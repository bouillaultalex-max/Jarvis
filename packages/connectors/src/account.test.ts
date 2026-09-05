import { describe, expect, it } from 'vitest';

import { resolveAccount, type Account } from './account.js';
import { AmbiguousAccountError, UnknownAccountError } from './errors.js';
import { InMemoryAccountStore } from './in-memory/in-memory-account-store.js';

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'provider' | 'accountIdentifier'>): Account {
  return {
    displayName: undefined,
    status: 'connected',
    metadata: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryAccountStore', () => {
  it('permet plusieurs comptes pour un même provider (ex. Google perso + pro)', async () => {
    const store = new InMemoryAccountStore();
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });

    await store.register(personal);
    await store.register(work);

    await expect(store.listByProvider('google')).resolves.toEqual([personal, work]);
  });

  it('lookup par accountId', async () => {
    const store = new InMemoryAccountStore();
    const account = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    await store.register(account);

    await expect(store.get('acc-1')).resolves.toBe(account);
    await expect(store.has('acc-1')).resolves.toBe(true);
  });

  it('compte inexistant : get() lève UnknownAccountError, has() renvoie false', async () => {
    const store = new InMemoryAccountStore();

    await expect(store.has('acc-missing')).resolves.toBe(false);
    await expect(store.get('acc-missing')).rejects.toThrowError(UnknownAccountError);
  });

  it('list() énumère tous les comptes enregistrés', async () => {
    const store = new InMemoryAccountStore();
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    await store.register(personal);

    await expect(store.list()).resolves.toEqual([personal]);
  });
});

describe('resolveAccount()', () => {
  it('un seul compte pour le provider, sans accountId : le résout automatiquement', async () => {
    const store = new InMemoryAccountStore();
    const account = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    await store.register(account);

    await expect(resolveAccount(store, { provider: 'google' })).resolves.toBe(account);
  });

  it('accountId fourni : retourne exactement ce compte', async () => {
    const store = new InMemoryAccountStore();
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
    await store.register(personal);
    await store.register(work);

    await expect(resolveAccount(store, { provider: 'google', accountId: 'acc-2' })).resolves.toBe(work);
  });

  it('aucun compte pour ce provider : lève UnknownAccountError', async () => {
    const store = new InMemoryAccountStore();
    await expect(resolveAccount(store, { provider: 'google' })).rejects.toThrowError(UnknownAccountError);
  });

  it('accountId fourni mais inexistant : lève UnknownAccountError', async () => {
    const store = new InMemoryAccountStore();
    await store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' }));

    await expect(resolveAccount(store, { provider: 'google', accountId: 'does-not-exist' })).rejects.toThrowError(
      UnknownAccountError,
    );
  });

  it('accountId appartenant à un autre provider : traité comme inconnu pour CE provider (pas de fuite cross-provider)', async () => {
    const store = new InMemoryAccountStore();
    await store.register(makeAccount({ id: 'acc-1', provider: 'slack', accountIdentifier: 'team-x' }));

    await expect(resolveAccount(store, { provider: 'google', accountId: 'acc-1' })).rejects.toThrowError(
      UnknownAccountError,
    );
  });

  it('ambiguïté de compte : plusieurs comptes existent, aucun accountId fourni → AmbiguousAccountError, jamais une sélection implicite', async () => {
    const store = new InMemoryAccountStore();
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
    await store.register(personal);
    await store.register(work);

    let thrown: unknown;
    try {
      await resolveAccount(store, { provider: 'google' });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AmbiguousAccountError);
    expect([...(thrown as AmbiguousAccountError).candidateAccountIds].sort()).toEqual(['acc-1', 'acc-2']);
  });

  it('ambiguïté : appeler resolveAccount() plusieurs fois de suite ne finit jamais par choisir un compte au hasard', async () => {
    const store = new InMemoryAccountStore();
    await store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' }));
    await store.register(makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' }));

    for (let i = 0; i < 5; i++) {
      await expect(resolveAccount(store, { provider: 'google' })).rejects.toThrowError(AmbiguousAccountError);
    }
  });
});
