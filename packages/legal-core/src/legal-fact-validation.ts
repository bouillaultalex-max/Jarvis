import { validateLegalFingerprint, type LegalFingerprint } from './legal-fingerprint.js';
import {
  validateClosedObject,
  validateLegalInstant,
  validateLegalOpaqueId,
  type LegalInstant,
} from './legal-primitives.js';
import {
  invalid,
  isNonEmptyString,
  OK,
  type LegalCaseValidation,
} from './legal-validation-shared.js';

/**
 * Validation humaine d'un fait — événement **séparé, immuable, append-only**
 * (LegalCase v3, Q7 / B2). Elle ne modifie **jamais** le `LegalFact`.
 *
 * ```
 * LegalFact ◄── factFingerprint ── LegalFactValidation { decision: confirm | reject }
 * ```
 *
 *   - `decision` : `confirm` ou `reject` — **distincte** d'une résolution
 *     (`retain | discard | retain_multiple`) et d'un état épistémique.
 *   - Champs **humains** seulement (`actorId`, `interactionId`) : un LLM ne peut pas
 *     valider. Aucune provenance `llm` n'est représentable ici.
 *   - `factFingerprint` épingle le fait validé : « validé F, puis F changé » est
 *     détecté à la validation du dossier.
 *   - La **dernière validation effective** d'un fait est la dernière, **par
 *     position**, dans la liste append-only `factValidations` (l'horodatage est
 *     informatif).
 *
 * Un fait rejeté est conservé ; le rejet ne crée pas de conflit et ne produit pas
 * `contradictory`.
 */
export type LegalFactValidationDecision = 'confirm' | 'reject';

export const LEGAL_FACT_VALIDATION_DECISIONS: readonly LegalFactValidationDecision[] = [
  'confirm',
  'reject',
];

export interface LegalFactValidation {
  readonly id: string;
  readonly factId: string;
  readonly factFingerprint: LegalFingerprint;
  readonly decision: LegalFactValidationDecision;
  readonly actorId: string;
  readonly interactionId: string;
  readonly timestamp: LegalInstant;
}

const VALIDATION_KEYS: ReadonlySet<string> = new Set([
  'id',
  'factId',
  'factFingerprint',
  'decision',
  'actorId',
  'interactionId',
  'timestamp',
]);

/** Valide la forme d'une validation de fait non fiable. Clés fermées ; ne lève jamais. */
export function validateLegalFactValidation(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, VALIDATION_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;

  if (!isNonEmptyString(record.factId))
    return invalid(`${path}.factId : chaîne non vide attendue.`);
  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    validateLegalFingerprint(record.factFingerprint, `${path}.factFingerprint`),
    validateLegalOpaqueId(record.actorId, `${path}.actorId`),
    validateLegalOpaqueId(record.interactionId, `${path}.interactionId`),
    validateLegalInstant(record.timestamp, `${path}.timestamp`),
  ]) {
    if (!result.ok) return result;
  }
  if (!LEGAL_FACT_VALIDATION_DECISIONS.includes(record.decision as LegalFactValidationDecision)) {
    return invalid(`${path}.decision : « confirm » ou « reject » attendu.`);
  }
  return OK;
}
