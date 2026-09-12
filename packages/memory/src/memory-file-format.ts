import { MEMORY_KINDS, type MemoryEntry, type MemoryKind } from './memory-entry.js';
import { type Provenance, type ProvenanceOrigin, validateProvenance } from './provenance.js';

/**
 * Version courante du format de fichier de {@link FileMemoryStore}.
 *
 * **Format v1** — enveloppe explicite :
 *
 * ```json
 * { "version": 1, "entries": [ { …champs de MemoryEntry… } ] }
 * ```
 *
 * Une seule version existe aujourd'hui. `parseMemoryFile` **refuse** toute
 * autre valeur de `version` (`unknown_version`) : c'est la frontière prête
 * pour une future migration — jamais d'interprétation silencieuse.
 */
export const CURRENT_MEMORY_FILE_VERSION = 1;

export type MemoryFileErrorReason =
  'empty_file' | 'invalid_json' | 'unknown_version' | 'invalid_structure' | 'duplicate_id';

/**
 * Levée lorsqu'un fichier de mémoire **existe mais ne peut pas être interprété
 * de façon sûre**. Ne masque **jamais** une corruption par un « store vide »
 * silencieux — voir {@link MemoryFileErrorReason}.
 */
export class MemoryFileError extends Error {
  constructor(
    readonly reason: MemoryFileErrorReason,
    readonly filePath: string,
  ) {
    super(`MemoryFileError[${reason}] : fichier de mémoire « ${filePath} » illisible.`);
    this.name = 'MemoryFileError';
  }
}

/** Forme exacte écrite/lue sur disque — jamais exposée hors de ce module. */
interface PersistedProvenanceV1 {
  readonly origin: ProvenanceOrigin;
  readonly confidence?: number;
  readonly note?: string;
}
interface PersistedMemoryEntryV1 {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly statement: string;
  readonly subject?: string;
  readonly provenance: PersistedProvenanceV1;
  readonly createdAt: string;
  readonly invalidatedAt?: string;
  readonly invalidationReason?: string;
  readonly supersedesId?: string;
  readonly supersededById?: string;
}
interface PersistedMemoryFileV1 {
  readonly version: 1;
  readonly entries: readonly PersistedMemoryEntryV1[];
}

const ENTRY_KEYS: ReadonlySet<string> = new Set([
  'id',
  'kind',
  'statement',
  'subject',
  'provenance',
  'createdAt',
  'invalidatedAt',
  'invalidationReason',
  'supersedesId',
  'supersededById',
]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(['origin', 'confidence', 'note']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(reason: MemoryFileErrorReason, filePath: string): never {
  throw new MemoryFileError(reason, filePath);
}

function requireNonEmptyString(value: unknown, filePath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_structure', filePath);
  }
  return value;
}

function requireOptionalString(value: unknown, filePath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fail('invalid_structure', filePath);
  }
  return value;
}

/**
 * Valide **et normalise** une provenance brute. Schéma **fermé** (aucune clé
 * hors `origin`/`confidence`/`note`) ; réutilise `validateProvenance` (origine
 * connue, `confidence` ∈ [0,1] et interdite sur une origine certaine).
 */
function parseProvenance(value: unknown, filePath: string): Provenance {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  for (const key of Object.keys(value)) {
    if (!PROVENANCE_KEYS.has(key)) {
      fail('invalid_structure', filePath);
    }
  }
  const check = validateProvenance(value);
  if (!check.ok) {
    fail('invalid_structure', filePath);
  }
  const raw = value as { origin: ProvenanceOrigin; confidence?: number; note?: string };
  return {
    origin: raw.origin,
    ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
    ...(raw.note !== undefined ? { note: raw.note } : {}),
  };
}

