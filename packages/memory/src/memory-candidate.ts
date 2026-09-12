import { MEMORY_KINDS, type MemoryKind } from './memory-entry.js';
import { type Provenance, type ProvenanceOrigin, validateProvenance } from './provenance.js';

/**
 * Un **souvenir candidat** : une information que JARVIS *propose* de mémoriser,
 * pas encore validée — donc **jamais** présente dans un `MemoryStore`.
 *
 * Forme délibérément distincte de {@link MemoryEntry} / `MemoryEntryInput` :
 *   - aucun `id`, aucun `createdAt`, aucun lien de lignée : un candidat n'a
 *     pas d'existence dans le store ;
 *   - `subject` est **obligatoire et non vide** (il est optionnel sur
 *     `MemoryEntry`) : une proposition sans sujet n'est pas exploitable ;
 *   - `provenance` reste explicite ; une origine « certaine »
 *     (`user_stated` / `user_confirmed`) sur un candidat non validé serait un
 *     mensonge — la validation la refuse implicitement pour l'extraction
 *     (voir `parseMemoryExtraction`).
 *
 * Promouvoir un candidat en `MemoryEntry` est une décision **explicite** d'une
 * couche supérieure (revue utilisateur…), hors de ce module.
 */
export interface MemoryCandidate {
  readonly kind: MemoryKind;
  readonly subject: string;
  readonly statement: string;
  readonly provenance: Provenance;
}

/** Résultat d'une validation de {@link MemoryCandidate}. Ne lève jamais. */
export type MemoryCandidateValidation =
  | { readonly ok: true; readonly value: MemoryCandidate }
  | { readonly ok: false; readonly error: string };

/** Schéma **fermé** : toute autre clé est rejetée (jamais ignorée en silence). */
const ALLOWED_CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'subject',
  'statement',
  'provenance',
]);
const ALLOWED_PROVENANCE_KEYS: ReadonlySet<string> = new Set(['origin', 'confidence', 'note']);

/**
 * Valide une valeur **non fiable** (typiquement issue d'un `JSON.parse` de la
 * sortie d'un LLM) et en renvoie une copie **propre** — même discipline que
 * `Tool.validateInput` : ne lève jamais, message d'erreur lisible.
 *
 * - objet (pas `null`, pas un tableau) ;
 * - **aucune propriété inattendue** (schéma fermé), y compris dans
 *   `provenance` ;
 * - `kind` ∈ {@link MEMORY_KINDS} ;
 * - `subject` : chaîne non vide (après `trim`) ;
 * - `statement` : chaîne non vide (après `trim`) ;
 * - `provenance` : valide au sens de `validateProvenance` (origine connue,
 *   `confidence` ∈ [0,1] et interdite sur une origine certaine, `note` string).
 *
 * La valeur renvoyée ne contient **que** `kind`/`subject`/`statement`/
 * `provenance`, et `provenance` ne contient que `origin`/`confidence?`/`note?`.
 */
export function validateMemoryCandidate(value: unknown): MemoryCandidateValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'candidat : objet attendu.' };
  }
  const record = value as Record<string, unknown>;

  const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_CANDIDATE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `candidat : propriété(s) inattendue(s) : ${unknownKeys.join(', ')}.`,
    };
  }

  const { kind, subject, statement, provenance } = record;

  if (typeof kind !== 'string' || !MEMORY_KINDS.includes(kind as MemoryKind)) {
    return {
      ok: false,
      error: `candidat : « kind » doit être l'un de ${MEMORY_KINDS.join(', ')}.`,
    };
  }
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return { ok: false, error: 'candidat : « subject » ne peut pas être vide.' };
  }
  if (typeof statement !== 'string' || statement.trim().length === 0) {
    return { ok: false, error: 'candidat : « statement » ne peut pas être vide.' };
  }

  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
    return { ok: false, error: 'candidat : « provenance » objet attendu.' };
  }
  const unknownProvKeys = Object.keys(provenance as Record<string, unknown>).filter(
    (key) => !ALLOWED_PROVENANCE_KEYS.has(key),
  );
  if (unknownProvKeys.length > 0) {
    return {
      ok: false,
      error: `candidat : provenance — propriété(s) inattendue(s) : ${unknownProvKeys.join(', ')}.`,
    };
  }
  const prov = validateProvenance(provenance);
  if (!prov.ok) {
    return { ok: false, error: `candidat : ${prov.error}` };
  }

  const raw = provenance as { origin: ProvenanceOrigin; confidence?: number; note?: string };
  const cleanProvenance: Provenance = {
    origin: raw.origin,
    ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
    ...(raw.note !== undefined ? { note: raw.note } : {}),
  };

  return {
    ok: true,
    value: {
      kind: kind as MemoryKind,
      subject,
      statement,
      provenance: cleanProvenance,
    },
  };
}
