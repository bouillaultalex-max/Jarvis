import type {
  LegalAction,
  LegalAnalysisNote,
  LegalArgument,
  LegalConclusion,
  LegalDeadline,
  LegalQuestion,
  LegalResearchItem,
} from './legal-case.js';
import {
  invalid,
  isNonEmptyString,
  validateIdRefs,
  type LegalCaseValidation,
  OK,
} from './legal-validation-shared.js';

/**
 * Validateurs d'entités **communs** aux formats v2 (legacy) et v3 : question,
 * élément de recherche, argument, note d'analyse, conclusion, échéance, action.
 * Extraits sans changement de comportement de l'ancien `legal-case-validation.ts`
 * (gel de la v2, LegalCase v3). Aucune entité de ce module n'est modifiée par le
 * modèle Fact / Provenance / Evidence de la v3.
 */

export function validateQuestion(question: unknown, path: string): LegalCaseValidation {
  if (typeof question !== 'object' || question === null || Array.isArray(question)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, question: text, status } = question as Partial<LegalQuestion>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(text)) return invalid(`${path}.question : chaîne non vide attendue.`);
  if (status !== 'open' && status !== 'answered') {
    return invalid(`${path}.status : « open » ou « answered » attendu.`);
  }
  return OK;
}

/**
 * `knownQuestionIds` valide `questionId` **si présent** (LEGAL-RESEARCH-ITEM-01,
 * même discipline que `LegalCitationEligibility.questionId` dans
 * `legal-citation-validation.ts`). Absent de l'appelant (`undefined`) ⇒ un
 * `questionId` fourni est refusé (impossible à vérifier en confiance) ; le champ
 * étant optionnel, son absence totale sur l'item reste toujours valide.
 */
export function validateResearchItem(
  item: unknown,
  path: string,
  knownCitationIds: ReadonlySet<string>,
  knownQuestionIds?: ReadonlySet<string>,
): LegalCaseValidation {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, topic, summary, citationIds, questionId } = item as Partial<LegalResearchItem>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(topic)) return invalid(`${path}.topic : chaîne non vide attendue.`);
  if (!isNonEmptyString(summary)) return invalid(`${path}.summary : chaîne non vide attendue.`);
  const citationIdsResult = validateIdRefs(
    citationIds,
    `${path}.citationIds`,
    knownCitationIds,
    'citation',
  );
  if (!citationIdsResult.ok) return citationIdsResult;

  if (questionId !== undefined) {
    if (!isNonEmptyString(questionId)) {
      return invalid(`${path}.questionId : chaîne non vide attendue.`);
    }
    if (knownQuestionIds === undefined || !knownQuestionIds.has(questionId)) {
      return invalid(
        `${path}.questionId : question inconnue « ${questionId} » (absente de « questions »).`,
      );
    }
  }
  return OK;
}

export function validateArgument(
  argument: unknown,
  path: string,
  knownCitationIds: ReadonlySet<string>,
): LegalCaseValidation {
  if (typeof argument !== 'object' || argument === null || Array.isArray(argument)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, statement, citationIds } = argument as Partial<LegalArgument>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(statement)) return invalid(`${path}.statement : chaîne non vide attendue.`);
  return validateIdRefs(citationIds, `${path}.citationIds`, knownCitationIds, 'citation');
}

export function validateAnalysisNote(
  note: unknown,
  path: string,
  knownArgumentIds: ReadonlySet<string>,
  knownCitationIds: ReadonlySet<string>,
): LegalCaseValidation {
  if (typeof note !== 'object' || note === null || Array.isArray(note)) {
    return invalid(`${path} : objet attendu.`);
  }
  const {
    id,
    note: text,
    createdAt,
    argumentIds,
    citationIds,
  } = note as Partial<LegalAnalysisNote>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(text)) return invalid(`${path}.note : chaîne non vide attendue.`);
  if (!isNonEmptyString(createdAt)) return invalid(`${path}.createdAt : chaîne non vide attendue.`);

  const argumentIdsResult = validateIdRefs(
    argumentIds,
    `${path}.argumentIds`,
    knownArgumentIds,
    'argument',
  );
  if (!argumentIdsResult.ok) return argumentIdsResult;

  return validateIdRefs(citationIds, `${path}.citationIds`, knownCitationIds, 'citation');
}

