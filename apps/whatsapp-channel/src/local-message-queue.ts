/**
 * File locale en mémoire, bornée en capacité et en concurrence, pour les
 * événements **message** uniquement (les statuts et types non supportés ne
 * la traversent jamais — voir `server.ts`).
 *
 * Garanties réellement fournies par cette file :
 *   - **réservation atomique** de l'identifiant à l'admission (synchrone,
 *     via `Deduplicator.beginProcessing`) — un doublon arrivé pendant que
 *     le premier est **encore en attente** (pas démarré) ou **déjà en
 *     cours** est détecté dans les deux cas, puisque la réservation est
 *     prise au moment de l'admission, pas du démarrage du traitement ;
 *   - **capacité bornée** (`maxQueueSize`, en attente + en cours) — une
 *     admission qui dépasserait la capacité est refusée et **libère**
 *     immédiatement la réservation qu'elle venait de prendre
 *     (`'rejected_capacity'`), afin qu'une relivraison ultérieure du même
 *     identifiant ne soit jamais traitée comme un faux doublon ;
 *   - **concurrence bornée** (`maxConcurrency`) — au plus N événements
 *     traités en parallèle, le reste patiente dans la file interne ;
 *   - **historique des issues borné** (`maxRetainedOutcomes`) — une file de
 *     travail bornée ne borne pas automatiquement son historique : sans
 *     cette limite, `getOutcome()` resterait disponible indéfiniment pour
 *     *tout* message jamais traité, faisant grossir la mémoire avec le
 *     volume total historique plutôt qu'avec la charge courante. Éviction
 *     FIFO — un ancien outcome évincé devient simplement introuvable via
 *     `getOutcome()` (`undefined`), sans affecter la déduplication (portée
 *     séparément par `Deduplicator`, voir `in-memory-deduplicator.ts`) ;
 *   - **suivi, jamais fire-and-forget** — chaque admission acceptée est
 *     explicitement planifiée (`#scheduleNext`), son issue est capturée et
 *     consultable (`getOutcome`), et `drain()`/`close()` permettent
 *     d'attendre/arrêter proprement, avec délai optionnel observable (voir
 *     plus bas).
 *
 * Garantie **non** fournie, explicitement : la durabilité. Tout l'état
 * (réservations, événements en attente, issues) vit en mémoire du process.
 * Un crash entre l'admission (accusé HTTP déjà envoyé) et la fin réelle du
 * traitement perd silencieusement le travail en cours — ni pire ni mieux
 * qu'un redémarrage, qui réinitialise entièrement la file et le
 * déduplicateur. Cette file ne permet donc pas, à elle seule, une
 * exposition réseau réelle fiable : une file durable (persistée) serait
 * nécessaire pour fermer cet écart — hors périmètre de cette tranche.
 *
 * `drain()`/`close()` **avec délai** n'annulent jamais un traitement en
 * cours — `Promise.race` ne peut pas interrompre un service/transport qui
 * ne se résout jamais, et libérer sa réservation sous prétexte d'un délai
 * écoulé permettrait une exécution concurrente du **même** message (la
 * garantie que ce fichier existe pour fournir). Un délai écoulé fait donc
 * seulement cesser d'**attendre** (résultat observable, voir
 * {@link DrainResult}/{@link CloseResult}) — le travail bloqué continue, sa
 * réservation reste détenue tant qu'il ne se termine pas (ou jamais). Une
 * annulation réelle exigerait un contrat d'annulation (`AbortSignal`) sur
 * `ConversationalService`/`OutboundTransport`, absent aujourd'hui — décision
 * séparée, non ajoutée ici (voir le rapport d'intégration).
 */
import type {
  ChannelOutcome,
  ConversationalService,
  Deduplicator,
  MessageChannelEvent,
  OutboundTransport,
  SenderAllowlist,
} from './channel-ports.js';
import { executeMessageEvent } from './execute-message-event.js';

export type AdmissionResult = 'queued' | 'duplicate' | 'rejected_capacity' | 'closed';

export type DrainResult =
  | { readonly status: 'idle' }
  | { readonly status: 'timed_out'; readonly pendingCount: number; readonly activeCount: number };

export type CloseResult =
  | { readonly status: 'closed' }
  | {
      readonly status: 'closed_with_pending_work';
      readonly pendingCount: number;
      readonly activeCount: number;
    };

/** Nombre d'issues (`ChannelOutcome`) conservées par défaut avant éviction FIFO. */
export const DEFAULT_MAX_RETAINED_OUTCOMES = 1000;

