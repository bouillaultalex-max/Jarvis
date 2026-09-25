import {
  LEGAL_CASE_STATUSES,
  LEGAL_JURISDICTIONS,
  type LegalAnalysisNote,
  type LegalArgument,
  type LegalCase,
  type LegalSource,
} from './legal-case.js';
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
import { validateLegalFactConflict } from './legal-conflict.js';
import { validateLegalDocument } from './legal-document.js';
import { validateLegalEvidence } from './legal-evidence.js';
import { validateLegalFact } from './legal-fact.js';
import { validateFactEventModel } from './legal-fact-events-validation.js';
import { validateLegalFactValidation } from './legal-fact-validation.js';
import { validateFactModelReferences } from './legal-fact-refs-validation.js';
import { validateClosedObject } from './legal-primitives.js';
import { validateLegalRelation } from './legal-relation.js';
import {
  validateLegalFactResolution,
  validateLegalResolutionProposal,
} from './legal-resolution.js';
import { validateLegalRuleExecution } from './legal-rule.js';
import { validateSourceList } from './legal-source-validation.js';
import {
  checkNoDuplicateIds,
  extractKnownIds,
  invalid,
  isNonEmptyString,
  validateEachOf,
  type LegalCaseValidation,
} from './legal-validation-shared.js';

export type { LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Clés autorisées à la racine d'un dossier v3 — **clés fermées** : toute clé
 * inconnue (dont un état de fait stocké, ou l'ancien `facts` en objet de 4 listes
 * qui échoue de toute façon sur son type) est rejetée.
 */
export const LEGAL_CASE_V3_KEYS: readonly string[] = [
  'id',
  'title',
  'jurisdiction',
  'status',
  'createdAt',
  'updatedAt',
  'facts',
  'documents',
  'evidence',
  'questions',
  'relations',
  'factValidations',
  'conflicts',
  'resolutionProposals',
  'ruleExecutions',
  'resolutions',
  'research',
  'sources',
  'citations',
  'arguments',
  'counterArguments',
  'analysis',
  'conclusions',
  'deadlines',
  'actions',
];

const ROOT_KEYS: ReadonlySet<string> = new Set(LEGAL_CASE_V3_KEYS);

/**
 * Validation runtime d'un {@link LegalCase} **v3** non fiable (ex. relu depuis un
 * stockage externe, ou reçu d'un producteur). Ne lève **jamais** — voir
 * {@link LegalCaseValidation}.
 *
 * Contrat strict : un objet v2 (facts en quatre listes, faits sans provenance ni
 * temporalité, documents sans `kind`, pièces sans lien…) est **rejeté** ; aucune
 * valeur n'est jamais inventée pour l'accepter. Un dossier v2 se valide avec
 * `validateLegalCaseV2` (`legal-case-v2-validation.ts`).
 *
 * Orchestre :
 *   - la **forme** de chaque entité (modules `legal-*.ts` dédiés, clés fermées) ;
 *   - l'unicité des identifiants **par liste** ;
 *   - les sources, citations et la chaîne d'audit
 *     `Conclusion → Argument → Analysis → Citation → Source` (inchangées) ;
 *   - la **sémantique** du modèle Fact : références d'entrée, empreintes, cycles
 *     (`legal-fact-refs-validation.ts`), relations, validations, conflits,
 *     résolutions (`legal-fact-events-validation.ts`).
 *
 * L'append-only entre deux instantanés se contrôle avec `assertAppendOnly`
 * (`legal-case-append-only.ts`) : un validateur ne voit qu'un instantané.
 */
export function validateLegalCaseV3(value: unknown): LegalCaseValidation {
  const closed = validateClosedObject(value, ROOT_KEYS, 'LegalCase');
  if (!closed.ok) return closed;
  const legalCase = value as Partial<Record<keyof LegalCase, unknown>>;

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

  // --- Forme et unicité des listes du modèle Fact -----------------------------------------
  const shapedLists: readonly (readonly [
    string,
    (item: unknown, path: string) => LegalCaseValidation,
  ])[] = [
    ['facts', validateLegalFact],
    ['documents', validateLegalDocument],
    ['evidence', validateLegalEvidence],
    ['questions', validateQuestion],
    ['relations', validateLegalRelation],
    ['factValidations', validateLegalFactValidation],
    ['conflicts', validateLegalFactConflict],
    ['resolutionProposals', validateLegalResolutionProposal],
    ['ruleExecutions', validateLegalRuleExecution],
    ['resolutions', validateLegalFactResolution],
  ];
  for (const [name, validateItem] of shapedLists) {
    const list = legalCase[name as keyof LegalCase];
    const shape = validateEachOf(list, name, validateItem);
    if (!shape.ok) return shape;
    const unique = checkNoDuplicateIds(list as readonly { readonly id: string }[], name);
    if (!unique.ok) return unique;
  }

  // --- Sources / citations (inchangées) -----------------------------------------------------
  const sourcesResult = validateSourceList(legalCase.sources, 'sources');
  if (!sourcesResult.ok) return sourcesResult;
  const knownSourcesById = new Map(
    ((legalCase.sources ?? []) as readonly LegalSource[]).map(
      (source) => [source.id, source] as const,
    ),
  );
  const citationsResult = validateCitationList(
    legalCase.citations,
    'citations',
    knownSourcesById,
    extractKnownIds(legalCase.questions),
  );
  if (!citationsResult.ok) return citationsResult;
  const knownCitationIds = extractKnownIds(legalCase.citations);

  // --- Recherche / arguments / analyses / conclusions (chaîne d'audit, inchangée) ---------
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

  const conclusionsResult = validateEachOf(legalCase.conclusions, 'conclusions', (item, path) =>
    validateConclusion(item, path, knownArgumentIds, knownAnalysisIds, knownCitationIds),
  );
  if (!conclusionsResult.ok) return conclusionsResult;

  const deadlinesResult = validateEachOf(legalCase.deadlines, 'deadlines', validateDeadline);
  if (!deadlinesResult.ok) return deadlinesResult;
  const actionsResult = validateEachOf(legalCase.actions, 'actions', validateAction);
  if (!actionsResult.ok) return actionsResult;

  // --- Sémantique du modèle Fact ---------------------------------------------------------------
  const model = legalCase as unknown as LegalCase;
  const references = validateFactModelReferences(model);
  if (!references.ok) return references;
  return validateFactEventModel(model);
}
