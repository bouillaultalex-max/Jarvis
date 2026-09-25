import { describe, expect, it } from 'vitest';

import type { LegalCase } from './legal-case.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';

/**
 * Tests dédiés à la chaîne d'audit fermée par LEGAL-02A :
 *
 *   Conclusion → Argument → Analysis → Citation → Source
 *
 * (revue d'architecture LEGAL-01 §5). Chaque test isole **un seul** maillon
 * cassé de cette chaîne, plutôt que de mélanger ces cas avec les tests
 * généraux de `legal-case-validation.test.ts`. (Chaîne inchangée par LegalCase v3 :
 * validée ici sur le validateur v3.)
 */
function buildChainedLegalCase(): LegalCase {
  return {
    id: 'case-audit-1',
    title: 'Chaîne d’audit complète',
    jurisdiction: 'FR',
    status: 'VERIFY',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    facts: [],
    documents: [],
    evidence: [],
    questions: [],
    relations: [],
    factValidations: [],
    conflicts: [],
    resolutionProposals: [],
    ruleExecutions: [],
    resolutions: [],
    sources: [
      {
        id: 'src-1',
        sourceType: 'legislative_text',
        authority: 'legifrance',
        title: 'Code civil — Article 1103',
        identifier: 'LEGIARTI000006436298',
        publicationDate: '2016-02-11T00:00:00.000Z',
        effectiveFrom: '2016-10-01T00:00:00.000Z',
        consultedAt: '2026-01-01T00:00:00.000Z',
        version: '2016-10-01',
        reliability: 'primary_institutional',
      },
    ],
    citations: [
      {
        id: 'cit-1',
        sourceId: 'src-1',
        sourceVersion: '2016-10-01',
        consultedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    research: [],
    arguments: [{ id: 'arg-1', statement: 'Le contrat lie les parties.', citationIds: ['cit-1'] }],
    counterArguments: [],
    analysis: [
      {
        id: 'an-1',
        note: 'Analyse fondée sur la force obligatoire du contrat.',
        createdAt: '2026-01-01T00:00:00.000Z',
        argumentIds: ['arg-1'],
        citationIds: ['cit-1'],
      },
    ],
    conclusions: [
      {
        id: 'con-1',
        statement: 'Le contrat est valablement formé.',
        confidence: 'certain',
        argumentIds: ['arg-1'],
        analysisIds: ['an-1'],
        citationIds: ['cit-1'],
      },
    ],
    deadlines: [],
    actions: [],
  };
}

describe('chaîne d’audit Conclusion → Argument → Analysis → Citation → Source', () => {
  it('valid chain : la chaîne complète est acceptée', () => {
    expect(validateLegalCaseV3(buildChainedLegalCase())).toEqual({ ok: true });
  });

  it('missing source : une citation vers une source absente est rejetée', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = { ...legalCase, sources: [] };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/source inconnue/);
    }
  });

  it('missing citation : un argument citant une citation absente est rejeté', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = { ...legalCase, citations: [] };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/citation inconnu/);
    }
  });

  it('missing argument : une analyse référençant un argument absent est rejetée', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = { ...legalCase, arguments: [] };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/argument inconnu/);
    }
  });

  it('missing analysis : une conclusion référençant une analyse absente est rejetée', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = { ...legalCase, analysis: [] };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/analysis inconnu/);
    }
  });

  it('invalid conclusion : une conclusion sans aucune citation est rejetée même si arguments/analyses existent', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = {
      ...legalCase,
      conclusions: [
        {
          id: 'con-2',
          statement: 'Conclusion non citée.',
          confidence: 'uncertain',
          argumentIds: ['arg-1'],
          analysisIds: ['an-1'],
          citationIds: [],
        },
      ],
    };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/citationIds/);
    }
  });

  it('conclusion référençant un argument absent est rejetée', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = {
      ...legalCase,
      conclusions: [
        {
          id: 'con-3',
          statement: 'Conclusion mal reliée.',
          confidence: 'certain',
          argumentIds: ['arg-does-not-exist'],
          analysisIds: ['an-1'],
          citationIds: ['cit-1'],
        },
      ],
    };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/argument inconnu/);
    }
  });

  it('id dupliqué parmi les sources est rejeté (ambiguïté de citation)', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = {
      ...legalCase,
      sources: [...legalCase.sources, { ...legalCase.sources[0]!, version: '2020-01-01' }],
    };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/id dupliqué/);
    }
  });

  it('id dupliqué parmi les citations est rejeté', () => {
    const legalCase = buildChainedLegalCase();
    const broken: LegalCase = {
      ...legalCase,
      citations: [...legalCase.citations, { ...legalCase.citations[0]! }],
    };

    const result = validateLegalCaseV3(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/id dupliqué/);
    }
  });
});
