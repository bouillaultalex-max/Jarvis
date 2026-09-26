import { describe, expect, it } from 'vitest';

import { ResearchProviderError, type ResearchProviderErrorReason } from './ports.js';
import { ResearchEngine, type ResearchEngineOptions } from './research-engine.js';
import type { ResearchBudget, ResearchCandidate, ResearchResult } from './research-types.js';
import type { RetrievalResult, VersionTargetResult } from './retrieval-types.js';
import type { SearchQuery, SearchResultPage } from './search-types.js';
import type { VersionCompleteness, VersionHistory, VersionResolver } from './temporal-types.js';
import { resolveVersion } from './version-resolver.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import {
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  L36_11_V14_RAW,
  QUERY,
  SENTINEL_MS,
} from './testing/fixtures.js';
import { deepFreeze, retrievalOf, targetOf } from './testing/version-resolver-helpers.js';

/**
 * Récupération bornée de la version résolue (ADR-0019) — `ResearchEngine`, sans réseau :
 * fakes des ports uniquement. Le chemin complet via `ToolExecutor` est couvert dans
 * `research-pipeline.test.ts` ; l'adaptateur Légifrance dans `legifrance-retrieval-adapter.test.ts`.
 */

const WIDE: ResearchBudget = { maxSearchPages: 3, maxCandidates: 50, maxRetrievedSources: 50 };
const L36_V1 = 'LEGIARTI000006465863';
const L36_V14 = 'LEGIARTI000033219357';
const L36_V20 = 'LEGIARTI000049571362';
const L3121_V1 = 'LEGIARTI000006902466';
const L3121_V2 = 'LEGIARTI000033020376';

/** Dans l'historique L36-11 (v1, v14, v20), 2024-06-01 est couvert par la v20 seule. */
const AS_OF_L36_V20 = '2024-06-01';

const L36_11_V1_RAW = {
  ...L36_11_V14_RAW,
  id: L36_V1,
  versionArticle: '1.0',
  dateDebut: 838425600000,
  dateFin: 996278400000,
  versionPrecedente: null,
};
const L36_11_V20_RAW = {
  ...L36_11_V14_RAW,
  id: L36_V20,
  versionArticle: '20.0',
  etat: 'VIGUEUR',
  dateDebut: 1716422400000,
  dateFin: SENTINEL_MS,
  versionPrecedente: 'LEGIARTI000049571361',
};

const R_L36_V1 = retrievalOf(L36_11_V1_RAW);
const R_L36_V14 = retrievalOf(L36_11_V14_RAW);
const R_L36_V20 = retrievalOf(L36_11_V20_RAW);
const R_L3121_V1 = retrievalOf(L3121_27_V1_RAW);
const R_L3121_V2 = retrievalOf(L3121_27_V2_RAW);
const T_L36_V20 = targetOf(R_L36_V20);
const T_L3121_V2 = targetOf(R_L3121_V2);

const failure = (reason: ResearchProviderErrorReason) =>
  new ResearchProviderError('fake', reason, 'échec simulé.');

function spyResolver(): { resolver: VersionResolver; calls: { history: VersionHistory }[] } {
  const calls: { history: VersionHistory }[] = [];
  return {
    calls,
    resolver: {
      resolve(history, asOf) {
        calls.push({ history });
        return resolveVersion(history, asOf);
      },
    },
  };
}

interface Setup {
  readonly retrievals: readonly RetrievalResult[];
  /** Versions cibles récupérables ; absent = le port n'a pas la capacité optionnelle. */
  readonly targets?: Readonly<Record<string, VersionTargetResult | ResearchProviderError>>;
  /** Récupérations primaires en échec, par identifiant de candidat. */
  readonly failing?: readonly string[];
  readonly query?: SearchQuery;
  readonly budget?: ResearchBudget;
  readonly options?: Partial<ResearchEngineOptions>;
}

const withAsOf = (asOf: string): SearchQuery => ({ ...QUERY, asOf });

