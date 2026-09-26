import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachSourcesAndCitations,
  createLegalCase,
  parseLegalCaseFile,
  serializeLegalCaseFile,
  validateLegalCaseV3,
  type LegalSource,
} from '@jarvis/legal-core';

import { ResearchProviderError } from './ports.js';
import { projectCitations } from './citation-projection.js';
import { ResearchEngine, type ResearchEngineOptions } from './research-engine.js';
import type { ResearchBudget, ResearchCandidate, ResearchResult } from './research-types.js';
import type { RetrievalResult, VersionTargetResult } from './retrieval-types.js';
import type { SearchQuery, SearchResultPage } from './search-types.js';
import type { VersionCompleteness } from './temporal-types.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import {
  ARTICLE_57_RAW,
  L3121_27_V2_RAW,
  L36_11_V14_RAW,
  QUERY,
  SENTINEL_MS,
} from './testing/fixtures.js';
import { deepFreeze, retrievalOf, targetOf } from './testing/version-resolver-helpers.js';

/**
 * Projection `ResearchResult` → sources + citations de niveau source (ADR-0020).
 * Sans réseau : fakes des ports pour produire de vrais `ResearchResult`, ou
 * résultats construits à la main pour les cas que le moteur ne peut pas produire.
 */

const WIDE: ResearchBudget = { maxSearchPages: 3, maxCandidates: 50, maxRetrievedSources: 50 };
const QUESTION = { id: 'q-1' };
const L36_V14 = 'LEGIARTI000033219357';
const L36_V20 = 'LEGIARTI000049571362';
const AS_OF_L36_V20 = '2024-06-01';

const L36_11_V20_RAW = {
  ...L36_11_V14_RAW,
  id: L36_V20,
  versionArticle: '20.0',
  etat: 'VIGUEUR',
  dateDebut: 1716422400000,
  dateFin: SENTINEL_MS,
  versionPrecedente: 'LEGIARTI000049571361',
};

const R_L36_V14 = retrievalOf(L36_11_V14_RAW);
const R_L36_V20 = retrievalOf(L36_11_V20_RAW);
const R_L3121_V2 = retrievalOf(L3121_27_V2_RAW);
const R_ART57 = retrievalOf(ARTICLE_57_RAW);
const T_L36_V20 = targetOf(R_L36_V20);

const withAsOf = (asOf: string): SearchQuery => ({ ...QUERY, asOf });

interface Setup {
  readonly retrievals: readonly RetrievalResult[];
  readonly targets?: Readonly<Record<string, VersionTargetResult | ResearchProviderError>>;
  readonly failing?: readonly string[];
  readonly query?: SearchQuery;
  readonly budget?: ResearchBudget;
  readonly options?: Partial<ResearchEngineOptions>;
}

/** Vrai `ResearchResult`, produit par le moteur avec des fakes de ports. */
async function research(setup: Setup) {
  const page: SearchResultPage = {
    references: setup.retrievals.map((r) => r.reference),
    skipped: [],
    metadata: { page: 1, pageSize: 5, resultCount: setup.retrievals.length },
  };
  const search = new FakeSearchPort({ 1: page });
  const outcomes: Record<string, RetrievalResult | ResearchProviderError> = {};
  for (const r of setup.retrievals) outcomes[r.reference.candidateId] = r;
  for (const id of setup.failing ?? [])
    outcomes[id] = new ResearchProviderError('fake', 'execution_error', 'échec simulé.');
  const retrieval = new FakeRetrievalPort(outcomes, { versionTargets: setup.targets });
  const engine = new ResearchEngine({ search, retrieval, ...setup.options });
  const result = await engine.research(
    setup.query ?? withAsOf(AS_OF_L36_V20),
    setup.budget ?? WIDE,
  );
  return { result, search, retrieval };
}

// --- résultats construits à la main (cas que le moteur ne produit pas) ---------------------------

const BASE_SOURCE: LegalSource = R_L3121_V2.source;

