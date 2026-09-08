import { Writable } from 'node:stream';

import {
  ClassificationEngine,
  InMemoryPreferenceStore,
  type EmailLlmClassifier,
} from '@jarvis/classification';
import {
  AmbiguousAccountError,
  InMemoryAccountStore,
  InMemorySecretStore,
  connectGmailAccount,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';

/**
 * Câblage de la sous-commande `inbox` de `apps/desktop` : lecture Gmail
 * (`gmail.read` via `ToolExecutor`) puis classification
 * (`@jarvis/inbox` → `ClassificationEngine`).
 *
 * `fetchFn` mocké pour l'échange OAuth et les appels Gmail `list`/`get`
 * (aucun réseau réel). Le LLM est toujours injecté (jamais d'appel réseau
 * Anthropic). Les mécaniques internes de `gmail.read` et du moteur de
 * classification ne sont PAS re-testées ici — seul le câblage CLI l'est.
 *
 * Toutes les valeurs (adresses, contenu, tokens) sont artificielles.
 */

const APP_CREDENTIALS: GmailAppCredentials = {
  clientId: 'app-client-id',
  clientSecret: 'FAKE-APP-CLIENT-SECRET',
};

const BODY_MARKER = 'CORPS-CONFIDENTIEL-NE-PAS-AFFICHER';
const LEAK_MARKER = 'refresh-token-LEAK-MARKER';

afterEach(() => {
  vi.unstubAllEnvs();
});

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
        { name: 'To', value: 'me@example.test, autre@example.test' },
        { name: 'Subject', value: subject },
      ],
      mimeType: 'text/plain',
      body: { data: encode(body) },
    },
  };
}

