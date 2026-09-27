import { describe, expect, it } from 'vitest';

import { createLegalCase } from './legal-case-factory.js';
import type { LegalCase, LegalCitation, LegalResearchItem, LegalSource } from './legal-case.js';
import { attachResearchItems } from './legal-case-research-items.js';
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

function caseWithCitation(): LegalCase {
  return {
    ...createLegalCase({ title: 'Dossier', id: 'case-1', createdAt: '2026-09-24T00:00:00.000Z' }),
    questions: [{ id: 'q-1', question: 'Quel préavis ?', status: 'open' }],
    sources: [source()],
    citations: [citation()],
  };
}

function item(overrides: Partial<LegalResearchItem> = {}): LegalResearchItem {
  return {
    id: 'ri-1',
    topic: 'Préavis en CDD',
    summary: '1 citation éligible : LEGIARTI000033020376 (version 2.0).',
    citationIds: ['cit-1'],
    questionId: 'q-1',
    ...overrides,
  };
}

describe('attachResearchItems', () => {
  it('rattache un item valide, dossier revalidé, autres champs préservés', () => {
    const before = caseWithCitation();
    const after = attachResearchItems(before, [item()]);

    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(after.research).toEqual([item()]);
    expect(after.status).toBe(before.status);
    expect(after.sources).toBe(before.sources);
    expect(after.citations).toBe(before.citations);
    expect(after.questions).toBe(before.questions);
  });

  it('rattacher deux fois exactement le même item est idempotent', () => {
    const before = caseWithCitation();
    const once = attachResearchItems(before, [item()]);
    const twice = attachResearchItems(once, [item()]);

    expect(twice.research).toEqual([item()]);
    expect(twice).toBe(once); // même objet : rien à ajouter, aucune nouvelle valeur construite.
  });

  it('une collision d’id avec un contenu différent est rejetée, dossier inchangé côté appelant', () => {
    const before = attachResearchItems(caseWithCitation(), [item()]);
    expect(() => attachResearchItems(before, [item({ topic: 'Sujet différent' })])).toThrow(
      /existe déjà avec un contenu différent/,
    );
  });

  it('une citation référencée absente du dossier est rejetée', () => {
    const before = caseWithCitation();
    expect(() => attachResearchItems(before, [item({ citationIds: ['cit-inexistante'] })])).toThrow(
      /référence la citation « cit-inexistante », absente du dossier/,
    );
  });

  it('un questionId absent du dossier est rejeté', () => {
    const before = caseWithCitation();
    expect(() => attachResearchItems(before, [item({ questionId: 'q-inexistante' })])).toThrow(
      /référence la question « q-inexistante », absente du dossier/,
    );
  });

  it('un item sans questionId (rétrocompatibilité) est accepté', () => {
    const before = caseWithCitation();
    const withoutQuestionId = item({ id: 'ri-2', questionId: undefined });
    const after = attachResearchItems(before, [withoutQuestionId]);
    expect(validateLegalCaseV3(after)).toEqual({ ok: true });
    expect(after.research).toEqual([withoutQuestionId]);
  });

  it('ne mute ni le dossier ni l’item d’entrée (objets gelés en profondeur acceptés)', () => {
    const deepFreeze = <T>(v: T): T => {
      if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
        Object.freeze(v);
        Object.values(v).forEach(deepFreeze);
      }
      return v;
    };
    const before = deepFreeze(caseWithCitation());
    const input = deepFreeze(item());

    expect(() => attachResearchItems(before, [input])).not.toThrow();
    expect(before.research).toEqual([]);
  });

  it('rattacher plusieurs items en un seul appel : tous ajoutés, ordre conservé', () => {
    const before = caseWithCitation();
    const second = item({ id: 'ri-2', citationIds: [] });
    const after = attachResearchItems(before, [item(), second]);
    expect(after.research).toEqual([item(), second]);
  });

  it('aucun ajout → renvoie le même objet dossier (pas de nouvelle valeur construite)', () => {
    const before = caseWithCitation();
    const after = attachResearchItems(before, []);
    expect(after).toBe(before);
  });
});
