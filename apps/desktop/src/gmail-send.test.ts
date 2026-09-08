import {
  AmbiguousAccountError,
  ConfirmationService,
  InMemoryAccountStore,
  InMemorySecretStore,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  UnknownAccountError,
  confirmAndExecute,
  connectGmailAccount,
  gmailConnector,
  gmailRefreshTokenSecretKey,
  proposeConfirmation,
  resolveGmailApiClient,
  type Account,
  type ConfirmationPayload,
  type ConfirmationRequest,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGmailSend } from './gmail-send.js';

/**
 * M8-B4 — Boucle d'envoi Gmail confirmée côté desktop.
 *
 * `fetchFn` est mocké pour l'échange OAuth et l'appel Gmail `send` (aucun
 * appel réseau réel). Toutes les valeurs (adresses, contenu, tokens) sont
 * strictement artificielles.
 */

const APP_CREDENTIALS: GmailAppCredentials = {
  clientId: 'app-client-id',
  clientSecret: 'FAKE-APP-CLIENT-SECRET',
};
const SEND_INPUT = { to: 'dest@example.test', subject: 'Salut', body: 'Ceci est un test' } as const;
const LEAK_MARKER = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SendCall {
  readonly authorization: string;
  readonly raw: string;
  readonly threadId?: string;
  readonly mime: string;
}

/**
 * Fausse API combinée (OAuth token + Gmail send) sur un unique `fetchFn`,
 * comme un `fetch` global en production. Reprend le pattern de
 * `gmail-connection-lifecycle.test.ts`.
 */
function buildFakeGmail(accessTokenByRefreshToken: ReadonlyMap<string, string>) {
  const sendCalls: SendCall[] = [];
  const tokenExchanges: string[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      tokenExchanges.push(refreshToken);
      const accessToken = accessTokenByRefreshToken.get(refreshToken);
      if (accessToken === undefined) return jsonResponse(400, { error: 'invalid_grant' });
      return jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      const authorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? '',
      );
      const body = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
      sendCalls.push({
        authorization,
        raw: body.raw,
        ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
        mime: Buffer.from(body.raw, 'base64url').toString('utf-8'),
      });
      return jsonResponse(200, { id: 'sent-1', threadId: 'thread-xyz' });
    }

    return jsonResponse(500, { error: `URL inattendue dans le test : ${url}` });
  });

  return { fetchFn, sendCalls, tokenExchanges };
}

function successResult(accountIdentifier: string, refreshToken: string): GmailOAuthResult {
  return { status: 'success', identity: { accountIdentifier }, refreshToken };
}

