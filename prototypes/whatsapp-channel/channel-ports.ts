/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md` et
 * `README.md` de ce dossier. Zéro import `@jarvis/*` : ce fichier ne définit
 * que des contrats génériques, indépendants du fournisseur (WhatsApp,
 * Telegram…) et du moteur conversationnel (`AgentLoop` ou autre).
 *
 * ⚠️ **SUPERSEDED** — l'implémentation de référence vit désormais dans
 * `apps/whatsapp-channel/src/channel-ports.ts` (première intégration
 * locale). Ce fichier reste tel quel comme instantané historique, validé
 * par `whatsapp-channel.test.ts` de ce dossier — il ne reçoit plus
 * d'évolution. Ne pas modifier l'un sans l'autre sans en avoir
 * conscience : toute nouvelle fonctionnalité va dans `apps/whatsapp-channel`.
 */

/** Requête brute reçue par le canal, avant tout parsing fournisseur. */
export interface RawInboundRequest {
  /** Octets exacts du corps HTTP — jamais une resérialisation. */
  readonly rawBody: Buffer;
  /** En-têtes HTTP, noms déjà normalisés en minuscules par l'appelant. */
  readonly headers: Readonly<Record<string, string>>;
}

/** Requête de handshake webhook (paramètres de requête GET). */
export interface HandshakeRequest {
  readonly mode: string | undefined;
  readonly verifyToken: string | undefined;
  readonly challenge: string | undefined;
}

export type HandshakeResult =
  | { readonly status: 'ok'; readonly challenge: string }
  | { readonly status: 'rejected'; readonly reason: string };

export type SignatureVerificationResult =
  { readonly status: 'valid' } | { readonly status: 'invalid'; readonly reason: string };

/** Vérifie l'origine d'un événement sur ses octets bruts, avant parsing. */
export interface SignatureVerifier {
  verify(rawBody: Buffer, signatureHeader: string | undefined): SignatureVerificationResult;
}

/**
 * Événement normalisé, après parsing par un adaptateur spécifique au
 * fournisseur. Le cœur d'orchestration (`channel-processor.ts`) ne connaît
 * que cette forme — jamais le JSON brut d'un fournisseur donné.
 */
export type ChannelEvent =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly senderId: string;
      readonly text: string;
      readonly receivedAt: string;
    }
  /** Accusé de statut (livré/lu/échoué…) — jamais traité comme un message. */
  | { readonly kind: 'status'; readonly id: string }
  /** Type de contenu non pris en charge par ce MVP (image, audio…). */
  | { readonly kind: 'unsupported'; readonly id: string | undefined; readonly reason: string };

/** Qui a le droit de parler au canal — distinct des permissions d'outil. */
export interface SenderAllowlist {
  isAuthorized(senderId: string): boolean;
}

export type ClaimResult = 'proceed' | 'duplicate';

/** Issue terminale d'un traitement, transmise à {@link Deduplicator.finish}. */
export type ProcessingOutcome =
  /** Réponse effectivement envoyée — ne doit plus jamais être retraité. */
  | 'completed'
  /**
   * Aucun effet confirmé (erreur de service, erreur de transport, ou refus
   * d'autorisation) — l'identifiant est libéré : une relivraison ultérieure
   * du même identifiant est traitée comme un essai neuf, pas comme un
   * doublon. Politique **au moins une fois**, jamais « exactement une
   * fois » : si le service conversationnel réussit mais que le transport
   * échoue, une relivraison réexécute le service (nouvel appel, texte
   * éventuellement différent) puis retente l'envoi — accepté
   * explicitement pour ce prototype (voir README, Politique de
   * déduplication).
   */
  | 'released';

/**
 * Déduplication par identifiant d'événement, en deux temps :
 *   1. `beginProcessing` — **synchrone** à dessein : dans un process Node
 *      mono-thread, cela élimine toute fenêtre d'interleaving entre la
 *      vérification et le marquage, donc toute course entre deux livraisons
 *      concurrentes du même identifiant (voir tests « livraison
 *      concurrente »).
 *   2. `finish` — appelé une fois le traitement terminé, quelle qu'en soit
 *      l'issue, pour décider si l'identifiant reste bloqué (`completed`) ou
 *      redevient disponible pour une relivraison (`released`).
 *
 * Aucune des deux garanties ne survit à un redémarrage ni à plusieurs
 * instances du process (état en mémoire uniquement — voir README, Limites).
 * Un identifiant marqué `completed` puis le process redémarré serait
 * retraité comme neuf : aucune ambiguïté n'est résolue par ce prototype
 * entre « réponse envoyée dont l'accusé de réception a été perdu » et
 * « jamais traité » — voir README, Politique de déduplication.
 */
export interface Deduplicator {
  /** `'duplicate'` si déjà en cours ou terminé (`completed`) ; sinon marque « en cours » et renvoie `'proceed'`. */
  beginProcessing(eventId: string): ClaimResult;
  /** Fixe l'issue terminale — voir {@link ProcessingOutcome}. */
  finish(eventId: string, outcome: ProcessingOutcome): void;
}

export type ConversationalServiceResult =
  | { readonly status: 'ok'; readonly text: string }
  | { readonly status: 'error'; readonly reason: string };

/**
 * Port vers le moteur conversationnel. Aucune dépendance à `AgentLoop` ici —
 * un futur adaptateur `AgentLoop` → `ConversationalService` vivra ailleurs,
 * hors de ce prototype (voir ADR-0022, Hors périmètre).
 */
export interface ConversationalService {
  reply(input: {
    readonly senderId: string;
    readonly text: string;
  }): Promise<ConversationalServiceResult>;
}

export type TransportResult =
  { readonly status: 'sent' } | { readonly status: 'error'; readonly reason: string };

/** Port de sortie — aucun appel réseau réel dans ce prototype. */
export interface OutboundTransport {
  send(input: { readonly recipientId: string; readonly text: string }): Promise<TransportResult>;
}
