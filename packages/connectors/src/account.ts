import { AmbiguousAccountError, UnknownAccountError } from './errors.js';

/**
 * Statut d'un compte connecté. Purement informatif : ne conditionne
 * aucune décision de permission (ça reste le rôle de `PermissionManager`).
 */
export type AccountStatus = 'connected' | 'disconnected' | 'error';

/**
 * Un compte utilisateur pour un provider donné (ex. Gmail personnel, Gmail
 * professionnel). Un utilisateur peut avoir plusieurs `Account` pour le
 * même `provider` : ne jamais supposer 1 provider = 1 compte.
 *
 * Ne porte volontairement aucun champ credential/token — les secrets
 * vivent exclusivement dans un `SecretStore`, jamais ici.
 */
export interface Account {
  readonly id: string;
  readonly provider: string;
  /** Identifiant côté fournisseur (ex. une adresse email), pas un secret. */
  readonly accountIdentifier: string;
  readonly displayName?: string;
  readonly status: AccountStatus;
  /** Métadonnées non sensibles uniquement (jamais de credential). */
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolveAccountRequest {
  readonly provider: string;
  /** Si omis, ne peut être résolu que s'il existe exactement un compte pour ce provider. */
  readonly accountId?: string;
}

/**
 * Registre des comptes connectés. Responsabilité unique : enregistrer et
 * résoudre des `Account` — ne prend aucune décision de permission
 * (`PermissionManager`) ni de secret (`SecretStore`).
 */
export class AccountStore {
  private readonly accounts = new Map<string, Account>();

  register(account: Account): void {
    this.accounts.set(account.id, account);
  }

  has(accountId: string): boolean {
    return this.accounts.has(accountId);
  }

  /**
   * Lookup direct par id.
   *
   * @throws {UnknownAccountError} si aucun compte ne porte cet id.
   */
  get(accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (account === undefined) {
      throw new UnknownAccountError(accountId);
    }
    return account;
  }

  listByProvider(provider: string): Account[] {
    return [...this.accounts.values()].filter((account) => account.provider === provider);
  }

  list(): Account[] {
    return [...this.accounts.values()];
  }

  /**
   * Résout le compte à utiliser pour une opération donnée. C'est le seul
   * point de sélection d'un compte : il ne choisit **jamais** silencieusement
   * un compte parmi plusieurs.
   *
   * - `accountId` fourni : retourne ce compte précis (doit exister et
   *   appartenir à `provider`), sinon `UnknownAccountError`.
   * - `accountId` absent et un seul compte pour ce provider : le retourne.
   * - `accountId` absent et aucun compte pour ce provider : `UnknownAccountError`.
   * - `accountId` absent et plusieurs comptes pour ce provider : `AmbiguousAccountError`.
   */
  resolve(request: ResolveAccountRequest): Account {
    const { provider, accountId } = request;

    if (accountId !== undefined) {
      const account = this.accounts.get(accountId);
      if (account === undefined || account.provider !== provider) {
        throw new UnknownAccountError(accountId, provider);
      }
      return account;
    }

    const candidates = this.listByProvider(provider);
    if (candidates.length === 0) {
      throw new UnknownAccountError(undefined, provider);
    }
    if (candidates.length > 1) {
      throw new AmbiguousAccountError(
        provider,
        candidates.map((account) => account.id),
      );
    }
    return candidates[0]!;
  }
}
