import { Writable } from 'node:stream';

import {
  AmbiguousAccountError,
  InMemoryAccountStore,
  InMemorySecretStore,
  connectGmailAccount,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';

/**
 * Câblage de `gmail.read` dans la sous-commande `read` de `apps/desktop`.
 *
 * `fetchFn` mocké pour l'échange OAuth et les appels Gmail `list`/`get`
 * (aucun réseau réel). Les mécaniques internes de `gmail.read`
 * (validation, mapping `EmailMessage`) ne sont PAS re-testées ni mockées —
 * déjà prouvées par `gmail-connector.test.ts`/`gmail-message-mapper.test.ts` :
 * seul le câblage CLI (résolution de compte, `ToolExecutor`, formatage de
 * sortie, `--maxResults`) l'est ici.
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

/** Fausse API combinée (OAuth token + Gmail list/get) sur un unique `fetchFn`. */
function buildFakeGmail(
  accessTokenByRefreshToken: ReadonlyMap<string, string>,
  messages: readonly ReturnType<typeof rawGmailMessage>[],
) {
  const listUrls: string[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      const accessToken = accessTokenByRefreshToken.get(refreshToken);
      return accessToken === undefined
        ? jsonResponse(400, { error: 'invalid_grant' })
        : jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }

    if (url.includes('/messages?')) {
      listUrls.push(url);
      return jsonResponse(200, { messages: messages.map((m) => ({ id: m.id })) });
    }

    const match = url.match(/\/messages\/([^/?]+)/);
    const found = messages.find((m) => m.id === match?.[1]);
    return found === undefined
      ? jsonResponse(404, { error: 'not found' })
      : jsonResponse(200, found);
  });

  return { fetchFn, listUrls };
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

describe('dispatch(["read"]) — câblage CLI', () => {
  it('compte connecté, plusieurs emails → une ligne par email (expéditeur — objet)', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'Contenu 1'),
      rawGmailMessage('m2', 'bob@example.test', 'Réunion', 'Contenu 2'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['read'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('alice@example.test — Salut');
    expect(text).toContain('bob@example.test — Réunion');
    expect(text).not.toContain('Contenu 1');
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('aucun compte Gmail → erreur propagée (résolution/connexion existante), aucune ligne de succès', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const deps: DesktopDeps = { accountStore, secretStore, appCredentials: APP_CREDENTIALS };
    const { output, readText } = collectingOutput();
    const connect = vi.fn(async () => {
      throw new Error('OAuth non simulé dans ce test');
    });

    await expect(dispatch(['read'], deps, { output }, connect)).rejects.toThrow(
      'OAuth non simulé dans ce test',
    );
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

    await expect(dispatch(['read'], deps, { output }, forbiddenConnect)).rejects.toBeInstanceOf(
      AmbiguousAccountError,
    );
    expect(readText()).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('boîte vide → « Aucun email trouvé. », aucune ligne fictive, aucune erreur', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['read'], deps, { output }, forbiddenConnect);

    expect(readText()).toBe('Aucun email trouvé.\n');
  });

  it('--maxResults est transmis tel quel au Tool gmail.read', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, listUrls } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'Contenu'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output } = collectingOutput();

    await dispatch(['read', '--maxResults', '3'], deps, { output }, forbiddenConnect);

    expect(listUrls).toHaveLength(1);
    expect(listUrls[0]).toContain('maxResults=3');
  });

  it('sans --maxResults → le défaut du Tool gmail.read s’applique (non réécrit par le CLI)', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, listUrls } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'Contenu'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output } = collectingOutput();

    await dispatch(['read'], deps, { output }, forbiddenConnect);

    // Défaut de gmail.read (DEFAULT_MAX_RESULTS = 10, gmail-connector.ts) —
    // jamais réécrit par le CLI, voir parseGmailReadArgs.
    expect(listUrls[0]).toContain('maxResults=10');
  });
});
