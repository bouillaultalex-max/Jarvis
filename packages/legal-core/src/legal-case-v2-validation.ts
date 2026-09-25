import type { LegalAnalysisNote, LegalArgument, LegalSource } from './legal-case.js';
import { LEGAL_CASE_STATUSES, LEGAL_JURISDICTIONS } from './legal-case.js';
import type {
  LegalCaseFactsV2,
  LegalCaseV2,
  LegalDocumentV2,
  LegalEvidenceV2,
  LegalFactV2,
} from './legal-case-v2.js';
import {
  validateAction,
  validateAnalysisNote,
  validateArgument,
  validateConclusion,
  validateDeadline,
  validateQuestion,
  validateResearchItem,
} from './legal-case-common-validation.js';
import { validateCitationList } from './legal-citation-validation.js';
import { validateSourceList } from './legal-source-validation.js';
import {
  checkNoDuplicateIds,
  extractKnownIds,
  invalid,
  isNonEmptyString,
  validateEachOf,
  type LegalCaseValidation,
  OK,
} from './legal-validation-shared.js';

/**
 * Validation **legacy** d'un dossier au format v2 (`LegalCaseV2`) — gel de la v2,
 * LegalCase v3.
 *
 * Contrat **figé** : même logique et mêmes messages que l'ancien
 * `validateLegalCase` (LEGAL-01 / LEGAL-02A / ADR-0020). Aucun enrichissement,
 * aucune migration : un dossier v2 valide reste un `LegalCaseV2`, il n'est jamais
 * interprété comme un dossier v3 (voir `legal-case-validation.ts`).
 *
 * Ne lève **jamais** — voir {@link LegalCaseValidation}.
 */

function validateFact(fact: unknown, path: string): LegalCaseValidation {
  if (!(typeof fact === 'object' && fact !== null && !Array.isArray(fact))) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, statement, sourceRef } = fact as Partial<LegalFactV2>;
  if (!isNonEmptyString(id)) {
    return invalid(`${path}.id : chaîne non vide attendue.`);
  }
  if (!isNonEmptyString(statement)) {
    return invalid(`${path}.statement : chaîne non vide attendue.`);
  }
  if (sourceRef !== undefined && typeof sourceRef !== 'string') {
    return invalid(`${path}.sourceRef : chaîne attendue.`);
  }
  return OK;
}

function validateFacts(facts: unknown): LegalCaseValidation {
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) {
    return invalid('facts : objet attendu.');
  }
  const { established, alleged, contradictory, unknown } = facts as Partial<LegalCaseFactsV2>;
  for (const [key, value] of Object.entries({ established, alleged, contradictory, unknown })) {
    const result = validateEachOf(value, `facts.${key}`, validateFact);
    if (!result.ok) {
      return result;
    }
  }
  return OK;
}

function validateDocument(document: unknown, path: string): LegalCaseValidation {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, title, addedAt } = document as Partial<LegalDocumentV2>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(title)) return invalid(`${path}.title : chaîne non vide attendue.`);
  if (!isNonEmptyString(addedAt)) return invalid(`${path}.addedAt : chaîne non vide attendue.`);
  return OK;
}

function validateEvidence(evidence: unknown, path: string): LegalCaseValidation {
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, description, addedAt } = evidence as Partial<LegalEvidenceV2>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(description))
    return invalid(`${path}.description : chaîne non vide attendue.`);
  if (!isNonEmptyString(addedAt)) return invalid(`${path}.addedAt : chaîne non vide attendue.`);
  return OK;
}

/**
 * Valide une {@link LegalCaseV2} non fiable. Ne lève jamais — voir
 * {@link LegalCaseValidation}.
 */
