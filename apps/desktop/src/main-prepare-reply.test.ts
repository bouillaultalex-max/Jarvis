import { Readable, Writable } from 'node:stream';

import {
  AmbiguousAccountError,
  InMemoryAccountStore,
  InMemorySecretStore,
  PermissionManager,
  connectGmailAccount,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import { dispatch, runPrepareReplyFlow, type DesktopDeps } from './main.js';

/**
 * Câblage de la sous-commande `prepare-reply` de `apps/desktop` : appel du
 * Tool `gmail.prepare_reply` (`action: 'prepare'`, aucun effet de bord Gmail)
 * strictement via `ToolExecutor.run`.
 *
 * `fetchFn` mocké pour l'échange OAuth et l'appel Gmail `get` (aucun réseau
 * réel). Les mécaniques internes de `gmail.prepare_reply` (dérivation
 * `to`/`subject`/`threadId`, rejet d'input falsifié) ne sont PAS re-testées
 * ici — déjà prouvées par `gmail-connector.test.ts` : seul le câblage CLI
 * l'est (résolution de compte, passage par `ToolExecutor`, formatage de
 * sortie, transmission des arguments).
 *
 * Toutes les valeurs (adresses, contenu, tokens) sont artificielles.
 */

const APP_CREDENTIALS: GmailAppCredentials = {
  clientId: 'app-client-id',
  clientSecret: 'FAKE-APP-CLIENT-SECRET',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

function rawGmailMessage(id: string, sender: string, subject: string, body: string) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: '1757000000000',
    payload: {
      headers: [
        { name: 'From', value: sender },
        { name: 'To', value: 'me@example.test' },
        { name: 'Subject', value: subject },
      ],
      mimeType: 'text/plain',
      body: { data: encode(body) },
    },
  };
}

/** Fausse API combinée (OAuth token + Gmail get). Enregistre les URL appelées. */
function buildFakeGmail(
  accessTokenByRefreshToken: ReadonlyMap<string, string>,
  messages: readonly ReturnType<typeof rawGmailMessage>[],
) {
  const getIds: string[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      const accessToken = accessTokenByRefreshToken.get(refreshToken);
      return accessToken === undefined
        ? jsonResponse(400, { error: 'invalid_grant' })
        : jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }

    const match = url.match(/\/messages\/([^/?]+)/);
    if (match) {
      getIds.push(match[1]!);
      const found = messages.find((m) => m.id === match[1]);
      return found === undefined
        ? jsonResponse(404, { error: 'not found' })
        : jsonResponse(200, found);
    }

    return jsonResponse(404, { error: `URL inattendue : ${url}` });
  });

  return { fetchFn, getIds };
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

async function connectedStores(
  refreshToken = 'refresh-token-1',
): Promise<{ accountStore: InMemoryAccountStore; secretStore: InMemorySecretStore }> {
  const accountStore = new InMemoryAccountStore();
  const secretStore = new InMemorySecretStore();
  const outcome = await connectGmailAccount({
    result: successResult('alice@example.test', refreshToken),
    accountStore,
    secretStore,
  });
  if (outcome.status !== 'connected') throw new Error('unreachable');
  return { accountStore, secretStore };
}

/** Seam OAuth qui échoue le test s'il est appelé (prouve « OAuth non relancé »). */
const forbiddenConnect = vi.fn(async () => {
  throw new Error('le flux OAuth ne doit pas être relancé');
});

