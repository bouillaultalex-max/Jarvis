import { Readable, Writable } from 'node:stream';

import {
  AmbiguousAccountError,
  InMemoryAccountStore,
  InMemorySecretStore,
  PermissionManager,
  connectGmailAccount,
  type ConnectGmailAccountOutcome,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import {
  dispatch,
  resolveOrConnectGmailAccount,
  runConnectFlow,
  runSendFlow,
  type DesktopDeps,
} from './main.js';

/**
 * M8-B5 — câblage de `runGmailSend` dans `apps/desktop` (sous-commande `send`).
 *
 * `fetchFn` mocké pour l'échange OAuth et l'appel Gmail `send` (aucun réseau
 * réel). Le seam `connect` (consentement OAuth navigateur + callback loopback)
 * est un faux dans les tests — même compromis que M8-B3 (`main.test.ts`). Les
 * mécaniques internes de `runGmailSend` / `ConfirmationService` /
 * `PermissionManager` / `ToolExecutor` (prouvées par M8-B4) ne sont PAS
 * re-testées ni mockées : seul le câblage l'est.
 *
 * Toutes les valeurs (adresses, contenu, tokens) sont artificielles.
 */

const APP_CREDENTIALS: GmailAppCredentials = {
  clientId: 'app-client-id',
  clientSecret: 'FAKE-APP-CLIENT-SECRET',
};
const SEND_ARGS = [
  '--to',
  'dest@example.test',
  '--subject',
  'Salut',
  '--body',
  'Ceci est un test',
] as const;
const LEAK_MARKER = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildFakeGmail(accessTokenByRefreshToken: ReadonlyMap<string, string>) {
  const sendCalls: string[] = [];
  const tokenExchanges: string[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      tokenExchanges.push(refreshToken);
      const accessToken = accessTokenByRefreshToken.get(refreshToken);
      return accessToken === undefined
        ? jsonResponse(400, { error: 'invalid_grant' })
        : jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      const body = JSON.parse(String(init?.body)) as { raw: string };
      sendCalls.push(Buffer.from(body.raw, 'base64url').toString('utf-8'));
      return jsonResponse(200, { id: 'sent-1', threadId: 'thread-xyz' });
    }
    return jsonResponse(500, { error: `URL inattendue : ${url}` });
  });

  return { fetchFn, sendCalls, tokenExchanges };
}

function successResult(accountIdentifier: string, refreshToken: string): GmailOAuthResult {
  return { status: 'success', identity: { accountIdentifier }, refreshToken };
}

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

async function connectedStores(refreshToken = 'refresh-token-1'): Promise<{
  accountStore: InMemoryAccountStore;
  secretStore: InMemorySecretStore;
  accountId: string;
}> {
  const accountStore = new InMemoryAccountStore();
  const secretStore = new InMemorySecretStore();
  const outcome = await connectGmailAccount({
    result: successResult('alice@example.test', refreshToken),
    accountStore,
    secretStore,
  });
  if (outcome.status !== 'connected') throw new Error('unreachable');
  return { accountStore, secretStore, accountId: outcome.accountId };
}

/** Seam OAuth qui ÉCHOUE le test s'il est appelé (prouve « OAuth non relancé »). */
const forbiddenConnect = vi.fn(async (): Promise<ConnectGmailAccountOutcome> => {
  throw new Error('le flux OAuth ne doit pas être relancé');
});

