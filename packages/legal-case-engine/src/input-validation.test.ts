import { validateLegalCaseV3, type LegalCase } from '@jarvis/legal-core';
import { describe, expect, it } from 'vitest';

import { LegalCaseEngineError } from './errors.js';
import { assertValidAppend } from './input-validation.js';
import { stampedCase, stamps } from './testing/chronology-fixtures.js';
import {
  T0,
  caseWithQuestions,
  deepFreeze,
  question,
  snapshot,
} from './testing/engine-fixtures.js';

/**
 * `assertValidAppend` est le contrôle final de toute écriture : le résultat est un v3 valide et
 * n'a modifié, remplacé, réordonné ni retiré aucun objet append-only ni aucune question
 * existante. Chaque test fabrique une sortie **candidate** valide au sens de `legal-core`, de
 * sorte que seul le contrôle visé peut la refuser, puis vérifie la **cause précise**.
 */
function failure(before: LegalCase, after: LegalCase): LegalCaseEngineError {
  try {
    assertValidAppend(before, after);
  } catch (error) {
    if (error instanceof LegalCaseEngineError) return error;
    throw error;
  }
  throw new Error('assertValidAppend aurait dû refuser cette sortie');
}

const human = {
  origin: 'human' as const,
  actorId: 'actor-1',
  interactionId: 'interaction-1',
  inputReferences: [],
};
const bareFact = (id: string, statement: string) => ({
  id,
  statement,
  temporal: { kind: 'unknown' as const },
  provenance: human,
  recordedAt: T0,
});

/** Deux faits isolés (aucune référence) et deux questions non référencées : retirer ou modifier reste valide. */
function seed(): LegalCase {
  return {
    ...caseWithQuestions(question('q1'), question('q2')),
    facts: [bareFact('f-1', 'Premier.'), bareFact('f-2', 'Second.')],
  };
}

describe('assertValidAppend — extension légitime', () => {
  it('accepte un ajout en fin de liste et une question ajoutée en fin de liste', () => {
    const before = seed();
    const after: LegalCase = {
      ...before,
      facts: [...before.facts, bareFact('f-3', 'Troisième.')],
      questions: [...before.questions, question('q3')],
    };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(() => assertValidAppend(before, after)).not.toThrow();
  });

  it('accepte un résultat identique (aucun ajout)', () => {
    const before = seed();
    expect(() => assertValidAppend(before, { ...before })).not.toThrow();
  });
});

describe('assertValidAppend — faits existants protégés', () => {
  it('refuse un fait existant modifié (cause : facts[0], append-only)', () => {
    const before = seed();
    const after: LegalCase = {
      ...before,
      facts: [{ ...before.facts[0]!, statement: 'Altéré.' }, before.facts[1]!],
    };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toMatch(
      /^facts\[0\] : objet modifié, remplacé ou réordonné \(append-only\)\.$/,
    );
  });

  it('refuse un fait existant remplacé par un autre identifiant', () => {
    const before = seed();
    const after: LegalCase = {
      ...before,
      facts: [before.facts[0]!, bareFact('f-remplaçant', 'Autre.')].map((fact, i) =>
        i === 1 ? { ...fact, id: 'f-remplacant' } : fact,
      ),
    };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toContain('facts[1]');
    expect(error.detail).toContain('append-only');
  });

  it('refuse deux faits réordonnés (cause : facts[0])', () => {
    const before = seed();
    const after: LegalCase = { ...before, facts: [before.facts[1]!, before.facts[0]!] };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toContain('facts[0]');
  });

  it('refuse un fait retiré (cause : « objet(s) supprimé(s) »)', () => {
    const before = seed();
    const after: LegalCase = { ...before, facts: [before.facts[0]!] };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toBe('facts : 1 objet(s) supprimé(s) (append-only).');
  });

  it('refuse le retrait de tous les faits', () => {
    const before = seed();
    const error = failure(before, { ...before, facts: [] });
    expect(error.detail).toBe('facts : 2 objet(s) supprimé(s) (append-only).');
  });
});