async function run(setup: Setup) {
  const page: SearchResultPage = {
    references: setup.retrievals.map((r) => r.reference),
    skipped: [],
    metadata: { page: 1, pageSize: 5, resultCount: setup.retrievals.length },
  };
  const search = new FakeSearchPort({ 1: page });
  const outcomes: Record<string, RetrievalResult | ResearchProviderError> = {};
  for (const r of setup.retrievals) outcomes[r.reference.candidateId] = r;
  for (const id of setup.failing ?? []) outcomes[id] = failure('execution_error');
  const retrieval = new FakeRetrievalPort(outcomes, { versionTargets: setup.targets });
  const engine = new ResearchEngine({ search, retrieval, ...setup.options });
  const result: ResearchResult = await engine.research(
    setup.query ?? withAsOf(AS_OF_L36_V20),
    setup.budget ?? WIDE,
  );
  return { result, search, retrieval };
}

const byId = (result: ResearchResult, id: string): ResearchCandidate =>
  result.candidates.find((c) => c.reference.candidateId === id)!;

describe('version cible — cas sans saut', () => {
  it('1. resolved = retrieved : mode initial, MÊME objet que retrieval, aucun appel de version', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L3121_V2],
      targets: { [L3121_V2]: T_L3121_V2 },
      query: withAsOf('2020-01-01'),
    });
    const candidate = result.candidates[0]!;

    expect(candidate.resolvedRetrieval?.mode).toBe('initial');
    expect(candidate.resolvedRetrieval?.result).toBe(candidate.retrieval);
    expect(candidate.retrieval).toBe(R_L3121_V2);
    expect(retrieval.retrievedVersions).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it.each([
    ['incomplete_history', '2020-01-01'],
    ['boundary_date', '2016-10-09'],
  ])(
    '11. indeterminate / %s : aucun saut, resolvedRetrieval absent, aucun rejet',
    async (reason, asOf) => {
      const { result, retrieval } = await run({
        retrievals: [R_L36_V14],
        targets: { [L36_V20]: T_L36_V20 },
        query: withAsOf(asOf),
      });
      const candidate = result.candidates[0]!;

      expect(candidate.versionResolution).toMatchObject({ status: 'indeterminate', reason });
      expect(candidate).not.toHaveProperty('resolvedRetrieval');
      expect(retrieval.retrievedVersions).toEqual([]);
      expect(result.rejections).toEqual([]);
    },
  );

  it('12. none_applicable : aucun saut, resolvedRetrieval absent, seul le rejet no_applicable_version existant', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L3121_V2],
      targets: { [L3121_V2]: T_L3121_V2 },
      query: withAsOf('2012-06-15'),
      options: { historyCompleteness: (): VersionCompleteness => 'complete' },
    });

    expect(result.candidates[0]!.versionResolution?.status).toBe('none_applicable');
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
    expect(retrieval.retrievedVersions).toEqual([]);
    expect(result.rejections).toEqual([
      { reference: R_L3121_V2.reference, reason: 'no_applicable_version' },
    ]);
  });

  it('13. asOf absent : ni resolver, ni saut, ni resolvedRetrieval', async () => {
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;
    const { resolver, calls } = spyResolver();
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
      query: withoutAsOf,
      options: { versionResolver: resolver },
    });

    expect(calls).toEqual([]);
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
    expect(result.candidates[0]).not.toHaveProperty('versionResolution');
    expect(retrieval.retrievedVersions).toEqual([]);
  });
});

