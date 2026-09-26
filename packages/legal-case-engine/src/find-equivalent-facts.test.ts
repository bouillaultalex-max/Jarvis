import { validateLegalCaseV3, type LegalCase, type LegalFactTemporal } from '@jarvis/legal-core';
import { describe, expect, it } from 'vitest';

import { LegalCaseEngineError } from './errors.js';
import {
  EQUIVALENCE_CRITERION,
  findEquivalentFacts,
  normalizeStatement,
} from './find-equivalent-facts.js';
import { recordReportedFact } from './record-reported-fact.js';
import {
  T1,
  T2,
  caseWithQuestions,
  deepFreeze,
  options,
  question,
  reportedFactInput,
  snapshot,
} from './testing/engine-fixtures.js';

const DAY = { kind: 'point', precision: 'day', value: '2026-03-03' } as const;

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof LegalCaseEngineError ? error.reason : `autre : ${String(error)}`;
  }
  return undefined;
}

/** Dossier avec un fait `f1` (« Le salarié a été absent le 3 mars. », 2026-03-03) lié à `q1`. */
function caseWithFact(overrides: Parameters<typeof reportedFactInput>[0] = {}): LegalCase {
  return recordReportedFact(
    caseWithQuestions(question('q1'), question('q2')),
    reportedFactInput(overrides),
    options(T1),
  ).legalCase;
}

