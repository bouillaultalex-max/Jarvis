import {
  checkAppendOnly,
  canonicalizeLegal,
  validateLegalCaseV3,
  validateLegalOpaqueId,
  type LegalCase,
} from '@jarvis/legal-core';

import { LegalCaseEngineError } from './errors.js';

/**
 * Validations d'entrée et de sortie partagées par les opérations du moteur. Les messages
 * ne citent que des chemins de champ et des identifiants, jamais un contenu.
 */

export function requireRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LegalCaseEngineError('invalid_input', `${path} : objet attendu.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new LegalCaseEngineError('invalid_input', `${path} : clé inconnue « ${key} ».`);
    }
  }
  return value as Record<string, unknown>;
}

/** Identifiant opaque **fourni par l'appelant** (décision D7) — jamais généré ici. */
export function requireOpaqueId(value: unknown, path: string): string {
  const result = validateLegalOpaqueId(value, path);
  if (!result.ok) throw new LegalCaseEngineError('invalid_input', result.error);
  return value as string;
}

/** Texte non vide après trim ; renvoyé **tel que fourni** (aucune réécriture du contenu). */
export function requireText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LegalCaseEngineError('invalid_input', `${path} : chaîne non vide attendue.`);
  }
  return value;
}

/**
 * Contrôle final d'une écriture : le dossier résultant est un v3 valide, et aucune liste
 * append-only ni aucune question existante n'a été modifiée, remplacée, réordonnée ou
 * retirée (`legal-core` ne contrôle pas les questions : elles sont vérifiées ici).
 *
 * @throws {LegalCaseEngineError} `invalid_result` — aucune sortie n'est alors produite.
 */
export function assertValidAppend(before: LegalCase, after: LegalCase): void {
  const validation = validateLegalCaseV3(after);
  if (!validation.ok) throw new LegalCaseEngineError('invalid_result', validation.error);

  const appendOnly = checkAppendOnly(before, after);
  if (!appendOnly.ok) throw new LegalCaseEngineError('invalid_result', appendOnly.error);

  if (after.questions.length < before.questions.length) {
    throw new LegalCaseEngineError('invalid_result', 'questions : objet(s) retiré(s).');
  }
  for (let i = 0; i < before.questions.length; i += 1) {
    if (canonicalizeLegal(before.questions[i]) !== canonicalizeLegal(after.questions[i])) {
      throw new LegalCaseEngineError(
        'invalid_result',
        `questions[${i}] : question existante modifiée ou réordonnée.`,
      );
    }
  }
}
