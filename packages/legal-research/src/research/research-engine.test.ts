import { describe, expect, it } from 'vitest';

import { mapLegifranceArticleToLegalSource } from '../legifrance-source-mapping.js';
import { ResearchProviderError } from './ports.js';
import { ResearchEngine } from './research-engine.js';
import type { ResearchBudget } from './research-types.js';
import type { RetrievalResult } from './retrieval-types.js';
import { sourceKey } from './source-key.js';
import type { SearchQuery, SearchReference, SearchResultPage } from './search-types.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import {
  CONTAINER_ARTICLE_IDS,
  DUPLICATED_ACROSS_RESULTS_PAGE,
  EMPTY_PAGE,
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  PAGE_WITH_UNUSABLE_ITEM,
  QUERY,
  SINGLE_CONTAINER_PAGE,
} from './testing/fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');
const WIDE: ResearchBudget = { maxSearchPages: 10, maxCandidates: 100, maxRetrievedSources: 100 };

/** Pages de test : chaque page contient `count` références distinctes (ids propres à la page) et annonce `total` résultats. */
function pageOf(
  pageNumber: number,
  candidateIds: readonly string[],
  overrides: Partial<SearchResultPage['metadata']> = {},
): SearchResultPage {
  const base = SINGLE_CONTAINER_PAGE.references[0]!;
  return {
    references: candidateIds.map((candidateId, i) => ({
      ...base,
      candidateId,
      provenance: { ...base.provenance, page: pageNumber, resultIndex: i },
    })),
    skipped: [],
    metadata: {
      page: pageNumber,
      pageSize: QUERY.page.size,
      resultCount: QUERY.page.size,
      ...overrides,
    },
  };
}

function retrievalFor(reference: SearchReference, raw: Record<string, unknown>): RetrievalResult {
  const { source, metadata } = mapLegifranceArticleToLegalSource(raw, { now: NOW });
  return {
    source,
    versions: metadata.articleVersions.map((v) => ({ id: v.id })),
    reference,
    ...(metadata.versionPrecedente !== undefined
      ? { previousVersionId: metadata.versionPrecedente }
      : {}),
  };
}

/** Retrieval fake qui accepte tout identifiant listé et renvoie une source minimale cohérente. */
function retrievalPortFor(
  ids: readonly string[],
  extra: Record<string, RetrievalResult | ResearchProviderError> = {},
): FakeRetrievalPort {
  const results: Record<string, RetrievalResult | ResearchProviderError> = {};
  for (const id of ids) {
    const reference = { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId: id };
    results[id] = retrievalFor(reference, {
      ...L3121_27_V2_RAW,
      id,
      cid: id,
      versionPrecedente: null,
    });
  }
  return new FakeRetrievalPort({ ...results, ...extra });
}

const IDS_A = ['LEGIARTI000000000001', 'LEGIARTI000000000002', 'LEGIARTI000000000003'];

describe('ResearchEngine — aucun résultat', () => {
  it('produit une lacune no_search_result, sans candidat ni récupération', async () => {
    const retrieval = retrievalPortFor([]);
    const engine = new ResearchEngine({ search: new FakeSearchPort({ 1: EMPTY_PAGE }), retrieval });

    const result = await engine.research(QUERY, WIDE);

    expect(result.candidates).toEqual([]);
    expect(result.gaps).toEqual([{ kind: 'no_search_result' }]);
    expect(result.rejections).toEqual([]);
    expect(retrieval.retrieved).toEqual([]);
  });

  it('renvoie la requête et le budget tels que fournis', async () => {
    const result = await new ResearchEngine({
      search: new FakeSearchPort({}),
      retrieval: retrievalPortFor([]),
    }).research(QUERY, WIDE);
    expect(result.query).toBe(QUERY);
    expect(result.budget).toBe(WIDE);
  });
});

