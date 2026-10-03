/**
 * Contrats génériques du canal conversationnel — indépendants du
 * fournisseur (WhatsApp, Telegram…) et du moteur conversationnel
 * (`AgentLoop` ou autre). Zéro import `@jarvis/*`.
 *
 * **Implémentation de référence** depuis cette intégration locale
 * (`apps/whatsapp-channel`) — voir `docs/adr/0022-whatsapp-channel-boundary.md`
 * (toujours `Proposed` : cette tranche retient des décisions d'implémentation
 * concrètes, elle ne vaut pas acceptation définitive de l'architecture).
 * Issu de `prototypes/whatsapp-channel/channel-ports.ts`, repris à
 * l'identique ici ; le prototype reste en l'état comme instantané historique
 * validé par ses propres tests, mais n'est plus la source de vérité —
 * voir `prototypes/whatsapp-channel/README.md`.
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
 * fournisseur. Le cœur d'orchestration ne connaît que cette forme — jamais
 * le JSON brut d'un fournisseur donné.
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

/** Un événement de type message, isolé du reste de l'union — utilisé par la file et l'exécuteur. */
export type MessageChannelEvent = Extract<ChannelEvent, { readonly kind: 'message' }>;

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
   * fois ».
   */
  | 'released';

/**
 * Déduplication par identifiant d'événement, en deux temps :
 *   1. `beginProcessing` — **synchrone** à dessein : dans un process Node
 *      mono-thread, cela élimine toute fenêtre d'interleaving entre la
 *      vérification et le marquage, donc toute course entre deux livraisons
 *      concurrentes du même identifiant.
 *   2. `finish` — appelé une fois le traitement terminé, quelle qu'en soit
 *      l'issue, pour décider si l'identifiant reste bloqué (`completed`) ou
 *      redevient disponible pour une relivraison (`released`).
 *
 * Aucune des deux garanties ne survit à un redémarrage ni à plusieurs
 * instances du process (état en mémoire uniquement). Dans cette intégration,
 * c'est {@link ../local-message-queue.js | LocalMessageQueue} qui appelle
 * `beginProcessing` **à l'admission** (avant d'empiler l'événement) et
 * `finish` une fois le traitement terminé — jamais l'exécuteur de message
 * lui-même (voir `execute-message-event.ts`).
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

/** Port vers le moteur conversationnel — voir `agent-loop-conversational-service.ts`. */
export interface ConversationalService {
  reply(input: {
    readonly senderId: string;
    readonly text: string;
  }): Promise<ConversationalServiceResult>;
}

export type TransportResult =
  { readonly status: 'sent' } | { readonly status: 'error'; readonly reason: string };

/** Port de sortie — voir `simulated-transport.ts` (aucune implémentation réseau dans cette tranche). */
export interface OutboundTransport {
  send(input: { readonly recipientId: string; readonly text: string }): Promise<TransportResult>;
}

/**
 * Issue définitive du traitement d'un événement **message** par l'exécuteur
 * (`execute-message-event.ts`). Distincte des issues d'admission de la file
 * (voir `local-message-queue.ts` → `AdmissionResult`), produites avant même
 * qu'un exécuteur ne soit invoqué.
 */
export type ChannelOutcome =
  | { readonly status: 'replied' }
  | { readonly status: 'ignored_unauthorized' }
  | { readonly status: 'conversational_service_error'; readonly reason: string }
  | { readonly status: 'transport_error'; readonly reason: string }
  /**
   * Exception inattendue (bug d'un double, erreur de programmation) levée
   * par `allowlist`/`conversationalService`/`transport` plutôt que renvoyée
   * comme résultat structuré.
   */
  | { readonly status: 'processing_error'; readonly reason: string };
