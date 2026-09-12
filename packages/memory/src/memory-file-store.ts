import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { MEMORY_KINDS, type MemoryEntry, type MemoryEntryInput } from './memory-entry.js';
import { MemoryFileError, parseMemoryFile, serializeMemoryFile } from './memory-file-format.js';
import type { MemoryListFilter, MemoryStore } from './memory-store.js';
import { validateProvenance } from './provenance.js';

export interface FileMemoryStoreOptions {
  /**
   * Chemin du fichier JSON. **Fourni explicitement par l'appelant** — jamais
   * deviné, jamais lu depuis l'environnement. Le répertoire parent est créé à
   * la première écriture.
   */
  readonly filePath: string;
}

/**
 * Implémentation **persistante** de {@link MemoryStore} : un unique fichier
 * JSON local, versionné (voir `memory-file-format.ts`).
 *
 * ## Sémantique
 * **Identique** à `InMemoryMemoryStore` — mêmes règles de validation, mêmes
 * ids `mem-<n>`, même idempotence de `invalidate`, même comportement de
 * `supersede` (lien double sens, refus d'une cible déjà invalidée, aucune
 * suppression). Des tests de parité verrouillent cette équivalence.
 * `FileMemoryStore` **n'ajoute aucune logique métier** : ni déduplication, ni
 * résolution de contradiction, ni décision. Il persiste et restitue.
 *
 * ## Ce qui est persistant
 * Tous les champs du contrat `MemoryEntry` : `id`, `kind`, `statement`,
 * `subject?`, `provenance` (`origin` + `confidence?` + `note?`), `createdAt`,
 * `invalidatedAt?`, `invalidationReason?`, `supersedesId?`, `supersededById?`.
 * Les `id` et `createdAt` **restent stables** après redémarrage.
 *
 * ## Ce qui ne l'est PAS
 * Rien d'autre. Le store **n'écrit jamais** de token / credential / clé /
 * mot de passe / `accountId` : il ne connaît que `MemoryEntry`.
 *
 * ## Démarrage
 * Le fichier est lu **au constructeur** (I/O synchrone — le contrat
 * `MemoryStore` est synchrone).
 *   - fichier **absent** ⇒ store vide, aucune erreur, aucun fichier créé
 *     (seule une écriture crée le fichier) ;
 *   - fichier **vide** ⇒ `MemoryFileError('empty_file')` — jamais traité comme
 *     un « store vide » (ce serait masquer une troncature) ;
 *   - **JSON invalide** ⇒ `MemoryFileError('invalid_json')` ;
 *   - **version inconnue** ⇒ `MemoryFileError('unknown_version')` (aucune
 *     interprétation silencieuse) ;
 *   - **structure invalide / clé inconnue / id dupliqué** ⇒
 *     `MemoryFileError('invalid_structure' | 'duplicate_id')`.
 * ⇒ Aucune perte silencieuse de mémoire.
 *
 * ## Stratégie d'écriture
 * Chaque mutation (`add`/`invalidate`/`supersede`) réécrit **tout** le fichier
 * de façon **atomique** : `mkdir -p` du parent, écriture d'un fichier
 * temporaire `<path>.<pid>-<hex>.tmp`, `fsync`, puis `rename` sur le fichier
 * cible (même stratégie que `FileAccountStore`). Un `rename` est atomique sur
 * un même système de fichiers ⇒ jamais de JSON à moitié écrit à la place de
 * l'ancien.
 *
 * Si l'écriture échoue, l'**état mémoire est restauré** à l'instant d'avant la
 * mutation et l'erreur est **propagée** : la mutation n'est jamais présentée
 * comme réussie alors que le fichier n'a pas bougé.
 *
 * ## Concurrence
 * Prévu pour **un processus, une instance** par fichier. Aucun verrou
 * inter-processus : deux instances écrivant le même fichier en parallèle
 * peuvent se perdre des écritures (dernier `rename` gagne). Un « redémarrage »
 * (nouvelle instance après fermeture de la précédente) relit le fichier et
 * repart de l'état persisté.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly filePath: string;
  private entries: MemoryEntry[];
  private counter: number;

  constructor(options: FileMemoryStoreOptions) {
    this.filePath = options.filePath;
    const loaded = this.load();
    this.entries = loaded.slice();
    this.counter = loaded.reduce((max, entry) => {
      const match = /^mem-(\d+)$/.exec(entry.id);
      const n = match ? Number.parseInt(match[1]!, 10) : 0;
      return n > max ? n : max;
    }, 0);
  }

  add(input: MemoryEntryInput): MemoryEntry {
    return this.persistedMutation(() => this.insert(input, undefined));
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  list(filter: MemoryListFilter = {}): readonly MemoryEntry[] {
    const includeInvalidated = filter.includeInvalidated ?? false;
    return this.entries.filter((entry) => {
      if (!includeInvalidated && entry.invalidatedAt !== undefined) {
        return false;
      }
      if (filter.kind !== undefined && entry.kind !== filter.kind) {
        return false;
      }
      if (filter.subject !== undefined && entry.subject !== filter.subject) {
        return false;
      }
      return true;
    });
  }

  invalidate(id: string, reason?: string): MemoryEntry {
    return this.persistedMutation(() => this.markInvalidated(id, reason));
  }

  supersede(id: string, input: MemoryEntryInput): MemoryEntry {
    return this.persistedMutation(() => {
      const target = this.entries.find((entry) => entry.id === id);
      if (target === undefined) {
        throw new Error(`MemoryStore.supersede : aucune entrée d'id « ${id} ».`);
      }
      if (target.invalidatedAt !== undefined) {
        throw new Error(`MemoryStore.supersede : l'entrée « ${id} » est déjà invalidée.`);
      }
      assertValidMemoryInput(input);
      const replacement = this.insert(input, id);
      this.markInvalidated(id, `Remplacée par « ${replacement.id} ».`, replacement.id);
      return replacement;
    });
  }

  // ── logique de store (miroir exact d'`InMemoryMemoryStore`) ────────────────

  private insert(input: MemoryEntryInput, supersedesId: string | undefined): MemoryEntry {
    assertValidMemoryInput(input);
    this.counter += 1;
    const entry: MemoryEntry = {
      id: `mem-${this.counter}`,
      kind: input.kind,
      statement: input.statement,
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      provenance: input.provenance,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(supersedesId !== undefined ? { supersedesId } : {}),
    };
    this.entries.push(entry);
    return entry;
  }

  private markInvalidated(id: string, reason?: string, supersededById?: string): MemoryEntry {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new Error(`MemoryStore : aucune entrée d'id « ${id} ».`);
    }
    const current = this.entries[index]!;
    if (current.invalidatedAt !== undefined) {
      return current;
    }
    const updated: MemoryEntry = {
      ...current,
      invalidatedAt: new Date().toISOString(),
      ...(reason !== undefined ? { invalidationReason: reason } : {}),
      ...(supersededById !== undefined ? { supersededById } : {}),
    };
    this.entries[index] = updated;
    return updated;
  }

  // ── persistance ───────────────────────────────────────────────────────────

  /**
   * Applique `mutation` sur la copie mémoire, puis réécrit tout le fichier.
   * Une exception de `mutation` (input invalide, cible inconnue…) se propage
   * sans écriture. Un échec de la **persistance** restaure l'état mémoire
   * d'avant la mutation et propage l'erreur — jamais de fausse confirmation.
   */
  private persistedMutation<T>(mutation: () => T): T {
    const snapshot = this.entries.slice();
    const snapshotCounter = this.counter;
    const result = mutation();
    try {
      this.writeFileAtomic();
    } catch (err) {
      this.entries = snapshot;
      this.counter = snapshotCounter;
      throw err;
    }
    return result;
  }

  private load(): readonly MemoryEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    if (raw.trim().length === 0) {
      throw new MemoryFileError('empty_file', this.filePath);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MemoryFileError('invalid_json', this.filePath);
    }

    return parseMemoryFile(parsed, this.filePath);
  }

  private writeFileAtomic(): void {
    const serialized = serializeMemoryFile(this.entries);
    mkdirSync(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
    const handle = openSync(tempPath, 'w');
    try {
      writeFileSync(handle, serialized, 'utf-8');
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }

    renameSync(tempPath, this.filePath);
  }
}

/** Miroir d'`assertValidInput` (`memory-store.ts`, privée) — réutilise les primitives exportées. */
function assertValidMemoryInput(input: MemoryEntryInput): void {
  if (!MEMORY_KINDS.includes(input.kind)) {
    throw new Error(`MemoryStore : « kind » inconnu (attendu : ${MEMORY_KINDS.join(', ')}).`);
  }
  if (typeof input.statement !== 'string' || input.statement.trim().length === 0) {
    throw new Error('MemoryStore : « statement » ne peut pas être vide.');
  }
  const provenance = validateProvenance(input.provenance);
  if (!provenance.ok) {
    throw new Error(`MemoryStore : ${provenance.error}`);
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
