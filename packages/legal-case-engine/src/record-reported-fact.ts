import {
  appendToLegalCase,
  computeLegalFingerprint,
  deriveFactEpistemicDerivation,
  validateLegalFactTemporal,
  type LegalCase,
  type LegalFact,
  type LegalFactEpistemicRule,
  type LegalFactEpistemicState,
  type LegalFactQuestionRelation,
  type LegalFactTemporal,
  type LegalNonDocumentaryEvidence,
} from '@jarvis/legal-core';

import {
  assertWritableCase,
  buildHumanProvenance,
  resolveEngineOptions,
  type LegalEngineOptions,
} from './engine-context.js';
import { LegalCaseEngineError } from './errors.js';
import { findEquivalentFacts, type EquivalentFactsResult } from './find-equivalent-facts.js';
import {
  assertValidAppend,
  requireOpaqueId,
  requireRecord,
  requireText,
} from './input-validation.js';

/** Lien du fait à une question du dossier ; l'identifiant de la relation est fourni (D7). */
export interface ReportedFactQuestionLink {
  readonly questionId: string;
  readonly relationId: string;
}

/**
 * Entrée de {@link recordReportedFact}. Tous les identifiants sont fournis par l'appelant
 * (décision D7). `temporal` est **obligatoire** (jamais de défaut) : « inconnu » s'écrit
 * `{ kind: 'unknown' }`. `evidenceDescription` est le libellé de la pièce non documentaire
 * (ex. « déclaration de l'utilisateur ») : le moteur ne l'invente pas.
 */
export interface RecordReportedFactInput {
  readonly factId: string;
  readonly evidenceId: string;
  readonly statement: string;
  readonly temporal: LegalFactTemporal;
  readonly evidenceDescription: string;
  readonly questionLinks: readonly ReportedFactQuestionLink[];
}

/** État dérivé du fait pour une question liée — copie de la dérivation de `legal-core`, jamais stockée. */
export interface ReportedFactDerivation {
  readonly questionId: string;
  readonly state: LegalFactEpistemicState;
  readonly rule: LegalFactEpistemicRule;
}

export interface RecordedReportedFact {
  /** Nouveau dossier (l'entrée n'est pas modifiée). */
  readonly legalCase: LegalCase;
  readonly fact: LegalFact;
  readonly evidence: LegalNonDocumentaryEvidence;
  readonly relations: readonly LegalFactQuestionRelation[];
  /** Une dérivation par question liée (R1 → R7 de `legal-core`, inchangées). */
  readonly derivations: readonly ReportedFactDerivation[];
  /**
   * Information **consultative** (décision D7) : faits déjà présents **avant** cet ajout et
   * potentiellement équivalents (voir `findEquivalentFacts`). L'enregistrement a eu lieu
   * quoi qu'il en soit : rien n'est rejeté, fusionné ni modifié.
   */
  readonly equivalents: EquivalentFactsResult;
}

const INPUT_KEYS: ReadonlySet<string> = new Set([
  'factId',
  'evidenceId',
  'statement',
  'temporal',
  'evidenceDescription',
  'questionLinks',
]);
const LINK_KEYS: ReadonlySet<string> = new Set(['questionId', 'relationId']);

interface ValidatedInput {
  readonly factId: string;
  readonly evidenceId: string;
  readonly statement: string;
  readonly temporal: LegalFactTemporal;
  readonly evidenceDescription: string;
  readonly links: readonly ReportedFactQuestionLink[];
}

function validateInput(input: unknown): ValidatedInput {
  const record = requireRecord(input, INPUT_KEYS, 'input');
  const factId = requireOpaqueId(record.factId, 'input.factId');
  const evidenceId = requireOpaqueId(record.evidenceId, 'input.evidenceId');
  const statement = requireText(record.statement, 'input.statement');
  const evidenceDescription = requireText(record.evidenceDescription, 'input.evidenceDescription');

  // Lue **une seule fois** : la valeur validée est exactement celle qui est copiée.
  const rawTemporal = record.temporal;
  const temporalCheck = validateLegalFactTemporal(rawTemporal, 'input.temporal');
  if (!temporalCheck.ok) throw new LegalCaseEngineError('invalid_input', temporalCheck.error);

  if (!Array.isArray(record.questionLinks) || record.questionLinks.length === 0) {
    throw new LegalCaseEngineError(
      'invalid_input',
      'input.questionLinks : au moins un lien à une question est attendu (décision D4).',
    );
  }
  const seenQuestions = new Set<string>();
  const seenRelations = new Set<string>();
  const links: ReportedFactQuestionLink[] = [];
  for (let i = 0; i < record.questionLinks.length; i += 1) {
    const path = `input.questionLinks[${i}]`;
    const link = requireRecord(record.questionLinks[i], LINK_KEYS, path);
    const questionId = requireOpaqueId(link.questionId, `${path}.questionId`);
    const relationId = requireOpaqueId(link.relationId, `${path}.relationId`);
    if (seenQuestions.has(questionId)) {
      throw new LegalCaseEngineError(
        'invalid_input',
        `${path}.questionId : question « ${questionId} » liée deux fois.`,
      );
    }
    if (seenRelations.has(relationId)) {
      throw new LegalCaseEngineError(
        'invalid_input',
        `${path}.relationId : identifiant de relation « ${relationId} » répété.`,
      );
    }
    seenQuestions.add(questionId);
    seenRelations.add(relationId);
    links.push({ questionId, relationId });
  }
  return {
    factId,
    evidenceId,
    statement,
    // Copie **indépendante** (donnée JSON pure, déjà validée) : une mutation ultérieure de
    // l'entrée par l'appelant ne doit jamais altérer le fait du dossier renvoyé.
    temporal: structuredClone(rawTemporal) as LegalFactTemporal,
    evidenceDescription,
    links,
  };
}

