import type { Account, AccountStore } from '../account.js';
import { UnknownAccountError } from '../errors.js';

/**
 * Implémentation en mémoire d'{@link AccountStore} — comportement
 * historique de l'ancienne classe concrète `AccountStore` (pré-M8-A1),
 * désormais derrière l'interface générique. Sert de référence pour les
 * tests et pour tout usage qui n'a pas besoin de survivre à un
 * redémarrage (voir un futur `FileAccountStore` pour la persistance).
 */
export class InMemoryAccountStore implements AccountStore {
  readonly #accounts = new Map<string, Account>();

  async register(account: Account): Promise<void> {
    this.#accounts.set(account.id, account);
  }

  async has(accountId: string): Promise<boolean> {
    return this.#accounts.has(accountId);
  }

  async get(accountId: string): Promise<Account> {
    const account = this.#accounts.get(accountId);
    if (account === undefined) {
      throw new UnknownAccountError(accountId);
    }
    return account;
  }

  async listByProvider(provider: string): Promise<Account[]> {
    return [...this.#accounts.values()].filter((account) => account.provider === provider);
  }

  async list(): Promise<Account[]> {
    return [...this.#accounts.values()];
  }
}