describe('ResearchEngine — déduplication', () => {
  it('doublons exacts entre résultats : 9 références → 3 candidats, ordre de première occurrence', async () => {
    const engine = new ResearchEngine({
      search: new FakeSearchPort({ 1: DUPLICATED_ACROSS_RESULTS_PAGE }),
      retrieval: retrievalPortFor(CONTAINER_ARTICLE_IDS),
    });

    const result = await engine.research(QUERY, WIDE);

    expect(result.candidates.map((c) => c.reference.candidateId)).toEqual([
      ...CONTAINER_ARTICLE_IDS,
    ]);
    expect(result.rejections).toEqual([]);
  });

  it('conserve TOUTES les occurrences (sightings) d’un même referenceKey, à leurs positions, première incluse', async () => {
    const engine = new ResearchEngine({
      search: new FakeSearchPort({ 1: DUPLICATED_ACROSS_RESULTS_PAGE }),
      retrieval: retrievalPortFor(CONTAINER_ARTICLE_IDS),
    });

    const result = await engine.research(QUERY, WIDE);
    const first = result.candidates[0]!;

    expect(first.sightings.map((s) => s.resultIndex)).toEqual([0, 1, 2]);
    expect(first.sightings.map((s) => s.resultId)).toEqual([
      'LEGITEXT000006072050_29-12-2025',
      'LEGITEXT000006072050_26-10-2025',
      'LEGITEXT000006072050_01-11-2025',
    ]);
    expect(first.sightings[0]).toBe(first.reference.provenance);
  });

  it('même référence sur deux pages : une seule candidate, deux sightings (pages 1 et 2)', async () => {
    const search = new FakeSearchPort({
      1: pageOf(1, [IDS_A[0]!, IDS_A[1]!], { resultCount: 5, totalResults: 12 }),
      2: pageOf(2, [IDS_A[0]!, IDS_A[2]!], { resultCount: 5, totalResults: 12 }),
      3: pageOf(3, [], { resultCount: 0, totalResults: 12 }),
    });
    const result = await new ResearchEngine({
      search,
      retrieval: retrievalPortFor(IDS_A),
    }).research(QUERY, WIDE);

    expect(result.candidates.map((c) => c.reference.candidateId)).toEqual(IDS_A);
    expect(result.candidates[0]!.sightings.map((s) => s.page)).toEqual([1, 2]);
  });

  it('deux versions différentes d’un même article ne sont pas fusionnées, avant comme après récupération', async () => {
    const v1Ref = { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId: 'LEGIARTI000006902466' };
    const v2Ref = { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId: 'LEGIARTI000033020376' };
    const retrieval = new FakeRetrievalPort({
      [v1Ref.candidateId]: retrievalFor(v1Ref, L3121_27_V1_RAW),
      [v2Ref.candidateId]: retrievalFor(v2Ref, L3121_27_V2_RAW),
    });
    const page: SearchResultPage = { ...SINGLE_CONTAINER_PAGE, references: [v1Ref, v2Ref] };

    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: page }),
      retrieval,
    }).research(QUERY, WIDE);

    expect(result.candidates).toHaveLength(2);
    const [s1, s2] = result.candidates.map((c) => c.retrieval!.source);
    expect(s1!.identifier).toBe(s2!.identifier);
    expect(sourceKey(s1!)).not.toBe(sourceKey(s2!));
    expect(s2!.version).toBe('2.0');
  });
});

