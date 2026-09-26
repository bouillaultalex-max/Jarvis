import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry, valid, type Tool } from '@jarvis/core';

import { LegifranceRetrievalAdapter } from '../legifrance-retrieval-adapter.js';
import { LegifranceSearchAdapter } from '../legifrance-search-adapter.js';
import { LegifranceSourceProvider } from '../legifrance-source-provider.js';
import { ResearchEngine } from './research-engine.js';
import {
  createLegalCase,
  attachSourcesAndCitations,
  serializeLegalCaseFile,
} from '@jarvis/legal-core';

import { projectCitations } from './citation-projection.js';
import { L3121_27_V1_RAW, L3121_27_V2_RAW } from './testing/fixtures.js';
import { extract, NOMINAL_OUTPUT, output, result } from './testing/legifrance-search-fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');

function rawArticle(id: string): Record<string, unknown> {
  if (id === L3121_27_V2_RAW.id) return L3121_27_V2_RAW;
  return id === L3121_27_V1_RAW.id
    ? L3121_27_V1_RAW
    : {
        id,
        cid: id,
        nature: 'Article',
        num: 'X',
        texte: `Texte factice ${id}.`,
        versionArticle: '1.0',
        dateDebut: Date.UTC(2008, 4, 1),
        dateFin: 32472144000000,
        versionPrecedente: null,
        articleVersions: [],
      };
}

/** Chaîne complète sans réseau : ResearchEngine → adaptateurs → ToolExecutor → deux fausses Tools. */
function buildPipeline(searchOutput: unknown = NOMINAL_OUTPUT) {
  const executions: string[] = [];
  const searchTool: Tool<unknown, unknown> = {
    name: 'legifrance.search',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: {} },
    validateInput: (input) => valid(input),
    async execute() {
      executions.push('legifrance.search');
      return searchOutput;
    },
  };
  const getArticleTool: Tool<{ id: string }, unknown> = {
    name: 'legifrance.get_article',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    validateInput: (input) => valid(input as { id: string }),
    async execute(input) {
      executions.push(`legifrance.get_article:${input.id}`);
      return rawArticle(input.id);
    },
  };
  const registry = new ToolRegistry();
  registry.register(searchTool);
  registry.register(getArticleTool as Tool);
  const toolExecutor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

  const engine = new ResearchEngine({
    search: new LegifranceSearchAdapter({ toolExecutor, now: NOW }),
    retrieval: new LegifranceRetrievalAdapter({
      provider: new LegifranceSourceProvider({ toolExecutor, now: NOW }),
    }),
  });
  return { engine, executions };
}

const QUERY = {
  text: 'préavis démission',
  matchMode: 'all_terms',
  asOf: '2019-05-24',
  page: { number: 1, size: 5 },
} as const;