describe('findEquivalentFacts', () => {
  it('signale l’absence d’équivalent, sans prétendre à une preuve d’absence', () => {
    const result = findEquivalentFacts(caseWithFact(), {
      statement: 'Le contrat a été signé le 1er janvier.',
      temporal: DAY,
    });
    expect(result).toEqual({
      criterion: EQUIVALENCE_CRITERION,
      status: 'none_found',
      equivalents: [],
    });
  });

  it('dossier sans fait : aucun équivalent', () => {
    expect(
      findEquivalentFacts(caseWithQuestions(), { statement: 'Un fait.', temporal: DAY }).status,
    ).toBe('none_found');
  });

  it('détecte un énoncé identique à la même date', () => {
    const result = findEquivalentFacts(caseWithFact(), {
      statement: 'Le salarié a été absent le 3 mars.',
      temporal: DAY,
      questionIds: ['q1'],
    });
    expect(result.status).toBe('potential_equivalents');
    expect(result.equivalents).toEqual([
      {
        factId: 'f1',
        statementMatch: 'identical',
        temporalMatch: 'identical',
        sharedQuestionIds: ['q1'],
        corrected: false,
      },
    ]);
  });

  it('détecte un énoncé identique après normalisation minimale (casse, espaces, NFC)', () => {
    const variants = [
      '  le salarié   a été absent le 3 mars.  ',
      'LE SALARIÉ A ÉTÉ ABSENT LE 3 MARS.',
      'Le salarié a\nété absent le 3 mars.',
      'Le salarié a été absent le 3 mars.', // « é » décomposé (NFD)
    ];
    for (const statement of variants) {
      const result = findEquivalentFacts(caseWithFact(), { statement, temporal: DAY });
      expect(result.equivalents[0]?.statementMatch, JSON.stringify(statement)).toBeDefined();
      expect(result.status).toBe('potential_equivalents');
    }
    const normalized = findEquivalentFacts(caseWithFact(), {
      statement: 'LE SALARIÉ A ÉTÉ ABSENT LE 3 MARS.',
      temporal: DAY,
    });
    expect(normalized.equivalents[0]!.statementMatch).toBe('normalized');
  });

  it('ne rapproche PAS des formulations différentes (accents, ponctuation, mots, synonymes)', () => {
    const different = [
      'Le salarie a été absent le 3 mars.', // accent
      'Le salarié a été absent le 3 mars', // ponctuation
      'Le salarié a été absent, le 3 mars.',
      'Le salarié était absent le 3 mars.', // autre formulation
      "L'employé a été absent le 3 mars.", // synonyme
      'Le 3 mars, le salarié a été absent.', // ordre des mots
      'Le salarié a été absent le 3 mars. Il est revenu.',
    ];
    for (const statement of different) {
      expect(findEquivalentFacts(caseWithFact(), { statement, temporal: DAY }).status).toBe(
        'none_found',
      );
    }
  });

  it('liste un même énoncé à une autre date, avec temporalMatch « different » (jamais fusionné)', () => {
    const result = findEquivalentFacts(caseWithFact(), {
      statement: 'Le salarié a été absent le 3 mars.',
      temporal: { kind: 'point', precision: 'day', value: '2026-03-04' },
    });
    expect(result.equivalents).toHaveLength(1);
    expect(result.equivalents[0]).toMatchObject({
      statementMatch: 'identical',
      temporalMatch: 'different',
    });
  });

  it('compare les températures structurellement : la précision compte, jamais convertie', () => {
    const month = { kind: 'point', precision: 'month', value: '2026-03' } as const;
    const found = (fact: Parameters<typeof reportedFactInput>[0], candidate: LegalFactTemporal) =>
      findEquivalentFacts(caseWithFact(fact), {
        statement: 'Le salarié a été absent le 3 mars.',
        temporal: candidate,
      }).equivalents[0]!.temporalMatch;
    expect(found({ temporal: month }, month)).toBe('identical');
    expect(
      found({ temporal: month }, { kind: 'point', precision: 'day', value: '2026-03-01' }),
    ).toBe('different');
    expect(found({ temporal: { kind: 'unknown' } }, { kind: 'unknown' })).toBe('identical');
    expect(found({ temporal: { kind: 'unknown' } }, DAY)).toBe('different');
  });

  it('renvoie tous les équivalents dans l’ordre des faits du dossier', () => {
    let legalCase = caseWithFact();
    legalCase = recordReportedFact(
      legalCase,
      reportedFactInput({
        factId: 'f2',
        evidenceId: 'e2',
        statement: 'LE SALARIÉ A ÉTÉ ABSENT LE 3 MARS.',
        questionLinks: [{ questionId: 'q2', relationId: 'r2' }],
      }),
      options(T2),
    ).legalCase;
    const result = findEquivalentFacts(legalCase, {
      statement: 'Le salarié a été absent le 3 mars.',
      temporal: DAY,
      questionIds: ['q2', 'q1', 'q-inconnue'],
    });
    expect(result.equivalents.map((e) => e.factId)).toEqual(['f1', 'f2']);
    expect(result.equivalents.map((e) => e.statementMatch)).toEqual(['identical', 'normalized']);
    expect(result.equivalents[0]!.sharedQuestionIds).toEqual(['q1']);
    expect(result.equivalents[1]!.sharedQuestionIds).toEqual(['q2']);
  });

  it('indique un fait déjà corrigé, sans l’écarter', () => {
    const base = caseWithFact();
    const f1 = base.facts[0]!;
    const corrected: LegalCase = {
      ...base,
      facts: [...base.facts, { ...f1, id: 'f-corr', statement: 'Correction.', recordedAt: T2 }],
      relations: [
        ...base.relations,
        {
          kind: 'fact_correction',
          id: 'k1',
          factId: 'f-corr',
          correctsFactId: 'f1',
          correction: 'corrects',
          provenance: {
            origin: 'human',
            actorId: 'a-1',
            interactionId: 'i-1',
            inputReferences: [],
          },
          recordedAt: T2,
        },
      ],
      updatedAt: T2,
    };
    expect(validateLegalCaseV3(corrected)).toEqual({ ok: true });
    const result = findEquivalentFacts(corrected, { statement: f1.statement, temporal: DAY });
    expect(result.equivalents).toHaveLength(1);
    expect(result.equivalents[0]!.corrected).toBe(true);
  });

  it('sans effet de bord : dossier et candidat gelés, résultat déterministe', () => {
    const legalCase = deepFreeze(caseWithFact());
    const candidate = deepFreeze({
      statement: 'Le salarié a été absent le 3 mars.',
      temporal: { ...DAY },
    });
    const before = snapshot(legalCase);
    const first = findEquivalentFacts(legalCase, candidate);
    const second = findEquivalentFacts(legalCase, candidate);
    expect(snapshot(legalCase)).toBe(before);
    expect(snapshot(first)).toBe(snapshot(second));
    expect(first.equivalents).not.toBe(second.equivalents);
  });

  it('ne fusionne, ne supprime et ne modifie rien : le nombre de faits est inchangé', () => {
    const legalCase = caseWithFact();
    findEquivalentFacts(legalCase, { statement: legalCase.facts[0]!.statement, temporal: DAY });
    expect(legalCase.facts).toHaveLength(1);
    expect(legalCase.relations).toHaveLength(1);
  });

  it.each([
    ['candidat nul', null],
    ['énoncé vide', { statement: '  ', temporal: DAY }],
    ['énoncé absent', { temporal: DAY }],
    ['température absente', { statement: 'X.' }],
    [
      'température invalide',
      { statement: 'X.', temporal: { kind: 'point', precision: 'day', value: '2026-13-01' } },
    ],
    ['questionIds non liste', { statement: 'X.', temporal: DAY, questionIds: 'q1' }],
    ['questionIds avec entrée vide', { statement: 'X.', temporal: DAY, questionIds: [''] }],
    ['clé inconnue', { statement: 'X.', temporal: DAY, id: 'f9' }],
  ])('refuse un candidat invalide : %s', (_label, candidate) => {
    expect(reasonOf(() => findEquivalentFacts(caseWithFact(), candidate as never))).toBe(
      'invalid_input',
    );
  });

  it('refuse un dossier invalide', () => {
    expect(
      reasonOf(() =>
        findEquivalentFacts({ ...caseWithFact(), title: '' }, { statement: 'X.', temporal: DAY }),
      ),
    ).toBe('invalid_case');
  });
});

describe('normalizeStatement', () => {
  it('ne fait que NFC, espaces et minuscules', () => {
    expect(normalizeStatement('  Été   ÉTÉ\n')).toBe('été été');
    expect(normalizeStatement('é')).toBe('é');
    expect(normalizeStatement('a, b.')).toBe('a, b.');
  });
});