describe('ResearchEngine — éléments inexploitables, lacunes et rejets', () => {
  it('reporte les éléments écartés par le SearchPort avec leur page, sans les transformer en références', async () => {
    const engine = new ResearchEngine({
      search: new FakeSearchPort({ 1: PAGE_WITH_UNUSABLE_ITEM }),
      retrieval: retrievalPortFor(['LEGIARTI000006901174']),
    });

    const result = await engine.research(QUERY, WIDE);

    expect(result.skipped).toEqual([
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 1, extractIndex: 0, page: 1 },
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.gaps).toEqual([]);
  });

  it('des résultats existent mais aucun élément n’est exploitable : pas de no_search_result, uniquement des éléments écartés', async () => {
    const page: SearchResultPage = {
      references: [],
      skipped: [{ reason: 'malformed_item', resultIndex: 0 }],
      metadata: { page: 1, pageSize: 5, resultCount: 1 },
    };
    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: page }),
      retrieval: retrievalPortFor([]),
    }).research(QUERY, WIDE);

    expect(result.gaps).toEqual([]);
    expect(result.skipped).toEqual([{ reason: 'malformed_item', resultIndex: 0, page: 1 }]);
  });

  it('les articles non exposés (moreArticlesCount) deviennent une lacune unexposed_articles, somme des pages lues', async () => {
    const engine = new ResearchEngine({
      search: new FakeSearchPort({ 1: DUPLICATED_ACROSS_RESULTS_PAGE }),
      retrieval: retrievalPortFor(CONTAINER_ARTICLE_IDS),
    });
    expect((await engine.research(QUERY, WIDE)).gaps).toEqual([
      { kind: 'unexposed_articles', count: 42 },
    ]);
  });

  it('une référence que le RetrievalPort ne sait pas récupérer est rejetée not_retrievable, sans appel de récupération', async () => {
    const retrieval = retrievalPortFor([CONTAINER_ARTICLE_IDS[0]]);
    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: SINGLE_CONTAINER_PAGE }),
      retrieval,
    }).research(QUERY, WIDE);

    expect(result.rejections.map((r) => [r.reference.candidateId, r.reason])).toEqual([
      [CONTAINER_ARTICLE_IDS[1], 'not_retrievable'],
      [CONTAINER_ARTICLE_IDS[2], 'not_retrievable'],
    ]);
    expect(retrieval.retrieved).toEqual([CONTAINER_ARTICLE_IDS[0]]);
  });

  it('résultats partiellement récupérables : l’échec d’une récupération devient un rejet retrieval_failed et les autres continuent', async () => {
    const failure = new ResearchProviderError('fake', 'execution_error', 'échec technique.');
    const retrieval = retrievalPortFor(CONTAINER_ARTICLE_IDS, {
      [CONTAINER_ARTICLE_IDS[1]]: failure,
    });

    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: SINGLE_CONTAINER_PAGE }),
      retrieval,
    }).research(QUERY, WIDE);

    expect(result.candidates.map((c) => c.retrieval !== undefined)).toEqual([true, false, true]);
    expect(result.rejections).toEqual([
      {
        reference: result.candidates[1]!.reference,
        reason: 'retrieval_failed',
        errorReason: 'execution_error',
      },
    ]);
    expect(retrieval.retrieved).toEqual([...CONTAINER_ARTICLE_IDS]);
  });

  it('une erreur inattendue du RetrievalPort (bug) est propagée, jamais transformée en rejet', async () => {
    const retrieval = {
      providerId: 'fake',
      canRetrieve: () => true,
      async retrieve(): Promise<RetrievalResult> {
        throw new TypeError('bug');
      },
    };
    await expect(
      new ResearchEngine({
        search: new FakeSearchPort({ 1: SINGLE_CONTAINER_PAGE }),
        retrieval,
      }).research(QUERY, WIDE),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('une erreur du SearchPort est propagée : une recherche qui échoue n’est pas un résultat vide', async () => {
    const error = new ResearchProviderError('fake', 'denied', 'refusé.');
    const engine = new ResearchEngine({
      search: new FakeSearchPort({}, { failWith: error }),
      retrieval: retrievalPortFor([]),
    });
    await expect(engine.research(QUERY, WIDE)).rejects.toBe(error);
  });
});

describe('ResearchEngine — budget explicite, aucun seuil implicite', () => {
  it.each([
    ['budget vide', {}],
    ['maxSearchPages absent', { maxCandidates: 1, maxRetrievedSources: 1 }],
    ['maxSearchPages nul', { maxSearchPages: 0, maxCandidates: 1, maxRetrievedSources: 1 }],
    ['maxCandidates négatif', { maxSearchPages: 1, maxCandidates: -1, maxRetrievedSources: 1 }],
    [
      'maxRetrievedSources non entier',
      { maxSearchPages: 1, maxCandidates: 1, maxRetrievedSources: 1.5 },
    ],
    ['maxRetrievedSources absent', { maxSearchPages: 1, maxCandidates: 1 }],
    ['valeur NaN', { maxSearchPages: Number.NaN, maxCandidates: 1, maxRetrievedSources: 1 }],
  ])('rejette un budget invalide (%s), sans aucun appel', async (_label, budget) => {
    const search = new FakeSearchPort({ 1: SINGLE_CONTAINER_PAGE });
    const engine = new ResearchEngine({ search, retrieval: retrievalPortFor([]) });

    await expect(
      engine.research(QUERY, budget as unknown as ResearchBudget),
    ).rejects.toBeInstanceOf(RangeError);
    expect(search.queries).toEqual([]);
  });

  it('rejette une pagination de requête invalide', async () => {
    const engine = new ResearchEngine({
      search: new FakeSearchPort({}),
      retrieval: retrievalPortFor([]),
    });
    const bad: SearchQuery = { ...QUERY, page: { number: 0, size: 5 } };
    await expect(engine.research(bad, WIDE)).rejects.toBeInstanceOf(RangeError);
  });

  it('maxSearchPages : n’interroge jamais plus de pages, incrémente le numéro de page, signale budget_truncated', async () => {
    const search = new FakeSearchPort({
      1: pageOf(1, [IDS_A[0]!], { resultCount: 5, totalResults: 20 }),
      2: pageOf(2, [IDS_A[1]!], { resultCount: 5, totalResults: 20 }),
      3: pageOf(3, [IDS_A[2]!], { resultCount: 5, totalResults: 20 }),
    });
    const result = await new ResearchEngine({
      search,
      retrieval: retrievalPortFor(IDS_A),
    }).research(QUERY, {
      ...WIDE,
      maxSearchPages: 2,
    });

    expect(search.queries.map((q) => q.page.number)).toEqual([1, 2]);
    expect(result.candidates).toHaveLength(2);
    expect(result.gaps).toEqual([
      { kind: 'budget_truncated', budget: 'maxSearchPages', count: 10 },
    ]);
  });

  it('maxSearchPages avec une requête démarrant à la page 4 : les pages suivent la page de départ', async () => {
    const search = new FakeSearchPort({
      4: pageOf(4, [IDS_A[0]!], { resultCount: 5 }),
      5: pageOf(5, [IDS_A[1]!], { resultCount: 5 }),
    });
    await new ResearchEngine({ search, retrieval: retrievalPortFor(IDS_A) }).research(
      { ...QUERY, page: { number: 4, size: 5 } },
      { ...WIDE, maxSearchPages: 2 },
    );
    expect(search.queries.map((q) => q.page.number)).toEqual([4, 5]);
  });

  it('s’arrête sans lacune quand la dernière page est atteinte avant la limite (page courte)', async () => {
    const search = new FakeSearchPort({
      1: pageOf(1, [IDS_A[0]!], { resultCount: 5, totalResults: 7 }),
      2: pageOf(2, [IDS_A[1]!], { resultCount: 2, totalResults: 7 }),
    });
    const result = await new ResearchEngine({
      search,
      retrieval: retrievalPortFor(IDS_A),
    }).research(QUERY, WIDE);

    expect(search.queries).toHaveLength(2);
    expect(result.gaps).toEqual([]);
  });

  it('s’arrête quand le total annoncé est atteint, sans page supplémentaire', async () => {
    const search = new FakeSearchPort({
      1: pageOf(1, [IDS_A[0]!], { resultCount: 5, totalResults: 5 }),
    });
    await new ResearchEngine({ search, retrieval: retrievalPortFor(IDS_A) }).research(QUERY, WIDE);
    expect(search.queries).toHaveLength(1);
  });

  it('total inconnu et limite de pages atteinte : budget_truncated sans count', async () => {
    const search = new FakeSearchPort({
      1: pageOf(1, [IDS_A[0]!], { resultCount: 5 }),
      2: pageOf(2, [IDS_A[1]!], { resultCount: 5 }),
    });
    const result = await new ResearchEngine({
      search,
      retrieval: retrievalPortFor(IDS_A),
    }).research(QUERY, {
      ...WIDE,
      maxSearchPages: 1,
    });
    expect(result.gaps).toEqual([{ kind: 'budget_truncated', budget: 'maxSearchPages' }]);
  });

  it('maxCandidates : ne conserve que les premiers candidats, rejette les autres over_candidate_budget, signale la lacune', async () => {
    const retrieval = retrievalPortFor(IDS_A);
    const search = new FakeSearchPort({ 1: pageOf(1, IDS_A, { resultCount: 3, totalResults: 3 }) });

    const result = await new ResearchEngine({ search, retrieval }).research(
      { ...QUERY, page: { number: 1, size: 3 } },
      {
        ...WIDE,
        maxCandidates: 2,
      },
    );

    expect(result.candidates.map((c) => c.reference.candidateId)).toEqual([IDS_A[0], IDS_A[1]]);
    expect(result.rejections.map((r) => [r.reference.candidateId, r.reason])).toEqual([
      [IDS_A[2], 'over_candidate_budget'],
    ]);
    expect(result.gaps).toContainEqual({
      kind: 'budget_truncated',
      budget: 'maxCandidates',
      count: 1,
    });
    expect(retrieval.retrieved).toEqual([IDS_A[0], IDS_A[1]]);
  });

  it('maxRetrievedSources : ne récupère jamais plus ; les candidats restants sont conservés sans source, rejetés over_retrieval_budget', async () => {
    const retrieval = retrievalPortFor(IDS_A);
    const search = new FakeSearchPort({ 1: pageOf(1, IDS_A, { resultCount: 3, totalResults: 3 }) });

    const result = await new ResearchEngine({ search, retrieval }).research(
      { ...QUERY, page: { number: 1, size: 3 } },
      {
        ...WIDE,
        maxRetrievedSources: 1,
      },
    );

    expect(retrieval.retrieved).toEqual([IDS_A[0]]);
    expect(result.candidates.map((c) => c.retrieval !== undefined)).toEqual([true, false, false]);
    expect(result.rejections.map((r) => [r.reference.candidateId, r.reason])).toEqual([
      [IDS_A[1], 'over_retrieval_budget'],
      [IDS_A[2], 'over_retrieval_budget'],
    ]);
    expect(result.gaps).toContainEqual({
      kind: 'budget_truncated',
      budget: 'maxRetrievedSources',
      count: 2,
    });
  });

  it('maxRetrievedSources = 0 : découverte seule, aucune récupération', async () => {
    const retrieval = retrievalPortFor(IDS_A);
    const search = new FakeSearchPort({ 1: pageOf(1, IDS_A, { resultCount: 3, totalResults: 3 }) });
    const result = await new ResearchEngine({ search, retrieval }).research(
      { ...QUERY, page: { number: 1, size: 3 } },
      {
        ...WIDE,
        maxRetrievedSources: 0,
      },
    );

    expect(retrieval.retrieved).toEqual([]);
    expect(result.candidates).toHaveLength(3);
    expect(result.gaps).toContainEqual({
      kind: 'budget_truncated',
      budget: 'maxRetrievedSources',
      count: 3,
    });
  });

  it('un échec de récupération consomme du budget : une tentative est un appel', async () => {
    const failure = new ResearchProviderError('fake', 'execution_error', 'échec technique.');
    const retrieval = retrievalPortFor(IDS_A, { [IDS_A[0]!]: failure });
    const search = new FakeSearchPort({ 1: pageOf(1, IDS_A, { resultCount: 3, totalResults: 3 }) });

    const result = await new ResearchEngine({ search, retrieval }).research(
      { ...QUERY, page: { number: 1, size: 3 } },
      {
        ...WIDE,
        maxRetrievedSources: 1,
      },
    );

    expect(retrieval.retrieved).toEqual([IDS_A[0]]);
    expect(result.rejections.map((r) => r.reason)).toEqual([
      'retrieval_failed',
      'over_retrieval_budget',
      'over_retrieval_budget',
    ]);
  });

  it('un budget serré borne les appels même sur un grand nombre de références (aucun seuil implicite ne l’élargit)', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `LEGIARTI${String(i + 1).padStart(12, '0')}`);
    const retrieval = retrievalPortFor(many);
    const search = new FakeSearchPort({
      1: pageOf(1, many, { resultCount: 50, totalResults: 50 }),
    });

    await new ResearchEngine({ search, retrieval }).research(
      { ...QUERY, page: { number: 1, size: 50 } },
      {
        maxSearchPages: 1,
        maxCandidates: 10,
        maxRetrievedSources: 3,
      },
    );

    expect(search.queries).toHaveLength(1);
    expect(retrieval.retrieved).toHaveLength(3);
  });
});