describe('Research Engine — chaîne complète sans réseau', () => {
  it('Search → SearchReference → déduplication → budget → getArticle → LegalSource, uniquement via ToolExecutor', async () => {
    const { engine, executions } = buildPipeline();

    const result = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 10,
    });

    expect(executions).toEqual([
      'legifrance.search',
      'legifrance.get_article:LEGIARTI000006901174',
      'legifrance.get_article:LEGIARTI000006900916',
      'legifrance.get_article:LEGIARTI000006900954',
      'legifrance.get_article:LEGIARTI000006902466',
      // Un seul saut : la v1.0 abrogée de L3121-27 se résout (2019) vers la v2.0, récupérée par id (ADR-0019).
      'legifrance.get_article:LEGIARTI000033020376',
    ]);
    expect(result.candidates.map((c) => c.retrieval?.source.id)).toEqual([
      'LEGIARTI000006901174',
      'LEGIARTI000006900916',
      'LEGIARTI000006900954',
      'LEGIARTI000006902466',
    ]);
    expect(result.candidates[0]!.reference.provenance).toMatchObject({
      providerId: 'legifrance',
      collection: 'CODE_DATE',
      resultId: 'LEGITEXT000006072050_24-05-2019',
    });
    expect(result.gaps).toEqual([{ kind: 'unexposed_articles', count: 14 }]);
    expect(result.rejections).toEqual([]);
  });

  it('le budget de récupération borne les appels getArticle réellement exécutés par le ToolExecutor', async () => {
    const { engine, executions } = buildPipeline();

    const result = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 2,
    });

    expect(executions.filter((e) => e.startsWith('legifrance.get_article'))).toHaveLength(2);
    expect(result.rejections.map((r) => r.reason)).toEqual([
      'over_retrieval_budget',
      'over_retrieval_budget',
    ]);
  });

  it('aucune LegalSource ne porte de texte ; le résultat de recherche ne contient aucune conclusion ni LegalResearchItem', async () => {
    const { engine } = buildPipeline();
    const result = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 10,
    });

    expect(JSON.stringify(result)).not.toContain('Texte factice');
    expect(Object.keys(result).sort()).toEqual([
      'budget',
      'candidates',
      'gaps',
      'query',
      'rejections',
      'skipped',
    ]);
  });

  it('une requête avec sourceTypes est refusée explicitement avant tout appel', async () => {
    const { engine, executions } = buildPipeline();
    await expect(
      engine.research(
        { ...QUERY, sourceTypes: ['case_law'] },
        { maxSearchPages: 1, maxCandidates: 1, maxRetrievedSources: 1 },
      ),
    ).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(executions).toEqual([]);
  });

  it('un conteneur sans titles[0].id : le résultat est tracé (skipped, avec sa page) mais ses candidats sont récupérés, sans resultId inventé', async () => {
    const { engine, executions } = buildPipeline(
      output([result({ titles: [], sections: [{ extracts: [extract()] }] })], {
        totalResultNumber: 1,
      }),
    );

    const research = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 10,
    });

    expect(research.skipped).toEqual([{ reason: 'malformed_item', resultIndex: 0, page: 1 }]);
    expect(research.candidates).toHaveLength(1);
    expect(research.candidates[0]!.retrieval?.source.id).toBe('LEGIARTI000006901174');
    expect(research.candidates[0]!.reference.provenance).not.toHaveProperty('resultId');
    expect(executions).toEqual([
      'legifrance.search',
      'legifrance.get_article:LEGIARTI000006901174',
    ]);
  });

  it('un conteneur sans titles[0].id ni extrait exploitable : aucun candidat, tout est tracé, pas de lacune no_search_result (des résultats existent)', async () => {
    const { engine, executions } = buildPipeline(
      output(
        [
          result({
            titles: [],
            sections: [{ extracts: [extract({ id: 'LEGISCTA000006189234' })] }],
          }),
        ],
        {
          totalResultNumber: 1,
        },
      ),
    );

    const research = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 10,
    });

    expect(research.candidates).toEqual([]);
    expect(research.skipped).toEqual([
      { reason: 'malformed_item', resultIndex: 0, page: 1 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 0, page: 1 },
    ]);
    expect(research.gaps.map((g) => g.kind)).not.toContain('no_search_result');
    expect(executions).toEqual(['legifrance.search']);
  });

  it('un seul saut : une exécution get_article de plus pour la version résolue différente, aucune pour les autres', async () => {
    const { engine, executions } = buildPipeline();

    const research = await engine.research(QUERY, {
      maxSearchPages: 1,
      maxCandidates: 10,
      maxRetrievedSources: 10,
    });

    expect(executions).toEqual([
      'legifrance.search',
      'legifrance.get_article:LEGIARTI000006901174',
      'legifrance.get_article:LEGIARTI000006900916',
      'legifrance.get_article:LEGIARTI000006900954',
      'legifrance.get_article:LEGIARTI000006902466',
      'legifrance.get_article:LEGIARTI000033020376',
    ]);
    expect(research.candidates.every((c) => c.versionResolution !== undefined)).toBe(true);
    expect(research.candidates.every((c) => c.retrieval !== undefined)).toBe(true);
    // `retrieval` = source initialement récupérée, jamais remplacée ; une seule source distincte par candidat.
    expect(new Set(research.candidates.map((c) => c.retrieval!.source.id)).size).toBe(
      research.candidates.length,
    );
    expect(research.candidates.map((c) => c.resolvedRetrieval?.mode)).toEqual([
      'initial',
      'initial',
      'initial',
      'retrieved',
    ]);
    const jumped = research.candidates[3]!;
    expect(jumped.retrieval?.source.id).toBe('LEGIARTI000006902466');
    expect(jumped.resolvedRetrieval?.result.source.id).toBe('LEGIARTI000033020376');
    expect(research.rejections).toEqual([]);
  });
});