/** Fausse API combinée (OAuth token + Gmail list/get). `listStatus` force une erreur Gmail. */
function buildFakeGmail(
  accessTokenByRefreshToken: ReadonlyMap<string, string>,
  messages: readonly ReturnType<typeof rawGmailMessage>[],
  options: { readonly listStatus?: number } = {},
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
      if (options.listStatus !== undefined && options.listStatus >= 400) {
        return jsonResponse(options.listStatus, { error: 'gmail backend en panne' });
      }
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

/** Faux provider LLM : rejoue une réponse scriptée selon l'expéditeur. Aucun réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  constructor(private readonly reply: (userContent: string) => LlmResponse) {}

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    return this.reply(user);
  }
}

function classifierJson(label: string, reason: string): LlmResponse {
  return { content: JSON.stringify({ label, reason }) };
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

describe('dispatch(["inbox"]) — câblage CLI', () => {
  it('compte unique, plusieurs emails → 5 champs par email, jamais le corps', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Facture', `${BODY_MARKER} 1`),
      rawGmailMessage('m2', 'news@promo.example', 'Solde -50%', `${BODY_MARKER} 2`),
    ]);
    const llm = new MockLlmProvider((user) =>
      user.includes('promo.example')
        ? classifierJson('not_important', 'Newsletter commerciale.')
        : classifierJson('important', 'Facture à traiter.'),
    );
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: llm,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('Expéditeur : alice@example.test');
    expect(text).toContain('Objet : Facture');
    expect(text).toContain('Libellé : important');
    expect(text).toContain('Raison : Facture à traiter.');
    expect(text).toContain('Provenance : LLM');
    expect(text).toContain('Expéditeur : news@promo.example');
    expect(text).toContain('Libellé : non important');
    expect(text).not.toContain(BODY_MARKER);
    expect(text).not.toContain('autre@example.test');
    expect(text).not.toContain('thread-m1');
    expect(llm.calls).toHaveLength(2);
    expect(forbiddenConnect).not.toHaveBeenCalled();
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
    const llm = new MockLlmProvider(() => classifierJson('uncertain', 'x'));
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: llm,
    };
    const { output, readText } = collectingOutput();

    await expect(dispatch(['inbox'], deps, { output }, forbiddenConnect)).rejects.toBeInstanceOf(
      AmbiguousAccountError,
    );
    expect(readText()).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(llm.calls).toHaveLength(0);
  });

  it('--maxResults est transmis tel quel au Tool gmail.read', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn, listUrls } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'x'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: new MockLlmProvider(() => classifierJson('uncertain', 'x')),
    };
    const { output } = collectingOutput();

    await dispatch(['inbox', '--maxResults', '3'], deps, { output }, forbiddenConnect);

    expect(listUrls).toHaveLength(1);
    expect(listUrls[0]).toContain('maxResults=3');
  });

  it('boîte vide → « Aucun email trouvé. », aucune ligne fictive, aucun appel LLM', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const llm = new MockLlmProvider(() => classifierJson('uncertain', 'x'));
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: llm,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    expect(readText()).toBe('Aucun email trouvé.\n');
    expect(llm.calls).toHaveLength(0);
  });

  it('erreur Gmail (list HTTP 500) → statut générique, jamais le message d’API brut', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(
      new Map([['refresh-token-1', 'access-token-1']]),
      [rawGmailMessage('m1', 'alice@example.test', 'Salut', 'x')],
      { listStatus: 500 },
    );
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: new MockLlmProvider(() => classifierJson('uncertain', 'x')),
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toBe('Lecture échouée (error).\n');
    expect(text).not.toContain('gmail backend en panne');
    expect(text).not.toContain('500');
  });

  it('absence de ANTHROPIC_API_KEY → repli contrôlé vers « incertain / repli par défaut »', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'x'),
    ]);
    // Aucun llmProvider ni classificationEngine injecté : le moteur est
    // construit par buildInboxClassificationEngine, qui n'ajoute PAS de LLM
    // sans clé.
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('Libellé : incertain');
    expect(text).toContain('Provenance : repli par défaut');
  });

  it('erreur LLM (provider qui jette) → repli contrôlé vers « incertain », jamais l’erreur brute', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'x'),
    ]);
    const throwingProvider: LlmProvider = {
      chat: async () => {
        throw new Error('BOOM-LLM-INTERNE quota dépassé');
      },
    };
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: throwingProvider,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('Libellé : incertain');
    expect(text).toContain('Provenance : repli par défaut');
    expect(text).not.toContain('BOOM-LLM-INTERNE');
  });

  it('préférence existante → décision de la préférence, LLM jamais consulté', async () => {
    const { accountStore, secretStore } = await connectedStores('refresh-token-1');
    const { fetchFn } = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'x'),
    ]);

    const preferenceStore = new InMemoryPreferenceStore();
    preferenceStore.add({
      attribute: 'sender',
      value: 'alice@example.test',
      decision: 'important',
      origin: 'explicit_rule',
      reason: 'Les messages d’Alice comptent.',
    });
    const forbiddenClassifier: EmailLlmClassifier = {
      classify: async () => {
        throw new Error('le LLM ne doit pas être consulté quand une préférence correspond');
      },
    };
    const classificationEngine = new ClassificationEngine({
      preferenceStore,
      llmClassifier: forbiddenClassifier,
    });

    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      classificationEngine,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('Libellé : important');
    expect(text).toContain('Raison : Les messages d’Alice comptent.');
    expect(text).toContain('Provenance : règle explicite');
  });

  it('sécurité : le marqueur de refresh token n’apparaît jamais dans la sortie', async () => {
    const { accountStore, secretStore } = await connectedStores(LEAK_MARKER);
    const { fetchFn } = buildFakeGmail(new Map([[LEAK_MARKER, 'access-token-secure']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', BODY_MARKER),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      llmProvider: new MockLlmProvider(() => classifierJson('important', 'ok')),
    };
    const { output, readText } = collectingOutput();

    await dispatch(['inbox'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).not.toContain(LEAK_MARKER);
    expect(text).not.toContain('access-token-secure');
    expect(text).not.toContain(BODY_MARKER);
  });
});
