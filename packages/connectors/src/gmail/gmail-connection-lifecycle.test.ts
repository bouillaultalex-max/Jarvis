import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { resolveAccount } from '../account.js';
import {
  confirmAndExecute,
  proposeConfirmation,
} from '../confirmation/confirmation-flow.js';
import type { ConfirmationInputSummary } from '../confirmation/confirmation-request.js';
import { ConfirmationService, type ConfirmationPayload } from '../confirmation/confirmation-service.js';
import { UnknownAccountError } from '../errors.js';
import { InMemoryAccountStore } from '../in-memory/in-memory-account-store.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import { type GmailAppCredentials } from './gmail-auth.js';
import { resolveGmailApiClient } from './gmail-client-resolver.js';
import { connectGmailAccount, type GmailOAuthResult } from './gmail-connection.js';
import { gmailConnector } from './gmail-connector.js';

/**
 * M8-A12 — Test d'intégration du cycle de vie complet : prouve que
 * `connectGmailAccount` (M8-A9) compose réellement avec le reste de la
 * chaîne déjà validée en M8-A11 (`resolveAccount` → `resolveGmailApiClient`
 * → `gmailConnector.createTools` → `ToolRegistry`/`PermissionManager`/
 * `ToolExecutor`/`ConfirmationFlow` → `gmail.send`).
 *
 * Aucun code de production n'est ajouté ni modifié : toutes les briques
 * utilisées sont les implémentations réelles existantes.
 */

