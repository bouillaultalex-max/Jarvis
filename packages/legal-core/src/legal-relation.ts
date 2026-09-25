import {
  AUTHORITATIVE_PROVENANCE_ORIGINS,
  NON_LLM_PROVENANCE_ORIGINS,
  validateLegalProvenance,
  type LegalAuthoritativeProvenance,
  type LegalNonLlmProvenance,
} from './legal-provenance.js';
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
 * Relations **append-only** au niveau `LegalCase` — LegalCase v3 (Q1 / Q6 / B2).
 *
 * `relations[]` est une union discriminée volontairement **limitée** à ce qui est
 * décidé (pas de graphe générique) :
 *
 *   - `fact_question` : Question ↔ Fact, **many-to-many**. « Le fait fait partie du
 *     contexte factuel considéré pour cette question » — ni pertinence, ni preuve.
 *     Source **unique** de la pertinence d'un conflit pour une question : aucune
 *     relation Conflict → Question n'existe. Provenance : jamais `llm` (ces
 *     relations déterminent l'état dérivé ; une proposition LLM ne change aucun état).
 *   - `fact_correction` : un **nouveau** fait `factId` corrige un ancien fait
 *     `correctsFactId`. L'ancien fait n'est jamais réécrit ; la correction ne crée
 *     pas de conflit. Provenance : humain ou règle déterministe seulement.
 *
 * Aucun `questionId` dans un fait ; aucun `factIds` dans une question : le lien
 * vit ici et nulle part ailleurs (aucune seconde source de vérité).
 */
export type LegalFactCorrectionKind = 'corrects';

export const LEGAL_FACT_CORRECTION_KINDS: readonly LegalFactCorrectionKind[] = ['corrects'];

export interface LegalFactQuestionRelation {
  readonly kind: 'fact_question';
  readonly id: string;
  readonly factId: string;
  readonly questionId: string;
  readonly provenance: LegalNonLlmProvenance;
  readonly recordedAt: LegalInstant;
}

export interface LegalFactCorrectionRelation {
  readonly kind: 'fact_correction';
  readonly id: string;
  /** Le **nouveau** fait. */
  readonly factId: string;
  /** L'ancien fait, conservé et immuable. */
  readonly correctsFactId: string;
  readonly correction: LegalFactCorrectionKind;
  readonly provenance: LegalAuthoritativeProvenance;
  readonly recordedAt: LegalInstant;
}

export type LegalRelation = LegalFactQuestionRelation | LegalFactCorrectionRelation;

const QUESTION_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'factId',
  'questionId',
  'provenance',
  'recordedAt',
]);
const CORRECTION_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'factId',
  'correctsFactId',
  'correction',
  'provenance',
  'recordedAt',
]);

function requireText(value: unknown, path: string): LegalCaseValidation {
  return isNonEmptyString(value) ? OK : invalid(`${path} : chaîne non vide attendue.`);
}

/** Valide la forme d'une relation non fiable. Clés fermées par variante ; ne lève jamais. */
export function validateLegalRelation(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu.`);
  }
  const record = value as Record<string, unknown>;

  if (record.kind === 'fact_question') {
    const closed = validateClosedObject(value, QUESTION_KEYS, path);
    if (!closed.ok) return closed;
    for (const result of [
      validateLegalOpaqueId(record.id, `${path}.id`),
      requireText(record.factId, `${path}.factId`),
      requireText(record.questionId, `${path}.questionId`),
      validateLegalProvenance(record.provenance, `${path}.provenance`, NON_LLM_PROVENANCE_ORIGINS),
      validateLegalInstant(record.recordedAt, `${path}.recordedAt`),
    ]) {
      if (!result.ok) return result;
    }
    return OK;
  }

  if (record.kind === 'fact_correction') {
    const closed = validateClosedObject(value, CORRECTION_KEYS, path);
    if (!closed.ok) return closed;
    for (const result of [
      validateLegalOpaqueId(record.id, `${path}.id`),
      requireText(record.factId, `${path}.factId`),
      requireText(record.correctsFactId, `${path}.correctsFactId`),
      validateLegalProvenance(
        record.provenance,
        `${path}.provenance`,
        AUTHORITATIVE_PROVENANCE_ORIGINS,
      ),
      validateLegalInstant(record.recordedAt, `${path}.recordedAt`),
    ]) {
      if (!result.ok) return result;
    }
    if (!LEGAL_FACT_CORRECTION_KINDS.includes(record.correction as LegalFactCorrectionKind)) {
      return invalid(`${path}.correction : « corrects » attendu.`);
    }
    if (record.factId === record.correctsFactId) {
      return invalid(`${path} : un fait ne peut pas se corriger lui-même.`);
    }
    return OK;
  }

  return invalid(`${path}.kind : « fact_question » ou « fact_correction » attendu.`);
}