export interface LocalMessageQueueOptions {
  readonly deduplicator: Deduplicator;
  readonly allowlist: SenderAllowlist;
  readonly conversationalService: ConversationalService;
  readonly transport: OutboundTransport;
  /** Nombre maximum d'événements admis simultanément (en attente + en cours). */
  readonly maxQueueSize: number;
  /** Nombre maximum d'événements traités en parallèle. */
  readonly maxConcurrency: number;
  /** Défaut : {@link DEFAULT_MAX_RETAINED_OUTCOMES}. Voir l'en-tête de fichier. */
  readonly maxRetainedOutcomes?: number;
}

export class LocalMessageQueue {
  readonly #deduplicator: Deduplicator;
  readonly #deps: {
    allowlist: SenderAllowlist;
    conversationalService: ConversationalService;
    transport: OutboundTransport;
  };
  readonly #maxQueueSize: number;
  readonly #maxConcurrency: number;
  readonly #maxRetainedOutcomes: number;
  readonly #pending: MessageChannelEvent[] = [];
  readonly #outcomes = new Map<string, ChannelOutcome>();
  #idleWaiters: Array<() => void> = [];
  #active = 0;
  #closed = false;

  constructor(options: LocalMessageQueueOptions) {
    if (!Number.isInteger(options.maxQueueSize) || options.maxQueueSize < 1) {
      throw new Error('LocalMessageQueue : « maxQueueSize » doit être un entier >= 1.');
    }
    if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
      throw new Error('LocalMessageQueue : « maxConcurrency » doit être un entier >= 1.');
    }
    const maxRetainedOutcomes = options.maxRetainedOutcomes ?? DEFAULT_MAX_RETAINED_OUTCOMES;
    if (!Number.isInteger(maxRetainedOutcomes) || maxRetainedOutcomes < 1) {
      throw new Error('LocalMessageQueue : « maxRetainedOutcomes » doit être un entier >= 1.');
    }
    this.#deduplicator = options.deduplicator;
    this.#deps = {
      allowlist: options.allowlist,
      conversationalService: options.conversationalService,
      transport: options.transport,
    };
    this.#maxQueueSize = options.maxQueueSize;
    this.#maxConcurrency = options.maxConcurrency;
    this.#maxRetainedOutcomes = maxRetainedOutcomes;
  }

  /** Nombre d'événements admis en attente d'un worker (hors ceux déjà en cours). */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Nombre d'événements actuellement en cours de traitement. */
  get activeCount(): number {
    return this.#active;
  }

  /** Nombre d'issues actuellement retenues (observabilité — voir `maxRetainedOutcomes`). */
  get retainedOutcomeCount(): number {
    return this.#outcomes.size;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Admission **synchrone** : la réservation de déduplication et la
   * décision de capacité sont prises avant tout `await`, donc atomiques
   * vis-à-vis de deux admissions concurrentes du même identifiant (aucune
   * fenêtre d'interleaving possible en Node mono-thread).
   */
  admit(event: MessageChannelEvent): AdmissionResult {
    if (this.#closed) {
      return 'closed';
    }

    const claim = this.#deduplicator.beginProcessing(event.id);
    if (claim === 'duplicate') {
      return 'duplicate';
    }

    if (this.#pending.length + this.#active >= this.#maxQueueSize) {
      // Ne jamais laisser l'identifiant faussement « réservé » : une
      // relivraison ultérieure doit pouvoir retenter un admission neuve.
      this.#deduplicator.finish(event.id, 'released');
      return 'rejected_capacity';
    }

    this.#pending.push(event);
    this.#scheduleNext();
    return 'queued';
  }

  /** Issue terminale d'un événement déjà exécuté, ou `undefined` (jamais exécuté / en cours / évincé — voir `maxRetainedOutcomes`). */
  getOutcome(eventId: string): ChannelOutcome | undefined {
    return this.#outcomes.get(eventId);
  }

  /**
   * Résout lorsque la file est inactive (aucun événement en attente ni en
   * cours). Immédiat si déjà inactive. Sans `timeoutMs`, peut attendre
   * indéfiniment si un service/transport ne se résout jamais — voir l'en-tête
   * de fichier. Avec `timeoutMs`, résout au plus tard après ce délai avec
   * `{status:'timed_out', …}` si la file n'est toujours pas inactive —
   * sans jamais toucher au travail en cours.
   */
  async drain(timeoutMs?: number): Promise<DrainResult> {
    if (this.#isIdle()) {
      return { status: 'idle' };
    }
    if (timeoutMs === undefined) {
      await new Promise<void>((resolve) => {
        this.#idleWaiters.push(resolve);
      });
      return { status: 'idle' };
    }
    return new Promise<DrainResult>((resolve) => {
      let settled = false;
      const onIdle = (): void => {
        if (settled) return;
        settled = true;
        resolve({ status: 'idle' });
      };
      this.#idleWaiters.push(onIdle);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#idleWaiters = this.#idleWaiters.filter((w) => w !== onIdle);
        resolve({
          status: 'timed_out',
          pendingCount: this.#pending.length,
          activeCount: this.#active,
        });
      }, timeoutMs);
    });
  }

  /**
   * Fermeture maîtrisée : refuse immédiatement toute nouvelle admission
   * (`'closed'`), puis attend que le travail déjà admis se termine
   * (`drain`). N'annule **jamais** un traitement en cours — voir l'en-tête
   * de fichier. Sans `timeoutMs`, peut ne jamais résoudre si un
   * traitement ne se termine jamais ; avec `timeoutMs`, résout au plus
   * tard après ce délai avec `'closed_with_pending_work'` si du travail
   * reste en cours, sans libérer sa réservation.
   */
  async close(timeoutMs?: number): Promise<CloseResult> {
    this.#closed = true;
    const result = await this.drain(timeoutMs);
    if (result.status === 'idle') {
      return { status: 'closed' };
    }
    return {
      status: 'closed_with_pending_work',
      pendingCount: result.pendingCount,
      activeCount: result.activeCount,
    };
  }

  #isIdle(): boolean {
    return this.#pending.length === 0 && this.#active === 0;
  }

  #scheduleNext(): void {
    while (this.#active < this.#maxConcurrency && this.#pending.length > 0) {
      const event = this.#pending.shift();
      if (event === undefined) break;
      this.#active += 1;
      // Non attendu ici par conception (ne doit jamais bloquer `admit`),
      // mais **suivi** : complétion capturée dans `#runJob`, jamais perdue.
      void this.#runJob(event);
    }
  }

  async #runJob(event: MessageChannelEvent): Promise<void> {
    const outcome = await executeMessageEvent(event, this.#deps);
    this.#deduplicator.finish(
      event.id,
      blocksAutomaticRedelivery(outcome) ? 'completed' : 'released',
    );
    this.#recordOutcome(event.id, outcome);
    this.#active -= 1;
    this.#scheduleNext();
    this.#notifyIfIdle();
  }

  #recordOutcome(eventId: string, outcome: ChannelOutcome): void {
    this.#outcomes.set(eventId, outcome);
    while (this.#outcomes.size > this.#maxRetainedOutcomes) {
      const oldest = this.#outcomes.keys().next();
      if (oldest.done === true) break;
      this.#outcomes.delete(oldest.value);
    }
  }

  #notifyIfIdle(): void {
    if (!this.#isIdle()) {
      return;
    }
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

