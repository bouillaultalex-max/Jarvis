import { LegifranceConfigError } from '../errors/legifrance-errors.js';

/**
 * Configuration Légifrance/PISTE — jalon LEGAL-02B.1.
 *
 * Volontairement **publique et sans secret** : `LegifranceConfig` ne porte
 * que des URLs déterminées par l'environnement, jamais `client_id`/
 * `client_secret` (voir `../auth/legifrance-credentials.ts`, qui passe par
 * le `SecretStore` existant de `@jarvis/connectors`).
 */
export type LegifranceEnvironment = 'sandbox' | 'production';

/** Ensemble des environnements connus — exposé pour la validation et les tests. */
export const LEGIFRANCE_ENVIRONMENTS: readonly LegifranceEnvironment[] = ['sandbox', 'production'];

export interface LegifranceConfig {
  readonly environment: LegifranceEnvironment;
  readonly oauthTokenUrl: string;
  readonly apiBaseUrl: string;
}

const SANDBOX_OAUTH_TOKEN_URL = 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token';
const SANDBOX_API_BASE_URL = 'https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app';
const PRODUCTION_OAUTH_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token';
const PRODUCTION_API_BASE_URL = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app';

/**
 * Construit la {@link LegifranceConfig} de l'environnement demandé.
 * Sandbox et production sont **structurellement distinctes** : les deux
 * jeux d'URLs sont des constantes séparées, jamais dérivées l'une de
 * l'autre par substitution de chaîne — pour qu'une erreur de construction
 * de chaîne ne puisse jamais faire pointer un environnement vers les URLs
 * de l'autre.
 */
export function createLegifranceConfig(environment: LegifranceEnvironment): LegifranceConfig {
  switch (environment) {
    case 'sandbox':
      return {
        environment,
        oauthTokenUrl: SANDBOX_OAUTH_TOKEN_URL,
        apiBaseUrl: SANDBOX_API_BASE_URL,
      };
    case 'production':
      return {
        environment,
        oauthTokenUrl: PRODUCTION_OAUTH_TOKEN_URL,
        apiBaseUrl: PRODUCTION_API_BASE_URL,
      };
  }
}

/**
 * Lit l'environnement Légifrance actif depuis une variable
 * d'environnement (`LEGIFRANCE_ENVIRONMENT`) — jamais les credentials
 * (voir `../auth/legifrance-credentials.ts`).
 *
 * **Aucune valeur par défaut, y compris `'sandbox'`** : une variable
 * absente ou invalide échoue explicitement plutôt que de choisir
 * silencieusement un environnement — en particulier, cette fonction ne
 * choisit **jamais** `'production'` par défaut (exigence explicite de
 * LEGAL-02B.1).
 *
 * @throws {LegifranceConfigError} si la variable est absente, vide, ou ne
 *   vaut ni `'sandbox'` ni `'production'`.
 */
export function resolveLegifranceEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegifranceEnvironment {
  const raw = env.LEGIFRANCE_ENVIRONMENT?.trim();
  if (!raw) {
    throw new LegifranceConfigError(
      'variable d’environnement LEGIFRANCE_ENVIRONMENT manquante (attendu : "sandbox" ou "production").',
    );
  }
  if (!LEGIFRANCE_ENVIRONMENTS.includes(raw as LegifranceEnvironment)) {
    throw new LegifranceConfigError(
      `LEGIFRANCE_ENVIRONMENT invalide (« ${raw} ») — attendu : ${LEGIFRANCE_ENVIRONMENTS.join(' ou ')}.`,
    );
  }
  return raw as LegifranceEnvironment;
}