describe('Research Engine — contenu transitoire, chaîne complète sans réseau (ADR-0021)', () => {
  const BUDGET = { maxSearchPages: 1, maxCandidates: 10, maxRetrievedSources: 10 };

  it('12. le contenu est capturé pendant les appels existants : mêmes exécutions Tool qu’avant, aucune de plus', async () => {
    const { engine, executions } = buildPipeline();

    const research = await engine.research(QUERY, BUDGET);

    expect(executions).toEqual([
      'legifrance.search',
      'legifrance.get_article:LEGIARTI000006901174',
      'legifrance.get_article:LEGIARTI000006900916',
      'legifrance.get_article:LEGIARTI000006900954',
      'legifrance.get_article:LEGIARTI000006902466',
      'legifrance.get_article:LEGIARTI000033020376',
    ]);
    for (const candidate of research.candidates) {
      expect(candidate.retrieval?.content).toBeDefined();
      expect(candidate.retrieval!.content!.contentHash).toBe(
        candidate.retrieval!.source.contentHash,
      );
      expect(candidate.retrieval!.content!.revealText()).toBe(
        candidate.retrieval!.source.id === 'LEGIARTI000006902466'
          ? 'Texte factice version 1.'
          : `Texte factice ${candidate.retrieval!.source.id}.`,
      );
    }
  });

  it('8. retrieve puis retrieveVersion : la version initiale et la version résolue ont chacune leur contenu', async () => {
    const { engine } = buildPipeline();

    const research = await engine.research(QUERY, BUDGET);
    const jumped = research.candidates[3]!;

    expect(jumped.retrieval?.content?.revealText()).toBe('Texte factice version 1.');
    expect(jumped.resolvedRetrieval?.mode).toBe('retrieved');
    expect(jumped.resolvedRetrieval?.result.content?.revealText()).toBe('Texte factice version 2.');
    expect(jumped.resolvedRetrieval?.result.content?.contentHash).toBe(
      jumped.resolvedRetrieval?.result.source.contentHash,
    );
  });

  it('9. JSON.stringify(ResearchResult) ne contient aucun texte, ni celui de retrieve ni celui de retrieveVersion', async () => {
    const { engine } = buildPipeline();

    const json = JSON.stringify(await engine.research(QUERY, BUDGET));

    expect(json).not.toContain('Texte factice');
    expect(json).toContain('"redacted":true');
  });

  it('10. le LegalCase sérialisé (projection puis rattachement) ne contient aucun texte', async () => {
    const { engine } = buildPipeline();
    const research = await engine.research(QUERY, BUDGET);
    const base = {
      ...createLegalCase({ title: 'Dossier', id: 'case-1', createdAt: '2026-09-24T00:00:00.000Z' }),
      questions: [{ id: 'q-1', question: 'Quel préavis ?', status: 'open' as const }],
    };

    const projection = projectCitations(research, { id: 'q-1' });
    const attached = attachSourcesAndCitations(base, projection);
    const file = serializeLegalCaseFile(attached);

    expect(projection.citations.length).toBeGreaterThan(0);
    expect(file).not.toContain('Texte factice');
    expect(file).not.toContain('redacted'); // le dossier ne connaît même pas la notion de contenu
    expect(file).not.toContain('"content"');
    expect(JSON.stringify(attached.sources)).not.toContain('Texte factice');
    expect(JSON.stringify(attached.citations)).not.toContain('Texte factice');
  });
});
