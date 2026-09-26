import {
  LEGAL_CASE_STATUSES,
  checkAppendOnly,
  deriveFactEpistemicDerivation,
  parseLegalCaseFile,
  serializeLegalCaseFile,
  validateLegalCaseV3,
  verifyLegalFingerprint,
  type LegalCase,
  type LegalFactTemporal,
} from '@jarvis/legal-core';
import { describe, expect, it } from 'vitest';

import { addOpenQuestion } from './add-open-question.js';
import { LegalCaseEngineError } from './errors.js';
import { recordReportedFact } from './record-reported-fact.js';
import {
  CONTEXT,
  T0,
  T1,
  T2,
  caseWithQuestions,
  deepFreeze,
  fixedClock,
  options,
  question,
  reportedFactInput,
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

const base = (): LegalCase => caseWithQuestions(question('q1'), question('q2'));

describe('recordReportedFact — cas nominal', () => {
  it('ajoute atomiquement le fait, la pièce non documentaire et le lien à la question', () => {
    const before = base();
    const result = recordReportedFact(before, reportedFactInput(), options());
    const after = result.legalCase;

    expect(after.facts).toEqual([result.fact]);
    expect(after.evidence).toEqual([result.evidence]);
    expect(after.relations).toEqual(result.relations);
    expect(result.evidence.kind).toBe('non_documentary');
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      kind: 'fact_question',
      id: 'r1',
      factId: 'f1',
      questionId: 'q1',
    });
    expect(after.updatedAt).toBe(T1);
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(checkAppendOnly(before, after)).toEqual({ ok: true });
  });

  it('la provenance vient du seul contexte injecté (D2) et n’est jamais inventée', () => {
    const { fact, evidence, relations } = recordReportedFact(
      base(),
      reportedFactInput(),
      options(T1, { actorId: 'alexandre', interactionId: 'session-42' }),
    );
    for (const provenance of [fact.provenance, evidence.provenance, relations[0]!.provenance]) {
      expect(provenance).toMatchObject({
        origin: 'human',
        actorId: 'alexandre',
        interactionId: 'session-42',
      });
    }
    expect(evidence.provenance.inputReferences).toEqual([]);
    expect(relations[0]!.provenance.inputReferences).toEqual([]);
  });

  it('le fait référence la pièce par une empreinte qui vérifie', () => {
    const { fact, evidence } = recordReportedFact(base(), reportedFactInput(), options());
    expect(fact.provenance.inputReferences).toHaveLength(1);
    const reference = fact.provenance.inputReferences[0]!;
    expect(reference).toMatchObject({ kind: 'evidence', evidenceId: 'e1' });
    if (reference.kind !== 'evidence') throw new Error('référence evidence attendue');
    expect(verifyLegalFingerprint(evidence, reference.evidenceFingerprint)).toBe(true);
  });

  it('utilise le même instant pour tous les objets, lu une seule fois (D6)', () => {
    const clock = fixedClock(T1, T2);
    const result = recordReportedFact(base(), reportedFactInput(), {
      context: CONTEXT,
      now: clock,
    });
    expect(clock.calls()).toBe(1);
    expect(result.fact.recordedAt).toBe(T1);
    expect(result.evidence.addedAt).toBe(T1);
    expect(result.relations[0]!.recordedAt).toBe(T1);
  });

  it('état dérivé : `alleged` par R6 (là où un fait sans pièce serait `unknown` par R7)', () => {
    const result = recordReportedFact(base(), reportedFactInput(), options());
    expect(result.derivations).toEqual([{ questionId: 'q1', state: 'alleged', rule: 'R6' }]);
    expect(deriveFactEpistemicDerivation(result.fact, { id: 'q1' }, result.legalCase)).toEqual({
      state: 'alleged',
      rule: 'R6',
    });

    const withoutEvidence = {
      ...result.legalCase,
      facts: [{ ...result.fact, provenance: { ...result.fact.provenance, inputReferences: [] } }],
    };
    expect(
      deriveFactEpistemicDerivation(withoutEvidence.facts[0]!, { id: 'q1' }, withoutEvidence).rule,
    ).toBe('R7');
  });

  it('le fait ne porte aucun état stocké (clés fermées du modèle)', () => {
    const { fact } = recordReportedFact(base(), reportedFactInput(), options());
    expect(Object.keys(fact).sort()).toEqual([
      'id',
      'provenance',
      'recordedAt',
      'statement',
      'temporal',
    ]);
  });

  it('relie le fait à plusieurs questions : une relation et une dérivation par question', () => {
    const result = recordReportedFact(
      base(),
      reportedFactInput({
        questionLinks: [
          { questionId: 'q1', relationId: 'r1' },
          { questionId: 'q2', relationId: 'r2' },
        ],
      }),
      options(),
    );
    expect(result.relations.map((relation) => relation.questionId)).toEqual(['q1', 'q2']);
    expect(result.derivations.map((d) => d.questionId)).toEqual(['q1', 'q2']);
    expect(validateLegalCaseV3(result.legalCase)).toEqual({ ok: true });
  });

  it('conserve la précision de la date : jour, mois, année, intervalle, inconnu', () => {
    const temporals = [
      { kind: 'point', precision: 'day', value: '2026-03-03' },
      { kind: 'point', precision: 'month', value: '2026-03' },
      { kind: 'point', precision: 'year', value: '2026' },
      {
        kind: 'interval',
        start: { precision: 'month', value: '2025-03' },
        end: { precision: 'day', value: '2025-06-30' },
      },
      { kind: 'unknown' },
    ] as const;
    temporals.forEach((temporal, index) => {
      const result = recordReportedFact(
        base(),
        reportedFactInput({ factId: `f${index}`, temporal }),
        options(),
      );
      expect(result.fact.temporal).toEqual(temporal);
    });
  });

  it('ne modifie pas la question liée, ni son statut, ni les questions existantes', () => {
    const input = caseWithQuestions(question('q1', 'answered'), question('q2'));
    const result = recordReportedFact(input, reportedFactInput(), options());
    expect(result.legalCase.questions).toEqual(input.questions);
    expect(result.legalCase.questions[0]!.status).toBe('answered');
  });

  it('les enregistrements successifs s’enchaînent (append-only, ordre conservé)', () => {
    const first = recordReportedFact(base(), reportedFactInput(), options(T1));
    const second = recordReportedFact(
      first.legalCase,
      reportedFactInput({
        factId: 'f2',
        evidenceId: 'e2',
        questionLinks: [{ questionId: 'q1', relationId: 'r2' }],
      }),
      options(T2),
    );
    expect(second.legalCase.facts.map((fact) => fact.id)).toEqual(['f1', 'f2']);
    expect(checkAppendOnly(first.legalCase, second.legalCase)).toEqual({ ok: true });
    expect(validateLegalCaseV3(second.legalCase)).toEqual({ ok: true });
  });

  it('fonctionne avec une question ajoutée par le moteur', () => {
    const withQuestion = addOpenQuestion(
      caseWithQuestions(),
      { id: 'q1', question: 'Le préavis est-il dû ?' },
      options(T1),
    );
    const result = recordReportedFact(withQuestion, reportedFactInput(), options(T2));
    expect(validateLegalCaseV3(result.legalCase)).toEqual({ ok: true });
  });
});

