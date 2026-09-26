import { describe, expect, it } from 'vitest';

import { createLegalCase, validateLegalCaseV3 } from '@jarvis/legal-core';

import { LegalCaseEngineError } from './errors.js';
import { addOpenQuestion } from './add-open-question.js';
import { recordReportedFact } from './record-reported-fact.js';
import {
  assertWritableCase,
  buildHumanProvenance,
  resolveEngineOptions,
} from './engine-context.js';
import { systemClock } from './system-clock.js';
import {
  CONTEXT,
  T0,
  T1,
  deepFreeze,
  emptyCase,
  fixedClock,
  options,
  question,
  reportedFactInput,
} from './testing/engine-fixtures.js';

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof LegalCaseEngineError ? error.reason : `autre : ${String(error)}`;
  }
  return undefined;
}

describe('resolveEngineOptions', () => {
  it('renvoie le contexte recopié et un unique instant', () => {
    const clock = fixedClock(T1, '2030-01-01T00:00:00.000Z');
    const resolved = resolveEngineOptions({ context: CONTEXT, now: clock });
    expect(resolved).toEqual({ context: CONTEXT, at: T1 });
    expect(clock.calls()).toBe(1);
    expect(resolved.context).not.toBe(CONTEXT);
  });

  it('accepte un contexte gelé', () => {
    expect(
      resolveEngineOptions(deepFreeze({ context: { ...CONTEXT }, now: fixedClock(T1) })).at,
    ).toBe(T1);
  });

  it.each([
    ['options absentes', undefined],
    ['options nulles', null],
    ['options tableau', []],
    ['contexte absent', { now: fixedClock(T1) }],
    ['contexte nul', { context: null, now: fixedClock(T1) }],
    ['actorId absent', { context: { interactionId: 'i-1' }, now: fixedClock(T1) }],
    ['interactionId absent', { context: { actorId: 'a-1' }, now: fixedClock(T1) }],
    ['actorId vide', { context: { actorId: '', interactionId: 'i-1' }, now: fixedClock(T1) }],
    [
      'actorId adresse e-mail',
      { context: { actorId: 'a@b.fr', interactionId: 'i-1' }, now: fixedClock(T1) },
    ],
    [
      'interactionId avec espace',
      { context: { actorId: 'a-1', interactionId: 'i 1' }, now: fixedClock(T1) },
    ],
    ['actorId non chaîne', { context: { actorId: 42, interactionId: 'i-1' }, now: fixedClock(T1) }],
    ['clé de contexte inconnue', { context: { ...CONTEXT, role: 'admin' }, now: fixedClock(T1) }],
  ])('refuse un contexte invalide : %s', (_label, options) => {
    expect(reasonOf(() => resolveEngineOptions(options))).toBe('invalid_context');
  });

  it.each([
    ['horloge absente', { context: CONTEXT }],
    ['horloge non fonction', { context: CONTEXT, now: T1 }],
  ])('refuse une horloge invalide : %s', (_label, options) => {
    expect(reasonOf(() => resolveEngineOptions(options))).toBe('invalid_clock');
  });

  it.each([
    ['chaîne quelconque', 'demain'],
    ['date sans heure', '2026-09-26'],
    ['instant sans décalage', '2026-09-26T10:00:00'],
    ['jour inexistant', '2026-02-30T10:00:00Z'],
    ['nombre', 1_780_000_000_000],
    ['undefined', undefined],
  ])('refuse un instant d’horloge invalide : %s', (_label, value) => {
    const now = (): unknown => value;
    expect(reasonOf(() => resolveEngineOptions({ context: CONTEXT, now }))).toBe('invalid_clock');
  });

  it('refuse une horloge qui lève, sans propager son message', () => {
    const now = (): string => {
      throw new Error('contenu secret');
    };
    try {
      resolveEngineOptions({ context: CONTEXT, now });
      expect.unreachable();
    } catch (error) {
      expect((error as LegalCaseEngineError).reason).toBe('invalid_clock');
      expect((error as Error).message).not.toContain('contenu secret');
    }
  });

  it('n’a aucun défaut : ni contexte ni horloge générés', () => {
    expect(reasonOf(() => resolveEngineOptions({}))).toBe('invalid_context');
  });
});

describe('systemClock', () => {
  it('renvoie un instant valide pour le moteur (explicite, jamais un défaut)', () => {
    const at = systemClock();
    expect(resolveEngineOptions({ context: CONTEXT, now: () => at }).at).toBe(at);
  });
});

describe('buildHumanProvenance', () => {
  it('ne reprend que le contexte fourni et les références de l’opération', () => {
    expect(buildHumanProvenance(CONTEXT)).toEqual({
      origin: 'human',
      actorId: 'actor-1',
      interactionId: 'interaction-1',
      inputReferences: [],
    });
    const reference = { kind: 'question', questionId: 'q1' } as const;
    expect(buildHumanProvenance(CONTEXT, [reference]).inputReferences).toEqual([reference]);
  });
});

