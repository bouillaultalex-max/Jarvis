/**
 * Worker local durable (ADR-0023) — remplace `LocalMessageQueue` +
 * `InMemoryDeduplicator`. L'admission et tout l'état de traitement vivent
 * dans `MessageStore` (persisté) ; ce fichier ne garde en mémoire que le
 * compteur de concurrence courante, reconstruit à chaque démarrage à partir
 * du store, jamais une source de vérité en lui-même.
 *
 * Chaque unité de concurrence traite **une étape** à la fois, jamais un
 * message de bout en bout dans un seul job :
 *   - un `queued` réclamé devient un job de **génération** (→ `response_ready`
 *     ou `failed` démontré sans envoi) ;
 *   - un `response_ready` réclamé devient un job d'**envoi** (→ `sent` /
 *     `uncertain` / `failed` démontré sans envoi).
 * Un même message traverse donc le pool deux fois (généralement
 * consécutives). Les `response_ready` sont réclamés en priorité sur les
 * `queued` pour vider en premier le travail déjà proche de son terme.
 *
 * ## Distinction cruciale `failed` vs `uncertain` à l'envoi
 *
 * Une exception **inattendue** levée par `sendResponse` (bug d'un double,
 * exception non capturée par le transport lui-même) n'est **jamais** mappée
 * vers `failed` : contrairement à une génération ratée (où aucun appel
 * réseau n'a pu avoir lieu), une exception survenue **pendant l'envoi** ne
 * prouve rien sur ce que le fournisseur a reçu — exactement le raisonnement
 * déjà posé par ADR-0022 pour `TransportResult.uncertain`. Seul un
 * `TransportResult.status === 'error'` (échec **démontré**, contrat déjà
 * strict côté `graph-api-transport.ts`/`channel-ports.ts`) est mappé vers
 * `failed`. Toute autre issue d'envoi non confirmée va vers `uncertain`,
 * jamais relancée automatiquement.
 */
import type {
  ConversationalService,
  MessageChannelEvent,
  OutboundTransport,
  SenderAllowlist,
} from './channel-ports.js';
import { generateResponse } from './generate-response.js';
import type { AdmissionOutcome, MessageStore, StoredMessageRow } from './message-store.js';
import { MAX_RESPONSE_TEXT_LENGTH_CHARS } from './message-store.js';
import { sendResponse } from './send-response.js';

export interface DurableMessageWorkerOptions {
  readonly store: MessageStore;
  readonly allowlist: SenderAllowlist;
  readonly conversationalService: ConversationalService;
  readonly transport: OutboundTransport;
  readonly maxConcurrency: number;
}

export type DrainResult =
  { readonly status: 'idle' } | { readonly status: 'timed_out'; readonly activeCount: number };

export type CloseResult =
  | { readonly status: 'closed' }
  | { readonly status: 'closed_with_pending_work'; readonly activeCount: number };

function nowIso(): string {
  return new Date().toISOString();
}