function makeAccount(overrides: Pick<Account, 'id' | 'status'> & Partial<Account>): Account {
  return {
    provider: 'gmail',
    accountIdentifier: `${overrides.id}@example.test`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface ConnectedFixture {
  readonly accountStore: InMemoryAccountStore;
  readonly secretStore: InMemorySecretStore;
  readonly accountId: string;
  readonly fetchFn: ReturnType<typeof buildFakeGmail>['fetchFn'];
  readonly sendCalls: readonly SendCall[];
  readonly tokenExchanges: readonly string[];
}

async function connectedFixture(
  refreshToken = 'refresh-token-1',
  accessToken = 'access-token-1',
): Promise<ConnectedFixture> {
  const accountStore = new InMemoryAccountStore();
  const secretStore = new InMemorySecretStore();
  const { fetchFn, sendCalls, tokenExchanges } = buildFakeGmail(
    new Map([[refreshToken, accessToken]]),
  );

  const connected = await connectGmailAccount({
    result: successResult('alice@example.test', refreshToken),
    accountStore,
    secretStore,
  });
  if (connected.status !== 'connected') throw new Error('unreachable');

  return {
    accountStore,
    secretStore,
    accountId: connected.accountId,
    fetchFn,
    sendCalls,
    tokenExchanges,
  };
}

describe('runGmailSend — M8-B4', () => {
  describe('envoi confirmé (chemin nominal)', () => {
    it('confirmation acceptée → gmail.send exécuté exactement une fois', async () => {
      const fx = await connectedFixture();

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: () => true,
        fetchFn: fx.fetchFn,
      });

      expect(result).toMatchObject({
        status: 'executed',
        output: { id: 'sent-1', threadId: 'thread-xyz' },
      });
      expect(fx.sendCalls).toHaveLength(1);
      expect(fx.sendCalls[0]!.authorization).toBe('Bearer access-token-1');
      expect(fx.tokenExchanges).toEqual(['refresh-token-1']);
    });

    it('le callback confirm reçoit un ConfirmationRequest complet, avant tout appel Gmail', async () => {
      const fx = await connectedFixture();
      let seen: ConfirmationRequest | undefined;
      let sendCallsAtConfirmTime = -1;

      await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: { ...SEND_INPUT, threadId: 'thread-parent' },
        confirm: (request) => {
          seen = request;
          sendCallsAtConfirmTime = fx.sendCalls.length;
          return true;
        },
        fetchFn: fx.fetchFn,
      });

      expect(sendCallsAtConfirmTime).toBe(0);
      expect(seen?.toolName).toBe('gmail.send');
      expect(seen?.action).toBe('execute');
      expect(seen?.account.provider).toBe('gmail');
      expect(seen?.account.accountIdentifier).toBe('alice@example.test');
      expect(seen?.summary.fields.map((f) => f.key)).toEqual(['to', 'subject', 'body', 'threadId']);
      expect(seen?.summary.fields.find((f) => f.key === 'to')?.value).toBe(SEND_INPUT.to);
      expect(typeof seen?.confirmationId).toBe('string');
      expect(seen?.confirmationId.length).toBeGreaterThan(0);
    });

    it('threadId présent dans l’input → transmis tel quel à sendMessage', async () => {
      const fx = await connectedFixture();

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: { ...SEND_INPUT, threadId: 'thread-parent-123' },
        confirm: () => true,
        fetchFn: fx.fetchFn,
      });

      expect(result.status).toBe('executed');
      expect(fx.sendCalls).toHaveLength(1);
      expect(fx.sendCalls[0]!.threadId).toBe('thread-parent-123');
    });

    it('le payload exécuté est exactement l’input validé — le callback confirm ne peut pas l’altérer', async () => {
      const fx = await connectedFixture();

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: (request) => {
          // Le read-model est gelé : toute tentative de le modifier échoue et
          // reste sans effet sur le payload réellement exécuté.
          try {
            (request.summary.fields[0] as { value: string }).value = 'attacker@evil.test';
          } catch {
            /* gel attendu */
          }
          return true;
        },
        fetchFn: fx.fetchFn,
      });

      expect(result.status).toBe('executed');
      expect(fx.sendCalls[0]!.mime).toContain(`To: ${SEND_INPUT.to}`);
      expect(fx.sendCalls[0]!.mime).toContain(`Subject: ${SEND_INPUT.subject}`);
      expect(fx.sendCalls[0]!.mime).not.toContain('attacker@evil.test');
    });
  });

  describe('confirmation refusée / obligatoire', () => {
    it('confirmation refusée (confirm → false) → confirmation_declined, aucun appel Gmail', async () => {
      const fx = await connectedFixture();

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: () => false,
        fetchFn: fx.fetchFn,
      });

      expect(result).toEqual({ status: 'confirmation_declined' });
      expect(fx.fetchFn).not.toHaveBeenCalled();
    });

    it('politique « allow » → confirmation_required, jamais exécuté, callback confirm jamais appelé', async () => {
      const fx = await connectedFixture();
      const confirm = vi.fn(() => true);

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm,
        permissionManager: new PermissionManager({ rules: { 'gmail.send': 'allow' } }),
        fetchFn: fx.fetchFn,
      });

      expect(result.status).toBe('confirmation_required');
      expect(confirm).not.toHaveBeenCalled();
      expect(fx.fetchFn).not.toHaveBeenCalled();
    });

    it('politique « deny » → denied, aucune confirmation, aucun appel Gmail', async () => {
      const fx = await connectedFixture();
      const confirm = vi.fn(() => true);

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm,
        permissionManager: new PermissionManager({ rules: { 'gmail.send': 'deny' } }),
        fetchFn: fx.fetchFn,
      });

      expect(result.status).toBe('denied');
      expect(confirm).not.toHaveBeenCalled();
      expect(fx.fetchFn).not.toHaveBeenCalled();
    });

    it('ticket de confirmation à usage unique : après un envoi confirmé, le même ticket ne peut plus être vérifié', async () => {
      const fx = await connectedFixture();
      const confirmationService = new ConfirmationService();
      let confirmationId = '';

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: (request) => {
          confirmationId = request.confirmationId;
          return true;
        },
        confirmationService,
        fetchFn: fx.fetchFn,
      });
      expect(result.status).toBe('executed');

      const account = await fx.accountStore.get(fx.accountId);
      const replay: ConfirmationPayload = {
        toolName: 'gmail.send',
        action: 'execute',
        accountId: account.id,
        input: SEND_INPUT,
      };
      await expect(confirmationService.verify(confirmationId, replay)).resolves.toEqual({
        ok: false,
        reason: 'already_consumed',
      });
      expect(fx.sendCalls).toHaveLength(1);
    });

    it('payload modifié entre propose et confirm → confirmation_failed / payload_mismatch, zéro envoi', async () => {
      // Mécanisme sur lequel s'appuie runGmailSend (proposeConfirmation +
      // confirmAndExecute re-exportés) : un payload divergent est rejeté par
      // l'empreinte, sans aucun appel Gmail.
      const fx = await connectedFixture();
      const account = await fx.accountStore.get(fx.accountId);
      const client = await resolveGmailApiClient({
        account,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        fetchFn: fx.fetchFn,
      });
      const registry = new ToolRegistry();
      for (const tool of gmailConnector.createTools(client)) registry.register(tool);
      const executor = new ToolExecutor(
        registry,
        new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } }),
      );
      const confirmationService = new ConfirmationService();

      const proposed = await proposeConfirmation({
        executor,
        confirmationService,
        request: { tool: 'gmail.send', input: SEND_INPUT },
        account,
        summary: { fields: [{ key: 'to', label: 'Destinataire', value: SEND_INPUT.to }] },
      });
      if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

      const tampered = await confirmAndExecute({
        executor,
        confirmationService,
        confirmationId: proposed.confirmationRequest!.confirmationId,
        payload: {
          toolName: proposed.result.toolName,
          action: proposed.result.action,
          accountId: account.id,
          input: { ...SEND_INPUT, body: 'contenu injecté après la proposition' },
        },
      });

      expect(tampered).toMatchObject({
        status: 'confirmation_failed',
        failureReason: 'payload_mismatch',
      });
      expect(fx.sendCalls).toHaveLength(0);
    });
  });

  describe('résolution de compte', () => {
    it('compte disconnected → échec propre (erreur propagée), aucun appel Gmail', async () => {
      const accountStore = new InMemoryAccountStore();
      const secretStore = new InMemorySecretStore();
      const { fetchFn } = buildFakeGmail(new Map());
      await accountStore.register(makeAccount({ id: 'acc-1', status: 'disconnected' }));
      await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'orphan-refresh-token');

      await expect(
        runGmailSend({
          accountStore,
          secretStore,
          appCredentials: APP_CREDENTIALS,
          input: SEND_INPUT,
          confirm: () => true,
          accountId: 'acc-1',
          fetchFn,
        }),
      ).rejects.toThrow(/pas connecté/);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('compte error → échec propre (erreur propagée), aucun appel Gmail', async () => {
      const accountStore = new InMemoryAccountStore();
      const secretStore = new InMemorySecretStore();
      const { fetchFn } = buildFakeGmail(new Map());
      await accountStore.register(makeAccount({ id: 'acc-1', status: 'error' }));
      await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'orphan-refresh-token');

      await expect(
        runGmailSend({
          accountStore,
          secretStore,
          appCredentials: APP_CREDENTIALS,
          input: SEND_INPUT,
          confirm: () => true,
          accountId: 'acc-1',
          fetchFn,
        }),
      ).rejects.toThrow(/status/);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('plusieurs comptes Gmail sans accountId → AmbiguousAccountError propagée, aucune sélection arbitraire', async () => {
      const accountStore = new InMemoryAccountStore();
      const secretStore = new InMemorySecretStore();
      const { fetchFn } = buildFakeGmail(new Map());
      await accountStore.register(makeAccount({ id: 'acc-A', status: 'connected' }));
      await accountStore.register(makeAccount({ id: 'acc-B', status: 'connected' }));
      await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'rt-A');
      await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'rt-B');

      await expect(
        runGmailSend({
          accountStore,
          secretStore,
          appCredentials: APP_CREDENTIALS,
          input: SEND_INPUT,
          confirm: () => true,
          fetchFn,
        }),
      ).rejects.toBeInstanceOf(AmbiguousAccountError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('aucun compte Gmail → UnknownAccountError propagée', async () => {
      const accountStore = new InMemoryAccountStore();
      const secretStore = new InMemorySecretStore();
      const { fetchFn } = buildFakeGmail(new Map());

      await expect(
        runGmailSend({
          accountStore,
          secretStore,
          appCredentials: APP_CREDENTIALS,
          input: SEND_INPUT,
          confirm: () => true,
          fetchFn,
        }),
      ).rejects.toBeInstanceOf(UnknownAccountError);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('erreurs du fournisseur Gmail (post-confirmation) — M8-B6', () => {
    // Ces deux tests prouvent, bout en bout via runGmailSend, un comportement
    // déjà garanti par ToolExecutor (catch de toute exception d'execute() →
    // status: 'error', jamais un succès) et par GmailApiClient (throw propre
    // sur échec réseau/HTTP) : aucun des deux n'est modifié ici, seul le
    // chemin confirmé → exécution réelle qui échoue n'était pas encore prouvé
    // par un test à ce niveau d'intégration.

    it('confirmé mais le refresh token est rejeté (invalid_grant) au moment de l’exécution → status: error, aucun envoi', async () => {
      const accountStore = new InMemoryAccountStore();
      const secretStore = new InMemorySecretStore();
      // Aucune entrée dans la map : tout refresh token échange échoue (400 invalid_grant),
      // comme un refresh token révoqué côté Google après la connexion initiale du compte.
      const { fetchFn, sendCalls } = buildFakeGmail(new Map());
      const connected = await connectGmailAccount({
        result: successResult('alice@example.test', 'refresh-token-1'),
        accountStore,
        secretStore,
      });
      if (connected.status !== 'connected') throw new Error('unreachable');

      const result = await runGmailSend({
        accountStore,
        secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: () => true,
        accountId: connected.accountId,
        fetchFn,
      });

      expect(result).toMatchObject({
        status: 'error',
        reason: expect.stringContaining("renouvellement de l'access token refusé"),
      });
      expect(sendCalls).toHaveLength(0);
    });

    it('confirmé, token valide, mais l’API Gmail refuse l’envoi (HTTP 500) → status: error, aucun envoi', async () => {
      const fx = await connectedFixture();
      const failingFetchFn = vi.fn(
        async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
          const url = String(input);
          if (url === 'https://oauth2.googleapis.com/token') {
            return jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 });
          }
          if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
            return jsonResponse(500, { error: 'internal_error' });
          }
          return jsonResponse(500, { error: `URL inattendue dans le test : ${url}` });
        },
      );

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: () => true,
        fetchFn: failingFetchFn,
      });

      expect(result).toMatchObject({
        status: 'error',
        reason: expect.stringContaining('requête refusée (statut HTTP 500)'),
      });
    });
  });

  describe('sécurité — non-fuite du refresh token', () => {
    let fx: ConnectedFixture;

    beforeEach(async () => {
      fx = await connectedFixture(LEAK_MARKER, 'access-token-secure');
    });

    it('le marqueur de refresh token n’apparaît ni dans le ConfirmationRequest ni dans le résultat public', async () => {
      let seen: ConfirmationRequest | undefined;

      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: { ...SEND_INPUT, threadId: 'thread-parent' },
        confirm: (request) => {
          seen = request;
          return true;
        },
        fetchFn: fx.fetchFn,
      });

      expect(result.status).toBe('executed');
      expect(JSON.stringify(seen)).not.toContain(LEAK_MARKER);
      expect(JSON.stringify(result)).not.toContain(LEAK_MARKER);
    });

    it('le marqueur n’apparaît pas non plus dans un résultat de confirmation refusée', async () => {
      const result = await runGmailSend({
        accountStore: fx.accountStore,
        secretStore: fx.secretStore,
        appCredentials: APP_CREDENTIALS,
        input: SEND_INPUT,
        confirm: () => false,
        fetchFn: fx.fetchFn,
      });

      expect(JSON.stringify(result)).not.toContain(LEAK_MARKER);
    });
  });
});