describe('M8-B5 — sous-commande send (câblage)', () => {
  it('compte connecté + confirmation « y » → gmail.send exécuté une fois, ligne de succès, OAuth non relancé', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, sendCalls, tokenExchanges } = buildFakeGmail(
      new Map([['refresh-token-1', 'access-token-1']]),
    );
    const { output, readText } = collectingOutput();
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };

    await dispatch(
      ['send', ...SEND_ARGS],
      deps,
      { input: Readable.from(['y\n']), output },
      forbiddenConnect,
    );

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toContain('To: dest@example.test');
    expect(tokenExchanges).toEqual(['refresh-token-1']);
    expect(readText()).toContain('Email envoyé (id Gmail : sent-1).');
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('compte connecté + confirmation « n » → aucun appel Gmail, ligne d’annulation', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const { fetchFn, sendCalls } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]));
    const { output, readText } = collectingOutput();
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };

    await dispatch(
      ['send', ...SEND_ARGS],
      deps,
      { input: Readable.from(['n\n']), output },
      forbiddenConnect,
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(sendCalls).toHaveLength(0);
    expect(readText()).toContain('Envoi annulé : confirmation refusée.');
  });

  it('PermissionManager deny → denied, aucun appel Gmail, confirm jamais invoqué', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const { fetchFn, sendCalls } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]));
    const { output, readText } = collectingOutput();
    const confirm = vi.fn(async () => true);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      permissionManager: new PermissionManager({ rules: { 'gmail.send': 'deny' } }),
    };

    const write = (line: string): void => {
      output.write(`${line}\n`);
    };
    const result = await runSendFlow(
      deps,
      { to: 'dest@example.test', subject: 's', body: 'b' },
      confirm,
      write,
      forbiddenConnect,
    );

    expect(result.status).toBe('denied');
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(sendCalls).toHaveLength(0);
    expect(readText()).toContain('Envoi refusé par la politique de permissions.');
  });

  it('aucun compte + pas de GMAIL_ACCOUNT_ID → OAuth déclenché dans la même invocation, puis envoi', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { fetchFn, sendCalls } = buildFakeGmail(
      new Map([['refresh-token-new', 'access-token-new']]),
    );
    const { output, readText } = collectingOutput();

    const connect = vi.fn(async (deps: DesktopDeps): Promise<ConnectGmailAccountOutcome> => {
      return connectGmailAccount({
        result: successResult('alice@example.test', 'refresh-token-new'),
        accountStore: deps.accountStore,
        secretStore: deps.secretStore,
      });
    });

    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    await dispatch(
      ['send', ...SEND_ARGS],
      deps,
      { input: Readable.from(['oui\n']), output },
      connect,
    );

    expect(connect).toHaveBeenCalledTimes(1);
    expect(sendCalls).toHaveLength(1);
    expect(readText()).toContain('Email envoyé (id Gmail : sent-1).');
  });

  it('plusieurs comptes sans GMAIL_ACCOUNT_ID → AmbiguousAccountError propagée, OAuth non relancé, aucun appel Gmail', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    await connectGmailAccount({
      result: successResult('a@example.test', 'rt-A'),
      accountStore,
      secretStore,
    });
    await connectGmailAccount({
      result: successResult('b@example.test', 'rt-B'),
      accountStore,
      secretStore,
    });
    const { fetchFn } = buildFakeGmail(new Map());
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };

    await expect(
      resolveOrConnectGmailAccount(deps, () => undefined, forbiddenConnect),
    ).rejects.toBeInstanceOf(AmbiguousAccountError);
    expect(forbiddenConnect).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('GMAIL_ACCOUNT_ID explicite → ce compte est utilisé, jamais un autre', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const a = await connectGmailAccount({
      result: successResult('a@example.test', 'rt-A'),
      accountStore,
      secretStore,
    });
    const b = await connectGmailAccount({
      result: successResult('b@example.test', 'rt-B'),
      accountStore,
      secretStore,
    });
    if (a.status !== 'connected' || b.status !== 'connected') throw new Error('unreachable');
    const { fetchFn, sendCalls, tokenExchanges } = buildFakeGmail(
      new Map([['rt-B', 'access-token-B']]),
    );
    const { output } = collectingOutput();

    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      accountId: b.accountId,
    };
    await dispatch(
      ['send', ...SEND_ARGS],
      deps,
      { input: Readable.from(['y\n']), output },
      forbiddenConnect,
    );

    expect(tokenExchanges).toEqual(['rt-B']);
    expect(tokenExchanges).not.toContain('rt-A');
    expect(sendCalls).toHaveLength(1);
  });

  it('dispatch sans argument (défaut) et « connect » → flux connexion inchangé, OAuth non relancé si compte exploitable', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const deps: DesktopDeps = { accountStore, secretStore, appCredentials: APP_CREDENTIALS };

    for (const argv of [[] as string[], ['connect']]) {
      const { output, readText } = collectingOutput();
      await dispatch(argv, deps, { output }, forbiddenConnect);
      expect(readText()).toContain('déjà connecté');
      expect(forbiddenConnect).not.toHaveBeenCalled();
    }
  });

  it('runConnectFlow : aucun compte → seam connect appelé, résultat affiché (jamais l’objet brut)', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { output, readText } = collectingOutput();
    const connect = vi.fn(async (): Promise<ConnectGmailAccountOutcome> => ({
      status: 'cancelled',
    }));

    await runConnectFlow(
      { accountStore, secretStore, appCredentials: APP_CREDENTIALS },
      (l) => output.write(`${l}\n`),
      connect,
    );

    expect(connect).toHaveBeenCalledTimes(1);
    expect(readText()).toContain('annulé par l’utilisateur');
    expect(readText()).not.toContain('{');
  });

  it('dispatch commande inconnue → erreur générique sans écho de la commande', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const deps: DesktopDeps = { accountStore, secretStore, appCredentials: APP_CREDENTIALS };
    const { output } = collectingOutput();

    await expect(dispatch(['bogus-cmd'], deps, { output }, forbiddenConnect)).rejects.toThrowError(
      /Commande inconnue/,
    );
    await expect(
      dispatch(['bogus-cmd'], deps, { output }, forbiddenConnect),
    ).rejects.not.toThrowError(/bogus-cmd/);
  });

  it('sécurité : le marqueur de refresh token n’apparaît ni dans la sortie terminal ni dans le résultat', async () => {
    const { accountStore, secretStore } = await connectedStores(LEAK_MARKER);
    const { fetchFn } = buildFakeGmail(new Map([[LEAK_MARKER, 'access-token-secure']]));
    const { output, readText } = collectingOutput();
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };

    const write = (line: string): void => {
      output.write(`${line}\n`);
    };
    const confirm = createAcceptingConfirm();
    const result = await runSendFlow(
      deps,
      { to: 'dest@example.test', subject: 's', body: 'b' },
      confirm,
      write,
      forbiddenConnect,
    );

    expect(result.status).toBe('executed');
    expect(readText()).not.toContain(LEAK_MARKER);
    expect(JSON.stringify(result)).not.toContain(LEAK_MARKER);
  });

  it('sécurité : marqueur absent aussi en cas de refus', async () => {
    const { accountStore, secretStore } = await connectedStores(LEAK_MARKER);
    const { fetchFn } = buildFakeGmail(new Map([[LEAK_MARKER, 'access-token-secure']]));
    const { output, readText } = collectingOutput();
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };

    const write = (line: string): void => {
      output.write(`${line}\n`);
    };
    const result = await runSendFlow(
      deps,
      { to: 'dest@example.test', subject: 's', body: 'b' },
      async () => false,
      write,
      forbiddenConnect,
    );

    expect(result.status).toBe('confirmation_declined');
    expect(readText()).not.toContain(LEAK_MARKER);
    expect(JSON.stringify(result)).not.toContain(LEAK_MARKER);
  });

  it('M8-B6 — l’API Gmail refuse l’envoi (HTTP 500) après confirmation → ligne d’échec, jamais un faux succès', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const failingFetchFn = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
          return jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          return jsonResponse(500, { error: 'internal_error' });
        }
        return jsonResponse(500, { error: `URL inattendue : ${url}` });
      },
    );
    const { output, readText } = collectingOutput();
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn: failingFetchFn,
    };

    await dispatch(
      ['send', ...SEND_ARGS],
      deps,
      { input: Readable.from(['y\n']), output },
      forbiddenConnect,
    );

    expect(readText()).toContain('Envoi échoué (error).');
    expect(readText()).not.toContain('Email envoyé');
  });
});

function createAcceptingConfirm(): () => Promise<boolean> {
  return async () => true;
}