describe('version cible — le saut', () => {
  it('2. resolved ≠ retrieved : un appel direct par id, sans SearchReference, provenance lisible', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const candidate = result.candidates[0]!;

    expect(retrieval.versionRequests).toEqual([
      { targetId: L36_V20, authority: 'legifrance', identifier: R_L36_V14.source.identifier },
    ]);
    expect(retrieval.versionRequests[0]).not.toHaveProperty('reference');
    expect(candidate.resolvedRetrieval).toEqual({ mode: 'retrieved', result: T_L36_V20 });
    expect(candidate.resolvedRetrieval?.result).toBe(T_L36_V20);
    // Provenance transitoire : candidat/référence initiale, source initiale, résolution, asOf, mode.
    expect(candidate.reference).toBe(R_L36_V14.reference);
    expect(candidate.retrieval).toBe(R_L36_V14);
    expect(candidate.versionResolution).toMatchObject({
      status: 'resolved',
      version: { id: L36_V20 },
    });
    expect(result.query.asOf).toBe(AS_OF_L36_V20);
    expect(result.rejections).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('3. cible déjà récupérée par un autre candidat : zéro appel, MÊME objet partagé (shared) ; l’autre reste initial', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V20],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const [first, second] = result.candidates;

    expect(retrieval.retrievedVersions).toEqual([]);
    expect(first!.resolvedRetrieval?.mode).toBe('shared');
    expect(first!.resolvedRetrieval?.result).toBe(R_L36_V20);
    expect(first!.retrieval).toBe(R_L36_V14);
    expect(second!.resolvedRetrieval?.mode).toBe('initial');
    expect(second!.resolvedRetrieval?.result).toBe(R_L36_V20);
    expect(result.rejections).toEqual([]);
  });

  it('4. plusieurs candidats du même article, cible non récupérée : UN seul appel, résultat partagé', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V1],
      targets: { [L36_V20]: T_L36_V20 },
    });

    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(result.candidates.map((c) => c.resolvedRetrieval?.mode)).toEqual([
      'retrieved',
      'retrieved',
    ]);
    expect(result.candidates[0]!.resolvedRetrieval?.result).toBe(T_L36_V20);
    expect(result.candidates[1]!.resolvedRetrieval?.result).toBe(T_L36_V20);
    // Chaque candidat garde sa propre source initiale.
    expect(result.candidates.map((c) => c.retrieval?.source.id)).toEqual([L36_V14, L36_V1]);
  });

  it('19. cible correspondant à un candidat non récupéré (échec primaire) : récupérée par id, le candidat en échec garde son rejet', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V20],
      failing: [L36_V20],
      targets: { [L36_V20]: T_L36_V20 },
      budget: { ...WIDE, maxRetrievedSources: 3 },
    });
    const failed = byId(result, L36_V20);

    expect(retrieval.retrieved).toEqual([L36_V14, L36_V20]);
    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(byId(result, L36_V14).resolvedRetrieval).toEqual({
      mode: 'retrieved',
      result: T_L36_V20,
    });
    expect(failed).not.toHaveProperty('retrieval');
    expect(failed).not.toHaveProperty('resolvedRetrieval');
    expect(result.rejections).toEqual([
      {
        reference: R_L36_V20.reference,
        reason: 'retrieval_failed',
        errorReason: 'execution_error',
      },
    ]);
  });
});

describe('version cible — budget partagé (maxRetrievedSources)', () => {
  it('5. budget exact (primaire + saut) : le saut est effectué, aucun rejet', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
      budget: { ...WIDE, maxRetrievedSources: 2 },
    });

    expect(retrieval.retrieved).toHaveLength(1);
    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(result.candidates[0]!.resolvedRetrieval?.mode).toBe('retrieved');
    expect(result.rejections).toEqual([]);
  });

  it('6. budget insuffisant : aucun appel, over_retrieval_budget (+ targetVersionId), resolvedRetrieval absent, aucun gap ajouté', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
      budget: { ...WIDE, maxRetrievedSources: 1 },
    });

    expect(retrieval.retrievedVersions).toEqual([]);
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
    expect(result.candidates[0]!.retrieval).toBe(R_L36_V14);
    expect(result.rejections).toEqual([
      { reference: R_L36_V14.reference, reason: 'over_retrieval_budget', targetVersionId: L36_V20 },
    ]);
    expect(result.gaps).toEqual([]);
  });

  it('20. plusieurs groupes, budget limité : premier groupe servi (ordre d’apparition), le suivant rejeté sans appel ; l’ordre inverse inverse le résultat', async () => {
    const budget = { ...WIDE, maxRetrievedSources: 3 };
    const targets = { [L36_V20]: T_L36_V20, [L3121_V2]: T_L3121_V2 };

    const forward = await run({ retrievals: [R_L36_V14, R_L3121_V1], targets, budget });
    expect(forward.retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(forward.result.rejections).toEqual([
      {
        reference: R_L3121_V1.reference,
        reason: 'over_retrieval_budget',
        targetVersionId: L3121_V2,
      },
    ]);
    expect(byId(forward.result, L36_V14).resolvedRetrieval?.mode).toBe('retrieved');
    expect(byId(forward.result, L3121_V1)).not.toHaveProperty('resolvedRetrieval');

    const reversed = await run({ retrievals: [R_L3121_V1, R_L36_V14], targets, budget });
    expect(reversed.retrieval.retrievedVersions).toEqual([L3121_V2]);
    expect(reversed.result.rejections).toEqual([
      { reference: R_L36_V14.reference, reason: 'over_retrieval_budget', targetVersionId: L36_V20 },
    ]);
  });

  it('un saut en échec consomme du budget (comme une récupération primaire en échec)', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L3121_V1],
      targets: { [L36_V20]: failure('execution_error'), [L3121_V2]: T_L3121_V2 },
      budget: { ...WIDE, maxRetrievedSources: 3 },
    });

    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(result.rejections.map((r) => [r.reason, r.targetVersionId])).toEqual([
      ['retrieval_failed', L36_V20],
      ['over_retrieval_budget', L3121_V2],
    ]);
  });

  it('une cible non supportée ne consomme aucun budget : le groupe suivant est servi', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L3121_V1],
      targets: { [L3121_V2]: T_L3121_V2 }, // la capacité existe mais refuse L36 (canRetrieveVersion = false)
      budget: { ...WIDE, maxRetrievedSources: 3 },
    });

    expect(retrieval.retrievedVersions).toEqual([L3121_V2]);
    expect(result.rejections).toEqual([
      { reference: R_L36_V14.reference, reason: 'not_retrievable', targetVersionId: L36_V20 },
    ]);
  });
});

