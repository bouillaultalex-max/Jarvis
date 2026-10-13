/**
 * Résolution de la configuration du mode **réel** — jamais appelée en mode
 * `simulated` (voir `build-channel-dependencies.ts`). Secrets lus via
 * `SecretStore` (`@jarvis/connectors`, même mécanisme déjà utilisé pour
 * Gmail/Légifrance — rien de nouveau inventé) ; identifiants non secrets
 * (`phoneNumberId`, `apiVersion`) et expéditeur autorisé lus depuis
 * l'environnement, jamais codés en dur.
 *
 * **Aucun repli synthétique** : toute valeur absente lève immédiatement —
 * {@link SecretNotFoundError} (`@jarvis/connectors`) pour un secret manquant,
 * {@link IncompleteRealConfigError} pour un champ non secret manquant. Ni
 * l'un ni l'autre ne cite de valeur, seulement le nom du champ/de la clé.
 */
import { requireSecret, SecretNotFoundError, type SecretStore } from '@jarvis/connectors';

export const WHATSAPP_APP_SECRET_KEY = 'whatsapp.appSecret';
export const WHATSAPP_VERIFY_TOKEN_KEY = 'whatsapp.verifyToken';
export const WHATSAPP_ACCESS_TOKEN_KEY = 'whatsapp.accessToken';

export interface RealWhatsAppConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly apiVersion: string;
  readonly allowedSenderId: string;
}

/** Un champ non secret (lu depuis l'environnement) est absent ou vide. */
export class IncompleteRealConfigError extends Error {
  constructor(public readonly missingEnvVar: string) {
    super(
      `Configuration réelle incomplète : variable d'environnement "${missingEnvVar}" absente ou vide. ` +
        'Aucun repli synthétique — le mode réel refuse de démarrer tant que ce champ manque.',
    );
    this.name = 'IncompleteRealConfigError';
  }
}

function requireEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new IncompleteRealConfigError(name);
  }
  return value;
}

/**
 * **Ordre délibéré, corrigé en revue finale** : les champs non secrets
 * (environnement, aucune E/S vers un trousseau) sont vérifiés **avant**
 * tout secret — un paramètre non secret manquant doit échouer sans jamais
 * avoir déclenché un seul accès au trousseau OS, y compris pour les
 * secrets qui auraient été présents.
 *
 * @throws {IncompleteRealConfigError} si `WHATSAPP_PHONE_NUMBER_ID`,
 *   `WHATSAPP_GRAPH_API_VERSION` ou `WHATSAPP_ALLOWED_SENDER_ID` est absent —
 *   vérifié en premier.
 * @throws {SecretNotFoundError} si `appSecret`/`verifyToken`/`accessToken`
 *   manque dans `secretStore` — vérifié seulement après.
 */
export async function resolveRealWhatsAppConfig(
  secretStore: SecretStore,
  env: Readonly<Record<string, string | undefined>>,
): Promise<RealWhatsAppConfig> {
  // Jamais une version supposée « actuelle » codée en dur ici — voir
  // `graph-api-transport.ts` : la version Graph API change avec le temps
  // (vérifiée à nouveau lors de cette mission : v26.0 est désormais la
  // dernière, v25.0 reste valide jusqu'en 2028,
  // https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) —
  // seule une version **explicitement configurée** est acceptée.
  const apiVersion = requireEnv(env, 'WHATSAPP_GRAPH_API_VERSION');
  const phoneNumberId = requireEnv(env, 'WHATSAPP_PHONE_NUMBER_ID');
  const allowedSenderId = requireEnv(env, 'WHATSAPP_ALLOWED_SENDER_ID');

  const appSecret = await requireSecret(secretStore, WHATSAPP_APP_SECRET_KEY);
  const verifyToken = await requireSecret(secretStore, WHATSAPP_VERIFY_TOKEN_KEY);
  const accessToken = await requireSecret(secretStore, WHATSAPP_ACCESS_TOKEN_KEY);

  return { appSecret, verifyToken, accessToken, phoneNumberId, apiVersion, allowedSenderId };
}

export { SecretNotFoundError };
