import { describe, expect, it } from 'vitest';

import type { LegalCase } from './legal-case.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';
import {
  documentRef,
  human,
  makeDocument,
  makeFact,
  makeNonDocumentaryEvidence,
} from './testing/legal-v3-fixtures.js';

function buildSampleLegalCase(): LegalCase {
  return {
    id: 'case-1',
    title: 'Rupture de préavis — CDD',
    jurisdiction: 'FR',
    status: 'ANALYZE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    facts: [
      makeFact('fact-1', human([documentRef('doc-1')]), {
        statement: 'Le contrat a été signé le 1er mars 2025.',
      }),
      makeFact('fact-2', human(), { statement: "L'employeur affirme un abandon de poste." }),
      makeFact('fact-3', human(), {
        statement: 'Date exacte de la dernière présence au poste inconnue.',
      }),
    ],
    documents: [makeDocument('doc-1', { title: 'Contrat de travail' })],
    evidence: [
      makeNonDocumentaryEvidence('evi-1', { description: 'Échange d’e-mails avec le service RH' }),
    ],
    questions: [
      { id: 'q-1', question: 'Le préavis contractuel a-t-il été respecté ?', status: 'open' },
    ],
    relations: [
      {
        kind: 'fact_question',
        id: 'rel-1',
        factId: 'fact-1',
        questionId: 'q-1',
        provenance: human(),
        recordedAt: '2026-09-24T10:00:00.000Z',
      },
    ],
    factValidations: [],
    conflicts: [],
    resolutionProposals: [],
    ruleExecutions: [],
    resolutions: [],
    sources: [
      {
        id: 'src-1',
        sourceType: 'code_article',
        authority: 'legifrance',
        title: 'Code du travail — Article L1243-1',
        identifier: 'LEGIARTI000006901247',
        reference: 'Code du travail, art. L1243-1',
        url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901247',
        publicationDate: '2008-05-01T00:00:00.000Z',
        effectiveFrom: '2008-05-01T00:00:00.000Z',
        consultedAt: '2026-01-01T00:00:00.000Z',
        version: '2008-05-01',
        reliability: 'primary_institutional',
      },
    ],
    citations: [
      {
        id: 'cit-1',
        sourceId: 'src-1',
        sourceVersion: '2008-05-01',
        pinpoint: 'al. 1',
        quotedText:
          'Le contrat de travail à durée déterminée, quel que soit son motif, ne peut être rompu avant l’échéance du terme…',
        consultedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    research: [
      {
        id: 'res-1',
        topic: 'Préavis en CDD',
        summary: 'Article L1243-1 et suivants.',
        citationIds: ['cit-1'],
      },
    ],
    arguments: [
      { id: 'arg-1', statement: 'Le préavis contractuel a été respecté.', citationIds: ['cit-1'] },
    ],
    counterArguments: [
      {
        id: 'carg-1',
        statement: 'La rupture anticipée ne relève pas d’un cas légal.',
        citationIds: ['cit-1'],
      },
    ],
    analysis: [
      {
        id: 'an-1',
        note: 'Les faits établis suffisent à documenter la chronologie.',
        createdAt: '2026-01-02T00:00:00.000Z',
        argumentIds: ['arg-1'],
        citationIds: ['cit-1'],
      },
    ],
    conclusions: [
      {
        id: 'con-1',
        statement: 'Le préavis contractuel semble avoir été respecté.',
        confidence: 'likely',
        argumentIds: ['arg-1'],
        analysisIds: ['an-1'],
        citationIds: ['cit-1'],
      },
    ],
    deadlines: [
      {
        id: 'dl-1',
        label: 'Saisine prud’homale',
        dueAt: '2027-01-01T00:00:00.000Z',
        critical: true,
      },
    ],
    actions: [
      {
        id: 'act-1',
        type: 'READ',
        description: 'Lecture du contrat fourni.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'act-2',
        type: 'PREPARE',
        description: 'Rédaction d’une note d’analyse.',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  };
}

describe('validateLegalCaseV3', () => {
  it('accepte une affaire complète et cohérente', () => {
    expect(validateLegalCaseV3(buildSampleLegalCase())).toEqual({ ok: true });
  });

  it('accepte une action EXECUTE portant sa confirmation', () => {
    const legalCase = buildSampleLegalCase();
    const withExecute: LegalCase = {
      ...legalCase,
      actions: [
        ...legalCase.actions,
        {
          id: 'act-3',
          type: 'EXECUTE',
          description: 'Envoi du courrier de mise en demeure.',
          createdAt: '2026-01-03T00:00:00.000Z',
          confirmationId: 'confirm-abc',
          confirmedAt: '2026-01-03T00:05:00.000Z',
        },
      ],
    };

    expect(validateLegalCaseV3(withExecute)).toEqual({ ok: true });
  });

  it.each([null, undefined, 'not-an-object', 42, []])(
    'rejette une valeur racine non-objet (%j)',
    (value) => {
      expect(validateLegalCaseV3(value)).toEqual({ ok: false, error: expect.any(String) });
    },
  );

  it('rejette une juridiction inconnue', () => {
    const legalCase = { ...buildSampleLegalCase(), jurisdiction: 'US' };
    const result = validateLegalCaseV3(legalCase);
    expect(result.ok).toBe(false);
  });

  it('rejette un status hors du workflow à 7 étapes', () => {
    const legalCase = { ...buildSampleLegalCase(), status: 'CLOSED' };
    const result = validateLegalCaseV3(legalCase);
    expect(result.ok).toBe(false);
  });

  it('rejette un title vide', () => {
    const legalCase = { ...buildSampleLegalCase(), title: '' };
    expect(validateLegalCaseV3(legalCase).ok).toBe(false);
  });

  it('rejette une conclusion sans citation (LEGAL_SPECIFICATION §4)', () => {
    const legalCase = buildSampleLegalCase();
    const withUnsourcedConclusion: LegalCase = {
      ...legalCase,
      conclusions: [
        {
          id: 'con-2',
          statement: 'Conclusion non sourcée.',
          confidence: 'uncertain',
          argumentIds: [],
          analysisIds: [],
          citationIds: [],
        },
      ],
    };

    const result = validateLegalCaseV3(withUnsourcedConclusion);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/citationIds/);
    }
  });

  it('rejette un fait sans statement', () => {
    const legalCase = buildSampleLegalCase();
    const withInvalidFact: LegalCase = {
      ...legalCase,
      facts: [...legalCase.facts, makeFact('fact-x', undefined, { statement: '' })],
    };

    expect(validateLegalCaseV3(withInvalidFact).ok).toBe(false);
  });

  it('rejette une question avec un status inconnu', () => {
    const legalCase = { ...buildSampleLegalCase() } as unknown as Record<string, unknown>;
    legalCase.questions = [{ id: 'q-2', question: 'Question mal formée', status: 'closed' }];

    expect(validateLegalCaseV3(legalCase).ok).toBe(false);
  });
});

describe('validateLegalCaseV3 — provenance de citation rattachée à une question (ADR-0020)', () => {
  const withEligibility = (questionId: string): LegalCase => {
    const base = buildSampleLegalCase();
    return {
      ...base,
      citations: [
        {
          ...base.citations[0]!,
          eligibility: {
            questionId,
            asOf: '2020-01-01',
            resolution: 'resolved',
            historyCompleteness: 'unknown',
          },
        },
      ],
    };
  };

  it('accepte une citation dont la question existe dans le dossier (historique unknown conservé)', () => {
    expect(validateLegalCaseV3(withEligibility('q-1'))).toEqual({ ok: true });
  });

  it('rejette une citation dont la question est absente du dossier', () => {
    const result = validateLegalCaseV3(withEligibility('q-inexistante'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/question inconnue/);
  });
});
