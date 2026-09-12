import {
  MEMORY_KINDS,
  type MemoryEntry,
  type MemoryEntryInput,
  type MemoryKind,
} from './memory-entry.js';
import { validateProvenance } from './provenance.js';

/** Filtre de lecture pour {@link MemoryStore.list}. */
export interface MemoryListFilter {
  readonly kind?: MemoryKind;
  readonly subject?: string;
  /** Défaut : `false` — les entrées invalidées sont exclues. */
  readonly includeInvalidated?: boolean;
}

/**
 * Stockage **pur** de la mémoire contrôlée de JARVIS.
 *
 * Même rôle que `PreferenceStore` (`@jarvis/classification`) : il conserve et
 * retrouve des entrées, il ne décide **jamais**
 *   - si deux entrées se contredisent,
 *   - laquelle « l'emporte »,
 *   - si une nouvelle entrée fait doublon.
 * Ces arbitrages relèveront d'une couche supérieure (à l'image de
 * `preference-matcher.ts`), volontairement absente aujourd'hui.
 *
 * Opérations :
 *   - `add`        — ajoute une information (avec sa provenance) ;
 *   - `get`        — consulte par id (rend aussi les entrées invalidées) ;
 *   - `list`       — consulte, filtrable (kind / subject / invalidées) ;
 *   - `invalidate` — invalide **sans supprimer** (traçabilité conservée) ;
 *   - `supersede`  — ajoute une entrée qui en remplace une autre ; l'ancienne
 *                    est invalidée et liée à la nouvelle via `supersedesId`.
 *
 * Pas de suppression définitive : une information retirée est invalidée, jamais
 * effacée, pour qu'une contradiction ne disparaisse pas silencieusement.
 */
export interface MemoryStore {
  /** @throws {Error} si `statement` est vide ou si la provenance est invalide. */
  add(input: MemoryEntryInput): MemoryEntry;
  get(id: string): MemoryEntry | undefined;
  list(filter?: MemoryListFilter): readonly MemoryEntry[];
  /**
   * Marque l'entrée comme invalidée. Idempotent : ré-invalider une entrée déjà
   * invalidée la renvoie inchangée.
   * @throws {Error} si aucune entrée ne porte cet id.
   */
  invalidate(id: string, reason?: string): MemoryEntry;
  /**
   * Ajoute `input` en tant que remplaçante de l'entrée `id`, puis invalide
   * cette dernière. La remplaçante porte `supersedesId = id` ; l'ancienne porte
   * désormais `supersededById = <id de la remplaçante>` — la lignée reste donc
   * traversable dans les deux sens (voir `resolveMemoryLineage`), sans aucune
   * perte : rien n'est supprimé.
   *
   * Comme `supersede` refuse une cible déjà invalidée, une lignée reste
   * strictement **linéaire** : elle ne s'allonge qu'à sa pointe (l'entrée
   * courante, seule non invalidée).
   *
   * @throws {Error} si l'entrée cible n'existe pas ou est déjà invalidée, ou
   *   si `input` est invalide (mêmes règles que `add`).
   */
  supersede(id: string, input: MemoryEntryInput): MemoryEntry;
}

function assertValidInput(input: MemoryEntryInput): void {
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

/**
 * Implémentation en mémoire — dev/test et premier socle d'exécution, comme
 * `InMemoryPreferenceStore`. Aucune persistance : l'état ne survit pas à
 * l'arrêt du process (une implémentation persistante fera l'objet d'un
 * chantier distinct).
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries: MemoryEntry[] = [];
  private counter = 0;

  add(input: MemoryEntryInput): MemoryEntry {
    return this.insert(input, undefined);
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
    return this.markInvalidated(id, reason);
  }

  supersede(id: string, input: MemoryEntryInput): MemoryEntry {
    const target = this.get(id);
    if (target === undefined) {
      throw new Error(`MemoryStore.supersede : aucune entrée d'id « ${id} ».`);
    }
    if (target.invalidatedAt !== undefined) {
      throw new Error(`MemoryStore.supersede : l'entrée « ${id} » est déjà invalidée.`);
    }
    assertValidInput(input);
    const replacement = this.insert(input, id);
    this.markInvalidated(id, `Remplacée par « ${replacement.id} ».`, replacement.id);
    return replacement;
  }

  private insert(input: MemoryEntryInput, supersedesId: string | undefined): MemoryEntry {
    assertValidInput(input);
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
}
