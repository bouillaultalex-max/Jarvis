import type { LegalFactConflict } from './legal-conflict.js';
import type { LegalFact } from './legal-fact.js';
import type { LegalFactValidation } from './legal-fact-validation.js';
import { isSubstantialInputReference } from './legal-input-reference.js';
import type { LegalQuestion } from './legal-case.js';
import type { LegalRelation } from './legal-relation.js';
import type { LegalFactResolution } from './legal-resolution.js';

/**
 * Dérivation de l'état épistémique d'un fait — LegalCase v3 (B1 / U1).
 *
 * L'état n'est **jamais stocké** : ni dans `LegalFact` (immuable), ni dans le
 * dossier. Il est **calculé à la demande** par une fonction pure — sans I/O, sans
 * horloge, sans LLM, sans aléa — à partir des faits, validations, conflits,
 * résolutions et relations. Il est **contextuel à une question** : seule la
 * pertinence d'un conflit (R1) dépend de la question ; `retain`, `confirm`,
 * `reject`, `corrects` n'en dépendent pas.
 *
 * ## Ordre de priorité — STRICT, ne pas réordonner
 *
 * | Règle | Condition | État |
 * |---|---|---|
 * | R1 | conflit **non résolu pertinent** pour la question | `contradictory` |
 * | R2 | résolution effective `retain` sur le fait | `established` |
 * | R3 | fait corrigé (`fact_correction`) | `alleged` |
 * | R4 | dernière validation effective = `reject` | `alleged` |
 * | R5 | dernière validation effective = `confirm` | `established` |
 * | R6 | au moins une `inputReference` **substantielle** | `alleged` |
 * | R7 | aucune `inputReference` substantielle | `unknown` |
 *
 * ## Définitions
 *   - **Conflit pertinent pour Q** : le fait et un autre membre du conflit sont
 *     tous deux liés à Q par `fact_question` (règle appliquée **paire par paire**
 *     pour plus de deux membres). Aucun `questionId` dans le conflit : la
 *     pertinence ne se lit que dans les relations.
 *   - **Conflit résolu** : il existe une résolution **effective**, c'est-à-dire non
 *     remplacée par une autre (`supersedesResolutionId`). Sinon il est non résolu.
 *   - **Dernière validation effective** : la dernière, **par position**, dans la
 *     liste append-only `factValidations` (l'horodatage n'intervient pas).
 *   - **Substantielle** (U1-A1ter) : `evidence`, `document`, `tool_invocation`,
 *     `source`, `fact` ; jamais `question`. Critère **syntaxique** sur le `kind` :
 *     la substantialité d'une référence `fact` **ne dépend pas** de l'état du fait
 *     référencé — aucune récursion Fact → Fact.
 *   - `discard` et `retain_multiple` n'ont **aucune règle propre** : ils ne
 *     déclenchent pas R2 et l'état retombe sur les règles suivantes.
 *   - Une proposition LLM n'est pas dans le contexte : elle n'a aucun effet.
 *   - `provenance.origin` n'intervient **jamais**.
 */
export type LegalFactEpistemicState = 'established' | 'alleged' | 'contradictory' | 'unknown';

export type LegalFactEpistemicRule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

export interface LegalFactEpistemicDerivation {
  readonly state: LegalFactEpistemicState;
  /** Règle appliquée — trace de la dérivation, pas un statut. */
  readonly rule: LegalFactEpistemicRule;
}

/** Sous-ensemble en lecture seule du dossier v3 nécessaire à la dérivation. */
export interface LegalFactStateContext {
  readonly relations: readonly LegalRelation[];
  readonly factValidations: readonly LegalFactValidation[];
  readonly conflicts: readonly LegalFactConflict[];
  readonly resolutions: readonly LegalFactResolution[];
}

