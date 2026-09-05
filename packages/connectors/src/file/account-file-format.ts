import type { Account, AccountStatus } from '../account.js';
import { AccountStoreCorruptedError } from '../errors.js';

/**
 * Format persistant de `FileAccountStore` — sérialisation/désérialisation
 * explicites, séparées de la classe qui fait l'E/S (`file-account-store.ts`).
 * Module pur, testable sans toucher au système de fichiers.
 *
 * Contrat de sécurité : la lecture (`parseAccountFile`) ne lit **que** les
 * clés de l'allowlist ci-dessous depuis le JSON brut — toute autre clé
 * présente dans le fichier (ex. un `refreshToken` glissé manuellement ou
 * par erreur) n'est jamais accédée, donc jamais recopiée dans l'`Account`
 * résultant. La sérialisation (`serializeAccount`) construit l'objet écrit
 * champ par champ à partir de la même allowlist, jamais par recopie
 * (`{...account}`) — un `Account` en mémoire auquel un appelant aurait
 * ajouté un champ superflu (ex. via un objet littéral qui satisfait
 * structurellement le type `Account`) ne peut donc pas non plus fuiter à
 * l'écriture.
 */

const CURRENT_ACCOUNT_FILE_VERSION = 1;

const ACCOUNT_STATUSES: readonly AccountStatus[] = ['connected', 'disconnected', 'error'];

/** Forme exacte écrite/lue sur disque — jamais exposée hors de ce module. */
interface PersistedAccountV1 {
  readonly id: string;
  readonly provider: string;
  readonly accountIdentifier: string;
  readonly displayName?: string;
  readonly status: AccountStatus;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PersistedAccountFileV1 {
  readonly version: 1;
  readonly accounts: readonly PersistedAccountV1[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: unknown,
  filePath: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }
  return value;
}

function requireStatus(value: unknown, filePath: string): AccountStatus {
  if (typeof value !== 'string' || !ACCOUNT_STATUSES.includes(value as AccountStatus)) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }
  return value as AccountStatus;
}

function parseMetadata(value: unknown, filePath: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }
  return value;
}

function parseDisplayName(value: unknown, filePath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }
  return value;
}

/**
 * Valide et convertit une entrée brute (déjà JSON.parse'd) en `Account`.
 * N'accède qu'aux clés de l'allowlist — voir le contrat de sécurité en
 * tête de module.
 */
function parseAccount(raw: unknown, filePath: string): Account {
  if (!isPlainObject(raw)) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }

  const id = requireNonEmptyString(raw.id, filePath);
  const provider = requireNonEmptyString(raw.provider, filePath);
  const accountIdentifier = requireNonEmptyString(raw.accountIdentifier, filePath);
  const status = requireStatus(raw.status, filePath);
  const createdAt = requireNonEmptyString(raw.createdAt, filePath);
  const updatedAt = requireNonEmptyString(raw.updatedAt, filePath);
  const displayName = parseDisplayName(raw.displayName, filePath);
  const metadata = parseMetadata(raw.metadata, filePath);

  return {
    id,
    provider,
    accountIdentifier,
    status,
    createdAt,
    updatedAt,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Valide et convertit le contenu JSON.parse'd complet du fichier en
 * `Account[]`.
 *
 * @throws {AccountStoreCorruptedError} `unknown_version` si `version` ne
 *   vaut pas la version courante — aucune tentative de migration
 *   automatique n'est faite pour une version inconnue. `invalid_structure`
 *   si la racine ou un compte n'a pas la forme attendue.
 */
export function parseAccountFile(parsed: unknown, filePath: string): Account[] {
  if (!isPlainObject(parsed)) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }

  if (parsed.version !== CURRENT_ACCOUNT_FILE_VERSION) {
    throw new AccountStoreCorruptedError('unknown_version', filePath);
  }

  if (!Array.isArray(parsed.accounts)) {
    throw new AccountStoreCorruptedError('invalid_structure', filePath);
  }

  return parsed.accounts.map((raw) => parseAccount(raw, filePath));
}

function serializeAccount(account: Account): PersistedAccountV1 {
  return {
    id: account.id,
    provider: account.provider,
    accountIdentifier: account.accountIdentifier,
    ...(account.displayName !== undefined ? { displayName: account.displayName } : {}),
    status: account.status,
    ...(account.metadata !== undefined ? { metadata: account.metadata } : {}),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/** Sérialise une liste de comptes vers le format persistant (JSON, indenté). */
export function serializeAccountFile(accounts: readonly Account[]): string {
  const payload: PersistedAccountFileV1 = {
    version: CURRENT_ACCOUNT_FILE_VERSION,
    accounts: accounts.map(serializeAccount),
  };
  return JSON.stringify(payload, null, 2);
}
