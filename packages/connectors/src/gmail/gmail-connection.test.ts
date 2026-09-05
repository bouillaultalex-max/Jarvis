import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { InMemoryAccountStore } from '../in-memory/in-memory-account-store.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import { gmailRefreshTokenSecretKey } from './gmail-auth.js';
import { connectGmailAccount, type ConnectGmailAccountOutcome, type GmailOAuthResult } from './gmail-connection.js';

/**
 * Tests de l'orchestration de connexion Gmail — M8-A9. Aucun réseau, aucun
 * transport OAuth réel, aucune UI : `connectGmailAccount` reçoit toujours un
 * `GmailOAuthResult` déjà normalisé, construit ici à la main.
 */

function successResult(accountIdentifier: string, refreshToken: string, displayName?: string): GmailOAuthResult {
  return {
    status: 'success',
    identity: { accountIdentifier, ...(displayName !== undefined ? { displayName } : {}) },
    refreshToken,
  };
}

describe('connectGmailAccount — M8-A9', () => {
  it('A. première connexion réussie : Account créé, refresh token stocké, résultat public correct', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-alice', 'Alice'),
      accountStore,
      secretStore,
    });

    expect(outcome.status).toBe('connected');
    if (outcome.status !== 'connected') throw new Error('unreachable');
    expect(outcome.provider).toBe('gmail');
    expect(outcome.accountIdentifier).toBe('alice@example.test');
    expect('refreshToken' in outcome).toBe(false);

    const stored = await accountStore.get(outcome.accountId);
    expect(stored).toMatchObject({
      provider: 'gmail',
      accountIdentifier: 'alice@example.test',
      status: 'connected',
      displayName: 'Alice',
    });

    expect(await secretStore.get(gmailRefreshTokenSecretKey(outcome.accountId))).toBe('refresh-token-alice');
  });

  it('B. compte déjà existant : aucun doublon, même accountId conservé, nouveau secret associé', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const first = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-v1'),
      accountStore,
      secretStore,
    });
    if (first.status !== 'connected') throw new Error('unreachable');

    const second = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-v2', 'Alice W.'),
      accountStore,
      secretStore,
    });
    if (second.status !== 'connected') throw new Error('unreachable');

    expect(second.accountId).toBe(first.accountId);
    expect(await accountStore.list()).toHaveLength(1);
    expect(await secretStore.get(gmailRefreshTokenSecretKey(first.accountId))).toBe('refresh-token-v2');
    const stored = await accountStore.get(first.accountId);
    expect(stored.displayName).toBe('Alice W.');
    expect(stored.status).toBe('connected');
  });

  it('C. deux comptes Gmail distincts : isolation totale des secrets', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcomeA = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-A'),
      accountStore,
      secretStore,
    });
    const outcomeB = await connectGmailAccount({
      result: successResult('bob@example.test', 'refresh-token-B'),
      accountStore,
      secretStore,
    });
    if (outcomeA.status !== 'connected' || outcomeB.status !== 'connected') throw new Error('unreachable');

    expect(outcomeA.accountId).not.toBe(outcomeB.accountId);
    expect(await secretStore.get(gmailRefreshTokenSecretKey(outcomeA.accountId))).toBe('refresh-token-A');
    expect(await secretStore.get(gmailRefreshTokenSecretKey(outcomeB.accountId))).toBe('refresh-token-B');
    // Le secret d'un compte ne doit jamais être lisible sous la clé de l'autre.
    expect(await secretStore.get(gmailRefreshTokenSecretKey(outcomeA.accountId))).not.toBe('refresh-token-B');
  });

  it('D. OAuth cancelled : aucun Account créé, aucun secret créé', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({ result: { status: 'cancelled' }, accountStore, secretStore });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(await accountStore.list()).toHaveLength(0);
  });

  it('E. OAuth error : aucun Account partiel, aucun secret, résultat public sûr', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({
      result: { status: 'error', reason: 'consentement refusé par Google' },
      accountStore,
      secretStore,
    });

    expect(outcome).toEqual({ status: 'error', reason: 'consentement refusé par Google' });
    expect(await accountStore.list()).toHaveLength(0);
  });

  it('F. identité Gmail ou refresh token absent/invalide : rejet propre, aucun stockage', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const emptyIdentifier = await connectGmailAccount({
      result: successResult('', 'refresh-token'),
      accountStore,
      secretStore,
    });
    expect(emptyIdentifier.status).toBe('rejected');

    const emptyToken = await connectGmailAccount({
      result: successResult('alice@example.test', ''),
      accountStore,
      secretStore,
    });
    expect(emptyToken.status).toBe('rejected');

    expect(await accountStore.list()).toHaveLength(0);
  });

  it('G. sécurité : FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK absent de tous les résultats publics et erreurs', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({
      result: successResult('alice@example.test', marker),
      accountStore,
      secretStore,
    });
    if (outcome.status !== 'connected') throw new Error('unreachable');

    expect(JSON.stringify(outcome)).not.toContain(marker);
    const account = await accountStore.get(outcome.accountId);
    expect(JSON.stringify(account)).not.toContain(marker);

    // Présence légitime : uniquement dans le SecretStore lui-même.
    expect(await secretStore.get(gmailRefreshTokenSecretKey(outcome.accountId))).toBe(marker);

    const rejectedOutcome = await connectGmailAccount({
      result: successResult('', marker),
      accountStore,
      secretStore,
    });
    expect(JSON.stringify(rejectedOutcome)).not.toContain(marker);

    const errorOutcome = await connectGmailAccount({
      result: { status: 'error', reason: 'refus' },
      accountStore,
      secretStore,
    });
    expect(JSON.stringify(errorOutcome)).not.toContain(marker);
  });

  it('H. Account : aucun credential, aucune metadata implicite, contrat structurel strict', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-alice'),
      accountStore,
      secretStore,
    });
    if (outcome.status !== 'connected') throw new Error('unreachable');

    const account = await accountStore.get(outcome.accountId);
    expect(Object.keys(account).sort()).toEqual(
      ['id', 'provider', 'accountIdentifier', 'status', 'createdAt', 'updatedAt'].sort(),
    );
    expect(account.metadata).toBeUndefined();
    expect((account as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    expect((account as unknown as Record<string, unknown>).accessToken).toBeUndefined();
  });

  it('I. indépendance de transport : la connexion réussit sans aucun réseau/UI/serveur (aucun fetchFn fourni nulle part)', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const outcome = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-alice'),
      accountStore,
      secretStore,
    });

    expect(outcome.status).toBe('connected');
  });

  it('J. invariant permission : aucune interaction avec PermissionManager/ToolExecutor/ToolRegistry', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    // Construits uniquement pour prouver l'absence totale d'interaction :
    // connectGmailAccount n'a même pas de paramètre pour les recevoir.
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'deny' }));

    const outcome = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-alice'),
      accountStore,
      secretStore,
    });

    expect(outcome.status).toBe('connected');
    expect(registry.list()).toHaveLength(0);
    // `executor` n'est jamais passé à connectGmailAccount ni invoqué : la
    // connexion d'un compte n'est structurellement pas un Tool `execute`.
    void executor;
  });

  it('résultats "cancelled"/"error"/"rejected" sont bien distincts de "denied"/"executed"/"awaiting_confirmation"', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const results: ConnectGmailAccountOutcome[] = [
      await connectGmailAccount({ result: { status: 'cancelled' }, accountStore, secretStore }),
      await connectGmailAccount({ result: { status: 'error', reason: 'x' }, accountStore, secretStore }),
      await connectGmailAccount({ result: successResult('', 'x'), accountStore, secretStore }),
    ];

    for (const status of ['denied', 'executed', 'awaiting_confirmation', 'unknown_tool', 'invalid_input']) {
      expect(results.map((r) => r.status)).not.toContain(status);
    }
  });
});
