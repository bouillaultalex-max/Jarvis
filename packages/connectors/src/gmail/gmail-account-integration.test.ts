import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import type { Account } from '../account.js';
import { resolveAccount } from '../account.js';
import {
  confirmAndExecute,
  proposeConfirmation,
  type ConfirmationFailed,
} from '../confirmation/confirmation-flow.js';
import type { ConfirmationInputSummary } from '../confirmation/confirmation-request.js';
import { ConfirmationService, type ConfirmationPayload } from '../confirmation/confirmation-service.js';
import { AmbiguousAccountError } from '../errors.js';
import { InMemoryAccountStore } from '../in-memory/in-memory-account-store.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import { gmailRefreshTokenSecretKey, type GmailAppCredentials } from './gmail-auth.js';
import { resolveGmailApiClient } from './gmail-client-resolver.js';
import { gmailConnector } from './gmail-connector.js';

/**
 * M8-A11 — Test d'intégration complet : prouve que M8-A1 → M8-A10
 * composent réellement ensemble, sans réimplémenter la logique d'aucune
 * brique.
 *
 * Chaîne exercée dans chaque scénario :
 *
 *   Account → AccountStore.resolveAccount() → resolveGmailApiClient()
 *   → gmailConnector.createTools() → ToolRegistry → PermissionManager
 *   → ToolExecutor → (ConfirmationFlow si require_confirmation)
 *   → GmailApiClient → appel Gmail mocké
 *
 * Aucun code de production n'est ajouté ni modifié par ce fichier : toutes
 * les briques utilisées sont les implémentations réelles existantes.
 */

const APP_CREDENTIALS: GmailAppCredentials = { clientId: 'app-client-id', clientSecret: 'FAKE-APP-CLIENT-SECRET' };
const SEND_INPUT = { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' };
const SUMMARY: ConfirmationInputSummary = {
  fields: [{ key: 'to', label: 'Destinataire', value: SEND_INPUT.to }],
};

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    provider: 'gmail',
    accountIdentifier: `${overrides.id}@example.test`,
    status: 'connected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Fausse API combinée : route l'échange OAuth (`oauth2.googleapis.com/token`)
 * et l'envoi Gmail (`gmail.googleapis.com/.../messages/send`) sur un seul
 * `fetchFn`, exactement comme un unique `fetch` global le ferait en
 * production. Reprend le pattern déjà établi dans
 * `gmail-client-resolver.test.ts`.
 */
function buildCombinedFetch(refreshTokenToAccessToken: ReadonlyMap<string, string>) {
  const tokenExchangeRefreshTokens: string[] = [];
  const gmailSendCalls: Array<{ authorization: string }> = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      const refreshToken = body.get('refresh_token') ?? '';
      tokenExchangeRefreshTokens.push(refreshToken);
      const accessToken = refreshTokenToAccessToken.get(refreshToken);
      if (accessToken === undefined) {
        return jsonResponse(400, { error: 'invalid_grant' });
      }
      return jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      const authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
      gmailSendCalls.push({ authorization });
      return jsonResponse(200, { id: 'sent-1', threadId: 'thread-1' });
    }

    return jsonResponse(500, { error: `unexpected url in test: ${url}` });
  });

  return { fetchFn, tokenExchangeRefreshTokens, gmailSendCalls };
}

/** Construit la chaîne complète Account → ... → ToolExecutor pour un compte déjà enregistré. */
async function buildChain(
  accountStore: InMemoryAccountStore,
  secretStore: InMemorySecretStore,
  fetchFn: typeof fetch,
  accountId: string,
  sendDecision: 'allow' | 'deny' | 'require_confirmation',
) {
  const resolvedAccount = await resolveAccount(accountStore, { provider: 'gmail', accountId });
  const client = await resolveGmailApiClient({
    account: resolvedAccount,
    secretStore,
    appCredentials: APP_CREDENTIALS,
    fetchFn,
  });
  const registry = new ToolRegistry();
  for (const tool of gmailConnector.createTools(client)) {
    registry.register(tool);
  }
  const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': sendDecision } }));
  return { resolvedAccount, client, registry, executor };
}