describe('assertValidAppend — questions existantes protégées', () => {
  it('refuse une question retirée (cause : questions : objet(s) retiré(s))', () => {
    const before = seed();
    const after: LegalCase = { ...before, questions: [before.questions[0]!] };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toBe('questions : objet(s) retiré(s).');
  });

  it('refuse toutes les questions retirées', () => {
    const before = seed();
    expect(failure(before, { ...before, questions: [] }).detail).toBe(
      'questions : objet(s) retiré(s).',
    );
  });

  it('refuse une question dont le statut change (cause : questions[0])', () => {
    const before = seed();
    const after: LegalCase = {
      ...before,
      questions: [{ ...before.questions[0]!, status: 'answered' }, before.questions[1]!],
    };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toBe('questions[0] : question existante modifiée ou réordonnée.');
  });

  it('refuse une question dont le texte change', () => {
    const before = seed();
    const after: LegalCase = {
      ...before,
      questions: [before.questions[0]!, { ...before.questions[1]!, question: 'Reformulée ?' }],
    };
    expect(failure(before, after).detail).toBe(
      'questions[1] : question existante modifiée ou réordonnée.',
    );
  });

  it('refuse deux questions réordonnées', () => {
    const before = seed();
    const after: LegalCase = { ...before, questions: [before.questions[1]!, before.questions[0]!] };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(failure(before, after).detail).toBe(
      'questions[0] : question existante modifiée ou réordonnée.',
    );
  });

  it('refuse une question existante remplacée par une autre de même position', () => {
    const before = seed();
    const after: LegalCase = { ...before, questions: [before.questions[0]!, question('q-autre')] };
    expect(failure(before, after).detail).toContain('questions[1]');
  });
});

describe('assertValidAppend — toutes les listes append-only du modèle Fact', () => {
  const removals: readonly (readonly [string, (legalCase: LegalCase) => LegalCase, RegExp])[] = [
    ['documents', (c) => ({ ...c, documents: [] }), /^documents : 1 objet\(s\) supprimé\(s\)/],
    ['evidence', (c) => ({ ...c, evidence: [] }), /^evidence : 1 objet\(s\) supprimé\(s\)/],
    ['relations', (c) => ({ ...c, relations: [] }), /^relations : 1 objet\(s\) supprimé\(s\)/],
    [
      'factValidations',
      (c) => ({ ...c, factValidations: [] }),
      /^factValidations : 1 objet\(s\) supprimé\(s\)/,
    ],
    [
      'resolutionProposals',
      (c) => ({ ...c, resolutionProposals: [] }),
      /^resolutionProposals : 1 objet\(s\) supprimé\(s\)/,
    ],
    [
      'ruleExecutions',
      (c) => ({ ...c, ruleExecutions: [] }),
      /^ruleExecutions : 1 objet\(s\) supprimé\(s\)/,
    ],
    [
      'resolutions',
      (c) => ({ ...c, resolutions: [] }),
      /^resolutions : 1 objet\(s\) supprimé\(s\)/,
    ],
    [
      'conflicts (avec ses dépendants)',
      (c) => ({
        ...c,
        conflicts: [],
        resolutionProposals: [],
        ruleExecutions: [],
        resolutions: [],
      }),
      /^conflicts : 1 objet\(s\) supprimé\(s\)/,
    ],
  ];

  it.each(removals)('refuse le retrait d’un objet de %s', (_label, remove, expected) => {
    const before = stampedCase(stamps(T0));
    const after = remove(before);
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    const error = failure(before, after);
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toMatch(expected);
  });

  it('refuse un objet modifié dans une liste sans dépendance épinglée (documents)', () => {
    const before = stampedCase(stamps(T0));
    const after: LegalCase = {
      ...before,
      documents: [{ ...before.documents[0]!, title: 'Titre altéré' }],
    };
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(failure(before, after).detail).toBe(
      'documents[0] : objet modifié, remplacé ou réordonné (append-only).',
    );
  });
});

describe('assertValidAppend — sortie invalide et entrée intacte', () => {
  it('refuse un résultat invalide au sens de legal-core (cause : le validateur v3)', () => {
    const before = seed();
    const error = failure(before, { ...before, title: '' });
    expect(error.reason).toBe('invalid_result');
    expect(error.detail).toContain('title');
  });

  it('ne modifie ni l’entrée ni la sortie candidate', () => {
    const before = deepFreeze(seed());
    const after = deepFreeze({ ...before, questions: [before.questions[0]!] });
    const snapshots = [snapshot(before), snapshot(after)];
    expect(() => assertValidAppend(before, after)).toThrow(LegalCaseEngineError);
    expect([snapshot(before), snapshot(after)]).toEqual(snapshots);
  });
});