function resolvedCandidate(
  source: LegalSource,
  options: {
    completeness?: VersionCompleteness;
    initialSource?: LegalSource;
    candidateId?: string;
    /** Id de la version que le resolver a désignée ; par défaut, celui de `source`. */
    resolvedId?: string;
  } = {},
): ResearchCandidate {
  const initial = options.initialSource ?? source;
  const reference = {
    ...R_L3121_V2.reference,
    candidateId: options.candidateId ?? initial.id,
  };
  const retrieval: RetrievalResult = { source: initial, versions: [], reference };
  return {
    reference,
    sightings: [reference.provenance],
    retrieval,
    versionResolution: { status: 'resolved', version: { id: options.resolvedId ?? source.id } },
    ...(options.completeness !== undefined ? { historyCompleteness: options.completeness } : {}),
    resolvedRetrieval: {
      mode: 'initial',
      result: source === initial ? retrieval : { source, versions: [], reference },
    },
  };
}

function handBuilt(
  candidates: readonly ResearchCandidate[],
  query: SearchQuery = withAsOf('2020-01-01'),
): ResearchResult {
  return { query, budget: WIDE, candidates, rejections: [], gaps: [], skipped: [] };
}

const at = (consultedAt: string, extra: Partial<LegalSource> = {}): LegalSource => ({
  ...BASE_SOURCE,
  consultedAt,
  ...extra,
});

