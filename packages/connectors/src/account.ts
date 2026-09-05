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
 * Stockage de comptes connectés. Responsabilité unique : enregistrer et
 * retrouver des `Account` — ne prend aucune décision de permission
 * (`PermissionManager`) ni de secret (`SecretStore`), et ne décide jamais
 * lui-même quel compte utiliser pour une opération ambiguë (voir
 * {@link resolveAccount}, volontairement séparée : la logique de
 * résolution est identique quel que soit le backend, elle ne doit pas
 * être ré-implémentée par chaque implémentation).
 *
 * Toutes les opérations sont `Promise`-based : un backend de production
 * (fichier, futur stockage distant…) fait nécessairement de l'E/S, et
 * l'interface doit rester honnête à ce sujet même quand une implémentation
 * donnée (ex. {@link ../in-memory/in-memory-account-store.js}) peut se
 * permettre d'être synchrone en interne.
 */
export interface AccountStore {
  register(account: Account): Promise<void>;
  has(accountId: string): Promise<boolean>;

  /**
   * Lookup direct par id.
   *
   * @throws {UnknownAccountError} si aucun compte ne porte cet id.
   */
  get(accountId: string): Promise<Account>;

  listByProvider(provider: string): Promise<Account[]>;
  list(): Promise<Account[]>;
}

/**
 * Résout le compte à utiliser pour une opération donnée, pour n'importe
 * quelle implémentation d'{@link AccountStore}. C'est le seul point de
 * sélection d'un compte : il ne choisit **jamais** silencieusement un
 * compte parmi plusieurs.
 *
 * - `accountId` fourni : retourne ce compte précis (doit exister et
 *   appartenir à `provider`), sinon `UnknownAccountError`.
 * - `accountId` absent et un seul compte pour ce provider : le retourne.
 * - `accountId` absent et aucun compte pour ce provider : `UnknownAccountError`.
 * - `accountId` absent et plusieurs comptes pour ce provider : `AmbiguousAccountError`.
 */
export async function resolveAccount(store: AccountStore, request: ResolveAccountRequest): Promise<Account> {
  const { provider, accountId } = request;

  if (accountId !== undefined) {
    const found = (await store.has(accountId)) ? await store.get(accountId) : undefined;
    if (found === undefined || found.provider !== provider) {
      throw new UnknownAccountError(accountId, provider);
    }
    return found;
  }

  const candidates = await store.listByProvider(provider);
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
