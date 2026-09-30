import type { LegifranceEnvironment } from '../config/legifrance-config.js';

/**
 * Credentials du client OAuth PISTE — **jamais** stockés ni lus autrement
 * que via le `SecretStore` de `@jarvis/connectors` (aucun
 * `LegifranceSecretStore` parallèle, conformément à LEGAL-02B.1). Le flux
 * `client_credentials` de PISTE n'a pas de refresh token distinct : la
 * paire `clientId`/`clientSecret` *est* le secret complet, contrairement à
 * Gmail où seul le refresh token (pas `clientId`/`clientSecret`) passe par
 * `SecretStore`.
 *
 * La résolution effective (`SecretStore` → `LegifranceCredentials`) vit
 * dans `@jarvis/connectors`
 * (`packages/connectors/src/legifrance/legifrance-credentials.ts`,
 * `resolveLegifranceCredentials`), pas ici : `@jarvis/legifrance-client`
 * reste une feuille sans dépendance `@jarvis/*` (cycle de packages corrigé
 * — voir PROJECT_STATE.md). Ce type et les constructeurs de clé ci-dessous
 * restent ici : ils sont purs, sans dépendance à `SecretStore`.
 */
export interface LegifranceCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Clé `SecretStore` du `client_id` PISTE pour un environnement donné —
 * **seul** endroit du package qui construit cette chaîne (même discipline
 * que `gmailRefreshTokenSecretKey` dans `@jarvis/connectors`) : tout code
 * qui a besoin de lire ou d'écrire ce secret doit appeler cette fonction
 * plutôt que de recopier le format littéralement.
 */
export function legifranceClientIdSecretKey(environment: LegifranceEnvironment): string {
  return `legifrance.${environment}.clientId`;
}

/** Clé `SecretStore` du `client_secret` PISTE pour un environnement donné — voir {@link legifranceClientIdSecretKey}. */
export function legifranceClientSecretSecretKey(environment: LegifranceEnvironment): string {
  return `legifrance.${environment}.clientSecret`;
}