function assertReferencesAndIds(legalCase: LegalCase, input: ValidatedInput): void {
  const questionIds = new Set(legalCase.questions.map((question) => question.id));
  for (const link of input.links) {
    if (!questionIds.has(link.questionId)) {
      throw new LegalCaseEngineError(
        'unknown_question',
        `question « ${link.questionId} » absente du dossier.`,
      );
    }
  }
  const taken: readonly (readonly [string, readonly { readonly id: string }[], string])[] = [
    ['facts', legalCase.facts, input.factId],
    ['evidence', legalCase.evidence, input.evidenceId],
  ];
  for (const [list, items, id] of taken) {
    if (items.some((item) => item.id === id)) {
      throw new LegalCaseEngineError(
        'duplicate_id',
        `${list} contient déjà l'id « ${id} » (aucun remplacement).`,
      );
    }
  }
  for (const link of input.links) {
    if (legalCase.relations.some((relation) => relation.id === link.relationId)) {
      throw new LegalCaseEngineError(
        'duplicate_id',
        `relations contient déjà l'id « ${link.relationId} » (aucun remplacement).`,
      );
    }
  }
}

/**
 * Enregistre **atomiquement** un fait rapporté par un humain (décision D4) : un `LegalFact`,
 * une `LegalEvidence` **non documentaire** et un lien `fact_question` par question, ajoutés
 * ensemble ou pas du tout.
 *
 * - **Provenance** : humaine, construite du seul contexte injecté (`actorId`,
 *   `interactionId`, décision D2) ; jamais inventée. Le fait référence la pièce par une
 *   `inputReference` `evidence` **épinglée par empreinte** ; c'est cette référence
 *   substantielle qui lui donne, par la dérivation `legal-core`, l'état `alleged` (R6), là
 *   où un fait humain sans pièce dériverait `unknown` (R7). Le fait ne porte aucun état.
 * - **Chronologie (D6)** : un seul instant (horloge injectée) pour tous les objets, jamais
 *   antérieur à `updatedAt` ni aux objets déjà enregistrés. Le validateur v3, gelé, n'est pas
 *   durci : le contrôle est propre aux écritures du moteur.
 * - **Pas de fusion ni de rejet** : les faits potentiellement équivalents déjà présents sont
 *   seulement **signalés** dans `equivalents` (`findEquivalentFacts`, information
 *   consultative) ; l'enregistrement a lieu dans tous les cas.
 * - **Atomicité et pureté** : le dossier d'entrée n'est pas muté ; en cas d'erreur, rien
 *   n'est renvoyé. La sortie est revalidée (`validateLegalCaseV3`, append-only).
 *
 * @throws {LegalCaseEngineError} `invalid_context`, `invalid_clock`, `invalid_case`,
 *   `chronology`, `invalid_input`, `unknown_question`, `duplicate_id` ou `invalid_result`.
 */
export function recordReportedFact(
  legalCase: LegalCase,
  input: RecordReportedFactInput,
  options: LegalEngineOptions,
): RecordedReportedFact {
  const { context, at } = resolveEngineOptions(options);
  assertWritableCase(legalCase, at);
  const valid = validateInput(input);
  assertReferencesAndIds(legalCase, valid);

  const equivalents = findEquivalentFacts(legalCase, {
    statement: valid.statement,
    temporal: valid.temporal,
    questionIds: valid.links.map((link) => link.questionId),
  });

  const evidence: LegalNonDocumentaryEvidence = {
    kind: 'non_documentary',
    id: valid.evidenceId,
    description: valid.evidenceDescription,
    addedAt: at,
    provenance: buildHumanProvenance(context),
  };
  const fact: LegalFact = {
    id: valid.factId,
    statement: valid.statement,
    temporal: valid.temporal,
    provenance: buildHumanProvenance(context, [
      {
        kind: 'evidence',
        evidenceId: evidence.id,
        evidenceFingerprint: computeLegalFingerprint(evidence),
      },
    ]),
    recordedAt: at,
  };
  const relations: LegalFactQuestionRelation[] = valid.links.map((link) => ({
    kind: 'fact_question',
    id: link.relationId,
    factId: fact.id,
    questionId: link.questionId,
    provenance: buildHumanProvenance(context),
    recordedAt: at,
  }));

  let next: LegalCase;
  try {
    next = appendToLegalCase(
      legalCase,
      { facts: [fact], evidence: [evidence], relations },
      { updatedAt: at },
    );
  } catch (error) {
    throw new LegalCaseEngineError(
      'invalid_result',
      error instanceof Error ? error.message : 'ajout refusé par legal-core.',
    );
  }
  assertValidAppend(legalCase, next);

  const derivations = valid.links.map((link): ReportedFactDerivation => {
    const { state, rule } = deriveFactEpistemicDerivation(fact, { id: link.questionId }, next);
    return { questionId: link.questionId, state, rule };
  });
  return { legalCase: next, fact, evidence, relations, derivations, equivalents };
}