describe('projection — éligibilité (retrouvée + applicable)', () => {
  it('1. candidat resolved (initial) → une source et une citation de niveau source', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const projection = projectCitations(result, QUESTION);

    expect(projection.sources).toEqual([R_L3121_V2.source]);
    expect(projection.citations).toHaveLength(1);
    expect(projection.citations[0]).toMatchObject({
      sourceId: R_L3121_V2.source.id,
      sourceVersion: '2.0',
      contentHash: R_L3121_V2.source.contentHash,
      consultedAt: R_L3121_V2.source.consultedAt,
      eligibility: {
        questionId: 'q-1',
        asOf: '2020-01-01',
        resolution: 'resolved',
        historyCompleteness: 'unknown',
      },
    });
    expect(projection.citations[0]).not.toHaveProperty('pinpoint');
    expect(projection.citations[0]).not.toHaveProperty('quotedText');
    expect(projection.ineligible).toEqual([]);
  });

  it('19. retrouvée ≠ applicable : la citation vise la version applicable (retrieved), pas la version trouvée', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const projection = projectCitations(result, QUESTION);

    expect(result.candidates[0]!.retrieval?.source.id).toBe(L36_V14);
    expect(projection.sources.map((s) => s.id)).toEqual([L36_V20]);
    expect(projection.citations.map((c) => [c.sourceId, c.sourceVersion])).toEqual([
      [L36_V20, '20.0'],
    ]);
  });

  it('2. indeterminate → aucune citation', async () => {
    const { result } = await research({ retrievals: [R_L36_V14], query: withAsOf('2020-01-01') });
    const projection = projectCitations(result, QUESTION);

    expect(projection.citations).toEqual([]);
    expect(projection.sources).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['indeterminate']);
  });

  it('3. none_applicable → aucune citation', async () => {
    const { result } = await research({
      retrievals: [R_L3121_V2],
      query: withAsOf('2012-06-15'),
      options: { historyCompleteness: (): VersionCompleteness => 'complete' },
    });
    const projection = projectCitations(result, QUESTION);

    expect(result.candidates[0]!.versionResolution?.status).toBe('none_applicable');
    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['none_applicable']);
  });

  it('4. retrieval_failed → aucune citation', async () => {
    const { result } = await research({ retrievals: [R_L36_V14], failing: [L36_V14] });
    const projection = projectCitations(result, QUESTION);

    expect(result.rejections.map((r) => r.reason)).toEqual(['retrieval_failed']);
    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['no_retrieval']);
  });

  it('5. not_retrievable (cible non récupérable : port sans la capacité) → aucune citation', async () => {
    const { result } = await research({ retrievals: [R_L36_V14] }); // resolved v20 mais aucune capacité
    const projection = projectCitations(result, QUESTION);

    expect(result.rejections.map((r) => r.reason)).toEqual(['not_retrievable']);
    expect(result.candidates[0]!.versionResolution?.status).toBe('resolved');
    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['no_resolved_retrieval']);
  });

  it('6. budget_truncated → aucune citation, aucune source', async () => {
    const { result } = await research({
      retrievals: [R_L3121_V2, R_ART57],
      query: withAsOf('2020-01-01'),
      budget: { ...WIDE, maxRetrievedSources: 0 },
    });
    const projection = projectCitations(result, QUESTION);

    expect(result.gaps.map((g) => g.kind)).toContain('budget_truncated');
    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['no_retrieval', 'no_retrieval']);
  });

  it('budget de récupération épuisé avant le saut : over_retrieval_budget → aucune citation', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
      budget: { ...WIDE, maxRetrievedSources: 1 },
    });
    const projection = projectCitations(result, QUESTION);

    expect(result.rejections.map((r) => r.reason)).toEqual(['over_retrieval_budget']);
    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['no_resolved_retrieval']);
  });

  it('12/18. sans asOf : aucune résolution, aucune citation, jamais de date implicite', async () => {
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;
    const { result } = await research({ retrievals: [R_L3121_V2], query: withoutAsOf });
    const projection = projectCitations(result, QUESTION);

    expect(result.candidates[0]).not.toHaveProperty('versionResolution');
    expect(projection.citations).toEqual([]);
    expect(projection.sources).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['no_version_resolution']);
    // Aucune date « aujourd'hui » n'est fabriquée dans une citation (la provenance de recherche des inéligibles n'est pas concernée).
    expect(JSON.stringify(projection.citations)).not.toContain(
      new Date().toISOString().slice(0, 10),
    );
  });

  it('18. résultat incohérent (resolved mais query.asOf absent) : jamais remplacé par une date implicite', () => {
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;
    const projection = projectCitations(
      handBuilt([resolvedCandidate(BASE_SOURCE)], withoutAsOf),
      QUESTION,
    );

    expect(projection.citations).toEqual([]);
    expect(projection.ineligible.map((i) => i.reason)).toEqual(['invalid_resolved_retrieval']);
  });

  it('13. source malformée ou incohérente → aucune citation (jamais une citation partielle)', () => {
    const cases: [string, ResearchCandidate][] = [
      [
        'id de la source ≠ version résolue',
        resolvedCandidate(BASE_SOURCE, {
          resolvedId: 'LEGIARTI000000000009',
        }),
      ],
      [
        'autre identifier que la source initiale',
        resolvedCandidate(
          { ...BASE_SOURCE, identifier: 'LEGIARTI000000000008' },
          {
            initialSource: BASE_SOURCE,
          },
        ),
      ],
      ['champ requis absent (version)', resolvedCandidate({ ...BASE_SOURCE, version: '' })],
      ['empreinte mal formée', resolvedCandidate({ ...BASE_SOURCE, contentHash: 'pas-un-hash' })],
      [
        'autorité incohérente avec la référence',
        resolvedCandidate({ ...BASE_SOURCE, authority: 'bofip' }),
      ],
    ];
    for (const [label, candidate] of cases) {
      const projection = projectCitations(handBuilt([candidate]), QUESTION);
      expect(projection.citations, label).toEqual([]);
      expect(
        projection.ineligible.map((i) => i.reason),
        label,
      ).toEqual(['invalid_resolved_retrieval']);
    }

    const notAnObject = {
      ...resolvedCandidate(BASE_SOURCE),
      resolvedRetrieval: { mode: 'initial', result: { source: 'oops' } },
    } as unknown as ResearchCandidate;
    const noResult = {
      ...resolvedCandidate(BASE_SOURCE),
      resolvedRetrieval: { mode: 'initial' },
    } as unknown as ResearchCandidate;
    for (const candidate of [notAnObject, noResult]) {
      const projection = projectCitations(handBuilt([candidate]), QUESTION);
      expect(projection.citations).toEqual([]);
      expect(projection.ineligible.map((i) => i.reason)).toEqual(['invalid_resolved_retrieval']);
    }
  });
});