describe('recordReportedFact — équivalents consultatifs (D7)', () => {
  it('sans fait préalable : aucun équivalent', () => {
    const result = recordReportedFact(base(), reportedFactInput(), options());
    expect(result.equivalents).toMatchObject({ status: 'none_found', equivalents: [] });
  });

  it('signale un équivalent mais enregistre quand même, sans fusion ni rejet', () => {
    const first = recordReportedFact(base(), reportedFactInput(), options(T1));
    const second = recordReportedFact(
      first.legalCase,
      reportedFactInput({
        factId: 'f2',
        evidenceId: 'e2',
        questionLinks: [{ questionId: 'q1', relationId: 'r2' }],
      }),
      options(T2),
    );
    expect(second.equivalents.status).toBe('potential_equivalents');
    expect(second.equivalents.equivalents.map((e) => e.factId)).toEqual(['f1']);
    expect(second.equivalents.equivalents[0]!.sharedQuestionIds).toEqual(['q1']);
    expect(second.legalCase.facts.map((fact) => fact.id)).toEqual(['f1', 'f2']);
    expect(second.legalCase.evidence).toHaveLength(2);
  });

  it('ne signale que les faits antérieurs à l’ajout, jamais le fait qui vient d’être ajouté', () => {
    const result = recordReportedFact(base(), reportedFactInput(), options());
    expect(result.equivalents.equivalents.map((e) => e.factId)).not.toContain('f1');
  });
});

