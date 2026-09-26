import { describe, expect, it } from 'vitest';

import { ResearchProviderError } from './ports.js';
import { ResearchEngine, type ResearchEngineOptions } from './research-engine.js';
import type { ResearchBudget, ResearchResult } from './research-types.js';
import type { RetrievalResult, VersionTargetResult } from './retrieval-types.js';
import type { SearchQuery, SearchResultPage } from './search-types.js';
import type { VersionCompleteness, VersionHistory, VersionResolver } from './temporal-types.js';
import { resolveVersion } from './version-resolver.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import {
  ARTICLE_57_RAW,
  L3121_27_V2_RAW,
  L36_11_V14_RAW,
  QUERY,
  SENTINEL_MS,
} from './testing/fixtures.js';
import { deepFreeze, retrievalOf, targetOf } from './testing/version-resolver-helpers.js';

const WIDE: ResearchBudget = { maxSearchPages: 3, maxCandidates: 50, maxRetrievedSources: 50 };
const V2 = 'LEGIARTI000033020376';
const L36_V14 = 'LEGIARTI000033219357';
const L36_V20 = 'LEGIARTI000049571362';

const L36_11_V20_RAW = {
  ...L36_11_V14_RAW,
  id: L36_V20,
  versionArticle: '20.0',
  etat: 'VIGUEUR',
  dateDebut: 1716422400000,
  dateFin: SENTINEL_MS,
  versionPrecedente: 'LEGIARTI000049571361',
};

const R_L3121 = retrievalOf(L3121_27_V2_RAW);
const R_L36_V14 = retrievalOf(L36_11_V14_RAW);
const R_L36_V20 = retrievalOf(L36_11_V20_RAW);
const R_ART57 = retrievalOf(ARTICLE_57_RAW);
const R_L36_V20_TARGET = targetOf(R_L36_V20);

interface ResolverCall {
  readonly history: VersionHistory;
  readonly asOf: string;
}

/** Resolver espion : délègue au vrai resolver et mémorise chaque appel. */
function spyResolver(): { resolver: VersionResolver; calls: ResolverCall[] } {
  const calls: ResolverCall[] = [];
  return {
    calls,
    resolver: {
      resolve(history, asOf) {
        calls.push({ history, asOf });
        return resolveVersion(history, asOf);
      },
    },
  };
}

function pageOf(retrievals: readonly RetrievalResult[]): SearchResultPage {
  return {
    references: retrievals.map((r) => r.reference),
    skipped: [],
    metadata: { page: 1, pageSize: 5, resultCount: retrievals.length },
  };
}

interface Setup {
  readonly retrievals: readonly RetrievalResult[];
  /** Versions cibles récupérables par id (capacité optionnelle du port) ; absent = capacité non supportée. */
  readonly targets?: Readonly<Record<string, VersionTargetResult | ResearchProviderError>>;
  readonly query?: SearchQuery;
  readonly budget?: ResearchBudget;
  readonly failing?: readonly string[];
  readonly options?: Partial<ResearchEngineOptions>;
}

async function run(setup: Setup) {
  const search = new FakeSearchPort({ 1: pageOf(setup.retrievals) });
  const outcomes: Record<string, RetrievalResult | ResearchProviderError> = {};
  for (const r of setup.retrievals) outcomes[r.reference.candidateId] = r;
  for (const id of setup.failing ?? [])
    outcomes[id] = new ResearchProviderError('fake', 'execution_error', 'échec simulé.');
  const retrieval = new FakeRetrievalPort(outcomes, { versionTargets: setup.targets });
  const engine = new ResearchEngine({ search, retrieval, ...setup.options });
  const result: ResearchResult = await engine.research(setup.query ?? QUERY, setup.budget ?? WIDE);
  return { result, search, retrieval };
}

const withAsOf = (asOf: string): SearchQuery => ({ ...QUERY, asOf });

