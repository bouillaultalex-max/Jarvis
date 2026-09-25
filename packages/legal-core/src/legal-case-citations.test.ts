import { describe, expect, it } from 'vitest';

import { attachSourcesAndCitations } from './legal-case-citations.js';
import { createLegalCase } from './legal-case-factory.js';
import type { LegalCase, LegalCitation, LegalSource } from './legal-case.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';

const HASH = 'a'.repeat(64);

function source(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
    id: 'LEGIARTI000033020376',
    sourceType: 'code_article',
    authority: 'legifrance',
    title: 'L3121-27',
    identifier: 'LEGIARTI000006902466',
    effectiveFrom: '2016-08-10T00:00:00.000Z',
    consultedAt: '2026-09-23T18:00:00.000Z',
    version: '2.0',
    contentHash: HASH,
    reliability: 'primary_institutional',
    ...overrides,
  };
}

function citation(overrides: Partial<LegalCitation> = {}): LegalCitation {
  return {
    id: 'cit-1',
    sourceId: 'LEGIARTI000033020376',
    sourceVersion: '2.0',
    contentHash: HASH,
    consultedAt: '2026-09-23T18:00:00.000Z',
    eligibility: {
      questionId: 'q-1',
      asOf: '2020-01-01',
      resolution: 'resolved',
      historyCompleteness: 'unknown',
    },
    ...overrides,
  };
}

function caseWithQuestion(): LegalCase {
  return {
    ...createLegalCase({ title: 'Dossier', id: 'case-1', createdAt: '2026-09-24T00:00:00.000Z' }),
    questions: [{ id: 'q-1', question: 'Quel préavis ?', status: 'open' }],
  };
}

const INPUT = { sources: [source()], citations: [citation()] };

describe('attachSourcesAndCitations', () => {
  it('ajoute sources et citations, le dossier reste valide, statut et autres collections inchangés', () => {
    const before = caseWithQuestion();
    const after = attachSourcesAndCitations(before, INPUT);

    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(after.sources).toEqual([source()]);
    expect(after.citations).toEqual([citation()]);
    expect(after.status).toBe('READ');
    expect(after.research).toEqual([]);
    expect(after.questions).toBe(before.questions);
  });

  it('ne mute ni le dossier ni l’entrée (objets gelés en profondeur acceptés)', () => {
    const deepFreeze = <T>(v: T): T => {
      if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
        Object.freeze(v);
        Object.values(v).forEach(deepFreeze);
      }
      return v;
    };
    const before = deepFreeze(caseWithQuestion());
    const input = deepFreeze({ sources: [source()], citations: [citation()] });
    const snapshot = JSON.stringify({ before, input });

    const after = attachSourcesAndCitations(before, input);

    expect(JSON.stringify({ before, input })).toBe(snapshot);
    expect(after).not.toBe(before);
    expect(before.sources).toEqual([]);
  });

  it('idempotent : rejouer le même rattachement rend exactement le même dossier (même objet)', () => {
    const once = attachSourcesAndCitations(caseWithQuestion(), INPUT);
    expect(attachSourcesAndCitations(once, INPUT)).toBe(once);
  });

  it('même version relue plus tard (autre id technique, autre consultedAt) : source et citation non dupliquées, première consultation conservée', () => {
    const once = attachSourcesAndCitations(caseWithQuestion(), INPUT);
    const later = {
      sources: [source({ id: 'LEGIARTI000033020399', consultedAt: '2026-09-30T08:00:00.000Z' })],
      citations: [
        citation({ sourceId: 'LEGIARTI000033020399', consultedAt: '2026-09-30T08:00:00.000Z' }),
      ],
    };

    const twice = attachSourcesAndCitations(once, later);

    expect(twice).toBe(once);
    expect(twice.sources).toHaveLength(1);
    expect(twice.citations[0]!.consultedAt).toBe('2026-09-23T18:00:00.000Z');
  });

  it('source déjà présente sous une autre id : les citations entrantes sont redirigées vers elle', () => {
    const existing = attachSourcesAndCitations(caseWithQuestion(), {
      sources: [source({ id: 'LEGIARTI000033020399' })],
      citations: [],
    });

    const after = attachSourcesAndCitations(existing, INPUT);

    expect(after.sources).toHaveLength(1);
    expect(after.citations[0]!.sourceId).toBe('LEGIARTI000033020399');
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
  });

  it('deux questions, même version : une source, deux citations (affirmations distinctes)', () => {
    const base: LegalCase = {
      ...caseWithQuestion(),
      questions: [
        { id: 'q-1', question: 'Q1 ?', status: 'open' },
        { id: 'q-2', question: 'Q2 ?', status: 'open' },
      ],
    };
    const first = attachSourcesAndCitations(base, INPUT);
    const second = attachSourcesAndCitations(first, {
      sources: [source()],
      citations: [
        citation({ id: 'cit-2', eligibility: { ...citation().eligibility!, questionId: 'q-2' } }),
      ],
    });

    expect(second.sources).toHaveLength(1);
    expect(second.citations.map((c) => c.eligibility?.questionId)).toEqual(['q-1', 'q-2']);
  });

  it('updatedAt : modifié seulement si quelque chose est ajouté', () => {
    const added = attachSourcesAndCitations(caseWithQuestion(), INPUT, {
      updatedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(added.updatedAt).toBe('2026-09-25T00:00:00.000Z');
    expect(
      attachSourcesAndCitations(added, INPUT, { updatedAt: '2030-01-01T00:00:00.000Z' }).updatedAt,
    ).toBe('2026-09-25T00:00:00.000Z');
    expect(attachSourcesAndCitations(caseWithQuestion(), INPUT).updatedAt).toBe(
      '2026-09-24T00:00:00.000Z',
    );
  });

  it('refuse une citation dont la question est absente du dossier (invariant non contourné)', () => {
    const bad = {
      sources: [source()],
      citations: [
        citation({ eligibility: { ...citation().eligibility!, questionId: 'q-absente' } }),
      ],
    };
    expect(() => attachSourcesAndCitations(caseWithQuestion(), bad)).toThrow(/question inconnue/);
  });

  it('refuse une citation dont la source est absente de l’entrée', () => {
    expect(() =>
      attachSourcesAndCitations(caseWithQuestion(), { sources: [], citations: [citation()] }),
    ).toThrow(/absente de l'entrée/);
  });

  it('refuse deux empreintes de contenu différentes pour une même identité logique', () => {
    const once = attachSourcesAndCitations(caseWithQuestion(), INPUT);
    const conflicting = { sources: [source({ contentHash: 'b'.repeat(64) })], citations: [] };
    expect(() => attachSourcesAndCitations(once, conflicting)).toThrow(/contenu différent/);
  });

  it('refuse une citation de même id mais d’affirmation différente (asOf différent)', () => {
    const once = attachSourcesAndCitations(caseWithQuestion(), INPUT);
    const other = {
      sources: [source()],
      citations: [citation({ eligibility: { ...citation().eligibility!, asOf: '2021-01-01' } })],
    };
    expect(() => attachSourcesAndCitations(once, other)).toThrow(
      /existe déjà avec un contenu différent/,
    );
  });

  it('refuse un id de source déjà utilisé par une autre identité logique (dossier invalide)', () => {
    const once = attachSourcesAndCitations(caseWithQuestion(), INPUT);
    const clash = {
      sources: [source({ version: '3.0', effectiveFrom: '2030-01-01T00:00:00.000Z' })],
      citations: [],
    };
    expect(() => attachSourcesAndCitations(once, clash)).toThrow(/dossier invalide/);
  });
});