const APP_CREDENTIALS: GmailAppCredentials = { clientId: 'app-client-id', clientSecret: 'FAKE-APP-CLIENT-SECRET' };
const SEND_INPUT = { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' };
const SUMMARY: ConfirmationInputSummary = {
  fields: [{ key: 'to', label: 'Destinataire', value: SEND_INPUT.to }],
};

function successResult(accountIdentifier: string, refreshToken: string, displayName?: string): GmailOAuthResult {
  return {
    status: 'success',
    identity: { accountIdentifier, ...(displayName !== undefined ? { displayName } : {}) },
    refreshToken,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Fausse API combinée : route l'échange OAuth et l'envoi Gmail sur un seul
 * `fetchFn`, comme un `fetch` global unique en production. Reprend le
 * pattern déjà établi dans `gmail-client-resolver.test.ts`/
 * `gmail-account-integration.test.ts` (M8-A10/A11).
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

describe('Cycle de vie Gmail complet (connectGmailAccount → gmail.send) — M8-A12', () => {
  it('Scénario 1 — connexion initiale : OAuth success → connectGmailAccount → resolveAccount → resolveGmailApiClient → gmail.send exécuté', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { fetchFn, tokenExchangeRefreshTokens, gmailSendCalls } = buildCombinedFetch(
      new Map([['refresh-token-v1', 'access-token-v1']]),
    );

    const connected = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-v1'),
      accountStore,
      secretStore,
    });
    expect(connected.status).toBe('connected');
    if (connected.status !== 'connected') throw new Error('unreachable');

    const resolvedAccount = await resolveAccount(accountStore, { provider: 'gmail', accountId: connected.accountId });
    const client = await resolveGmailApiClient({
      account: resolvedAccount,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': 'allow' } }));

    const result = await executor.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(result).toMatchObject({ status: 'executed', output: { id: 'sent-1', threadId: 'thread-1' } });
    expect(gmailSendCalls).toHaveLength(1);
    expect(gmailSendCalls[0]!.authorization).toBe('Bearer access-token-v1');
    expect(tokenExchangeRefreshTokens).toEqual(['refresh-token-v1']);
  });

  it('Scénario 2 — reconnexion : même accountId, nouveau refresh token utilisé exclusivement (via ConfirmationFlow)', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { fetchFn, tokenExchangeRefreshTokens, gmailSendCalls } = buildCombinedFetch(
      new Map([
        ['refresh-token-v1', 'access-token-v1'],
        ['refresh-token-v2', 'access-token-v2'],
      ]),
    );

    const firstConnection = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-v1'),
      accountStore,
      secretStore,
    });
    if (firstConnection.status !== 'connected') throw new Error('unreachable');

    const secondConnection = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-v2', 'Alice W.'),
      accountStore,
      secretStore,
    });
    if (secondConnection.status !== 'connected') throw new Error('unreachable');

    expect(secondConnection.accountId).toBe(firstConnection.accountId);
    expect(await accountStore.list()).toHaveLength(1);

    const resolvedAccount = await resolveAccount(accountStore, {
      provider: 'gmail',
      accountId: secondConnection.accountId,
    });
    const client = await resolveGmailApiClient({
      account: resolvedAccount,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } }));
    const confirmationService = new ConfirmationService();

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: resolvedAccount,
      summary: SUMMARY,
    });
    expect(proposed.result.status).toBe('awaiting_confirmation');
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

    expect(confirmed).toMatchObject({ status: 'executed', output: { id: 'sent-1', threadId: 'thread-1' } });
    expect(gmailSendCalls).toHaveLength(1);
    expect(gmailSendCalls[0]!.authorization).toBe('Bearer access-token-v2');
    expect(tokenExchangeRefreshTokens).toEqual(['refresh-token-v2']);
    expect(tokenExchangeRefreshTokens).not.toContain('refresh-token-v1');
  });

  it('Scénario 3 — cancellation/error : aucun Account, aucun secret, résolution ultérieure impossible proprement', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const cancelled = await connectGmailAccount({ result: { status: 'cancelled' }, accountStore, secretStore });
    expect(cancelled).toEqual({ status: 'cancelled' });

    const errored = await connectGmailAccount({
      result: { status: 'error', reason: 'consentement refusé par Google' },
      accountStore,
      secretStore,
    });
    expect(errored).toEqual({ status: 'error', reason: 'consentement refusé par Google' });

    expect(await accountStore.list()).toHaveLength(0);
    await expect(resolveAccount(accountStore, { provider: 'gmail' })).rejects.toBeInstanceOf(UnknownAccountError);
  });

  it('Scénario 4 — isolation multi-compte : deux comptes connectés via connectGmailAccount, exécutions isolées', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { fetchFn, gmailSendCalls } = buildCombinedFetch(
      new Map([
        ['refresh-token-A', 'access-token-A'],
        ['refresh-token-B', 'access-token-B'],
      ]),
    );

    const connectedA = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-A'),
      accountStore,
      secretStore,
    });
    const connectedB = await connectGmailAccount({
      result: successResult('bob@example.test', 'refresh-token-B'),
      accountStore,
      secretStore,
    });
    if (connectedA.status !== 'connected' || connectedB.status !== 'connected') throw new Error('unreachable');
    expect(connectedA.accountId).not.toBe(connectedB.accountId);

    const resolvedA = await resolveAccount(accountStore, { provider: 'gmail', accountId: connectedA.accountId });
    const resolvedB = await resolveAccount(accountStore, { provider: 'gmail', accountId: connectedB.accountId });
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

    const registryA = new ToolRegistry();
    for (const tool of gmailConnector.createTools(clientA)) registryA.register(tool);
    const registryB = new ToolRegistry();
    for (const tool of gmailConnector.createTools(clientB)) registryB.register(tool);
    const executorA = new ToolExecutor(registryA, new PermissionManager({ rules: { 'gmail.send': 'allow' } }));
    const executorB = new ToolExecutor(registryB, new PermissionManager({ rules: { 'gmail.send': 'allow' } }));

    const resultA = await executorA.run({ tool: 'gmail.send', input: SEND_INPUT });
    const resultB = await executorB.run({ tool: 'gmail.send', input: SEND_INPUT });

    expect(resultA.status).toBe('executed');
    expect(resultB.status).toBe('executed');
    expect(gmailSendCalls).toHaveLength(2);
    expect(gmailSendCalls[0]!.authorization).toBe('Bearer access-token-A');
    expect(gmailSendCalls[1]!.authorization).toBe('Bearer access-token-B');
    expect(gmailSendCalls[0]!.authorization).not.toBe(gmailSendCalls[1]!.authorization);
  });

  it('Scénario 5 — sécurité : FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK absent de tous les résultats publics du cycle complet', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const { fetchFn } = buildCombinedFetch(new Map([[marker, 'access-token-acc-1']]));

    const connected = await connectGmailAccount({
      result: successResult('alice@example.test', marker),
      accountStore,
      secretStore,
    });
    expect(JSON.stringify(connected)).not.toContain(marker);
    if (connected.status !== 'connected') throw new Error('unreachable');

    const resolvedAccount = await resolveAccount(accountStore, { provider: 'gmail', accountId: connected.accountId });
    expect(JSON.stringify(resolvedAccount)).not.toContain(marker);

    const client = await resolveGmailApiClient({
      account: resolvedAccount,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } }));
    const confirmationService = new ConfirmationService();

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
  });
});
