import { createServer, type Server } from 'node:http';

import type { GmailOAuthCallbackParams } from '@jarvis/connectors';

/**
 * Listener HTTP loopback éphémère recevant le callback OAuth Google —
 * M8-B2. Écoute strictement sur `127.0.0.1`, jamais sur `0.0.0.0` ni une
 * autre interface. Se ferme automatiquement dès le premier callback reçu
 * (succès, erreur, ou `state` invalide) : aucune route permanente.
 *
 * Ne connaît ni `GmailOAuthFlow`, ni `connectGmailAccount`, ni
 * `AccountStore`/`SecretStore` — il ne fait que parser les paramètres bruts
 * de la requête HTTP en {@link GmailOAuthCallbackParams}, sans les
 * interpréter. L'orchestration (ouvrir le navigateur, valider le `state`,
 * échanger le code, connecter le compte) reste dans `main.ts`.
 */

export interface StartedGmailOAuthCallbackServer {
  readonly port: number;
  readonly redirectUri: string;
  /** Résolue à la réception du premier callback ; le serveur est alors déjà fermé. */
  readonly result: Promise<GmailOAuthCallbackParams>;
  close(): Promise<void>;
}

const DEFAULT_CALLBACK_PATH = '/callback';

/** Démarre le listener sur un port local choisi dynamiquement (évite toute collision). */
export function startGmailOAuthCallbackServer(
  path: string = DEFAULT_CALLBACK_PATH,
): Promise<StartedGmailOAuthCallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveResult!: (value: GmailOAuthCallbackParams) => void;
    const result = new Promise<GmailOAuthCallbackParams>((res) => {
      resolveResult = res;
    });

    const server: Server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== path) {
        res.writeHead(404).end();
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      const error = requestUrl.searchParams.get('error');
      const params: GmailOAuthCallbackParams = {
        ...(code !== null ? { code } : {}),
        ...(state !== null ? { state } : {}),
        ...(error !== null ? { error } : {}),
      };

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('JARVIS : vous pouvez fermer cette fenêtre et revenir à l’application.');

      resolveResult(params);
      server.close();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Callback OAuth local : impossible de déterminer le port attribué.'));
        return;
      }
      const port = address.port;
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}${path}`,
        result,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
