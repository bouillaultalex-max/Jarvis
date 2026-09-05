import { describe, expect, it } from 'vitest';

import { startGmailOAuthCallbackServer } from './gmail-oauth-callback-server.js';

/**
 * Le serveur lui-même est ce qui est testé ici : une requête HTTP réelle
 * vers `127.0.0.1` (le loopback local, jamais un service externe) est la
 * seule façon sensée de l'exercer — mocker `node:http` reviendrait à ne
 * plus tester le listener du tout. Aucun appel ne sort de la machine.
 */

describe('startGmailOAuthCallbackServer — M8-B2', () => {
  it('écoute sur 127.0.0.1, parse le callback (code + state), se ferme après le premier appel', async () => {
    const server = await startGmailOAuthCallbackServer();
    expect(server.redirectUri).toBe(`http://127.0.0.1:${server.port}/callback`);

    const [callback] = await Promise.all([
      server.result,
      fetch(`${server.redirectUri}?code=auth-code-1&state=state-xyz`),
    ]);

    expect(callback).toEqual({ code: 'auth-code-1', state: 'state-xyz' });

    // Fermé après le premier callback : une seconde requête ne peut plus se connecter.
    await expect(fetch(`${server.redirectUri}?code=x&state=y`)).rejects.toThrow();
  });

  it('transmet error=access_denied tel quel, sans le réinterpréter', async () => {
    const server = await startGmailOAuthCallbackServer();

    const [callback] = await Promise.all([
      server.result,
      fetch(`${server.redirectUri}?error=access_denied&state=state-xyz`),
    ]);

    expect(callback).toEqual({ state: 'state-xyz', error: 'access_denied' });
  });

  it('un chemin différent de /callback renvoie 404 sans jamais résoudre le résultat', async () => {
    const server = await startGmailOAuthCallbackServer();

    const response = await fetch(`http://127.0.0.1:${server.port}/other`);

    expect(response.status).toBe(404);
    await server.close();
  });

  it('deux instances démarrées en parallèle obtiennent des ports distincts (choix dynamique)', async () => {
    const serverA = await startGmailOAuthCallbackServer();
    const serverB = await startGmailOAuthCallbackServer();

    expect(serverA.port).not.toBe(serverB.port);

    await Promise.all([serverA.close(), serverB.close()]);
  });
});
