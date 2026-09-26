/**
 * `@jarvis/legal-case-engine` — moteur de faits et de dossiers juridiques (LEGAL-04.1).
 *
 * Au-dessus de `@jarvis/legal-core` (seule dépendance, décision D1). Opérations **pures et
 * atomiques** sur un `LegalCase` v3 : elles renvoient un nouveau dossier revalidé ou lèvent
 * une `LegalCaseEngineError`, sans jamais muter l'entrée ni produire de résultat partiel.
 *
 *   - {@link addOpenQuestion}      : ajoute une question ouverte (D5) ;
 *   - {@link recordReportedFact}   : fait rapporté + pièce non documentaire + lien(s) à la
 *                                    question, atomiquement (D4) ;
 *   - {@link findEquivalentFacts}  : détection consultative de faits équivalents (D7).
 *
 * Contexte (`actorId`, `interactionId`, D2) et horloge (D6) sont **injectés** par l'appelant.
 * Hors périmètre de ce jalon : propositions issues d'un LLM (D3), validation humaine,
 * corrections (D8), projection des faits écartés (D9), persistance.
 */
export type { LegalEngineClock, LegalEngineContext, LegalEngineOptions } from './engine-context.js';
export type { LegalCaseEngineErrorReason } from './errors.js';
export { LegalCaseEngineError } from './errors.js';
export { systemClock } from './system-clock.js';

export type { AddOpenQuestionInput } from './add-open-question.js';
export { addOpenQuestion } from './add-open-question.js';

export type {
  RecordReportedFactInput,
  RecordedReportedFact,
  ReportedFactDerivation,
  ReportedFactQuestionLink,
} from './record-reported-fact.js';
export { recordReportedFact } from './record-reported-fact.js';

export type {
  EquivalenceCandidate,
  EquivalentFactsResult,
  FactStatementMatch,
  FactTemporalMatch,
  PotentialEquivalentFact,
} from './find-equivalent-facts.js';
export {
  EQUIVALENCE_CRITERION,
  findEquivalentFacts,
  normalizeStatement,
} from './find-equivalent-facts.js';