describe('version cible — échecs explicites (jamais la mauvaise version comme applicable)', () => {
  it('capacité absente du port : not_retrievable, aucun appel', async () => {
    const { result, retrieval } = await run({ retrievals: [R_L36_V14] });

    expect(retrieval.retrievedVersions).toEqual([]);
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
    expect(result.candidates[0]!.retrieval).toBe(R_L36_V14);
    expect(result.rejections).toEqual([
      { reference: R_L36_V14.reference, reason: 'not_retrievable', targetVersionId: L36_V20 },
    ]);
  });

  it.each<ResearchProviderErrorReason>(['execution_error', 'denied', 'invalid_request'])(
    '7. échec de la récupération cible (%s) : retrieval_failed + errorReason + targetVersionId, resolvedRetrieval absent',
    async (reason) => {
      const { result } = await run({
        retrievals: [R_L36_V14],
        targets: { [L36_V20]: failure(reason) },
      });

      expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
      expect(result.candidates[0]!.retrieval).toBe(R_L36_V14);
      expect(result.rejections).toEqual([
        {
          reference: R_L36_V14.reference,
          reason: 'retrieval_failed',
          errorReason: reason,
          targetVersionId: L36_V20,
        },
      ]);
    },
  );

  it('8. réponse malformée signalée par le port : retrieval_failed / malformed_response', async () => {
    const { result } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: failure('malformed_response') },
    });

    expect(result.rejections).toEqual([
      {
        reference: R_L36_V14.reference,
        reason: 'retrieval_failed',
        errorReason: 'malformed_response',
        targetVersionId: L36_V20,
      },
    ]);
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
  });

  it('9. mauvais id (une autre version reçue) : retrieval_failed / malformed_response, aucun rattachement', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: targetOf(R_L36_V14) },
    });

    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
    expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
    expect(result.rejections).toEqual([
      {
        reference: R_L36_V14.reference,
        reason: 'retrieval_failed',
        errorReason: 'malformed_response',
        targetVersionId: L36_V20,
      },
    ]);
  });

  it.each([
    ['identifier', { identifier: 'LEGIARTI000000000001' }],
    ['authority', { authority: 'bofip' as const }],
  ])(
    '10. mauvais %s (bon id, autre article/autorité) : retrieval_failed / malformed_response',
    async (_label, override) => {
      const wrong: VersionTargetResult = {
        ...T_L36_V20,
        source: { ...T_L36_V20.source, ...override },
      };
      const { result } = await run({ retrievals: [R_L36_V14], targets: { [L36_V20]: wrong } });

      expect(result.candidates[0]).not.toHaveProperty('resolvedRetrieval');
      expect(result.rejections.map((r) => [r.reason, r.errorReason, r.targetVersionId])).toEqual([
        ['retrieval_failed', 'malformed_response', L36_V20],
      ]);
    },
  );

  it('une exception qui n’est pas une ResearchProviderError (bug) est propagée, jamais convertie en rejet', async () => {
    const page: SearchResultPage = {
      references: [R_L36_V14.reference],
      skipped: [],
      metadata: { page: 1, pageSize: 5, resultCount: 1 },
    };
    const retrieval = new FakeRetrievalPort(
      { [L36_V14]: R_L36_V14 },
      { versionTargets: { [L36_V20]: T_L36_V20 } },
    );
    retrieval.retrieveVersion = async () => {
      throw new TypeError('bug');
    };
    const engine = new ResearchEngine({ search: new FakeSearchPort({ 1: page }), retrieval });

    await expect(engine.research(withAsOf(AS_OF_L36_V20), WIDE)).rejects.toThrow(TypeError);
  });
});

