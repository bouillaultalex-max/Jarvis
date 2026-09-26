import { requireSecret, type SecretStore } from '@jarvis/connectors';

import type { LegifranceEnvironment } from '../config/legifrance-config.js';

/**
 * Credentials du client OAuth PISTE — **jamais** stockés ni lus autrement
 * que via le `SecretStore` existant de `@jarvis/connectors` (aucun
 * `LegifranceSecretStore` parallèle, conformément à LEGAL-02B.1). Le flux
 * `client_credentials` de PISTE n'a pas de refresh token distinct : la
 * paire `clientId`/`clientSecret` *est* le secret complet, contrairement à
 * Gmail où seul le refresh token (pas `clientId`/`clientSecret`) passe par
 * `SecretStore` — voir la note de {@link resolveLegifranceCredentials}.
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

/**
 * Résout les {@link LegifranceCredentials} pour un environnement donné
 * depuis le `SecretStore` fourni.
 *
 * **Pourquoi via `SecretStore` et pas via une variable d'environnement**
 * (à la différence de `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`, lus
 * directement par `loadGmailCredentialsFromEnv`) : dans le flux
 * `client_credentials` de PISTE, il n'existe pas de refresh token séparé —
 * `clientSecret` *est* le secret complet et permanent de l'application. Il
 * mérite donc la même protection que le refresh token Gmail (coffre OS via
 * `OsCredentialSecretStore`, jamais un fichier `.env` en clair), pas le
 * traitement plus léger réservé à l'enregistrement OAuth applicatif de
 * Gmail. Les clés sont scindées par environnement
 * ({@link legifranceClientIdSecretKey}) : un `SecretStore` ne peut pas
 * mélanger un credential sandbox et un credential production sous la même
 * clé.
 *
 * @throws {SecretNotFoundError} si `client_id` ou `client_secret` est
 *   absent du `SecretStore` pour cet environnement — réutilise l'erreur
 *   déjà définie par `@jarvis/connectors`, aucune nouvelle classe
 *   d'erreur « credentials absents » n'est introduite ici.
 */
export async function resolveLegifranceCredentials(
  secretStore: SecretStore,
  environment: LegifranceEnvironment,
): Promise<LegifranceCredentials> {
  const clientId = await requireSecret(secretStore, legifranceClientIdSecretKey(environment));
  const clientSecret = await requireSecret(
    secretStore,
    legifranceClientSecretSecretKey(environment),
  );
  return { clientId, clientSecret };
}
