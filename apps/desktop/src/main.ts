import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  type Account,
  type AccountStore,
  type GmailAppCredentials,
  type SecretStore,
  connectGmailAccount,
  FileAccountStore,
  GmailOAuthFlow,
  OsCredentialSecretStore,
  resolveAccount,
  resolveGmailApiClient,
  UnknownAccountError,
} from '@jarvis/connectors';

import { startGmailOAuthCallbackServer } from './gmail-oauth-callback-server.js';

/**
 * Orchestration desktop du flux Gmail — M8-B2 (OAuth réel) + M8-B3
 * (persistance réelle + détection « déjà connecté »).
 *
 * `FileAccountStore`/`OsCredentialSecretStore` : implémentations réelles
 * réutilisées telles quelles (`@jarvis/connectors`) — aucune nouvelle
 * couche de stockage introduite ici. Le compte et son refresh token
 * survivent désormais à l'arrêt du process, contrairement à M8-B2
 * (`InMemoryAccountStore`/`InMemorySecretStore`, volontairement limité à
 * l'intérieur d'un seul run).
 */

function defaultAccountsFilePath(): string {
  const dataDir =
    process.env.JARVIS_DATA_DIR ??
    (process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')));

  return join(dataDir, 'jarvis', 'accounts.json');
}

function openSystemBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) {
      console.log(`Ouvrez cette URL dans votre navigateur pour connecter un compte Gmail :\n${url}`);
    }
  });
}

export interface ResolveExistingGmailConnectionOptions {
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  readonly appCredentials: GmailAppCredentials;
  /** Transmis tel quel à `resolveAccount()` — jamais choisi implicitement ici. */
  readonly accountId?: string;
}

/**
 * Détermine si un compte Gmail déjà connecté et immédiatement utilisable
 * existe, pour éviter de rouvrir inutilement un flux OAuth — M8-B3.
 *
 * Réutilise exclusivement des briques existantes, sans dupliquer leurs
 * règles :
 *   - `resolveAccount()` reste l'unique point de sélection de compte : un
 *     `accountId` absent avec plusieurs comptes Gmail persistés lève
 *     `AmbiguousAccountError`, propagée telle quelle — jamais de sélection
 *     arbitraire (« prendre le premier ») introduite ici.
 *   - Le statut du compte (`'connected'` vs `'disconnected'`/`'error'`) et
 *     la présence du secret ne sont **pas** revérifiés ici : c'est
 *     exactement la responsabilité déjà assumée par `resolveGmailCredentials`
 *     (via `resolveGmailApiClient`), inchangée depuis M8-A14. Un compte non
 *     `'connected'`, ou dont le secret est absent, fait donc simplement
 *     échouer `resolveGmailApiClient()` — traité ici comme « pas encore
 *     exploitable », sans réinterpréter la raison.
 *
 * @returns le compte déjà connecté et exploitable, ou `undefined` si un
 *   nouveau consentement OAuth est nécessaire (aucun compte pour ce
 *   provider, ou compte trouvé mais non exploitable).
 * @throws la même erreur que `resolveAccount()` pour tout cas autre
 *   qu'« aucun compte » (notamment `AmbiguousAccountError`) — jamais
 *   avalée.
 */
export async function resolveExistingGmailConnection(
  options: ResolveExistingGmailConnectionOptions,
): Promise<Account | undefined> {
  const { accountStore, secretStore, appCredentials, accountId } = options;

  let account: Account;
  try {
    account = await resolveAccount(accountStore, { provider: 'gmail', accountId });
  } catch (err) {
    if (err instanceof UnknownAccountError) {
      return undefined;
    }
    throw err;
  }

  try {
    // Construction seule, sans appel de méthode : `resolveGmailApiClient` ne
    // fait aucun appel réseau elle-même (voir gmail-client-resolver.ts) —
    // ce contrôle reste purement local.
    await resolveGmailApiClient({ account, secretStore, appCredentials });
    return account;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET sont requis (variables d’environnement) pour lancer la connexion Gmail.',
    );
  }
  const appCredentials: GmailAppCredentials = { clientId, clientSecret };

  const accountStore = new FileAccountStore({ filePath: defaultAccountsFilePath() });
  const secretStore = new OsCredentialSecretStore();
  const accountId = process.env.GMAIL_ACCOUNT_ID;

  const existingAccount = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials, accountId });
  if (existingAccount !== undefined) {
    console.log(
      `Compte Gmail déjà connecté : ${existingAccount.accountIdentifier} (accountId=${existingAccount.id}) — aucun nouveau consentement OAuth nécessaire.`,
    );
    return;
  }

  const callbackServer = await startGmailOAuthCallbackServer();
  const flow = new GmailOAuthFlow({ clientId, redirectUri: callbackServer.redirectUri });

  console.log('Ouverture du navigateur système pour connecter un compte Gmail…');
  openSystemBrowser(flow.authorizationUrl);

  const callback = await callbackServer.result;
  const result = await flow.completeWithCallback(callback, { clientSecret });

  const outcome = await connectGmailAccount({ result, accountStore, secretStore });
  console.log('Résultat de la connexion Gmail :', outcome);
}

// Garde d'entrée : ce module est importé directement par ses tests (pour
// exercer `resolveExistingGmailConnection` sans navigateur ni OAuth réel) —
// `main()` ne doit donc s'exécuter que lorsque ce fichier est le point
// d'entrée réel du process (exécuté en CommonJS, comme le reste du
// monorepo — aucun package.json ne déclare `"type": "module"`), jamais au
// simple import.
if (require.main === module) {
  main().catch((err) => {
    console.error('Échec de la connexion Gmail :', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