describe('assertWritableCase', () => {
  it('accepte un dossier valide et un instant postérieur ou égal à updatedAt', () => {
    expect(() => assertWritableCase(emptyCase(), T1)).not.toThrow();
    expect(() => assertWritableCase(emptyCase(), T0)).not.toThrow();
  });

  it('refuse un instant antérieur à updatedAt (chronologie, D6)', () => {
    expect(reasonOf(() => assertWritableCase(emptyCase(), '2026-09-26T09:59:59.999Z'))).toBe(
      'chronology',
    );
  });

  it('compare des instants de fuseaux différents comme des instants', () => {
    // 11:00+02:00 = 09:00Z, antérieur à T0 (10:00Z).
    expect(reasonOf(() => assertWritableCase(emptyCase(), '2026-09-26T11:00:00.000+02:00'))).toBe(
      'chronology',
    );
    // 13:00+02:00 = 11:00Z, postérieur.
    expect(() => assertWritableCase(emptyCase(), '2026-09-26T13:00:00.000+02:00')).not.toThrow();
  });

  it('refuse un dossier invalide (rien n’est écrit dans un dossier corrompu)', () => {
    expect(reasonOf(() => assertWritableCase({ ...emptyCase(), title: '' }, T1))).toBe(
      'invalid_case',
    );
  });

  it('refuse un updatedAt qui n’est pas un instant : chronologie invérifiable', () => {
    expect(reasonOf(() => assertWritableCase({ ...emptyCase(), updatedAt: 'garbage' }, T1))).toBe(
      'chronology',
    );
  });

  describe('createdAt non instant (décision I5-a)', () => {
    function detailOf(action: () => unknown): { reason?: string; detail?: string } {
      try {
        action();
      } catch (error) {
        if (error instanceof LegalCaseEngineError) {
          return { reason: error.reason, detail: error.detail };
        }
        throw error;
      }
      return {};
    }

    it('refuse un dossier legal-core valide dont createdAt est une date seule (jamais convertie)', () => {
      const dateOnly = createLegalCase({ title: 'Dossier', id: 'c-date', createdAt: '2026-09-24' });
      expect(validateLegalCaseV3(dateOnly)).toEqual({ ok: true });
      const failure = detailOf(() => assertWritableCase(dateOnly, T1));
      expect(failure.reason).toBe('chronology');
      expect(failure.detail).toContain('createdAt');
    });

    it('refuse aussi quand updatedAt est un instant valide : le motif désigne createdAt', () => {
      const legalCase = { ...emptyCase(), createdAt: '2026-09-24' };
      expect(validateLegalCaseV3(legalCase)).toEqual({ ok: true });
      const failure = detailOf(() => assertWritableCase(legalCase, T1));
      expect(failure.reason).toBe('chronology');
      expect(failure.detail).toContain('createdAt');
      expect(failure.detail).not.toContain('updatedAt');
    });

    it.each([
      ['date seule', '2026-09-24'],
      ['mois seul', '2026-09'],
      ['année seule', '2026'],
      ['instant sans décalage', '2026-09-24T10:00:00'],
      ['texte libre', 'hier'],
    ])('refuse createdAt : %s', (_label, createdAt) => {
      const legalCase = { ...emptyCase(), createdAt };
      expect(detailOf(() => assertWritableCase(legalCase, T1)).reason).toBe('chronology');
    });

    it('accepte un createdAt instant, avec Z ou avec décalage', () => {
      for (const createdAt of ['2026-09-24T10:00:00.000Z', '2026-09-24T12:00:00+02:00']) {
        expect(() => assertWritableCase({ ...emptyCase(), createdAt }, T1)).not.toThrow();
      }
    });

    it('les deux opérations d’écriture refusent, sans rien modifier ni renvoyer', () => {
      const legalCase = deepFreeze({ ...emptyCase(), createdAt: '2026-09-24' });
      const before = JSON.stringify(legalCase);
      const withQuestion = deepFreeze({ ...legalCase, questions: [question('q1')] });
      expect(
        detailOf(() => addOpenQuestion(legalCase, { id: 'q1', question: 'Q ?' }, options())).reason,
      ).toBe('chronology');
      expect(
        detailOf(() => recordReportedFact(withQuestion, reportedFactInput(), options())).reason,
      ).toBe('chronology');
      expect(JSON.stringify(legalCase)).toBe(before);
    });

    it('n’est pas une règle de legal-core : le validateur v3 reste inchangé et accepte ce dossier', () => {
      expect(
        validateLegalCaseV3({ ...emptyCase(), createdAt: '2026-09-24', updatedAt: '2026-09-24' }),
      ).toEqual({ ok: true });
    });
  });
});