/** Schéma **fermé** au niveau de l'entrée. */
function parseEntry(value: unknown, filePath: string): MemoryEntry {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) {
      fail('invalid_structure', filePath);
    }
  }

  const { kind, statement } = value;
  if (typeof kind !== 'string' || !MEMORY_KINDS.includes(kind as MemoryKind)) {
    fail('invalid_structure', filePath);
  }
  if (typeof statement !== 'string' || statement.trim().length === 0) {
    fail('invalid_structure', filePath);
  }
  const subject = requireOptionalString(value.subject, filePath);
  const invalidationReason = requireOptionalString(value.invalidationReason, filePath);

  return {
    id: requireNonEmptyString(value.id, filePath),
    kind: kind as MemoryKind,
    statement,
    ...(subject !== undefined ? { subject } : {}),
    provenance: parseProvenance(value.provenance, filePath),
    createdAt: requireNonEmptyString(value.createdAt, filePath),
    ...(value.invalidatedAt !== undefined
      ? { invalidatedAt: requireNonEmptyString(value.invalidatedAt, filePath) }
      : {}),
    ...(invalidationReason !== undefined ? { invalidationReason } : {}),
    ...(value.supersedesId !== undefined
      ? { supersedesId: requireNonEmptyString(value.supersedesId, filePath) }
      : {}),
    ...(value.supersededById !== undefined
      ? { supersededById: requireNonEmptyString(value.supersededById, filePath) }
      : {}),
  };
}

/**
 * Valide et convertit le contenu **déjà `JSON.parse`'d** d'un fichier de
 * mémoire en `MemoryEntry[]`. Fonction **pure**, sans I/O.
 *
 * @throws {MemoryFileError}
 *   - `unknown_version` si `version` ≠ {@link CURRENT_MEMORY_FILE_VERSION}
 *     (aucune migration silencieuse) ;
 *   - `invalid_structure` si la racine, une entrée ou une provenance ne
 *     respecte pas la forme attendue (**toute clé inconnue** incluse) ;
 *   - `duplicate_id` si deux entrées portent le même `id`.
 */
export function parseMemoryFile(parsed: unknown, filePath: string): MemoryEntry[] {
  if (!isPlainObject(parsed)) {
    fail('invalid_structure', filePath);
  }
  if (parsed.version !== CURRENT_MEMORY_FILE_VERSION) {
    fail('unknown_version', filePath);
  }
  if (!Array.isArray(parsed.entries)) {
    fail('invalid_structure', filePath);
  }

  const entries = parsed.entries.map((raw) => parseEntry(raw, filePath));

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      fail('duplicate_id', filePath);
    }
    seen.add(entry.id);
  }
  return entries;
}

function serializeEntry(entry: MemoryEntry): PersistedMemoryEntryV1 {
  return {
    id: entry.id,
    kind: entry.kind,
    statement: entry.statement,
    ...(entry.subject !== undefined ? { subject: entry.subject } : {}),
    provenance: {
      origin: entry.provenance.origin,
      ...(entry.provenance.confidence !== undefined
        ? { confidence: entry.provenance.confidence }
        : {}),
      ...(entry.provenance.note !== undefined ? { note: entry.provenance.note } : {}),
    },
    createdAt: entry.createdAt,
    ...(entry.invalidatedAt !== undefined ? { invalidatedAt: entry.invalidatedAt } : {}),
    ...(entry.invalidationReason !== undefined
      ? { invalidationReason: entry.invalidationReason }
      : {}),
    ...(entry.supersedesId !== undefined ? { supersedesId: entry.supersedesId } : {}),
    ...(entry.supersededById !== undefined ? { supersededById: entry.supersededById } : {}),
  };
}

/**
 * Sérialise vers le **format v1** (JSON indenté de 2, **champ par champ** —
 * jamais `{ ...entry }`, pour qu'aucun champ superflu ajouté par erreur en
 * mémoire ne puisse fuiter sur disque).
 */
export function serializeMemoryFile(entries: readonly MemoryEntry[]): string {
  const payload: PersistedMemoryFileV1 = {
    version: CURRENT_MEMORY_FILE_VERSION,
    entries: entries.map(serializeEntry),
  };
  return JSON.stringify(payload, null, 2);
}