describe('Intégration Gmail complète — M8-A11', () => {
  it('Scénario 1 — allow : gmail.send s’exécute réellement via toute la chaîne', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn, tokenExchangeRefreshTokens, gmailSendCalls } = buildCombinedFetch(
      new Map([['refresh-token-acc-1', 'access-token-acc-1']]),
    );

    const { executor } = await buildChain(accountStore, secretStore, fetchFn, 'acc-1', 'allow');
    const result = await executor.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(result).toMatchObject({ status: 'executed', output: { id: 'sent-1', threadId: 'thread-1' } });
    expect(gmailSendCalls).toHaveLength(1);
    expect(gmailSendCalls[0]!.authorization).toBe('Bearer access-token-acc-1');
    expect(tokenExchangeRefreshTokens).toEqual(['refresh-token-acc-1']);
  });

  it('Scénario 2 — deny : bloqué avant tout réseau (ni OAuth, ni Gmail)', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const { executor } = await buildChain(accountStore, secretStore, fetchFn, 'acc-1', 'deny');
    const result = await executor.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(result.status).toBe('denied');
    expect(gmailSendCalls).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Scénario 3 — require_confirmation : propose → ConfirmationRequest → verify avant execute → executed', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const { resolvedAccount, executor } = await buildChain(
      accountStore,
      secretStore,
      fetchFn,
      'acc-1',
      'require_confirmation',
    );
    const confirmationService = new ConfirmationService();

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: resolvedAccount,
      summary: SUMMARY,
    });

    expect(proposed.result.status).toBe('awaiting_confirmation');
    expect(proposed.confirmationRequest).toBeDefined();
    expect(proposed.confirmationRequest?.toolName).toBe('gmail.send');
    expect(proposed.confirmationRequest?.action).toBe('execute');
    expect(gmailSendCalls).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: resolvedAccount.id,
      input: proposed.result.input,
    };

    // Preuve d'ordre : verify() est appelé avant ToolExecutor.run().
    const callOrder: string[] = [];
    const originalVerify = confirmationService.verify.bind(confirmationService);
    vi.spyOn(confirmationService, 'verify').mockImplementation(async (...args) => {
      callOrder.push('verify');
      return originalVerify(...args);
    });
    const originalRun = executor.run.bind(executor);
    vi.spyOn(executor, 'run').mockImplementation(async (...args) => {
      callOrder.push('run');
      return originalRun(...args);
    });

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed).toMatchObject({ status: 'executed', output: { id: 'sent-1', threadId: 'thread-1' } });
    expect(callOrder).toEqual(['verify', 'run']);
    expect(gmailSendCalls).toHaveLength(1);
  });

  it('Scénario 4 — confirmation invalide (payload modifié) : confirmation_failed, aucune exécution, aucun réseau', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const { resolvedAccount, executor } = await buildChain(
      accountStore,
      secretStore,
      fetchFn,
      'acc-1',
      'require_confirmation',
    );
    const confirmationService = new ConfirmationService();

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: resolvedAccount,
      summary: SUMMARY,
    });
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const tamperedPayload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: resolvedAccount.id,
      input: { ...SEND_INPUT, body: 'contenu modifié après la proposition' },
    };

    const runSpy = vi.spyOn(executor, 'run');
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: tamperedPayload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('payload_mismatch');
    expect(runSpy).not.toHaveBeenCalled();
    expect(gmailSendCalls).toHaveLength(0);
  });

  it('Scénario 5 — compte ambigu : AmbiguousAccountError, aucun client construit, aucun réseau', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const accountA = makeAccount({ id: 'acc-A' });
    const accountB = makeAccount({ id: 'acc-B' });
    await accountStore.register(accountA);
    await accountStore.register(accountB);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');
    const { fetchFn } = buildCombinedFetch(
      new Map([
        ['refresh-token-A', 'access-token-A'],
        ['refresh-token-B', 'access-token-B'],
      ]),
    );

    await expect(resolveAccount(accountStore, { provider: 'gmail' })).rejects.toBeInstanceOf(AmbiguousAccountError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Scénario 6 — isolation multi-compte : deux ToolRegistry séparés, aucune inversion possible', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const accountA = makeAccount({ id: 'acc-A' });
    const accountB = makeAccount({ id: 'acc-B' });
    await accountStore.register(accountA);
    await accountStore.register(accountB);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');
    // Un seul fetchFn partagé par les deux comptes — comme un unique `fetch`
    // global en production : l'isolation doit tenir même sur infrastructure partagée.
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(
      new Map([
        ['refresh-token-A', 'access-token-A'],
        ['refresh-token-B', 'access-token-B'],
      ]),
    );

    const chainA = await buildChain(accountStore, secretStore, fetchFn, 'acc-A', 'allow');
    const chainB = await buildChain(accountStore, secretStore, fetchFn, 'acc-B', 'allow');

    const resultA = await chainA.executor.run({ tool: 'gmail.send', input: SEND_INPUT });
    const resultB = await chainB.executor.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(resultA.status).toBe('executed');
    expect(resultB.status).toBe('executed');
    expect(gmailSendCalls).toHaveLength(2);
    expect(gmailSendCalls[0]!.authorization).toBe('Bearer access-token-A');
    expect(gmailSendCalls[1]!.authorization).toBe('Bearer access-token-B');
    expect(gmailSendCalls[0]!.authorization).not.toBe(gmailSendCalls[1]!.authorization);
    expect(chainA.registry).not.toBe(chainB.registry);
  });

  it('Scénario 7 — limite connue : deux comptes ne peuvent pas partager un même ToolRegistry (collision de nom)', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const accountA = makeAccount({ id: 'acc-A' });
    const accountB = makeAccount({ id: 'acc-B' });
    await accountStore.register(accountA);
    await accountStore.register(accountB);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');
    const { fetchFn } = buildCombinedFetch(
      new Map([
        ['refresh-token-A', 'access-token-A'],
        ['refresh-token-B', 'access-token-B'],
      ]),
    );

    const resolvedA = await resolveAccount(accountStore, { provider: 'gmail', accountId: 'acc-A' });
    const resolvedB = await resolveAccount(accountStore, { provider: 'gmail', accountId: 'acc-B' });
    const clientA = await resolveGmailApiClient({
      account: resolvedA,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const clientB = await resolveGmailApiClient({
      account: resolvedB,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });

    // Limite architecturale actuelle, documentée ici — non corrigée par ce test :
    // ToolRegistry exige des noms uniques, donc un même registre ne peut pas
    // porter le `gmail.send` de deux comptes différents à la fois.
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(clientA)) {
      registry.register(tool);
    }
    expect(() => {
      for (const tool of gmailConnector.createTools(clientB)) {
        registry.register(tool);
      }
    }).toThrow(/déjà enregistré/);
  });

  it('Scénario 8 — sécurité : FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK absent de tous les résultats métier', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), marker);
    const { fetchFn } = buildCombinedFetch(new Map([[marker, 'access-token-acc-1']]));

    const { resolvedAccount, client, executor } = await buildChain(
      accountStore,
      secretStore,
      fetchFn,
      'acc-1',
      'require_confirmation',
    );
    const confirmationService = new ConfirmationService();

    // Le marqueur apparaît légitimement dans l'échange OAuth mocké (Authorization/
    // refresh_token) — c'est l'usage attendu, vérifié séparément par le scénario 1.
    expect(JSON.stringify(resolvedAccount)).not.toContain(marker);

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: resolvedAccount,
      summary: SUMMARY,
    });
    expect(JSON.stringify(proposed.confirmationRequest)).not.toContain(marker);
    expect(JSON.stringify(proposed.result)).not.toContain(marker);
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: resolvedAccount.id,
      input: proposed.result.input,
    };
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });
    expect(JSON.stringify(confirmed)).not.toContain(marker);

    // GmailApiClient et son AccessTokenProvider (donc les credentials qu'il capture)
    // ne doivent jamais devenir sérialisables publiquement (#private, M8-A10).
    expect(JSON.stringify(client)).not.toContain(marker);
    expect(Object.keys(client)).not.toContain('accessTokenProvider');
    expect(String(client)).not.toContain(marker);

    // Une confirmation invalide ne doit pas non plus faire fuiter le marqueur.
    const invalid = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: 'confirmation-id-inconnu',
      payload,
    });
    expect(JSON.stringify(invalid)).not.toContain(marker);
  });

  it('Scénario 9 — Account immutability : ni resolveGmailApiClient ni l’exécution ne modifient Account', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const resolvedAccount = await resolveAccount(accountStore, { provider: 'gmail', accountId: 'acc-1' });
    const snapshotBeforeResolution = { ...resolvedAccount };

    const client = await resolveGmailApiClient({
      account: resolvedAccount,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': 'allow' } }));
    await executor.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(resolvedAccount).toEqual(snapshotBeforeResolution);
    expect((resolvedAccount as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    const storedAccount = await accountStore.get('acc-1');
    expect(storedAccount).toEqual(snapshotBeforeResolution);
  });

  it('Scénario 10 — confirmation valide + permission deny (changée entre-temps) → denied, aucun appel Gmail', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey(account.id), 'refresh-token-acc-1');
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const resolvedAccount = await resolveAccount(accountStore, { provider: 'gmail', accountId: 'acc-1' });
    const client = await resolveGmailApiClient({
      account: resolvedAccount,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const confirmationService = new ConfirmationService();

    const requireConfirmationExecutor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } }),
    );
    const proposed = await proposeConfirmation({
      executor: requireConfirmationExecutor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: resolvedAccount,
      summary: SUMMARY,
    });
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');
    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: resolvedAccount.id,
      input: proposed.result.input,
    };

    // La politique change entre la proposition et la confirmation (ex. révocation
    // manuelle décidée entre-temps) : même registre, nouvelle politique "deny".
    const denyExecutor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': 'deny' } }));
    const confirmed = await confirmAndExecute({
      executor: denyExecutor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('denied');
    expect(gmailSendCalls).toHaveLength(0);
  });
});
