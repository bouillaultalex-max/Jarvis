import { Readable, Writable } from 'node:stream';

import {
  InMemoryAccountStore,
  InMemorySecretStore,
  PermissionManager,
  connectGmailAccount,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Câblage CLI de `read-natural` (VS-02f) — sous-commande de `dispatch()`
 * exposant `runReadNaturalLanguageFlow` (VS-02d, inchangé).
 *
 * `runReadNaturalLanguageFlow` est importé **directement** par `main.ts`
 * (pas via `DesktopDeps`) : `dispatch()` ne l'injecte pas. Solution la
 * moins intrusive retenue ici (conforme à la consigne : « ne pas utiliser
 * de mock global fragile si une injection locale est possible ») —
 * `vi.mock` **espionne** l'implémentation réelle (`vi.fn(actual...)`) :
 * tous les tests, sauf un seul (« conversion_failed », voir plus bas),
 * exercent le code réel de bout en bout (parser VS-02a, acceptation
 * VS-02c réelle via des flux `readline` simulés, conversion VS-02b
 * réelle) — le mock ne sert qu'à (a) observer les arguments transmis
 * (test 6) et (b) forcer, pour un seul test, un état structurellement
 * inatteignable par le code réel (`conversion_failed` : une interprétation
 * `understood` réelle produit toujours une entrée convertible). `vi.mock`
 * est hoisté automatiquement par Vitest avant tous les imports statiques
 * ci-dessous, y compris celui de `main.js`.
 *
 * Aucun réseau réel : `fetchFn` mocké pour l'OAuth et les appels Gmail
 * `list`/`get`, même patron que `main-read.test.ts`.
 */
vi.mock('./read-natural-language-flow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./read-natural-language-flow.js')>();
  return {
    ...actual,
    runReadNaturalLanguageFlow: vi.fn(actual.runReadNaturalLanguageFlow),
  };
});

import { dispatch, type DesktopDeps } from './main.js';
import {
  runReadNaturalLanguageFlow,
  type ReadNaturalLanguageFlowResult,
} from './read-natural-language-flow.js';

/**
 * L'espion `runReadNaturalLanguageFlow` est créé **une seule fois** par
 * `vi.mock` (portée module) — son historique d'appels doit être purgé
 * avant chaque test pour que `toHaveBeenCalledTimes`/`not.toHaveBeenCalled`
 * restent fiables. `mockClear()` (et non `mockReset()`) : préserve
 * l'implémentation réelle enveloppée, ne purge que l'historique.
 */
beforeEach(() => {
  vi.mocked(runReadNaturalLanguageFlow).mockClear();
});

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

function buildFakeGmail(
  accessTokenByRefreshToken: ReadonlyMap<string, string>,
  messages: readonly ReturnType<typeof rawGmailMessage>[],
) {
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
      return jsonResponse(200, { messages: messages.map((m) => ({ id: m.id })) });
    }
    const match = url.match(/\/messages\/([^/?]+)/);
    const found = messages.find((m) => m.id === match?.[1]);
    return found === undefined
      ? jsonResponse(404, { error: 'not found' })
      : jsonResponse(200, found);
  });
  return fetchFn;
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

/** Seam OAuth qui échoue le test s'il est appelé (aucune commande read-natural ne doit le relancer). */
const forbiddenConnect = vi.fn(async () => {
  throw new Error('le flux OAuth ne doit pas être relancé');
});

describe('dispatch(["read-natural"]) — parseur d’arguments', () => {
  it('un seul argument valide → texte conservé tel quel, transmis à l’orchestrateur', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const fetchFn = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output } = collectingOutput();

    await dispatch(
      ['read-natural', 'Lis mes 5 derniers emails'],
      deps,
      { input: Readable.from(['oui\n']), output },
      forbiddenConnect,
    );

    expect(runReadNaturalLanguageFlow).toHaveBeenCalledTimes(1);
    const [text] = vi.mocked(runReadNaturalLanguageFlow).mock.calls[0]!;
    expect(text).toBe('Lis mes 5 derniers emails');
  });

  it('aucun argument → erreur explicite, aucun appel à runReadNaturalLanguageFlow', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };

    await expect(dispatch(['read-natural'], deps, {}, forbiddenConnect)).rejects.toThrow(
      /read-natural/,
    );
    expect(runReadNaturalLanguageFlow).not.toHaveBeenCalled();
  });

  it('plusieurs arguments non guillemetés → erreur, aucun assemblage, aucun appel', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };

    await expect(
      dispatch(['read-natural', 'Lis', 'mes', 'emails'], deps, {}, forbiddenConnect),
    ).rejects.toThrow(/read-natural/);
    expect(runReadNaturalLanguageFlow).not.toHaveBeenCalled();
  });

  it('argument vide unique → rejeté explicitement, aucun appel', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };

    await expect(dispatch(['read-natural', ''], deps, {}, forbiddenConnect)).rejects.toThrow(
      /read-natural/,
    );
    expect(runReadNaturalLanguageFlow).not.toHaveBeenCalled();
  });

  it('plusieurs arguments dont une chaîne vide → erreur de nombre d’arguments, aucun appel', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };

    await expect(
      dispatch(['read-natural', 'Lis', '', 'mes emails'], deps, {}, forbiddenConnect),
    ).rejects.toThrow(/read-natural/);
    expect(runReadNaturalLanguageFlow).not.toHaveBeenCalled();
  });
});

