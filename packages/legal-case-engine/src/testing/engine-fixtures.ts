import { createLegalCase, type LegalCase, type LegalQuestion } from '@jarvis/legal-core';

import type {
  LegalEngineClock,
  LegalEngineContext,
  LegalEngineOptions,
} from '../engine-context.js';

/**
 * Fixtures **de test** (non exportées par `index.ts`). Les tests du moteur n'utilisent
 * jamais l'horloge système : chaque opération reçoit une horloge déterministe.
 */

export const T0 = '2026-09-26T10:00:00.000Z';
export const T1 = '2026-09-26T11:00:00.000Z';
export const T2 = '2026-09-26T12:00:00.000Z';

export const CONTEXT: LegalEngineContext = { actorId: 'actor-1', interactionId: 'interaction-1' };

/** Horloge qui renvoie ces instants dans l'ordre (le dernier se répète) et compte ses appels. */
export function fixedClock(...instants: readonly string[]): LegalEngineClock & {
  readonly calls: () => number;
} {
  let index = 0;
  const clock = (): string => {
    const value = instants[Math.min(index, instants.length - 1)]!;
    index += 1;
    return value;
  };
  return Object.assign(clock, { calls: () => index });
}

export function options(
  at: string = T1,
  context: LegalEngineContext = CONTEXT,
): LegalEngineOptions {
  return { context, now: fixedClock(at) };
}

/** Dossier v3 vide, créé à `T0` (donc `updatedAt` = `T0`). */
export function emptyCase(): LegalCase {
  return createLegalCase({ title: 'Dossier de test', id: 'case-1', createdAt: T0 });
}

export function question(id: string, status: LegalQuestion['status'] = 'open'): LegalQuestion {
  return { id, question: `Question ${id} ?`, status };
}

/** Dossier de test avec ces questions (construit par copie : `createLegalCase` reste la base). */
export function caseWithQuestions(...questions: readonly LegalQuestion[]): LegalCase {
  return { ...emptyCase(), questions };
}

/** Gèle récursivement : toute mutation de l'entrée par le moteur lèverait une erreur en mode strict. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Empreinte textuelle stable d'une valeur JSON (comparaison avant/après). */
export function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

import type { RecordReportedFactInput } from '../record-reported-fact.js';

/** Entrée valide de `recordReportedFact` : un fait, une pièce, un lien à `q1`. */
export function reportedFactInput(
  overrides: Partial<RecordReportedFactInput> = {},
): RecordReportedFactInput {
  return {
    factId: 'f1',
    evidenceId: 'e1',
    statement: 'Le salarié a été absent le 3 mars.',
    temporal: { kind: 'point', precision: 'day', value: '2026-03-03' },
    evidenceDescription: 'Déclaration de l’utilisateur',
    questionLinks: [{ questionId: 'q1', relationId: 'r1' }],
    ...overrides,
  };
}
