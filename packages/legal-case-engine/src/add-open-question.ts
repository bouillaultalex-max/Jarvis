import type { LegalCase, LegalQuestion } from '@jarvis/legal-core';

import {
  assertWritableCase,
  resolveEngineOptions,
  type LegalEngineOptions,
} from './engine-context.js';
import { LegalCaseEngineError } from './errors.js';
import {
  assertValidAppend,
  requireOpaqueId,
  requireRecord,
  requireText,
} from './input-validation.js';

/** Entrée de {@link addOpenQuestion} : l'identifiant est fourni par l'appelant (décision D7). */
export interface AddOpenQuestionInput {
  readonly id: string;
  readonly question: string;
}

const INPUT_KEYS: ReadonlySet<string> = new Set(['id', 'question']);

/**
 * Ajoute une question **ouverte** à un dossier v3 (décision D5).
 *
 * - Le moteur **n'accepte aucun `status`** en entrée : la question naît `open`, et le statut
 *   des questions existantes n'est **jamais** modifié (le passage à `answered` relève de
 *   l'analyse, hors de ce jalon).
 * - Fonction **pure** : le dossier d'entrée n'est pas muté, un **nouveau** dossier est
 *   renvoyé, revalidé (`validateLegalCaseV3`) et comparé à l'original. Atomique : en cas
 *   d'erreur, rien n'est renvoyé.
 * - Un identifiant déjà présent est **refusé** (aucun remplacement, même identique).
 * - `updatedAt` prend l'instant de l'opération (chronologie contrôlée, décision D6).
 * - `legal-core` ne propose pas d'ajout de question (`appendToLegalCase` ne couvre pas cette
 *   liste) : le dossier est reconstruit par copie, sans modifier `legal-core`.
 *
 * @throws {LegalCaseEngineError} `invalid_context`, `invalid_clock`, `invalid_case`,
 *   `chronology`, `invalid_input`, `duplicate_id` ou `invalid_result`.
 */
export function addOpenQuestion(
  legalCase: LegalCase,
  input: AddOpenQuestionInput,
  options: LegalEngineOptions,
): LegalCase {
  const { at } = resolveEngineOptions(options);
  assertWritableCase(legalCase, at);

  const record = requireRecord(input, INPUT_KEYS, 'input');
  const id = requireOpaqueId(record.id, 'input.id');
  const text = requireText(record.question, 'input.question');

  if (legalCase.questions.some((existing) => existing.id === id)) {
    throw new LegalCaseEngineError(
      'duplicate_id',
      `questions contient déjà l'id « ${id} » (aucun remplacement).`,
    );
  }

  const added: LegalQuestion = { id, question: text, status: 'open' };
  const next: LegalCase = {
    ...legalCase,
    updatedAt: at,
    questions: [...legalCase.questions, added],
  };
  assertValidAppend(legalCase, next);
  return next;
}
