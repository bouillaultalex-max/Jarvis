import type * as LegalCoreModule from '@jarvis/legal-core';
import type { LegalCase } from '@jarvis/legal-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@jarvis/legal-core', async (importOriginal) => {
  const actual = await importOriginal<typeof LegalCoreModule>();
  return { ...actual, appendToLegalCase: vi.fn(actual.appendToLegalCase) };
});

import * as legalCore from '@jarvis/legal-core';

import { LegalCaseEngineError } from './errors.js';
import { recordReportedFact, type RecordedReportedFact } from './record-reported-fact.js';
import {
  T0,
  caseWithQuestions,
  deepFreeze,
  options,
  question,
  reportedFactInput,
  snapshot,
} from './testing/engine-fixtures.js';

/**
 * Atomicité de bout en bout : `legal-core` (simulé) renvoie une sortie **candidate** qui viole
 * une garantie ; le moteur doit la refuser par une `LegalCaseEngineError` de motif
 * `invalid_result` dont la **cause précise** est identifiée, ne rien renvoyer, et laisser le
 * dossier d'entrée strictement identique. Chaque sortie candidate est construite à partir du
 * vrai résultat de `legal-core` puis altérée : elle reste valide au sens du validateur v3, de
 * sorte que seul le contrôle visé peut la refuser.
 */
let actual: typeof LegalCoreModule;
beforeAll(async () => {
  actual = await vi.importActual<typeof LegalCoreModule>('@jarvis/legal-core');
});

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

/** Deux faits isolés et deux questions non référencées : leur retrait ou altération resterait valide. */
function seed(): LegalCase {
  return {
    ...caseWithQuestions(question('q1'), question('q2')),
    facts: [bareFact('f-0a', 'Ancien fait A.'), bareFact('f-0b', 'Ancien fait B.')],
  };
}

const input = () => reportedFactInput({ factId: 'f-new', evidenceId: 'e-new' });

/** La prochaine sortie de `appendToLegalCase` est le vrai résultat, altéré par `tamper`. */
function tamperNext(tamper: (real: LegalCase) => LegalCase): void {
  vi.mocked(legalCore.appendToLegalCase).mockImplementationOnce((legalCase, additions, opts) =>
    tamper(actual.appendToLegalCase(legalCase, additions, opts)),
  );
}

function expectRefusal(legalCase: LegalCase): LegalCaseEngineError {
  const frozen = deepFreeze(legalCase);
  const before = snapshot(frozen);
  const calls = vi.mocked(legalCore.appendToLegalCase).mock.calls.length;
  let result: RecordedReportedFact | undefined;
  let caught: unknown;
  try {
    result = recordReportedFact(frozen, input(), options());
  } catch (error) {
    caught = error;
  }
  // Le moteur est bien allé jusqu'à l'ajout : le refus vient du contrôle final, pas d'une validation amont.
  expect(vi.mocked(legalCore.appendToLegalCase).mock.calls.length).toBe(calls + 1);
  expect(result).toBeUndefined();
  expect(caught).toBeInstanceOf(LegalCaseEngineError);
  expect((caught as LegalCaseEngineError).reason).toBe('invalid_result');
  expect(snapshot(frozen)).toBe(before);
  return caught as LegalCaseEngineError;
}

describe('atomicité — témoin', () => {
  it('sans altération, l’ajout réussit et le dossier est valide', () => {
    const result = recordReportedFact(seed(), input(), options());
    expect(result.legalCase.facts.map((fact) => fact.id)).toEqual(['f-0a', 'f-0b', 'f-new']);
    expect(actual.validateLegalCaseV3(result.legalCase)).toEqual({ ok: true });
  });
});

describe('atomicité — faits existants protégés', () => {
  it('fait existant modifié : refus, cause « facts[0] … append-only »', () => {
    tamperNext((real) => ({
      ...real,
      facts: [{ ...real.facts[0]!, statement: 'Altéré.' }, ...real.facts.slice(1)],
    }));
    const error = expectRefusal(seed());
    expect(error.detail).toBe('facts[0] : objet modifié, remplacé ou réordonné (append-only).');
  });

  it('fait existant remplacé par un autre (même position) : refus, cause « facts[1] »', () => {
    tamperNext((real) => ({
      ...real,
      facts: [real.facts[0]!, { ...real.facts[1]!, id: 'f-usurpateur' }, real.facts[2]!],
    }));
    const error = expectRefusal(seed());
    expect(error.detail).toBe('facts[1] : objet modifié, remplacé ou réordonné (append-only).');
  });

  it('faits existants réordonnés : refus, cause « facts[0] »', () => {
    tamperNext((real) => ({
      ...real,
      facts: [real.facts[1]!, real.facts[0]!, real.facts[2]!],
    }));
    expect(expectRefusal(seed()).detail).toContain('facts[0]');
  });

  it('fait existant retiré (le nouveau fait et sa relation aussi) : refus, cause « supprimé(s) »', () => {
    tamperNext((real) => ({ ...real, facts: [real.facts[0]!], relations: [] }));
    const error = expectRefusal(seed());
    expect(error.detail).toBe('facts : 1 objet(s) supprimé(s) (append-only).');
  });
});

describe('atomicité — questions existantes protégées', () => {
  it('question existante modifiée : refus, cause « questions[0] »', () => {
    tamperNext((real) => ({
      ...real,
      questions: [{ ...real.questions[0]!, status: 'answered' as const }, real.questions[1]!],
    }));
    expect(expectRefusal(seed()).detail).toBe(
      'questions[0] : question existante modifiée ou réordonnée.',
    );
  });

  it('question existante retirée : refus, cause « questions : objet(s) retiré(s) »', () => {
    tamperNext((real) => ({ ...real, questions: [real.questions[0]!] }));
    expect(expectRefusal(seed()).detail).toBe('questions : objet(s) retiré(s).');
  });

  it('questions existantes réordonnées : refus, cause « questions[0] »', () => {
    tamperNext((real) => ({ ...real, questions: [real.questions[1]!, real.questions[0]!] }));
    expect(expectRefusal(seed()).detail).toBe(
      'questions[0] : question existante modifiée ou réordonnée.',
    );
  });
});

describe('atomicité — sortie invalide ou refus de legal-core', () => {
  it('sortie invalide au sens du validateur v3 : refus, cause « title »', () => {
    tamperNext((real) => ({ ...real, title: '' }));
    expect(expectRefusal(seed()).detail).toContain('title');
  });

  it('refus explicite de legal-core : refus typé qui reprend sa cause', () => {
    vi.mocked(legalCore.appendToLegalCase).mockImplementationOnce(() => {
      throw new Error('ajout refusé (simulé)');
    });
    expect(expectRefusal(seed()).detail).toBe('ajout refusé (simulé)');
  });

  it('erreur non standard levée par legal-core : refus typé, sans fuite du contenu', () => {
    vi.mocked(legalCore.appendToLegalCase).mockImplementationOnce(() => {
      throw 'valeur levée non Error';
    });
    const error = expectRefusal(seed());
    expect(error.detail).toBe('ajout refusé par legal-core.');
  });
});