describe('recordReportedFact — immutabilité et déterminisme', () => {
  it('ne mute pas l’entrée (dossier et entrée gelés en profondeur)', () => {
    const input = deepFreeze(base());
    const args = deepFreeze(reportedFactInput());
    const before = snapshot(input);
    const result = recordReportedFact(input, args, options());
    expect(snapshot(input)).toBe(before);
    expect(result.legalCase).not.toBe(input);
    expect(result.legalCase.facts).not.toBe(input.facts);
  });

  it('est déterministe avec une horloge injectée', () => {
    const run = (): string => snapshot(recordReportedFact(base(), reportedFactInput(), options()));
    expect(run()).toBe(run());
  });

  it('aller-retour de sérialisation fidèle', () => {
    const { legalCase } = recordReportedFact(base(), reportedFactInput(), options());
    expect(parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(legalCase)))).toEqual(legalCase);
  });

  it('la dérivation reste identique après rechargement du dossier', () => {
    const { legalCase, fact } = recordReportedFact(base(), reportedFactInput(), options());
    const reloaded = parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(legalCase)));
    expect(deriveFactEpistemicDerivation(fact, { id: 'q1' }, reloaded)).toEqual({
      state: 'alleged',
      rule: 'R6',
    });
  });
});

describe('recordReportedFact — refus (atomicité : aucun ajout partiel)', () => {
  const invalidInputs: readonly (readonly [string, unknown, string])[] = [
    ['factId vide', reportedFactInput({ factId: '' }), 'invalid_input'],
    ['factId adresse e-mail', reportedFactInput({ factId: 'a@b.fr' }), 'invalid_input'],
    ['evidenceId invalide', reportedFactInput({ evidenceId: 'e 1' }), 'invalid_input'],
    ['énoncé vide', reportedFactInput({ statement: '  ' }), 'invalid_input'],
    ['description de pièce vide', reportedFactInput({ evidenceDescription: '' }), 'invalid_input'],
    ['température absente', { ...reportedFactInput(), temporal: undefined }, 'invalid_input'],
    [
      'température invalide (date avec heure)',
      reportedFactInput({
        temporal: { kind: 'point', precision: 'day', value: '2026-03-03T10:00:00Z' },
      }),
      'invalid_input',
    ],
    [
      'température invalide (jour inexistant)',
      reportedFactInput({ temporal: { kind: 'point', precision: 'day', value: '2026-02-30' } }),
      'invalid_input',
    ],
    [
      'intervalle impossible',
      reportedFactInput({
        temporal: {
          kind: 'interval',
          start: { precision: 'day', value: '2026-05-01' },
          end: { precision: 'day', value: '2026-04-01' },
        },
      }),
      'invalid_input',
    ],
    ['aucun lien à une question', reportedFactInput({ questionLinks: [] }), 'invalid_input'],
    ['liens non tableau', { ...reportedFactInput(), questionLinks: 'q1' }, 'invalid_input'],
    [
      'question liée deux fois',
      reportedFactInput({
        questionLinks: [
          { questionId: 'q1', relationId: 'r1' },
          { questionId: 'q1', relationId: 'r2' },
        ],
      }),
      'invalid_input',
    ],
    [
      'relationId répété',
      reportedFactInput({
        questionLinks: [
          { questionId: 'q1', relationId: 'r1' },
          { questionId: 'q2', relationId: 'r1' },
        ],
      }),
      'invalid_input',
    ],
    [
      'relationId manquant',
      reportedFactInput({ questionLinks: [{ questionId: 'q1' } as never] }),
      'invalid_input',
    ],
    [
      'clé inconnue (état stocké)',
      { ...reportedFactInput(), epistemicState: 'established' },
      'invalid_input',
    ],
    [
      'clé inconnue (provenance)',
      { ...reportedFactInput(), provenance: { origin: 'llm' } },
      'invalid_input',
    ],
    ['entrée nulle', null, 'invalid_input'],
    [
      'question inconnue',
      reportedFactInput({ questionLinks: [{ questionId: 'q-inconnue', relationId: 'r1' }] }),
      'unknown_question',
    ],
  ];

  it.each(invalidInputs)('refuse : %s', (_label, input, reason) => {
    const before = deepFreeze(base());
    const snap = snapshot(before);
    expect(reasonOf(() => recordReportedFact(before, input as never, options()))).toBe(reason);
    expect(snapshot(before)).toBe(snap);
  });

  it('refuse un identifiant déjà présent : fait, pièce ou relation (aucun remplacement)', () => {
    const first = recordReportedFact(base(), reportedFactInput(), options(T1)).legalCase;
    const snap = snapshot(first);
    const second = (overrides: Parameters<typeof reportedFactInput>[0]): unknown =>
      recordReportedFact(
        first,
        reportedFactInput({
          factId: 'f2',
          evidenceId: 'e2',
          questionLinks: [{ questionId: 'q1', relationId: 'r2' }],
          ...overrides,
        }),
        options(T2),
      );
    expect(reasonOf(() => second({ factId: 'f1' }))).toBe('duplicate_id');
    expect(reasonOf(() => second({ evidenceId: 'e1' }))).toBe('duplicate_id');
    expect(
      reasonOf(() => second({ questionLinks: [{ questionId: 'q1', relationId: 'r1' }] })),
    ).toBe('duplicate_id');
    expect(snapshot(first)).toBe(snap);
  });

  it('refuse un contexte ou une horloge invalides', () => {
    expect(
      reasonOf(() =>
        recordReportedFact(base(), reportedFactInput(), {
          context: { actorId: '', interactionId: 'i-1' },
          now: fixedClock(T1),
        }),
      ),
    ).toBe('invalid_context');
    expect(
      reasonOf(() =>
        recordReportedFact(base(), reportedFactInput(), { context: CONTEXT, now: () => 'demain' }),
      ),
    ).toBe('invalid_clock');
    expect(
      reasonOf(() => recordReportedFact(base(), reportedFactInput(), undefined as never)),
    ).toBe('invalid_context');
  });

  it('refuse un dossier invalide ou dont updatedAt est invérifiable', () => {
    expect(
      reasonOf(() => recordReportedFact({ ...base(), title: '' }, reportedFactInput(), options())),
    ).toBe('invalid_case');
    expect(
      reasonOf(() =>
        recordReportedFact({ ...base(), updatedAt: 'garbage' }, reportedFactInput(), options()),
      ),
    ).toBe('chronology');
  });

  it('chronologie (D6) : refuse un instant antérieur à updatedAt', () => {
    expect(
      reasonOf(() =>
        recordReportedFact(base(), reportedFactInput(), options('2026-09-26T09:59:59Z')),
      ),
    ).toBe('chronology');
  });

  it('chronologie (D6) : refuse un instant antérieur à un objet déjà enregistré', () => {
    const first = recordReportedFact(base(), reportedFactInput(), options(T2)).legalCase;
    // updatedAt corrigé « en arrière » : seul l'objet enregistré révèle l'incohérence.
    const rewound = { ...first, updatedAt: T0 };
    expect(validateLegalCaseV3(rewound)).toEqual({ ok: true });
    expect(
      reasonOf(() =>
        recordReportedFact(
          rewound,
          reportedFactInput({
            factId: 'f2',
            evidenceId: 'e2',
            questionLinks: [{ questionId: 'q1', relationId: 'r2' }],
          }),
          options(T1),
        ),
      ),
    ).toBe('chronology');
  });

  it('les messages d’erreur ne contiennent jamais le contenu du fait ni de la pièce', () => {
    const secret = 'CONTENU-CONFIDENTIEL-XYZ';
    const attempts: readonly (() => unknown)[] = [
      () =>
        recordReportedFact(
          base(),
          reportedFactInput({
            statement: secret,
            evidenceDescription: secret,
            temporal: { kind: 'point', precision: 'day', value: '2026-02-30' },
          }),
          options(),
        ),
      () =>
        recordReportedFact(
          base(),
          reportedFactInput({
            statement: secret,
            evidenceDescription: secret,
            questionLinks: [{ questionId: 'inconnue', relationId: 'r1' }],
          }),
          options(),
        ),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });
});

describe('recordReportedFact — indépendance vis-à-vis de l’entrée (aliasing de la température)', () => {
  const forms: readonly (readonly [string, LegalFactTemporal])[] = [
    ['point (jour)', { kind: 'point', precision: 'day', value: '2026-03-03' }],
    ['point (mois)', { kind: 'point', precision: 'month', value: '2026-03' }],
    ['point (année)', { kind: 'point', precision: 'year', value: '2026' }],
    [
      'intervalle',
      {
        kind: 'interval',
        start: { precision: 'month', value: '2025-03' },
        end: { precision: 'day', value: '2025-06-30' },
      },
    ],
    ['inconnu', { kind: 'unknown' }],
  ];

  it.each(forms)(
    '%s : muter input.temporal après l’appel ne change pas le fait',
    (_label, form) => {
      const temporal = structuredClone(form) as unknown as Record<string, unknown>;
      const input = reportedFactInput({ temporal: temporal as never });
      const result = recordReportedFact(base(), input, options());

      expect(result.fact.temporal).toEqual(form);
      expect(result.fact.temporal).not.toBe(temporal);

      // Mutation de tous les champs de l'objet d'entrée, y compris les bornes imbriquées.
      temporal.kind = 'point';
      temporal.precision = 'year';
      temporal.value = 'PAS-UNE-DATE';
      for (const key of ['start', 'end'] as const) {
        const bound = temporal[key] as Record<string, unknown> | undefined;
        if (bound !== undefined) bound.value = 'PAS-UNE-DATE';
      }

      expect(result.fact.temporal).toEqual(form);
      expect(result.legalCase.facts[0]!.temporal).toEqual(form);
      expect(validateLegalCaseV3(result.legalCase)).toEqual({ ok: true });
    },
  );

  it('la copie conserve exactement la précision (jamais convertie ni normalisée)', () => {
    for (const [, form] of forms) {
      const result = recordReportedFact(
        base(),
        reportedFactInput({ temporal: structuredClone(form) }),
        options(),
      );
      expect(JSON.stringify(result.fact.temporal)).toBe(JSON.stringify(form));
    }
  });

  it('accepte une entrée gelée en profondeur (la copie n’est pas gelée, l’entrée reste intacte)', () => {
    const temporal = deepFreeze({ kind: 'point', precision: 'day', value: '2026-03-03' } as const);
    const result = recordReportedFact(base(), reportedFactInput({ temporal }), options());
    expect(result.fact.temporal).toEqual(temporal);
    expect(result.fact.temporal).not.toBe(temporal);
    expect(temporal.value).toBe('2026-03-03');
  });

  it('la température validée est lue une seule fois (un getter ne peut pas changer de valeur)', () => {
    let reads = 0;
    const evil = { ...reportedFactInput() };
    Object.defineProperty(evil, 'temporal', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1
          ? { kind: 'unknown' }
          : { kind: 'point', precision: 'day', value: '2026-03-03' };
      },
    });
    const result = recordReportedFact(base(), evil, options());
    expect(reads).toBe(1);
    expect(result.fact.temporal).toEqual({ kind: 'unknown' });
  });
});

describe('recordReportedFact — statut du dossier (décision I5-b : aucune restriction imposée)', () => {
  it.each(LEGAL_CASE_STATUSES)('enregistre un fait quand le dossier est à l’étape %s', (status) => {
    const legalCase = { ...base(), status };
    const result = recordReportedFact(legalCase, reportedFactInput(), options());
    expect(result.legalCase.status).toBe(status);
    expect(result.derivations).toEqual([{ questionId: 'q1', state: 'alleged', rule: 'R6' }]);
    expect(validateLegalCaseV3(result.legalCase)).toEqual({ ok: true });
  });
});
