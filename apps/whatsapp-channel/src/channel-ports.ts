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

/**
 * La déduplication par identifiant d'événement (auparavant portée par
 * `Deduplicator`/`InMemoryDeduplicator`, en mémoire) est, depuis ADR-0023,
 * portée par `MessageStore.admit()` (`message-store.ts`) — durable,
 * transactionnelle, et seule source de vérité pour l'admission ET l'état de
 * traitement. `Deduplicator` n'existe plus : une admission durable exige
 * une seule décision atomique (réservation + capacité + réouverture bornée
 * d'un échec démontré), pas deux structures séparées à synchroniser.
 */

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
  | { readonly status: 'sent' }
  /** Échec certain — le transport sait que l'envoi n'a pas eu lieu (refus HTTP explicite, validation locale, erreur réseau avant toute réponse). */
  | { readonly status: 'error'; readonly reason: string }
  /**
   * Issue **incertaine** — la requête a pu atteindre le serveur et être
   * traitée avant que le transport ne puisse confirmer le résultat (délai
   * dépassé après envoi, réponse 2xx de forme inattendue, corps illisible
   * sur une réponse par ailleurs `ok`…). Ne jamais traiter comme un échec
   * certain : un timeout n'est **pas** une preuve de non-envoi. Voir
   * `graph-api-transport.ts` pour le détail des cas classés ainsi, et
   * `durable-message-worker.ts`/`send-response.ts` pour la politique de
   * non-relance automatique qui en découle.
   */
  | { readonly status: 'uncertain'; readonly reason: string };

/** Port de sortie — voir `simulated-transport.ts` (aucune implémentation réseau dans cette tranche). */
export interface OutboundTransport {
  send(input: { readonly recipientId: string; readonly text: string }): Promise<TransportResult>;
}

/**
 * Issue produite par les étapes de traitement d'un événement **message**
 * (`generate-response.ts`/`send-response.ts`), consommée par
 * `durable-message-worker.ts` pour décider de la transition `MessageStore`
 * correspondante (ADR-0023). Distincte du statut persistant
 * (`MessageStatus`, `message-store.ts`), qui seul survit à un redémarrage.
 */
export type ChannelOutcome =
  | { readonly status: 'replied' }
  | { readonly status: 'ignored_unauthorized' }
  | { readonly status: 'conversational_service_error'; readonly reason: string }
  | { readonly status: 'transport_error'; readonly reason: string }
  /**
   * Le transport a renvoyé `'uncertain'` (voir {@link TransportResult}) —
   * l'envoi a peut-être abouti. Jamais relancé automatiquement (voir
   * `durable-message-worker.ts` : mappé vers le statut durable `uncertain`,
   * jamais `failed`) précisément pour éviter un double envoi si le message
   * a en réalité été délivré. Une relance reste possible, mais seulement
   * via une décision explicite hors de cette tranche (jamais automatique).
   */
  | { readonly status: 'transport_uncertain'; readonly reason: string }
  /**
   * Exception inattendue (bug d'un double, erreur de programmation) levée
   * par `allowlist`/`conversationalService`/`transport` plutôt que renvoyée
   * comme résultat structuré.
   */
  | { readonly status: 'processing_error'; readonly reason: string };
