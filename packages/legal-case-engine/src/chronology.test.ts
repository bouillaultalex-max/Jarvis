import { validateLegalCaseV3 } from '@jarvis/legal-core';
import { describe, expect, it } from 'vitest';

import { addOpenQuestion } from './add-open-question.js';
import { LegalCaseEngineError } from './errors.js';
import { recordReportedFact } from './record-reported-fact.js';
import {
  STAMPED_LISTS,
  stampedCase,
  stamps,
  type StampedList,
  type Stamps,
} from './testing/chronology-fixtures.js';
import { T0, options, reportedFactInput } from './testing/engine-fixtures.js';

/**
 * Contrôle chronologique de D6 : l'instant d'une écriture ne peut précéder **aucun** objet déjà
 * enregistré. Chaque test donne un instant **distinct** à chaque liste : un contrôle qui ignore
 * une liste, qui retient le plus ancien au lieu du plus tardif, ou qui omet la liste la plus
 * récente, fait échouer au moins un test (vérifié par mutation).
 */
const LATE = '2026-09-26T15:00:00.000Z';
const BEFORE_LATE = '2026-09-26T14:59:59.999Z';
const MIDDAY = '2026-09-26T11:00:00.000Z';

function chronologyDetail(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof LegalCaseEngineError && error.reason === 'chronology') return error.detail;
    throw error;
  }
  return undefined;
}

const OBJECT_MESSAGE = /objet déjà enregistré/;

describe('chronologie — le plus tardif de toutes les listes append-only', () => {
  it('les fixtures couvrent exactement les neuf listes append-only et restent valides', () => {
    expect(STAMPED_LISTS).toHaveLength(9);
    const legalCase = stampedCase(stamps(T0));
    for (const list of STAMPED_LISTS) expect(legalCase[list].length, list).toBeGreaterThan(0);
    expect(validateLegalCaseV3(legalCase)).toEqual({ ok: true });
  });

  it('témoin : tous les objets à T0 et updatedAt à T0 — une écriture à midi est acceptée', () => {
    const next = addOpenQuestion(
      stampedCase(stamps(T0)),
      { id: 'q9', question: 'Q ?' },
      options(MIDDAY),
    );
    expect(next.updatedAt).toBe(MIDDAY);
  });

  it.each(STAMPED_LISTS)(
    '%s : un seul objet tardif (toutes les autres listes plus anciennes) bloque une écriture antérieure',
    (list: StampedList) => {
      const legalCase = stampedCase(stamps(T0, { [list]: LATE }));
      expect(
        chronologyDetail(() =>
          addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(MIDDAY)),
        ),
      ).toMatch(OBJECT_MESSAGE);
      // 1 ms avant l'objet tardif : encore refusé ; à l'instant exact et après : accepté.
      expect(
        chronologyDetail(() =>
          addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(BEFORE_LATE)),
        ),
      ).toMatch(OBJECT_MESSAGE);
      expect(
        addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(LATE)).updatedAt,
      ).toBe(LATE);
      expect(
        addOpenQuestion(
          legalCase,
          { id: 'q9', question: 'Q ?' },
          options('2026-09-26T15:00:00.001Z'),
        ).updatedAt,
      ).toBe('2026-09-26T15:00:00.001Z');
    },
  );

  it.each(STAMPED_LISTS)(
    '%s : même contrôle pour recordReportedFact (l’enregistrement d’un fait ne contourne rien)',
    (list: StampedList) => {
      const legalCase = stampedCase(stamps(T0, { [list]: LATE }));
      const input = reportedFactInput({ factId: 'f-new', evidenceId: 'e-new' });
      expect(chronologyDetail(() => recordReportedFact(legalCase, input, options(MIDDAY)))).toMatch(
        OBJECT_MESSAGE,
      );
      expect(recordReportedFact(legalCase, input, options(LATE)).legalCase.updatedAt).toBe(LATE);
    },
  );

  const ascending: Stamps = {
    facts: '2026-09-26T10:01:00.000Z',
    documents: '2026-09-26T10:02:00.000Z',
    evidence: '2026-09-26T10:03:00.000Z',
    relations: '2026-09-26T10:04:00.000Z',
    factValidations: '2026-09-26T10:05:00.000Z',
    conflicts: '2026-09-26T10:06:00.000Z',
    resolutionProposals: '2026-09-26T10:07:00.000Z',
    ruleExecutions: '2026-09-26T10:08:00.000Z',
    resolutions: '2026-09-26T10:09:00.000Z',
  };

  /** Même instants, répartis dans un autre ordre : le plus tardif n'est plus dans la même liste. */
  function rotated(by: number): Stamps {
    const values = STAMPED_LISTS.map((list) => ascending[list]);
    return Object.fromEntries(
      STAMPED_LISTS.map((list, index) => [list, values[(index + by) % values.length]!]),
    ) as unknown as Stamps;
  }

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    'instants tous distincts (rotation %i) : le plus tardif est retenu, où qu’il soit',
    (rotation) => {
      const legalCase = stampedCase(rotated(rotation));
      const write = (at: string): unknown =>
        addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(at));
      // Le plus tardif vaut 10:09 : 1 ms avant → refusé ; à 10:09 → accepté.
      expect(chronologyDetail(() => write('2026-09-26T10:08:59.999Z'))).toMatch(OBJECT_MESSAGE);
      // Un instant qui dépasse seulement l'avant-dernier objet reste refusé.
      expect(chronologyDetail(() => write('2026-09-26T10:08:30.000Z'))).toMatch(OBJECT_MESSAGE);
      expect(write('2026-09-26T10:09:00.000Z')).toBeDefined();
    },
  );

  it('instants exprimés avec des décalages différents : comparés comme des instants', () => {
    // 17:00+02:00 = 15:00Z, porté par la liste des résolutions.
    const legalCase = stampedCase(stamps(T0, { resolutions: '2026-09-26T17:00:00.000+02:00' }));
    const write = (at: string): unknown =>
      addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(at));
    expect(chronologyDetail(() => write('2026-09-26T14:59:59.999Z'))).toMatch(OBJECT_MESSAGE);
    expect(chronologyDetail(() => write('2026-09-26T16:59:59.999+02:00'))).toMatch(OBJECT_MESSAGE);
    expect(write('2026-09-26T15:00:00.000Z')).toBeDefined();
    expect(write('2026-09-26T17:00:01.000+02:00')).toBeDefined();
  });

  it('un objet tardif dans une liste et un autre, encore plus tardif, dans une autre : le plus tardif gagne', () => {
    const legalCase = stampedCase(
      stamps(T0, {
        evidence: '2026-09-26T13:00:00.000Z',
        factValidations: '2026-09-26T16:00:00.000Z',
      }),
    );
    expect(
      chronologyDetail(() =>
        addOpenQuestion(
          legalCase,
          { id: 'q9', question: 'Q ?' },
          options('2026-09-26T15:59:59.999Z'),
        ),
      ),
    ).toMatch(OBJECT_MESSAGE);
    expect(
      addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options('2026-09-26T16:00:00.000Z'))
        .updatedAt,
    ).toBe('2026-09-26T16:00:00.000Z');
  });

  it('un refus ne modifie rien : le dossier reste identique', () => {
    const legalCase = stampedCase(stamps(T0, { conflicts: LATE }));
    const before = JSON.stringify(legalCase);
    expect(() =>
      addOpenQuestion(legalCase, { id: 'q9', question: 'Q ?' }, options(MIDDAY)),
    ).toThrow(LegalCaseEngineError);
    expect(JSON.stringify(legalCase)).toBe(before);
  });
});
