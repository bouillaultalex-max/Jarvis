import { exec } from 'node:child_process';

import {
  connectGmailAccount,
  GmailOAuthFlow,
  InMemoryAccountStore,
  InMemorySecretStore,
} from '@jarvis/connectors';

import { startGmailOAuthCallbackServer } from './gmail-oauth-callback-server.js';

/**
 * Démonstrateur du flux OAuth Gmail desktop — M8-B2.
 *
 * Orchestration explicite et manuelle, comme `apps/api/src/main.ts` :
 * démarre le listener local, ouvre le navigateur système, attend le
 * callback, délègue la validation `state`/l'échange de tokens/la
 * récupération d'identité à `GmailOAuthFlow` (`@jarvis/connectors`), puis
 * transmet le résultat à `connectGmailAccount` — sans jamais manipuler de
 * secret directement ici.
 *
 * `InMemoryAccountStore`/`InMemorySecretStore` : aucun stockage de
 * production n'est introduit par ce jalon (volontairement hors scope) — le
 * compte connecté ne survit pas au-delà de ce processus. C'est une
 * limitation connue et acceptée pour ce démonstrateur, pas un oubli.
 */

function openSystemBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) {
      console.log(`Ouvrez cette URL dans votre navigateur pour connecter un compte Gmail :\n${url}`);
    }
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET sont requis (variables d’environnement) pour lancer la connexion Gmail.',
    );
  }

  const callbackServer = await startGmailOAuthCallbackServer();
  const flow = new GmailOAuthFlow({ clientId, redirectUri: callbackServer.redirectUri });

  console.log('Ouverture du navigateur système pour connecter un compte Gmail…');
  openSystemBrowser(flow.authorizationUrl);

  const callback = await callbackServer.result;
  const result = await flow.completeWithCallback(callback, { clientSecret });

  const accountStore = new InMemoryAccountStore();
  const secretStore = new InMemorySecretStore();
  const outcome = await connectGmailAccount({ result, accountStore, secretStore });

  console.log('Résultat de la connexion Gmail :', outcome);
}

main().catch((err) => {
  console.error('Échec de la connexion Gmail :', err instanceof Error ? err.message : err);
  process.exit(1);
});