/**
 * Décide si une issue marque l'identifiant `'completed'` (aucune relance
 * **automatique** tant qu'il reste retenu) ou le libère pour une
 * relivraison immédiate (`'released'`).
 *
 * **Garantie exacte, pas une garantie absolue** : `'completed'` empêche une
 * relance automatique seulement **pour la durée où cet identifiant reste
 * effectivement retenu dans ce process** — voir
 * `in-memory-deduplicator.ts` : les entrées `completed` sont bornées
 * (`maxCompletedEntries`) et évincées en FIFO, et tout l'état est perdu au
 * redémarrage. Un identifiant évincé, ou retrouvé après redémarrage, est
 * retraité comme un essai neuf si redélivré — ce n'est jamais un blocage
 * « définitif » ni une promesse de « jamais de renvoi » au sens absolu, et
 * ne doit pas être présenté comme tel.
 *
 * `'transport_uncertain'` est traité **comme** `'replied'` ici — pas parce
 * que l'envoi est confirmé, mais parce qu'une relance automatique risquerait
 * un double envoi si le message a en réalité été délivré (voir
 * `graph-api-transport.ts` : un timeout n'est jamais une preuve de
 * non-envoi). L'issue réelle reste distincte et consultable via
 * `getOutcome()` (tant que non évincée — voir `maxRetainedOutcomes`) — une
 * décision de relance reste possible, mais seulement explicite, hors de
 * cette politique automatique.
 */
function blocksAutomaticRedelivery(outcome: ChannelOutcome): boolean {
  return outcome.status === 'replied' || outcome.status === 'transport_uncertain';
}