export class DurableMessageWorker {
  readonly #store: MessageStore;
  readonly #deps: {
    allowlist: SenderAllowlist;
    conversationalService: ConversationalService;
    transport: OutboundTransport;
  };
  readonly #maxConcurrency: number;
  #active = 0;
  #closed = false;
  #idleWaiters: Array<() => void> = [];

  constructor(options: DurableMessageWorkerOptions) {
    if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
      throw new Error('DurableMessageWorker : « maxConcurrency » doit être un entier >= 1.');
    }
    this.#store = options.store;
    this.#deps = {
      allowlist: options.allowlist,
      conversationalService: options.conversationalService,
      transport: options.transport,
    };
    this.#maxConcurrency = options.maxConcurrency;
  }

  get activeCount(): number {
    return this.#active;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Admission durable et confirmée avant tout accusé HTTP — voir
   * `server.ts`. Une exception levée ici (erreur de stockage) doit
   * empêcher l'appelant de renvoyer 200, jamais être avalée.
   */
  admit(event: MessageChannelEvent): AdmissionOutcome {
    if (this.#closed) {
      return { kind: 'closed' };
    }
    const outcome = this.#store.admit({
      providerMessageId: event.id,
      senderId: event.senderId,
      text: event.text,
      now: nowIso(),
    });
    if (outcome.kind === 'admitted') {
      this.#scheduleNext();
    }
    return outcome;
  }

  /** À appeler une fois au démarrage, après `recoverAfterRestart()`, pour relancer tout travail resumable. */
  start(): void {
    this.#scheduleNext();
  }

  async drain(timeoutMs?: number): Promise<DrainResult> {
    if (this.#isIdle()) {
      return { status: 'idle' };
    }
    if (timeoutMs === undefined) {
      await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
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
        resolve({ status: 'timed_out', activeCount: this.#active });
      }, timeoutMs);
    });
  }

  async close(timeoutMs?: number): Promise<CloseResult> {
    this.#closed = true;
    const result = await this.drain(timeoutMs);
    return result.status === 'idle'
      ? { status: 'closed' }
      : { status: 'closed_with_pending_work', activeCount: result.activeCount };
  }

  #isIdle(): boolean {
    return this.#active === 0;
  }

  #scheduleNext(): void {
    while (this.#active < this.#maxConcurrency) {
      const now = nowIso();

      const responseReadyRow = this.#store.claimNextResponseReady(now);
      if (responseReadyRow !== undefined) {
        this.#active += 1;
        void this.#runSendJob(responseReadyRow);
        continue;
      }

      const queuedRow = this.#store.claimNextQueued(now);
      if (queuedRow !== undefined) {
        this.#active += 1;
        void this.#runGenerationJob(queuedRow);
        continue;
      }

      break;
    }
  }

  async #runGenerationJob(row: StoredMessageRow): Promise<void> {
    try {
      const result = await generateResponse(
        { senderId: row.senderId, text: row.text },
        {
          allowlist: this.#deps.allowlist,
          conversationalService: this.#deps.conversationalService,
        },
      );
      const now = nowIso();
      if (result.status === 'ok' && result.text.length > MAX_RESPONSE_TEXT_LENGTH_CHARS) {
        // Réponse générée trop longue (limite applicative locale, pas une
        // limite Meta — voir `sqlite-message-store.ts`) : traité comme un
        // échec de génération démontré sans envoi, jamais stocké tronqué
        // silencieusement ni envoyé tel quel.
        this.#store.recordGenerationFailed(row.providerMessageId, 'response_too_long', now);
      } else if (result.status === 'ok') {
        this.#store.recordResponseReady(row.providerMessageId, result.text, now);
      } else {
        // Toutes les issues terminales de génération sont des échecs
        // démontrés SANS envoi — aucun appel transport n'a pu avoir lieu à
        // ce stade (voir en-tête de fichier).
        const reason =
          result.outcome.status === 'ignored_unauthorized'
            ? 'ignored_unauthorized'
            : result.outcome.reason;
        this.#store.recordGenerationFailed(row.providerMessageId, reason, now);
      }
    } finally {
      this.#active -= 1;
      this.#scheduleNext();
      this.#notifyIfIdle();
    }
  }

  async #runSendJob(row: StoredMessageRow): Promise<void> {
    try {
      const outcome = await sendResponse(
        { recipientId: row.senderId, text: row.responseText ?? '' },
        { transport: this.#deps.transport },
      );
      const now = nowIso();
      if (outcome.status === 'replied') {
        this.#store.recordSent(row.providerMessageId, now);
      } else if (outcome.status === 'transport_error') {
        // Échec démontré sans envoi (ex. 4xx explicite) — voir `send-response.ts`.
        this.#store.recordSendRejected(row.providerMessageId, outcome.reason, now);
      } else {
        // `transport_uncertain` OU `processing_error` (exception inattendue
        // pendant l'envoi) : AUCUN des deux ne prouve une absence d'envoi —
        // jamais `failed`, toujours `uncertain`, jamais relancé automatiquement.
        this.#store.recordUncertain(row.providerMessageId, outcome.reason, now);
      }
    } finally {
      this.#active -= 1;
      this.#scheduleNext();
      this.#notifyIfIdle();
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
