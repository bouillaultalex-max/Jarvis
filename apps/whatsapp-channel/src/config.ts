/**
 * Configuration locale de cette tranche. Volontairement **minimale** :
 * aucun `accessToken` ni `phoneNumberId` n'est demandé, puisqu'aucun
 * transport réseau réel n'est branché ici (voir `simulated-transport.ts`).
 * Ces champs seront ajoutés **au moment** où un transport Graph API réel
 * sera introduit — pas avant, pour ne jamais donner l'impression qu'un
 * secret est déjà nécessaire ou exploité dans cette tranche.
 */
export interface WhatsAppChannelConfig {
  /** Jeton de vérification du handshake (`hub.verify_token`) — valeur locale synthétique. */
  readonly verifyToken: string;
  /** Secret HMAC du webhook — valeur locale synthétique, jamais un App Secret réel. */
  readonly appSecret: string;
  /** Unique expéditeur autorisé dans ce premier parcours (Alexandre) — valeur locale synthétique. */
  readonly allowedSenderId: string;
}

/**
 * Limite de taille du corps webhook. **Choix applicatif local pour cette
 * tranche** — ne reflète aucune limite officielle documentée par Meta
 * (non vérifiée dans cette session). À réviser une fois la limite réelle
 * confirmée, avant tout essai avec un fournisseur réel.
 */
export const LOCAL_BODY_LIMIT_BYTES = 262_144; // 256 KiB

/**
 * Capacité (`maxActiveDepth`) et rétention totale (`maxStoredMessages`) du
 * store durable vivent désormais dans `sqlite-message-store.ts`
 * (`DEFAULT_MAX_ACTIVE_DEPTH`/`DEFAULT_MAX_STORED_MESSAGES`, ADR-0023) —
 * seule la concurrence du worker reste un choix de ce bootstrap.
 */
export const DEFAULT_QUEUE_MAX_CONCURRENCY = 4;

/**
 * Construit une configuration locale synthétique pour le bootstrap
 * (`main.ts`) et les tests qui n'en fournissent pas une à eux-mêmes.
 * Aucune de ces valeurs n'est un secret réel.
 */
export function buildLocalSyntheticConfig(
  overrides: Partial<WhatsAppChannelConfig> = {},
): WhatsAppChannelConfig {
  return {
    verifyToken: 'local-dev-verify-token',
    appSecret: 'local-dev-app-secret-never-real',
    allowedSenderId: '33600000000',
    ...overrides,
  };
}