export function validateLegalCaseV2(value: unknown): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('LegalCase : objet attendu.');
  }
  const legalCase = value as Partial<LegalCaseV2>;

  if (!isNonEmptyString(legalCase.id)) return invalid('id : chaîne non vide attendue.');
  if (!isNonEmptyString(legalCase.title)) return invalid('title : chaîne non vide attendue.');
  if (
    typeof legalCase.jurisdiction !== 'string' ||
    !LEGAL_JURISDICTIONS.includes(legalCase.jurisdiction as never)
  ) {
    return invalid(`jurisdiction : l'une de ${LEGAL_JURISDICTIONS.join(', ')} attendue.`);
  }
  if (
    typeof legalCase.status !== 'string' ||
    !LEGAL_CASE_STATUSES.includes(legalCase.status as never)
  ) {
    return invalid(`status : l'une de ${LEGAL_CASE_STATUSES.join(', ')} attendue.`);
  }
  if (!isNonEmptyString(legalCase.createdAt))
    return invalid('createdAt : chaîne non vide attendue.');
  if (!isNonEmptyString(legalCase.updatedAt))
    return invalid('updatedAt : chaîne non vide attendue.');

  const factsResult = validateFacts(legalCase.facts);
  if (!factsResult.ok) return factsResult;

  const documentsResult = validateEachOf(legalCase.documents, 'documents', validateDocument);
  if (!documentsResult.ok) return documentsResult;

  const evidenceResult = validateEachOf(legalCase.evidence, 'evidence', validateEvidence);
  if (!evidenceResult.ok) return evidenceResult;

  const questionsResult = validateEachOf(legalCase.questions, 'questions', validateQuestion);
  if (!questionsResult.ok) return questionsResult;

  // --- Sources -----------------------------------------------------------
  const sourcesResult = validateSourceList(legalCase.sources, 'sources');
  if (!sourcesResult.ok) return sourcesResult;

  const knownSourcesById = new Map(
    ((legalCase.sources ?? []) as readonly LegalSource[]).map(
      (source) => [source.id, source] as const,
    ),
  );

  // --- Citations -----------------------------------------------------------
  const citationsResult = validateCitationList(
    legalCase.citations,
    'citations',
    knownSourcesById,
    extractKnownIds(legalCase.questions),
  );
  if (!citationsResult.ok) return citationsResult;

  const knownCitationIds = extractKnownIds(legalCase.citations);

  // --- Research / Arguments (chaîne d'audit) --------------------------------
  const researchResult = validateEachOf(legalCase.research, 'research', (item, path) =>
    validateResearchItem(item, path, knownCitationIds),
  );
  if (!researchResult.ok) return researchResult;

  const argumentsResult = validateEachOf(legalCase.arguments, 'arguments', (item, path) =>
    validateArgument(item, path, knownCitationIds),
  );
  if (!argumentsResult.ok) return argumentsResult;

  const counterArgumentsResult = validateEachOf(
    legalCase.counterArguments,
    'counterArguments',
    (item, path) => validateArgument(item, path, knownCitationIds),
  );
  if (!counterArgumentsResult.ok) return counterArgumentsResult;

  const allArguments = [
    ...((legalCase.arguments ?? []) as readonly LegalArgument[]),
    ...((legalCase.counterArguments ?? []) as readonly LegalArgument[]),
  ];
  const argumentsDuplicateResult = checkNoDuplicateIds(allArguments, 'arguments/counterArguments');
  if (!argumentsDuplicateResult.ok) return argumentsDuplicateResult;
  const knownArgumentIds = new Set(allArguments.map((argument) => argument.id));

  // --- Analysis --------------------------------------------------------------
  const analysisResult = validateEachOf(legalCase.analysis, 'analysis', (item, path) =>
    validateAnalysisNote(item, path, knownArgumentIds, knownCitationIds),
  );
  if (!analysisResult.ok) return analysisResult;

  const analysisDuplicateResult = checkNoDuplicateIds(
    (legalCase.analysis ?? []) as readonly LegalAnalysisNote[],
    'analysis',
  );
  if (!analysisDuplicateResult.ok) return analysisDuplicateResult;
  const knownAnalysisIds = extractKnownIds(legalCase.analysis);

  // --- Conclusions -------------------------------------------------------------
  const conclusionsResult = validateEachOf(legalCase.conclusions, 'conclusions', (item, path) =>
    validateConclusion(item, path, knownArgumentIds, knownAnalysisIds, knownCitationIds),
  );
  if (!conclusionsResult.ok) return conclusionsResult;

  const deadlinesResult = validateEachOf(legalCase.deadlines, 'deadlines', validateDeadline);
  if (!deadlinesResult.ok) return deadlinesResult;

  const actionsResult = validateEachOf(legalCase.actions, 'actions', validateAction);
  if (!actionsResult.ok) return actionsResult;

  return OK;
}
