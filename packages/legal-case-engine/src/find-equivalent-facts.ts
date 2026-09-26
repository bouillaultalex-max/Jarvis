import {
  canonicalizeLegal,
  validateLegalCaseV3,
  validateLegalFactTemporal,
  type LegalCase,
  type LegalFactTemporal,
} from '@jarvis/legal-core';

import { LegalCaseEngineError } from './errors.js';
import { requireRecord, requireText } from './input-validation.js';

/**
 * Détection **consultative** de faits potentiellement équivalents (décision D7).
 *
 * ## Ce que cette fonction fait — et ne fait pas
 * Elle **ne fusionne, ne modifie, ne rejette rien** et n'a aucun effet de bord : elle lit un
 * dossier et renvoie une information que l'appelant est libre d'ignorer. Elle **n'établit
 * aucune équivalence juridique ni sémantique**. Le modèle v3 ne documente aucun critère
 * d'équivalence ; le critère ci-dessous est un choix **technique prudent**, nommé et versionné
 * (`structural_text_v1`) pour pouvoir évoluer sans ambiguïté.
 *
 * ## Critère `structural_text_v1`
 *   - **Texte** : un fait est retenu comme *potentiel équivalent* si son `statement` est
 *     identique à celui du candidat (`identical`), ou identique après une normalisation
 *     minimale — Unicode NFC, espaces multiples et bords réduits, minuscules — (`normalized`).
 *     Ni accents, ni ponctuation, ni ordre des mots, ni synonymes ne sont neutralisés : deux
 *     formulations différentes ne sont **jamais** rapprochées (pas de similarité floue).
 *   - **Température** : comparée séparément et **jamais fusionnée** avec le texte. Un même
 *     énoncé à une autre date peut être un autre événement : il est donc **listé** avec
 *     `temporalMatch: 'different'` plutôt qu'écarté. L'égalité est structurelle (même
 *     `kind`, mêmes précisions et valeurs — `2025-03` ≠ `2025-03-01`).
 *   - Informations annexes, factuelles : questions communes (relations `fact_question`) et
 *     fait déjà corrigé (`fact_correction`). Aucune n'influe sur la sélection.
 *
 * Limites connues : un même fait dit autrement n'est **pas** détecté ; l'absence de résultat
 * n'est **pas** une preuve d'absence de doublon. Résultat déterministe : l'ordre est celui de
 * la liste `facts` du dossier.
 */
export const EQUIVALENCE_CRITERION = 'structural_text_v1';

/** Candidat à comparer — tel qu'il serait enregistré, sans identifiant ni provenance. */
export interface EquivalenceCandidate {
  readonly statement: string;
  readonly temporal: LegalFactTemporal;
  /** Optionnel : questions dont on veut connaître le recouvrement (information seulement). */
  readonly questionIds?: readonly string[];
}

export type FactStatementMatch = 'identical' | 'normalized';
export type FactTemporalMatch = 'identical' | 'different';

export interface PotentialEquivalentFact {
  readonly factId: string;
  readonly statementMatch: FactStatementMatch;
  readonly temporalMatch: FactTemporalMatch;
  /** Questions du candidat auxquelles ce fait est déjà lié, dans l'ordre du candidat. */
  readonly sharedQuestionIds: readonly string[];
  /** Ce fait est déjà l'objet d'une correction (`fact_correction`) — information seulement. */
  readonly corrected: boolean;
}

export interface EquivalentFactsResult {
  readonly criterion: typeof EQUIVALENCE_CRITERION;
  /** `none_found` : aucun équivalent selon ce critère — ce n'est **pas** une preuve d'absence. */
  readonly status: 'none_found' | 'potential_equivalents';
  readonly equivalents: readonly PotentialEquivalentFact[];
}

const CANDIDATE_KEYS: ReadonlySet<string> = new Set(['statement', 'temporal', 'questionIds']);

/** Normalisation minimale du critère `structural_text_v1` (ne neutralise ni accents ni ponctuation). */
export function normalizeStatement(statement: string): string {
  return statement.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function validateCandidate(candidate: unknown): {
  readonly statement: string;
  readonly temporal: LegalFactTemporal;
  readonly questionIds: readonly string[];
} {
  const record = requireRecord(candidate, CANDIDATE_KEYS, 'candidate');
  const statement = requireText(record.statement, 'candidate.statement');
  const temporal = validateLegalFactTemporal(record.temporal, 'candidate.temporal');
  if (!temporal.ok) throw new LegalCaseEngineError('invalid_input', temporal.error);

  let questionIds: readonly string[] = [];
  if (record.questionIds !== undefined) {
    if (!Array.isArray(record.questionIds)) {
      throw new LegalCaseEngineError('invalid_input', 'candidate.questionIds : liste attendue.');
    }
    questionIds = record.questionIds.map((id, i) => requireText(id, `candidate.questionIds[${i}]`));
  }
  return { statement, temporal: record.temporal as LegalFactTemporal, questionIds };
}

/**
 * Renvoie les faits du dossier potentiellement équivalents au candidat, selon
 * {@link EQUIVALENCE_CRITERION}. Lecture seule : aucune écriture, aucune horloge, aucun
 * contexte requis.
 *
 * @throws {LegalCaseEngineError} `invalid_case` ou `invalid_input`.
 */
export function findEquivalentFacts(
  legalCase: LegalCase,
  candidate: EquivalenceCandidate,
): EquivalentFactsResult {
  const validation = validateLegalCaseV3(legalCase);
  if (!validation.ok) throw new LegalCaseEngineError('invalid_case', validation.error);
  const target = validateCandidate(candidate);

  const normalizedTarget = normalizeStatement(target.statement);
  const targetTemporal = canonicalizeLegal(target.temporal);

  const linkedQuestions = new Map<string, Set<string>>();
  const corrected = new Set<string>();
  for (const relation of legalCase.relations) {
    if (relation.kind === 'fact_question') {
      const questions = linkedQuestions.get(relation.factId) ?? new Set<string>();
      questions.add(relation.questionId);
      linkedQuestions.set(relation.factId, questions);
    } else {
      corrected.add(relation.correctsFactId);
    }
  }

  const equivalents: PotentialEquivalentFact[] = [];
  for (const fact of legalCase.facts) {
    const statementMatch: FactStatementMatch | undefined =
      fact.statement === target.statement
        ? 'identical'
        : normalizeStatement(fact.statement) === normalizedTarget
          ? 'normalized'
          : undefined;
    if (statementMatch === undefined) continue;

    const linked = linkedQuestions.get(fact.id);
    equivalents.push({
      factId: fact.id,
      statementMatch,
      temporalMatch:
        canonicalizeLegal(fact.temporal) === targetTemporal ? 'identical' : 'different',
      sharedQuestionIds: target.questionIds.filter((id) => linked?.has(id) === true),
      corrected: corrected.has(fact.id),
    });
  }
  return {
    criterion: EQUIVALENCE_CRITERION,
    status: equivalents.length === 0 ? 'none_found' : 'potential_equivalents',
    equivalents,
  };
}
