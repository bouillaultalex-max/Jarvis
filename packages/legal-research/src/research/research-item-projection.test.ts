import { describe, expect, it } from 'vitest';

import { ResearchProviderError } from './ports.js';
import { projectCitations } from './citation-projection.js';
import { projectResearchItem } from './research-item-projection.js';
import { ResearchEngine, type ResearchEngineOptions } from './research-engine.js';
import type { ResearchBudget, ResearchResult } from './research-types.js';
import type { RetrievalResult } from './retrieval-types.js';
import type { SearchQuery, SearchResultPage } from './search-types.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import { ARTICLE_57_RAW, L3121_27_V2_RAW, QUERY } from './testing/fixtures.js';
import { retrievalOf } from './testing/version-resolver-helpers.js';

/**
 * Projection `ResearchResult` + citations (déjà produites par `projectCitations`,
 * ADR-0020) → `LegalResearchItem` (LEGAL-RESEARCH-ITEM-01). Sans réseau : fakes
 * des ports pour produire un vrai `ResearchResult`, comme
 * `citation-projection.test.ts`.
 */

const WIDE: ResearchBudget = { maxSearchPages: 3, maxCandidates: 50, maxRetrievedSources: 50 };
const QUESTION = { id: 'q-1' };
const withAsOf = (asOf: string): SearchQuery => ({ ...QUERY, asOf });

const R_L3121_V2 = retrievalOf(L3121_27_V2_RAW);
const R_ART57 = retrievalOf(ARTICLE_57_RAW);

interface Setup {
  readonly retrievals: readonly RetrievalResult[];
  readonly query?: SearchQuery;
  readonly options?: Partial<ResearchEngineOptions>;
}

async function research(setup: Setup): Promise<ResearchResult> {
  const page: SearchResultPage = {
    references: setup.retrievals.map((r) => r.reference),
    skipped: [],
    metadata: { page: 1, pageSize: 5, resultCount: setup.retrievals.length },
  };
  const search = new FakeSearchPort({ 1: page });
  const outcomes: Record<string, RetrievalResult | ResearchProviderError> = {};
  for (const r of setup.retrievals) outcomes[r.reference.candidateId] = r;
  const retrieval = new FakeRetrievalPort(outcomes);
  const engine = new ResearchEngine({ search, retrieval, ...setup.options });
  return engine.research(setup.query ?? withAsOf('2020-01-01'), WIDE);
}

describe('projectResearchItem', () => {
  it('1. citations éligibles présentes → item complet', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    const item = projectResearchItem(result, QUESTION, citations);

    expect(item).toBeDefined();
    expect(item!.topic).toBe(result.query.text);
    expect(item!.questionId).toBe('q-1');
    expect(item!.citationIds).toEqual(citations.map((c) => c.id));
    expect(item!.summary).toContain('1 citation(s) éligible(s)');
    expect(item!.summary).toContain(R_L3121_V2.source.id);
    expect(item!.summary).toContain(R_L3121_V2.source.version);
  });

  it('2. aucune citation éligible (indeterminate) → undefined, jamais citationIds: []', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2007-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    expect(citations).toEqual([]);
    expect(projectResearchItem(result, QUESTION, citations)).toBeUndefined();
  });

  it('3. rejouer la même entrée produit exactement le même id', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    const first = projectResearchItem(result, QUESTION, citations);
    const second = projectResearchItem(result, QUESTION, citations);

    expect(first!.id).toBe(second!.id);
    expect(first).toEqual(second);
  });

  it('4. deux questions différentes sur le même résultat → ids différents', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    const forQ1 = projectResearchItem(result, { id: 'q-1' }, citations);
    const forQ2 = projectResearchItem(result, { id: 'q-2' }, citations);

    expect(forQ1!.id).not.toBe(forQ2!.id);
  });

  it('5. ordre des citations modifié → id et citationIds identiques (tri canonique)', async () => {
    const result = await research({
      retrievals: [R_L3121_V2, R_ART57],
      query: withAsOf('2020-01-01'),
    });
    const { citations } = projectCitations(result, QUESTION);
    expect(citations.length).toBeGreaterThan(1);

    const inOrder = projectResearchItem(result, QUESTION, citations);
    const reversed = projectResearchItem(result, QUESTION, [...citations].reverse());

    expect(reversed!.id).toBe(inOrder!.id);
    expect(reversed!.citationIds).toEqual(inOrder!.citationIds);
    expect(reversed!.citationIds).toEqual([...inOrder!.citationIds].sort());
  });

  it('6. identifiant de question vide → RangeError, avant tout calcul', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    expect(() => projectResearchItem(result, { id: '' }, citations)).toThrow(RangeError);
    expect(() => projectResearchItem(result, { id: '   ' }, citations)).toThrow(RangeError);
  });

  it('7. le résumé reste mécanique : identité de source et version, jamais un jugement', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const { citations } = projectCitations(result, QUESTION);

    const item = projectResearchItem(result, QUESTION, citations)!;

    expect(item.summary).not.toMatch(/pertinen|probant|applicable|conclu|démontre/i);
    expect(item.summary).toBe(
      `1 citation(s) éligible(s) : ${R_L3121_V2.source.id} (version ${R_L3121_V2.source.version}).`,
    );
  });

  it('un pinpoint présent sur la citation est repris dans le résumé', async () => {
    const result = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const projection = projectCitations(result, QUESTION);
    const withPinpoint = projection.citations.map((c) => ({ ...c, pinpoint: 'al. 2' }));

    const item = projectResearchItem(result, QUESTION, withPinpoint)!;

    expect(item.summary).toContain('al. 2');
  });
});