describe('dispatch(["read-natural"]) — branchement et transmission des dépendances', () => {
  it('appelle runReadNaturalLanguageFlow une seule fois avec deps/acceptanceIo/write/connect', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const fetchFn = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output } = collectingOutput();
    const io = { input: Readable.from(['oui\n']), output };

    await dispatch(['read-natural', 'lis mes derniers mails'], deps, io, forbiddenConnect);

    expect(runReadNaturalLanguageFlow).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runReadNaturalLanguageFlow).mock.calls[0]!;
    const [text, calledDeps, calledIo, calledWrite, calledConnect] = call;
    expect(text).toBe('lis mes derniers mails');
    expect(calledDeps).toBe(deps);
    expect(calledIo).toBe(io);
    expect(typeof calledWrite).toBe('function');
    expect(calledConnect).toBe(forbiddenConnect);
    // argv n'est jamais transmis tel quel : seul le texte validé l'est.
    expect(text).not.toContain('read-natural');
  });
});

describe('dispatch(["read-natural"]) — restitution des six états', () => {
  it('ambiguous → message explicite, jamais présenté comme une lecture effectuée', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };
    const { output, readText } = collectingOutput();

    await dispatch(['read-natural', 'Regarde mes mails'], deps, { output }, forbiddenConnect);

    const text = readText();
    expect(text).toContain('ambiguë');
    expect(text).not.toContain('Aucun email trouvé');
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('unsupported → message explicite, jamais présenté comme une erreur Gmail', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['read-natural', 'Supprime mes anciens mails'],
      deps,
      { output },
      forbiddenConnect,
    );

    const text = readText();
    expect(text).toContain('hors du périmètre');
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('declined → refus utilisateur, jamais présenté comme une erreur technique', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['read-natural', 'lis mes derniers mails'],
      deps,
      { input: Readable.from(['non\n']), output },
      forbiddenConnect,
    );

    const text = readText();
    expect(text).toContain('refusée');
    expect(text).not.toContain('erreur');
    expect(forbiddenConnect).not.toHaveBeenCalled();
  });

  it('acceptance_error → distingué explicitement d’un refus', async () => {
    const deps: DesktopDeps = {
      accountStore: new InMemoryAccountStore(),
      secretStore: new InMemorySecretStore(),
      appCredentials: APP_CREDENTIALS,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['read-natural', 'lis mes derniers mails'],
      deps,
      { input: Readable.from([]), output }, // EOF avant toute saisie
      forbiddenConnect,
    );

    const text = readText();
    expect(text).toContain('acceptation impossible');
    expect(text).toContain('input-error');
    expect(text).not.toContain('refusée');
  });

  it(
    'conversion_failed → aucune restitution de lecture, aucun succès (état structurellement ' +
      'inatteignable via le code réel : forcé ici via le seul point d’injection disponible)',
    async () => {
      const deps: DesktopDeps = {
        accountStore: new InMemoryAccountStore(),
        secretStore: new InMemorySecretStore(),
        appCredentials: APP_CREDENTIALS,
      };
      const { output, readText } = collectingOutput();
      const forged: ReadNaturalLanguageFlowResult = {
        status: 'conversion_failed',
        interpretation: {
          status: 'understood',
          originalRequest: 'texte forgé',
          explanation: 'forgé pour test',
          proposedRead: { tool: 'gmail.read', input: {} },
        },
        reason: 'raison de test — conversion refusée',
      };
      vi.mocked(runReadNaturalLanguageFlow).mockResolvedValueOnce(forged);

      await dispatch(['read-natural', 'texte quelconque'], deps, { output }, forbiddenConnect);

      const text = readText();
      expect(text).toContain('conversion impossible');
      expect(text).toContain('raison de test');
      expect(text).not.toContain('Aucun email trouvé');
      expect(forbiddenConnect).not.toHaveBeenCalled();
    },
  );

  it('read_result exécuté → réutilise le format de restitution existant (emails listés)', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const fetchFn = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), [
      rawGmailMessage('m1', 'alice@example.test', 'Salut', 'Contenu'),
    ]);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['read-natural', 'lis mes derniers mails'],
      deps,
      { input: Readable.from(['oui\n']), output },
      forbiddenConnect,
    );

    expect(readText()).toContain('alice@example.test — Salut');
  });

  it('read_result non exécuté (denied) → aucun succès artificiel, statut réel restitué', async () => {
    const { accountStore, secretStore } = await connectedStores();
    const fetchFn = buildFakeGmail(new Map([['refresh-token-1', 'access-token-1']]), []);
    const deps: DesktopDeps = {
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
      // Politique réelle forçant un refus de PermissionManager : produit un
      // ToolExecutionResult `denied` authentique, sans aucun mock de cette
      // partie de la chaîne.
      permissionManager: new PermissionManager({ rules: { 'gmail.read': 'deny' } }),
    };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['read-natural', 'lis mes derniers mails'],
      deps,
      { input: Readable.from(['oui\n']), output },
      forbiddenConnect,
    );

    const text = readText();
    expect(text).toContain('Lecture échouée');
    expect(text).toContain('denied');
    expect(text).not.toContain('Aucun email trouvé');
    expect(text).not.toContain('alice@example.test');
  });
});