describe('version cible — un seul saut, pureté, déterminisme', () => {
  it('17/18. un seul saut, le resolver n’est appelé qu’une fois par groupe, même si le résultat cible apporte un autre historique', async () => {
    const { resolver, calls } = spyResolver();
    // Le résultat cible « propose » une v21 couvrant asOf : elle ne doit provoquer ni nouvelle résolution ni nouveau saut.
    const withOtherHistory: VersionTargetResult = {
      ...T_L36_V20,
      versions: [
        ...T_L36_V20.versions,
        { id: 'LEGIARTI000099999999', effectiveFrom: '2024-01-01', effectiveTo: '2030-01-01' },
      ],
      previousVersionId: 'LEGIARTI000099999998',
    };
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V1, R_L3121_V1],
      targets: { [L36_V20]: withOtherHistory, [L3121_V2]: T_L3121_V2 },
      options: { versionResolver: resolver },
    });

    expect(calls).toHaveLength(2); // un par groupe (L36-11, L3121-27), aucun après les sauts
    expect(retrieval.retrievedVersions).toEqual([L36_V20, L3121_V2]); // au plus un par groupe
    expect(byId(result, L36_V14).versionResolution).toMatchObject({ version: { id: L36_V20 } });
    expect(byId(result, L36_V14).resolvedRetrieval?.result).toBe(withOtherHistory);
    expect(result.rejections).toEqual([]);
  });

  it('14. permutation des candidats : même rattachement par candidat, même nombre d’appels', async () => {
    const targets = { [L36_V20]: T_L36_V20, [L3121_V2]: T_L3121_V2 };
    const summarize = (result: ResearchResult) =>
      result.candidates
        .map((c) => [
          c.reference.candidateId,
          c.resolvedRetrieval?.mode,
          c.resolvedRetrieval?.result.source.id,
        ])
        .sort();

    const a = await run({ retrievals: [R_L36_V14, R_L36_V1, R_L3121_V1], targets });
    const b = await run({ retrievals: [R_L3121_V1, R_L36_V1, R_L36_V14], targets });

    expect(summarize(a.result)).toEqual(summarize(b.result));
    expect(a.retrieval.retrievedVersions.slice().sort()).toEqual(
      b.retrieval.retrievedVersions.slice().sort(),
    );
    expect(a.retrieval.retrievedVersions).toHaveLength(2);
    expect(a.result.rejections).toEqual(b.result.rejections);
  });

  it('15. aucune mutation : entrées gelées en profondeur, objets d’entrée réutilisés tels quels', async () => {
    const retrievals = deepFreeze([R_L36_V14, R_L36_V1].map((r) => structuredClone(r)));
    const target = deepFreeze(structuredClone(T_L36_V20));
    const query = deepFreeze({ ...withAsOf(AS_OF_L36_V20) });
    const budget = deepFreeze({ ...WIDE });
    const before = JSON.stringify({ retrievals, target, query, budget });

    const { result } = await run({
      retrievals,
      targets: { [L36_V20]: target },
      query,
      budget,
    });

    expect(JSON.stringify({ retrievals, target, query, budget })).toBe(before);
    expect(result.candidates[0]!.retrieval).toBe(retrievals[0]);
    expect(result.candidates[0]!.resolvedRetrieval?.result).toBe(target);
  });

  it('16. aucun appel inattendu : exactement une recherche, les récupérations primaires prévues et un seul appel de version', async () => {
    const { search, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V1, R_L3121_V2],
      targets: { [L36_V20]: T_L36_V20 },
    });

    expect(search.queries).toHaveLength(1);
    expect(retrieval.retrieved).toEqual([L36_V14, L36_V1, L3121_V2]);
    expect(retrieval.retrievedVersions).toEqual([L36_V20]);
  });

  it('deux exécutions identiques donnent le même résultat', async () => {
    const setup = { retrievals: [R_L36_V14, R_L36_V1], targets: { [L36_V20]: T_L36_V20 } };
    expect((await run(setup)).result).toEqual((await run(setup)).result);
  });
});

