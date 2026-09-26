import {
  LEGAL_CASE_STATUSES,
  parseLegalCaseFile,
  serializeLegalCaseFile,
  validateLegalCaseV3,
} from '@jarvis/legal-core';
import { describe, expect, it } from 'vitest';

import { addOpenQuestion } from './add-open-question.js';
import { LegalCaseEngineError } from './errors.js';
import {
  CONTEXT,
  T0,
  T1,
  T2,
  caseWithQuestions,
  deepFreeze,
  emptyCase,
  fixedClock,
  options,
  question,
  snapshot,
} from './testing/engine-fixtures.js';

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof LegalCaseEngineError ? error.reason : `autre : ${String(error)}`;
  }
  return undefined;
}

describe('addOpenQuestion', () => {
  it('ajoute une question ouverte, avec updatedAt = instant injecté', () => {
    const next = addOpenQuestion(
      emptyCase(),
      { id: 'q1', question: 'Le préavis est-il dû ?' },
      options(),
    );
    expect(next.questions).toEqual([
      { id: 'q1', question: 'Le préavis est-il dû ?', status: 'open' },
    ]);
    expect(next.updatedAt).toBe(T1);
    expect(next.createdAt).toBe(T0);
    expect(validateLegalCaseV3(next)).toEqual({ ok: true });
  });

  it('ne modifie pas l’entrée (dossier gelé en profondeur) et renvoie un nouvel objet', () => {
    const input = deepFreeze(caseWithQuestions(question('q0', 'answered')));
    const before = snapshot(input);
    const next = addOpenQuestion(input, { id: 'q1', question: 'Q ?' }, options());
    expect(snapshot(input)).toBe(before);
    expect(next).not.toBe(input);
    expect(next.questions).not.toBe(input.questions);
  });

  it('ne modifie jamais le statut des questions existantes (D5)', () => {
    const input = caseWithQuestions(question('q0', 'answered'), question('q1', 'open'));
    const next = addOpenQuestion(input, { id: 'q2', question: 'Q2 ?' }, options());
    expect(next.questions.slice(0, 2)).toEqual(input.questions);
    expect(next.questions[0]!.status).toBe('answered');
    expect(next.questions[2]!.status).toBe('open');
  });

  it('conserve l’ordre : les questions existantes restent en tête', () => {
    const input = caseWithQuestions(question('q0'), question('q1'));
    const next = addOpenQuestion(input, { id: 'q2', question: 'Q ?' }, options());
    expect(next.questions.map((q) => q.id)).toEqual(['q0', 'q1', 'q2']);
  });

  it('laisse les autres listes strictement inchangées', () => {
    const input = emptyCase();
    const next = addOpenQuestion(input, { id: 'q1', question: 'Q ?' }, options());
    for (const key of ['facts', 'evidence', 'relations', 'factValidations', 'conflicts'] as const) {
      expect(next[key]).toEqual([]);
    }
    expect(next.status).toBe(input.status);
    expect(next.id).toBe(input.id);
  });

  it('refuse un identifiant déjà présent, même avec un contenu identique', () => {
    const input = caseWithQuestions(question('q1'));
    expect(
      reasonOf(() => addOpenQuestion(input, { id: 'q1', question: 'Autre ?' }, options())),
    ).toBe('duplicate_id');
    expect(
      reasonOf(() => addOpenQuestion(input, { id: 'q1', question: 'Question q1 ?' }, options())),
    ).toBe('duplicate_id');
  });

  it.each([
    ['id vide', { id: '', question: 'Q ?' }],
    ['id avec espace', { id: 'q 1', question: 'Q ?' }],
    ['id adresse e-mail', { id: 'a@b.fr', question: 'Q ?' }],
    ['id absent', { question: 'Q ?' }],
    ['question vide', { id: 'q1', question: '   ' }],
    ['question absente', { id: 'q1' }],
    ['question non chaîne', { id: 'q1', question: 42 }],
    ['statut fourni', { id: 'q1', question: 'Q ?', status: 'answered' }],
    ['clé inconnue', { id: 'q1', question: 'Q ?', factIds: ['f1'] }],
    ['entrée nulle', null],
    ['entrée tableau', []],
  ])('refuse une entrée invalide : %s', (_label, input) => {
    expect(reasonOf(() => addOpenQuestion(emptyCase(), input as never, options()))).toBe(
      'invalid_input',
    );
  });

  it('atomicité : chaque échec laisse l’entrée intacte et ne renvoie rien', () => {
    const input = deepFreeze(caseWithQuestions(question('q0')));
    const before = snapshot(input);
    const attempts: readonly (() => unknown)[] = [
      () => addOpenQuestion(input, { id: 'q0', question: 'Q ?' }, options()),
      () => addOpenQuestion(input, { id: '', question: 'Q ?' }, options()),
      () => addOpenQuestion(input, { id: 'q9', question: '' }, options()),
      () => addOpenQuestion(input, { id: 'q9', question: 'Q ?' }, { context: CONTEXT } as never),
      () => addOpenQuestion(input, { id: 'q9', question: 'Q ?' }, options('2000-01-01T00:00:00Z')),
      () => addOpenQuestion({ ...input, title: '' }, { id: 'q9', question: 'Q ?' }, options()),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(LegalCaseEngineError);
    expect(snapshot(input)).toBe(before);
  });

  it('refuse un contexte ou une horloge invalides', () => {
    const input = { id: 'q1', question: 'Q ?' };
    expect(
      reasonOf(() =>
        addOpenQuestion(emptyCase(), input, {
          context: { actorId: '', interactionId: 'i' },
          now: fixedClock(T1),
        }),
      ),
    ).toBe('invalid_context');
    expect(
      reasonOf(() =>
        addOpenQuestion(emptyCase(), input, { context: CONTEXT, now: () => 'demain' }),
      ),
    ).toBe('invalid_clock');
  });

  it('refuse un instant antérieur à updatedAt (D6) et un dossier invalide', () => {
    const input = { id: 'q1', question: 'Q ?' };
    expect(
      reasonOf(() => addOpenQuestion(emptyCase(), input, options('2026-09-26T09:00:00Z'))),
    ).toBe('chronology');
    expect(reasonOf(() => addOpenQuestion({ ...emptyCase(), title: '' }, input, options()))).toBe(
      'invalid_case',
    );
  });

  it('est déterministe : mêmes entrées et même horloge donnent le même dossier', () => {
    const run = (): unknown =>
      addOpenQuestion(emptyCase(), { id: 'q1', question: 'Q ?' }, options());
    expect(snapshot(run())).toBe(snapshot(run()));
  });

  it('lit l’horloge une seule fois par opération', () => {
    const clock = fixedClock(T1, T2);
    addOpenQuestion(emptyCase(), { id: 'q1', question: 'Q ?' }, { context: CONTEXT, now: clock });
    expect(clock.calls()).toBe(1);
  });

  it('aller-retour de sérialisation fidèle', () => {
    const next = addOpenQuestion(emptyCase(), { id: 'q1', question: 'Q ?' }, options());
    const reloaded = parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(next)));
    expect(reloaded).toEqual(next);
  });

  it('les ajouts successifs s’enchaînent avec des instants croissants', () => {
    const first = addOpenQuestion(emptyCase(), { id: 'q1', question: 'Q1 ?' }, options(T1));
    const second = addOpenQuestion(first, { id: 'q2', question: 'Q2 ?' }, options(T2));
    expect(second.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(second.updatedAt).toBe(T2);
    expect(
      reasonOf(() => addOpenQuestion(second, { id: 'q3', question: 'Q3 ?' }, options(T1))),
    ).toBe('chronology');
  });
});

describe('addOpenQuestion — statut du dossier (décision I5-b : aucune restriction imposée)', () => {
  it.each(LEGAL_CASE_STATUSES)(
    'accepte une question ouverte quand le dossier est à l’étape %s',
    (status) => {
      const legalCase = { ...emptyCase(), status };
      const next = addOpenQuestion(legalCase, { id: 'q1', question: 'Q ?' }, options());
      expect(next.status).toBe(status);
      expect(next.questions).toEqual([{ id: 'q1', question: 'Q ?', status: 'open' }]);
      expect(validateLegalCaseV3(next)).toEqual({ ok: true });
    },
  );
});
