import { validateLegalProvenance, type LegalFactProvenance } from './legal-provenance.js';
import { validateLegalFactTemporal, type LegalFactTemporal } from './legal-temporal.js';
import {
  validateClosedObject,
  validateLegalInstant,
  validateLegalOpaqueId,
  validateRequiredText,
  type LegalInstant,
} from './legal-primitives.js';
import { OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Un fait du dossier — LegalCase v3. **Immuable.**
 *
 * ```
 * id, statement, temporal (obligatoire), provenance (obligatoire), recordedAt
 * ```
 *
 * - **Aucun état stocké** : ni `status`, ni `certainty`, ni `epistemicState`, ni
 *   `confidence`, ni équivalent. L'état épistémique (`established`, `alleged`,
 *   `contradictory`, `unknown`) est **dérivé** par `deriveFactEpistemicState` à
 *   partir des faits, validations, conflits, résolutions et relations. Les clés
 *   sont fermées : ajouter un tel champ fait rejeter le fait.
 * - `temporal` : voir `legal-temporal.ts` (jamais un `asOf`).
 * - `provenance` : `origin` = producteur ; `inputReferences` = matière utilisée.
 * - `recordedAt` : instant de création (technique) — distinct de `temporal`.
 * - Pas de `sourceRef` (v2) : la source se référence par `inputReferences`.
 * - Pas d'empreinte stockée sur le fait : elle est **calculée** et épinglée par les
 *   objets qui le référencent (`legal-fingerprint.ts`).
 *
 * Une correction ne modifie jamais un fait : elle crée un **nouveau** fait et une
 * relation `fact_correction` (append-only).
 */
export interface LegalFact {
  readonly id: string;
  readonly statement: string;
  readonly temporal: LegalFactTemporal;
  readonly provenance: LegalFactProvenance;
  readonly recordedAt: LegalInstant;
}

const FACT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'statement',
  'temporal',
  'provenance',
  'recordedAt',
]);

/** Valide la forme d'un fait v3 non fiable. Clés fermées ; ne lève jamais. */
export function validateLegalFact(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, FACT_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;

  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    validateRequiredText(record.statement, `${path}.statement`),
    validateLegalFactTemporal(record.temporal, `${path}.temporal`),
    validateLegalProvenance(record.provenance, `${path}.provenance`),
    validateLegalInstant(record.recordedAt, `${path}.recordedAt`),
  ]) {
    if (!result.ok) return result;
  }
  return OK;
}