describe('dispatch(["prepare-reply"]) — câblage CLI', () => {
  it('préparation réussie → destinataire / objet / corps, jamais le threadId ni l’objet brut', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, getIds } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'boss@example.test', 'Point hebdo', 'Corps original.'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['prepare-reply', '--messageId', 'm1', '--body', 'Bonjour, voici ma réponse.'],
      deps,
      { output },
      forbiddenConnect,
    );

    const text = readText();
    expect(text).toContain('Destinataire : boss@example.test');
    expect(text).toContain('Objet : Re: Point hebdo');
    expect(text).toContain('Corps : Bonjour, voici ma réponse.');
    expect(text).not.toContain('threadId');
    expect(text).not.toContain('thread-m1');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('{');
    expect(getIds).toEqual(['m1']);
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('transmet exactement les arguments CLI au Tool (messageId lu, body verbatim)', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, getIds } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('abc123', 'collègue@example.test', 'Déjeuner ?', 'On mange où ?'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['prepare-reply', '--messageId=abc123', '--body=Oui, 12h30 au resto habituel.'],
      deps,
      { output },
      forbiddenConnect,
    );

    expect(getIds).toEqual(['abc123']);
    const text = readText();
    expect(text).toContain('Destinataire : collègue@example.test');
    expect(text).toContain('Corps : Oui, 12h30 au resto habituel.');
  });

  it('ToolExecutor.run reçoit exactement { tool: "gmail.prepare_reply", action: "prepare" } — une seule fois', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'boss@example.test', 'Sujet', 'x'),
    ]);
    const pm = new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } });
    const decideSpy = vi.spyOn(pm, 'decide');
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      permissionManager: pm,
    };
    const { output } = collectingOutput();

    await runPrepareReplyFlow(
      deps,
      { messageId: 'm1', body: 'réponse' },
      (l) => output.write(`${l}\n`),
      forbiddenConnect,
    );

    expect(decideSpy).toHaveBeenCalledTimes(1);
    expect(decideSpy).toHaveBeenCalledWith('gmail.prepare_reply', 'prepare');
  });

  it('permission « deny » → statut générique, aucun appel Gmail (exécution passe par ToolExecutor, jamais tool.execute direct)', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, getIds } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'boss@example.test', 'Sujet', 'x'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      permissionManager: new PermissionManager({ rules: { 'gmail.prepare_reply': 'deny' } }),
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['prepare-reply', '--messageId', 'm1', '--body', 'réponse'],
      deps,
      { output },
      forbiddenConnect,
    );

    expect(readText()).toBe('Préparation de la réponse échouée (denied).\n');
    expect(getIds).toEqual([]);
  });

  it('aucun compte Gmail → erreur propagée (connexion existante), aucune ligne de succès', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const deps: DesktopDeps = { accountStore, secretStore, appCredentials: APP_CREDENTIALS };
    const { output, readText } = collectingOutput();
    const connect = vi.fn(async () => {
      throw new Error('OAuth non simulé dans ce test');
    });

    await expect(
      dispatch(['prepare-reply', '--messageId', 'm1', '--body', 'x'], deps, { output }, connect),
    ).rejects.toThrow('OAuth non simulé dans ce test');
    expect(readText()).toBe('');
  });

  it('plusieurs comptes Gmail sans accountId → AmbiguousAccountError propagée, aucun appel Gmail', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-A'),
      accountStore,
      secretStore,
    });
    await connectGmailAccount({
      result: successResult('bob@example.test', 'refresh-token-B'),
      accountStore,
      secretStore,
    });
    const { fetchFn } = buildFakeGmail(new Map(), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await expect(
      dispatch(
        ['prepare-reply', '--messageId', 'm1', '--body', 'x'],
        deps,
        { output },
        forbiddenConnect,
      ),
    ).rejects.toBeInstanceOf(AmbiguousAccountError);
    expect(readText()).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('argument requis manquant (--body absent) → rejet du parser, aucune résolution de compte', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await expect(
      dispatch(['prepare-reply', '--messageId', 'm1'], deps, { output }, forbiddenConnect),
    ).rejects.toThrow(/option\(s\) requise\(s\) manquante\(s\)\s*:\s*--body/);
    expect(readText()).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('argument invalide (--body vide) → validation du Tool → statut « invalid_input », jamais un faux brouillon', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, getIds } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'boss@example.test', 'Sujet', 'x'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['prepare-reply', '--messageId', 'm1', '--body='],
      deps,
      { output },
      forbiddenConnect,
    );

    expect(readText()).toBe('Préparation de la réponse échouée (invalid_input).\n');
    expect(getIds).toEqual([]);
  });

  it('option inconnue → rejet sans écho de valeur', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const deps: DesktopDeps = { accountStore, secretStore, appCredentials: APP_CREDENTIALS };
    const { output } = collectingOutput();

    await expect(
      dispatch(
        ['prepare-reply', '--messageId', 'm1', '--body', 'x', '--cc', 'tiers@example.test'],
        deps,
        { output },
        forbiddenConnect,
      ),
    ).rejects.toThrow(/option inconnue « --cc »/);
  });

  it('aucune confirmation d’envoi, aucune tentative d’envoi (aucun POST /messages/send)', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'boss@example.test', 'Sujet', 'x'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();
    // Un flux d'entrée qui échoue si quoi que ce soit tente de le lire
    // (`createTerminalConfirm` le lirait — il ne doit jamais être instancié
    // pour `prepare-reply`, qui n'a pas de confirmation).
    const input = new Readable({
      read() {
        this.destroy(new Error('io.input ne doit pas être lu par prepare-reply'));
      },
    });

    await dispatch(
      ['prepare-reply', '--messageId', 'm1', '--body', 'réponse'],
      deps,
      { output, input },
      forbiddenConnect,
    );

    const urls = fetchFn.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('/send'))).toBe(false);
    expect(readText()).toBe(
      'Destinataire : boss@example.test\nObjet : Re: Sujet\nCorps : réponse\n',
    );
  });
});