/** Résolution effective d'un conflit : la dernière (par position) qu'aucune autre ne remplace. */
function effectiveResolution(
  conflictId: string,
  resolutions: readonly LegalFactResolution[],
): LegalFactResolution | undefined {
  const superseded = new Set<string>();
  for (const resolution of resolutions) {
    if (resolution.supersedesResolutionId !== undefined) {
      superseded.add(resolution.supersedesResolutionId);
    }
  }
  let effective: LegalFactResolution | undefined;
  for (const resolution of resolutions) {
    if (resolution.conflictId === conflictId && !superseded.has(resolution.id)) {
      effective = resolution;
    }
  }
  return effective;
}

/**
 * Dérive l'état épistémique de `fact` pour `question` et la règle appliquée.
 *
 * @throws {RangeError} si le fait n'est pas lié à la question par `fact_question`
 *   (erreur de l'appelant, jamais un état).
 */
export function deriveFactEpistemicDerivation(
  fact: LegalFact,
  question: Pick<LegalQuestion, 'id'>,
  caseContext: LegalFactStateContext,
): LegalFactEpistemicDerivation {
  const linkedToQuestion = new Set<string>();
  for (const relation of caseContext.relations) {
    if (relation.kind === 'fact_question' && relation.questionId === question.id) {
      linkedToQuestion.add(relation.factId);
    }
  }
  if (!linkedToQuestion.has(fact.id)) {
    throw new RangeError(
      `deriveFactEpistemicState : le fait « ${fact.id} » n'est pas lié à la question « ${question.id} » (fact_question).`,
    );
  }

  // R1 — conflit non résolu, pertinent pour la question.
  for (const conflict of caseContext.conflicts) {
    if (!conflict.facts.some((member) => member.factId === fact.id)) continue;
    const relevant = conflict.facts.some(
      (member) => member.factId !== fact.id && linkedToQuestion.has(member.factId),
    );
    if (relevant && effectiveResolution(conflict.id, caseContext.resolutions) === undefined) {
      return { state: 'contradictory', rule: 'R1' };
    }
  }

  // R2 — résolution effective `retain` sur le fait.
  for (const conflict of caseContext.conflicts) {
    if (!conflict.facts.some((member) => member.factId === fact.id)) continue;
    const resolution = effectiveResolution(conflict.id, caseContext.resolutions);
    if (
      resolution !== undefined &&
      resolution.outcome === 'retain' &&
      resolution.retainedFactIds.includes(fact.id)
    ) {
      return { state: 'established', rule: 'R2' };
    }
  }

  // R3 — fait corrigé par un autre fait.
  for (const relation of caseContext.relations) {
    if (relation.kind === 'fact_correction' && relation.correctsFactId === fact.id) {
      return { state: 'alleged', rule: 'R3' };
    }
  }

  // R4 / R5 — dernière validation effective, par position.
  let lastValidation: LegalFactValidation | undefined;
  for (const validation of caseContext.factValidations) {
    if (validation.factId === fact.id) lastValidation = validation;
  }
  if (lastValidation?.decision === 'reject') return { state: 'alleged', rule: 'R4' };
  if (lastValidation?.decision === 'confirm') return { state: 'established', rule: 'R5' };

  // R6 / R7 — base référentielle substantielle.
  return fact.provenance.inputReferences.some(isSubstantialInputReference)
    ? { state: 'alleged', rule: 'R6' }
    : { state: 'unknown', rule: 'R7' };
}

/**
 * Dérive l'état épistémique de `fact` pour `question`.
 *
 * Fonction **pure et déterministe** : voir {@link deriveFactEpistemicDerivation}
 * pour la règle appliquée.
 *
 * @throws {RangeError} si le fait n'est pas lié à la question par `fact_question`.
 */
export function deriveFactEpistemicState(
  fact: LegalFact,
  question: Pick<LegalQuestion, 'id'>,
  caseContext: LegalFactStateContext,
): LegalFactEpistemicState {
  return deriveFactEpistemicDerivation(fact, question, caseContext).state;
}