describe('contenu juridique transitoire (ADR-0021) — suit les résultats, sans appel ni budget en plus', () => {
  it('6. shared : le contenu du résultat partagé est conservé (même objet), aucun appel de version', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L36_V14, R_L36_V20],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const [first, second] = result.candidates;

    expect(first!.resolvedRetrieval?.mode).toBe('shared');
    expect(first!.resolvedRetrieval?.result.content).toBeDefined();
    expect(first!.resolvedRetrieval?.result.content).toBe(R_L36_V20.content);
    expect(second!.resolvedRetrieval?.result.content).toBe(R_L36_V20.content);
    expect(first!.retrieval?.content).toBe(R_L36_V14.content);
    expect(retrieval.retrievedVersions).toEqual([]); // aucun appel réseau supplémentaire
    expect(retrieval.retrieved).toEqual([L36_V14, L36_V20]);
  });

  it('5. initial : le contenu de la version résolue est celui déjà capturé par le candidat', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L3121_V2],
      query: withAsOf('2020-01-01'),
    });
    const candidate = result.candidates[0]!;

    expect(candidate.resolvedRetrieval?.mode).toBe('initial');
    expect(candidate.resolvedRetrieval?.result.content).toBe(candidate.retrieval?.content);
    expect(candidate.retrieval?.content?.revealText()).toBe('Texte factice version 2.');
    expect(retrieval.retrievedVersions).toEqual([]);
  });

  it('7/8. retrieved : version initiale ≠ résolue, chaque résultat a son propre contenu et son propre hash', async () => {
    const { result, retrieval } = await run({
      retrievals: [R_L3121_V1],
      targets: { [L3121_V2]: T_L3121_V2 },
    });
    const candidate = result.candidates[0]!;
    const initial = candidate.retrieval!;
    const resolved = candidate.resolvedRetrieval!;

    expect(resolved.mode).toBe('retrieved');
    expect(initial.content?.revealText()).toBe('Texte factice version 1.');
    expect(resolved.result.content?.revealText()).toBe('Texte factice version 2.');
    expect(initial.content?.contentHash).toBe(initial.source.contentHash);
    expect(resolved.result.content?.contentHash).toBe(resolved.result.source.contentHash);
    expect(initial.content?.contentHash).not.toBe(resolved.result.content?.contentHash);
    expect(retrieval.retrievedVersions).toEqual([L3121_V2]); // un seul appel, comme avant
  });

  it('un port sans contenu reste valide : content absent, aucune erreur, aucun changement de comportement', async () => {
    const { content: _c1, ...bareInitial } = R_L3121_V1;
    const { content: _c2, ...bareTarget } = T_L3121_V2;
    void _c1;
    void _c2;
    const { result } = await run({
      retrievals: [bareInitial],
      targets: { [L3121_V2]: bareTarget },
    });

    expect(result.candidates[0]!.resolvedRetrieval?.mode).toBe('retrieved');
    expect(result.candidates[0]!.retrieval).not.toHaveProperty('content');
    expect(result.rejections).toEqual([]);
  });

  it('9. le ResearchResult sérialisé ne contient jamais le texte', async () => {
    const { result } = await run({
      retrievals: [R_L3121_V1, R_L36_V14],
      targets: { [L3121_V2]: T_L3121_V2, [L36_V20]: T_L36_V20 },
    });

    const json = JSON.stringify(result);
    expect(json).not.toContain('Texte factice');
    expect(json).toContain('"redacted":true');
  });
});
