import { describe, expect, it } from 'vitest';

import { AccountStore, type Account } from './account.js';
import { AmbiguousAccountError, UnknownAccountError } from './errors.js';

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

describe('AccountStore', () => {
  it('permet plusieurs comptes pour un même provider (ex. Google perso + pro)', () => {
    const store = new AccountStore();
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });

    store.register(personal);
    store.register(work);

    expect(store.listByProvider('google')).toEqual([personal, work]);
  });

  it('lookup par accountId', () => {
    const store = new AccountStore();
    const account = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    store.register(account);

    expect(store.get('acc-1')).toBe(account);
    expect(store.has('acc-1')).toBe(true);
  });

  it('compte inexistant : get() lève UnknownAccountError, has() renvoie false', () => {
    const store = new AccountStore();

    expect(store.has('acc-missing')).toBe(false);
    expect(() => store.get('acc-missing')).toThrowError(UnknownAccountError);
  });

  describe('resolve()', () => {
    it('un seul compte pour le provider, sans accountId : le résout automatiquement', () => {
      const store = new AccountStore();
      const account = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
      store.register(account);

      expect(store.resolve({ provider: 'google' })).toBe(account);
    });

    it('accountId fourni : retourne exactement ce compte', () => {
      const store = new AccountStore();
      const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
      const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
      store.register(personal);
      store.register(work);

      expect(store.resolve({ provider: 'google', accountId: 'acc-2' })).toBe(work);
    });

    it('aucun compte pour ce provider : lève UnknownAccountError', () => {
      const store = new AccountStore();
      expect(() => store.resolve({ provider: 'google' })).toThrowError(UnknownAccountError);
    });

    it('accountId fourni mais inexistant : lève UnknownAccountError', () => {
      const store = new AccountStore();
      store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' }));

      expect(() => store.resolve({ provider: 'google', accountId: 'does-not-exist' })).toThrowError(
        UnknownAccountError,
      );
    });

    it('accountId appartenant à un autre provider : traité comme inconnu pour CE provider (pas de fuite cross-provider)', () => {
      const store = new AccountStore();
      store.register(makeAccount({ id: 'acc-1', provider: 'slack', accountIdentifier: 'team-x' }));

      expect(() => store.resolve({ provider: 'google', accountId: 'acc-1' })).toThrowError(UnknownAccountError);
    });

    it('ambiguïté de compte : plusieurs comptes existent, aucun accountId fourni → AmbiguousAccountError, jamais une sélection implicite', () => {
      const store = new AccountStore();
      const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
      const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
      store.register(personal);
      store.register(work);

      let thrown: unknown;
      try {
        store.resolve({ provider: 'google' });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AmbiguousAccountError);
      expect([...(thrown as AmbiguousAccountError).candidateAccountIds].sort()).toEqual(['acc-1', 'acc-2']);
    });

    it('ambiguïté : appeler resolve() plusieurs fois de suite ne finit jamais par choisir un compte au hasard', () => {
      const store = new AccountStore();
      store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' }));
      store.register(makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' }));

      for (let i = 0; i < 5; i++) {
        expect(() => store.resolve({ provider: 'google' })).toThrowError(AmbiguousAccountError);
      }
    });
  });
});