describe('ResearchEngine — résolution de version : asOf', () => {
  it('asOf absent : aucune résolution, aucun rejet, aucun marqueur, resolver jamais appelé', async () => {
    const { resolver, calls } = spyResolver();
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;

    const { result } = await run({
      retrievals: [R_L36_V14],
      query: withoutAsOf,
      options: { versionResolver: resolver },
    });

    expect(calls).toEqual([]);
    expect(result.candidates[0]).not.toHaveProperty('versionResolution');
    expect(result.rejections).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('asOf illisible pour le resolver : RangeError remontée AVANT tout appel réseau (ni recherche ni récupération)', async () => {
    const search = new FakeSearchPort({ 1: pageOf([R_L36_V14]) });
    const retrieval = new FakeRetrievalPort({ [L36_V14]: R_L36_V14 });
    const engine = new ResearchEngine({ search, retrieval });

    await expect(engine.research(withAsOf('2019-05-24T10:00:00'), WIDE)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(search.queries).toEqual([]);
    expect(retrieval.retrieved).toEqual([]);
  });

  it('la validation d’asOf n’est pas un appel du resolver injecté', async () => {
    const { resolver, calls } = spyResolver();
    await run({
      retrievals: [],
      query: withAsOf('2019-05-24'),
      options: { versionResolver: resolver },
    });
    expect(calls).toEqual([]);
  });
});

describe('ResearchEngine — résolution de version : issues', () => {
  it('resolved, même version que celle récupérée : rattachée au candidat, aucun rejet', async () => {
    const { result } = await run({ retrievals: [R_L3121], query: withAsOf('2020-01-01') });
    const candidate = result.candidates[0]!;

    expect(candidate.versionResolution).toMatchObject({ status: 'resolved', version: { id: V2 } });
    expect(
      candidate.versionResolution?.status === 'resolved' &&
        candidate.versionResolution.version.id === candidate.retrieval?.source.id,
    ).toBe(true);
    expect(result.rejections).toEqual([]);
  });

  it('resolved, AUTRE version : `retrieval` inchangé, la version résolue est récupérée par UN saut (resolvedRetrieval, mode retrieved)', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      query: withAsOf('2024-06-01'),
      targets: { [L36_V20]: R_L36_V20_TARGET },
    });
    const candidate = result.candidates[0]!;

    expect(candidate.versionResolution).toMatchObject({
      status: 'resolved',
      version: { id: L36_V20 },
    });
    expect(candidate.retrieval?.source.id).toBe(L36_V14);
    expect(candidate.retrieval).toBe(R_L36_V14);
    expect(candidate.resolvedRetrieval).toEqual({ mode: 'retrieved', result: R_L36_V20_TARGET });
    expect(retrieval.retrieved).toEqual([L36_V14]);
    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(result.rejections).toEqual([]);
  });

  it('indeterminate / boundary_date : rattachée, aucun rejet, ni skipped, ni lacune', async () => {
    const { result } = await run({ retrievals: [R_L36_V14], query: withAsOf('2016-10-09') });

    expect(result.candidates[0]!.versionResolution).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: [L36_V14],
    });
    expect(result.rejections).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('indeterminate / incomplete_history (historique unknown) : rattachée, aucun rejet', async () => {
    const { result } = await run({ retrievals: [R_L36_V14], query: withAsOf('2010-01-01') });

    expect(result.candidates[0]!.versionResolution).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
    expect(result.rejections).toEqual([]);
  });

  it('none_applicable (complete injecté en test) : rattachée + rejet no_applicable_version, candidat CONSERVÉ', async () => {
    const { result } = await run({
      retrievals: [R_L3121],
      query: withAsOf('2012-06-15'),
      options: { historyCompleteness: (): VersionCompleteness => 'complete' },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.versionResolution).toEqual({
      status: 'none_applicable',
      reason: 'gap_between_versions',
    });
    expect(result.candidates[0]!.retrieval).toBe(R_L3121);
    expect(result.rejections).toEqual([
      { reference: R_L3121.reference, reason: 'no_applicable_version' },
    ]);
    expect(result.gaps).toEqual([]);
  });

  it('sans injection, le même trou reste indeterminate : le moteur ne produit jamais complete par lui-même', async () => {
    const { resolver, calls } = spyResolver();
    const { result } = await run({
      retrievals: [R_L3121],
      query: withAsOf('2012-06-15'),
      options: { versionResolver: resolver },
    });

    expect(calls.map((call) => call.history.completeness)).toEqual(['unknown']);
    expect(result.candidates[0]!.versionResolution).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
    expect(result.rejections).toEqual([]);
  });
});

describe('ResearchEngine — résolution de version : groupement', () => {
  it('plusieurs candidats du même article : UN seul appel au resolver, même résolution pour tous', async () => {
    const { resolver, calls } = spyResolver();
    const { result } = await run({
      retrievals: [R_L36_V14, R_L36_V20],
      query: withAsOf('2017-03-01'),
      options: { versionResolver: resolver },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.asOf).toBe('2017-03-01');
    expect(calls[0]!.history.versions.map((v) => v.id).sort()).toEqual(
      [L36_V14, L36_V20, 'LEGIARTI000006465863'].sort(),
    );
    const [first, second] = result.candidates;
    expect(first!.versionResolution).toMatchObject({
      status: 'resolved',
      version: { id: L36_V14 },
    });
    expect(second!.versionResolution).toBe(first!.versionResolution);
  });

  it('plusieurs articles : un appel par groupe, chacun avec son propre historique', async () => {
    const { resolver, calls } = spyResolver();
    const { result } = await run({
      retrievals: [R_L3121, R_L36_V14, R_ART57],
      query: withAsOf('2020-01-01'),
      options: { versionResolver: resolver },
    });

    expect(calls).toHaveLength(3);
    const idsPerCall = calls.map((call) => call.history.versions.map((v) => v.id).sort());
    expect(idsPerCall).toContainEqual([V2, 'LEGIARTI000006902466'].sort());
    expect(idsPerCall).toContainEqual([L36_V14, L36_V20, 'LEGIARTI000006465863'].sort());
    expect(idsPerCall).toContainEqual(['LEGIARTI000006528277']);
    // L3121-27 et l'article 57 se résolvent ; en 2020, L36-11 tombe dans la partie NON couverte de son historique
    // partiel (ni v14 ni v20 n'y sont applicables) : indéterminé — jamais « aucune version ».
    expect(result.candidates.map((c) => c.versionResolution?.status)).toEqual([
      'resolved',
      'indeterminate',
      'resolved',
    ]);
    expect(result.candidates[1]!.versionResolution).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
  });

  it('un candidat en échec de récupération ne participe à aucun groupe et ne reçoit aucune résolution', async () => {
    const { resolver, calls } = spyResolver();
    const { result } = await run({
      retrievals: [R_L36_V14, R_L3121],
      failing: [V2],
      query: withAsOf('2017-03-01'),
      options: { versionResolver: resolver },
    });

    expect(calls).toHaveLength(1);
    const failed = result.candidates.find((c) => c.reference.candidateId === V2)!;
    expect(failed).not.toHaveProperty('versionResolution');
    expect(failed).not.toHaveProperty('retrieval');
    expect(result.rejections).toEqual([
      { reference: R_L3121.reference, reason: 'retrieval_failed', errorReason: 'execution_error' },
    ]);
  });

  it('un candidat non récupéré faute de budget ne reçoit aucune résolution', async () => {
    const { result } = await run({
      retrievals: [R_L36_V14, R_L3121],
      query: withAsOf('2017-03-01'),
      budget: { ...WIDE, maxRetrievedSources: 1 },
    });

    expect(result.candidates[0]!.versionResolution).toBeDefined();
    expect(result.candidates[1]).not.toHaveProperty('versionResolution');
    expect(result.rejections.map((r) => r.reason)).toEqual(['over_retrieval_budget']);
  });

  it('aucune récupération réussie : le resolver n’est jamais appelé', async () => {
    const { resolver, calls } = spyResolver();
    const { result } = await run({
      retrievals: [R_L36_V14],
      query: withAsOf('2017-03-01'),
      budget: { ...WIDE, maxRetrievedSources: 0 },
      options: { versionResolver: resolver },
    });

    expect(calls).toEqual([]);
    expect(result.candidates[0]).not.toHaveProperty('versionResolution');
  });

  it('historyCompleteness reçoit uniquement les récupérations réussies du groupe', async () => {
    const seen: string[][] = [];
    await run({
      retrievals: [R_L36_V14, R_L36_V20, R_L3121],
      failing: [L36_V20],
      query: withAsOf('2017-03-01'),
      options: {
        historyCompleteness: (retrievals) => {
          seen.push(retrievals.map((r) => r.source.id));
          return 'unknown';
        },
      },
    });
    expect(seen.sort()).toEqual([[L36_V14], [V2]].sort());
  });
});

describe('ResearchEngine — résolution de version : aucun coût réseau, ordre, pureté', () => {
  it('budget et appels réseau strictement inchangés : mêmes récupérations, avec ou sans asOf', async () => {
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;
    const retrievals = [R_L3121, R_L36_V14, R_L36_V20, R_ART57];

    const withResolution = await run({ retrievals, query: withAsOf('2020-01-01') });
    const without = await run({ retrievals, query: withoutAsOf });

    expect(withResolution.retrieval.retrieved).toEqual(without.retrieval.retrieved);
    expect(withResolution.retrieval.retrieved).toHaveLength(retrievals.length);
    expect(withResolution.search.queries).toHaveLength(without.search.queries.length);
  });

  it('un budget de récupération serré borne toujours les appels (la résolution ne l’élargit pas)', async () => {
    const { retrieval } = await run({
      retrievals: [R_L3121, R_L36_V14, R_ART57],
      query: withAsOf('2020-01-01'),
      budget: { ...WIDE, maxRetrievedSources: 2 },
    });
    expect(retrieval.retrieved).toEqual([V2, L36_V14]);
  });

  it('l’ordre des candidats est préservé, résolution attachée en place', async () => {
    const { result } = await run({
      retrievals: [R_ART57, R_L3121, R_L36_V20, R_L36_V14],
      query: withAsOf('2020-01-01'),
    });
    expect(result.candidates.map((c) => c.reference.candidateId)).toEqual([
      'LEGIARTI000006528277',
      V2,
      L36_V20,
      L36_V14,
    ]);
  });

  it('le diagnostic ne dépend pas de l’ordre des références (permutation)', async () => {
    const a = await run({ retrievals: [R_L36_V14, R_L36_V20], query: withAsOf('2017-03-01') });
    const b = await run({ retrievals: [R_L36_V20, R_L36_V14], query: withAsOf('2017-03-01') });
    const statusOf = (r: ResearchResult, id: string) =>
      r.candidates.find((c) => c.reference.candidateId === id)!.versionResolution;
    expect(statusOf(a.result, L36_V14)).toEqual(statusOf(b.result, L36_V14));
    expect(statusOf(a.result, L36_V20)).toEqual(statusOf(b.result, L36_V20));
  });

  it('aucune mutation : RetrievalResult, requête et budget gelés en profondeur ; les objets d’entrée sont réutilisés tels quels', async () => {
    const frozenRetrievals = deepFreeze([R_L36_V14, R_L36_V20].map((r) => structuredClone(r)));
    const query = deepFreeze({ ...withAsOf('2017-03-01') });
    const budget = deepFreeze({ ...WIDE });

    const { result } = await run({ retrievals: frozenRetrievals, query, budget });

    expect(result.candidates.map((c) => c.retrieval)).toEqual(frozenRetrievals);
    expect(result.candidates[0]!.retrieval).toBe(frozenRetrievals[0]);
    expect(result.query).toBe(query);
  });

  it('deux exécutions identiques donnent le même résultat', async () => {
    const setup = { retrievals: [R_L3121, R_L36_V14], query: withAsOf('2020-01-01') };
    const first = await run(setup);
    const second = await run(setup);
    expect(second.result).toEqual(first.result);
  });
});

describe('ResearchEngine — exhaustivité de l’historique consignée (ADR-0020)', () => {
  it('un candidat résolu porte l’exhaustivité réellement fournie au resolver : unknown par défaut, complete seulement si déclarée', async () => {
    const byDefault = await run({ retrievals: [R_L3121], query: withAsOf('2020-01-01') });
    const declared = await run({
      retrievals: [R_L3121],
      query: withAsOf('2020-01-01'),
      options: { historyCompleteness: (): VersionCompleteness => 'complete' },
    });

    expect(byDefault.result.candidates[0]!.historyCompleteness).toBe('unknown');
    expect(declared.result.candidates[0]!.historyCompleteness).toBe('complete');
  });

  it('présente pour tout candidat qui a une versionResolution (même indeterminate), identique dans un groupe ; absente sans asOf', async () => {
    const grouped = await run({
      retrievals: [R_L36_V14, R_L36_V20],
      query: withAsOf('2020-01-01'),
    });
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;
    const noAsOf = await run({ retrievals: [R_L36_V14], query: withoutAsOf });

    expect(grouped.result.candidates.map((c) => c.versionResolution?.status)).toEqual([
      'indeterminate',
      'indeterminate',
    ]);
    expect(grouped.result.candidates.map((c) => c.historyCompleteness)).toEqual([
      'unknown',
      'unknown',
    ]);
    expect(noAsOf.result.candidates[0]).not.toHaveProperty('historyCompleteness');
  });
});