const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set(['certain', 'likely', 'uncertain']);

export function validateConclusion(
  conclusion: unknown,
  path: string,
  knownArgumentIds: ReadonlySet<string>,
  knownAnalysisIds: ReadonlySet<string>,
  knownCitationIds: ReadonlySet<string>,
): LegalCaseValidation {
  if (typeof conclusion !== 'object' || conclusion === null || Array.isArray(conclusion)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, statement, confidence, argumentIds, analysisIds, citationIds } =
    conclusion as Partial<LegalConclusion>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(statement)) return invalid(`${path}.statement : chaîne non vide attendue.`);
  if (typeof confidence !== 'string' || !CONFIDENCE_LEVELS.has(confidence)) {
    return invalid(`${path}.confidence : « certain », « likely » ou « uncertain » attendu.`);
  }

  const argumentIdsResult = validateIdRefs(
    argumentIds,
    `${path}.argumentIds`,
    knownArgumentIds,
    'argument',
  );
  if (!argumentIdsResult.ok) return argumentIdsResult;

  const analysisIdsResult = validateIdRefs(
    analysisIds,
    `${path}.analysisIds`,
    knownAnalysisIds,
    'analysis',
  );
  if (!analysisIdsResult.ok) return analysisIdsResult;

  if (!Array.isArray(citationIds) || citationIds.length === 0) {
    return invalid(
      `${path}.citationIds : au moins une citation obligatoire (LEGAL_SPECIFICATION §4).`,
    );
  }
  return validateIdRefs(citationIds, `${path}.citationIds`, knownCitationIds, 'citation');
}

export function validateDeadline(deadline: unknown, path: string): LegalCaseValidation {
  if (typeof deadline !== 'object' || deadline === null || Array.isArray(deadline)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, label, dueAt, critical } = deadline as Partial<LegalDeadline>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(label)) return invalid(`${path}.label : chaîne non vide attendue.`);
  if (!isNonEmptyString(dueAt)) return invalid(`${path}.dueAt : chaîne non vide attendue.`);
  if (critical !== undefined && typeof critical !== 'boolean') {
    return invalid(`${path}.critical : booléen attendu.`);
  }
  return OK;
}

export function validateAction(action: unknown, path: string): LegalCaseValidation {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    return invalid(`${path} : objet attendu.`);
  }
  const { id, type, description, createdAt } = action as Partial<LegalAction>;
  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(description))
    return invalid(`${path}.description : chaîne non vide attendue.`);
  if (!isNonEmptyString(createdAt)) return invalid(`${path}.createdAt : chaîne non vide attendue.`);
  if (type !== 'READ' && type !== 'PREPARE' && type !== 'EXECUTE') {
    return invalid(`${path}.type : « READ », « PREPARE » ou « EXECUTE » attendu.`);
  }
  if (type === 'EXECUTE') {
    const { confirmationId, confirmedAt } = action as {
      confirmationId?: unknown;
      confirmedAt?: unknown;
    };
    if (!isNonEmptyString(confirmationId)) {
      return invalid(
        `${path}.confirmationId : chaîne non vide obligatoire pour une action EXECUTE (LEGAL_SPECIFICATION §3).`,
      );
    }
    if (!isNonEmptyString(confirmedAt)) {
      return invalid(
        `${path}.confirmedAt : chaîne non vide obligatoire pour une action EXECUTE (LEGAL_SPECIFICATION §3).`,
      );
    }
  }
  return OK;
}