describe('projection — incertitude historique (D3)', () => {
  it('7. resolved + history unknown : citation créée ET incertitude conservée', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });

    expect(result.candidates[0]!.historyCompleteness).toBe('unknown');
    const [citation] = projectCitations(result, QUESTION).citations;
    expect(citation!.eligibility?.resolution).toBe('resolved');
    expect(citation!.eligibility?.historyCompleteness).toBe('unknown');
  });

  it('historique déclaré complet par le moteur : conservé tel quel (distinct de unknown)', async () => {
    const { result } = await research({
      retrievals: [R_L3121_V2],
      query: withAsOf('2020-01-01'),
      options: { historyCompleteness: (): VersionCompleteness => 'complete' },
    });
    const [citation] = projectCitations(result, QUESTION).citations;
    expect(citation!.eligibility?.historyCompleteness).toBe('complete');
  });

  it('exhaustivité non consignée : se lit unknown, jamais complete par défaut', () => {
    const [citation] = projectCitations(
      handBuilt([resolvedCandidate(BASE_SOURCE)]),
      QUESTION,
    ).citations;
    expect(citation!.eligibility?.historyCompleteness).toBe('unknown');
  });

  it('un groupe dédupliqué n’est complete que si tous ses candidats le déclarent', () => {
    const a = resolvedCandidate(at('2026-01-01T00:00:00.000Z'), {
      completeness: 'complete',
      candidateId: 'LEGIARTI000000000101',
    });
    const b = resolvedCandidate(at('2026-01-02T00:00:00.000Z'), {
      completeness: 'unknown',
      candidateId: 'LEGIARTI000000000102',
    });
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const { citations } = projectCitations(handBuilt(order), QUESTION);
      expect(citations).toHaveLength(1);
      expect(citations[0]!.eligibility?.historyCompleteness).toBe('unknown');
    }
  });
});

describe('projection — déduplication authority + identifier + version (D6)', () => {
  it('8. même version rencontrée deux fois (initial + shared) → une seule citation', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14, R_L36_V20],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const projection = projectCitations(result, QUESTION);

    expect(result.candidates.map((c) => c.resolvedRetrieval?.mode)).toEqual(['shared', 'initial']);
    expect(projection.sources).toHaveLength(1);
    expect(projection.citations).toHaveLength(1);
    expect(projection.ineligible).toEqual([]);
  });

  it('9. mêmes source/version, consultedAt différents → une seule citation logique, la plus ancienne consultation', () => {
    const early = at('2026-09-23T18:00:00.000Z');
    const late = at('2026-09-24T09:00:00.000Z');
    const forward = projectCitations(
      handBuilt([
        resolvedCandidate(late, { candidateId: 'LEGIARTI000000000201' }),
        resolvedCandidate(early, { candidateId: 'LEGIARTI000000000202' }),
      ]),
      QUESTION,
    );
    const reversed = projectCitations(
      handBuilt([
        resolvedCandidate(early, { candidateId: 'LEGIARTI000000000202' }),
        resolvedCandidate(late, { candidateId: 'LEGIARTI000000000201' }),
      ]),
      QUESTION,
    );

    expect(forward.citations).toHaveLength(1);
    expect(forward.citations[0]!.consultedAt).toBe('2026-09-23T18:00:00.000Z');
    expect(forward.citations).toEqual(reversed.citations);
    expect(forward.sources).toEqual(reversed.sources);
  });

  it('identité logique, pas source.id seul : deux id techniques pour une même version → une citation, choix indépendant de l’ordre', () => {
    const a = at('2026-09-23T18:00:00.000Z', { id: 'LEGIARTI000033020399' });
    const b = at('2026-09-23T18:00:00.000Z');
    const forward = projectCitations(
      handBuilt([
        resolvedCandidate(a, { candidateId: 'LEGIARTI000000000301' }),
        resolvedCandidate(b, { candidateId: 'LEGIARTI000000000302' }),
      ]),
      QUESTION,
    );
    const reversed = projectCitations(
      handBuilt([
        resolvedCandidate(b, { candidateId: 'LEGIARTI000000000302' }),
        resolvedCandidate(a, { candidateId: 'LEGIARTI000000000301' }),
      ]),
      QUESTION,
    );

    expect(forward.citations).toHaveLength(1);
    expect(forward.citations[0]!.sourceId).toBe(BASE_SOURCE.id); // à égalité de consultedAt : id le plus petit
    expect(forward.citations).toEqual(reversed.citations);
  });

  it('10. deux versions différentes du même identifier → deux citations', () => {
    const v3 = at('2026-09-23T18:00:00.000Z', {
      id: 'LEGIARTI000033020388',
      version: '3.0',
      effectiveFrom: '2030-01-01T00:00:00.000Z',
    });
    const { citations, sources } = projectCitations(
      handBuilt([resolvedCandidate(BASE_SOURCE), resolvedCandidate(v3)]),
      QUESTION,
    );

    expect(sources).toHaveLength(2);
    expect(citations.map((c) => c.sourceVersion)).toEqual(['2.0', '3.0']);
    expect(new Set(citations.map((c) => c.id)).size).toBe(2);
  });

  it('11. deux identifiers différents → deux citations', async () => {
    const { result } = await research({
      retrievals: [R_L3121_V2, R_ART57],
      query: withAsOf('2020-01-01'),
    });
    const { citations } = projectCitations(result, QUESTION);

    expect(citations).toHaveLength(2);
    expect(new Set(citations.map((c) => c.id)).size).toBe(2);
  });

  it('même identité logique mais empreintes de contenu différentes : contradiction, aucune citation', () => {
    const a = at('2026-09-23T18:00:00.000Z');
    const b = at('2026-09-24T18:00:00.000Z', { contentHash: 'a'.repeat(64) });
    const { citations, sources, ineligible } = projectCitations(
      handBuilt([
        resolvedCandidate(a, { candidateId: 'LEGIARTI000000000401' }),
        resolvedCandidate(b, { candidateId: 'LEGIARTI000000000402' }),
      ]),
      QUESTION,
    );

    expect(citations).toEqual([]);
    expect(sources).toEqual([]);
    expect(ineligible.map((i) => i.reason)).toEqual([
      'conflicting_source_content',
      'conflicting_source_content',
    ]);
  });

  it('l’id de citation est déterministe et propre à (question, asOf, identité logique)', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const [base] = projectCitations(result, QUESTION).citations;
    const [again] = projectCitations(result, QUESTION).citations;
    const [otherQuestion] = projectCitations(result, { id: 'q-2' }).citations;
    const { result: otherAsOf } = await research({
      retrievals: [R_L3121_V2],
      query: withAsOf('2021-01-01'),
    });
    const [otherDate] = projectCitations(otherAsOf, QUESTION).citations;

    expect(again!.id).toBe(base!.id);
    expect(otherQuestion!.id).not.toBe(base!.id);
    expect(otherDate!.id).not.toBe(base!.id);
  });
});