describe('ResearchEngine — temporalité transmise sans résolution', () => {
  it('multi-version avec trou temporel : les versions sont conservées telles quelles, aucune lacune ni rejet de résolution', async () => {
    const v2Ref = { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId: 'LEGIARTI000033020376' };
    const mapped = mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, { now: NOW });
    const retrieval = new FakeRetrievalPort({
      [v2Ref.candidateId]: {
        source: mapped.source,
        versions: mapped.metadata.articleVersions.map((v) => ({
          id: v.id,
          ...(v.effectiveFrom !== undefined ? { effectiveFrom: v.effectiveFrom } : {}),
          ...(v.effectiveTo !== undefined ? { effectiveTo: v.effectiveTo } : {}),
        })),
        previousVersionId: mapped.metadata.versionPrecedente!,
        reference: v2Ref,
      },
    });
    const page: SearchResultPage = { ...SINGLE_CONTAINER_PAGE, references: [v2Ref] };

    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: page }),
      retrieval,
    }).research(QUERY, WIDE);
    const versions = result.candidates[0]!.retrieval!.versions;

    expect(versions).toHaveLength(2);
    expect(
      (Date.parse(versions[1]!.effectiveFrom!) - Date.parse(versions[0]!.effectiveTo!)) /
        86_400_000,
    ).toBe(2910);
    expect(result.gaps.map((g) => g.kind)).not.toContain('no_applicable_version');
    expect(result.rejections.map((r) => r.reason)).not.toContain('no_applicable_version');
  });

  it('les références sont transmises intactes : dateVersion n’est pas lu comme effectiveFrom, consultedAt n’est pas utilisé', async () => {
    const ref: SearchReference = {
      ...SINGLE_CONTAINER_PAGE.references[0]!,
      dateVersion: '2008-08-22T00:00:00.000Z',
      effectiveFrom: '2008-05-01T00:00:00.000Z',
    };
    const page: SearchResultPage = { ...SINGLE_CONTAINER_PAGE, references: [ref] };
    const result = await new ResearchEngine({
      search: new FakeSearchPort({ 1: page }),
      retrieval: retrievalPortFor([ref.candidateId]),
    }).research(QUERY, WIDE);

    const kept = result.candidates[0]!.reference;
    expect(kept).toBe(ref);
    expect(kept.dateVersion).not.toBe(kept.effectiveFrom);
  });
});
