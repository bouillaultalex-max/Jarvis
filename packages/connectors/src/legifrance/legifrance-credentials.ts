import type { LegifranceCredentials, LegifranceEnvironment } from '@jarvis/legifrance-client';
import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from '@jarvis/legifrance-client';

import { requireSecret, type SecretStore } from '../secret-store.js';

/**
 * Résout les {@link LegifranceCredentials} pour un environnement donné
 * depuis le `SecretStore` fourni.
 *
 * Déplacé depuis `@jarvis/legifrance-client` (cycle de packages
 * `connectors` ↔ `legifrance-client`, PROJECT_STATE.md « Dette technique
 * connue » — corrigé ici) : cette résolution dépend de `SecretStore`, donc
 * elle vit dans `@jarvis/connectors` (qui le définit), pas dans
 * `@jarvis/legifrance-client`, qui reste une feuille sans dépendance
 * `@jarvis/*`. `LegifranceCredentials` et les constructeurs de clé
 * ({@link legifranceClientIdSecretKey}/{@link legifranceClientSecretSecretKey})
 * restent dans `@jarvis/legifrance-client` : ils sont purs, sans dépendance
 * à `SecretStore`.
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
 *   absent du `SecretStore` pour cet environnement.
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