describe('projection — pureté, déterminisme, périmètre', () => {
  it('14. idempotente : deux projections d’un même résultat sont égales', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14, R_L3121_V2, R_ART57],
      targets: { [L36_V20]: T_L36_V20 },
    });
    expect(projectCitations(result, QUESTION)).toEqual(projectCitations(result, QUESTION));
  });

  it('15. aucune mutation : résultat gelé en profondeur, contenu inchangé', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14, R_L3121_V2],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const frozen = deepFreeze(structuredClone(result));
    const before = JSON.stringify(frozen);

    const projection = projectCitations(frozen, deepFreeze({ ...QUESTION }));

    expect(JSON.stringify(frozen)).toBe(before);
    expect(projection.citations.length).toBeGreaterThan(0);
  });

  it('16/17. questionId et asOf conservés ; question sans id refusée', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const [citation] = projectCitations(result, { id: 'question-42' }).citations;

    expect(citation!.eligibility).toMatchObject({ questionId: 'question-42', asOf: '2020-01-01' });
    expect(() => projectCitations(result, { id: '' })).toThrow(RangeError);
  });

  it('20. aucune décision de pertinence, de score ni de preuve : seuls les champs prévus existent', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const [citation] = projectCitations(result, QUESTION).citations;

    expect(Object.keys(citation!).sort()).toEqual([
      'consultedAt',
      'contentHash',
      'eligibility',
      'id',
      'sourceId',
      'sourceVersion',
    ]);
    expect(Object.keys(citation!.eligibility!).sort()).toEqual([
      'asOf',
      'historyCompleteness',
      'questionId',
      'resolution',
    ]);
    expect(JSON.stringify(citation)).not.toMatch(/relevan|score|confidence|strength|rank/i);
  });

  it('21/22. aucun appel réseau, aucun LLM : les ports ne sont pas sollicités, le module n’importe que legal-core', async () => {
    const { result, search, retrieval } = await research({
      retrievals: [R_L36_V14],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const calls = [
      search.queries.length,
      retrieval.retrieved.length,
      retrieval.retrievedVersions.length,
    ];

    projectCitations(result, QUESTION);

    expect([
      search.queries.length,
      retrieval.retrieved.length,
      retrieval.retrievedVersions.length,
    ]).toEqual(calls);
    const code = readFileSync(join(__dirname, 'citation-projection.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.filter((m) => m!.startsWith('@jarvis/'))).toEqual(['@jarvis/legal-core']);
    expect(code).not.toMatch(/\bfetch\s*\(|\bawait\b|\basync\b/);
  });
});

describe('projection → LegalCase (rattachement, validation, persistance)', () => {
  const caseWithQuestion = () =>
    ({
      ...createLegalCase({ title: 'Dossier', id: 'case-1', createdAt: '2026-09-24T00:00:00.000Z' }),
      questions: [{ id: 'q-1', question: 'Quel préavis ?', status: 'open' as const }],
    }) as ReturnType<typeof createLegalCase>;

  it('23. le dossier reste valide après rattachement, question → citation → source', async () => {
    const { result } = await research({
      retrievals: [R_L36_V14, R_L3121_V2],
      targets: { [L36_V20]: T_L36_V20 },
    });
    const projection = projectCitations(result, QUESTION);

    const attached = attachSourcesAndCitations(caseWithQuestion(), projection);

    expect(validateLegalCaseV3(attached)).toEqual({ ok: true });
    expect(attached.sources).toHaveLength(2);
    expect(attached.citations.map((c) => c.eligibility?.questionId)).toEqual(['q-1', 'q-1']);
    expect(attached.research).toEqual([]); // aucun LegalResearchItem
    expect(attached.arguments).toEqual([]);
    expect(attached.conclusions).toEqual([]);
  });

  it('rattachement idempotent : rejouer la même projection ne change rien', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const projection = projectCitations(result, QUESTION);

    const once = attachSourcesAndCitations(caseWithQuestion(), projection);
    const twice = attachSourcesAndCitations(once, projectCitations(result, QUESTION));

    expect(twice).toBe(once);
  });

  it('26. une citation dont la question n’existe pas dans le dossier est refusée', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const projection = projectCitations(result, { id: 'question-absente' });

    expect(() => attachSourcesAndCitations(caseWithQuestion(), projection)).toThrow(
      /question inconnue/,
    );
  });

  it('24. persistée puis rechargée : provenance, incertitude et empreinte conservées', async () => {
    const { result } = await research({ retrievals: [R_L3121_V2], query: withAsOf('2020-01-01') });
    const attached = attachSourcesAndCitations(
      caseWithQuestion(),
      projectCitations(result, QUESTION),
    );

    const reloaded = parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(attached)) as unknown);

    expect(reloaded).toEqual(attached);
    expect(reloaded.citations[0]!.eligibility).toEqual({
      questionId: 'q-1',
      asOf: '2020-01-01',
      resolution: 'resolved',
      historyCompleteness: 'unknown',
    });
    expect(reloaded.citations[0]!.contentHash).toBe(R_L3121_V2.source.contentHash);
  });

  it('même version consultée deux fois avec consultedAt différent : une seule source dans le dossier', () => {
    const a = at('2026-09-23T18:00:00.000Z');
    const b = at('2026-09-24T09:00:00.000Z', { id: 'LEGIARTI000033020399' });
    const first = projectCitations(handBuilt([resolvedCandidate(a)]), QUESTION);
    const second = projectCitations(handBuilt([resolvedCandidate(b)]), QUESTION);

    const once = attachSourcesAndCitations(caseWithQuestion(), first);
    const twice = attachSourcesAndCitations(once, second);

    expect(twice.sources).toHaveLength(1);
    expect(twice.citations).toHaveLength(1);
    expect(twice).toBe(once);
  });
});
