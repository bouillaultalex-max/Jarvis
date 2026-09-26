import { describe, expect, it } from 'vitest';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  invalid,
  valid,
  type Tool,
} from '@jarvis/core';

import { LegifranceSearchAdapter } from './legifrance-search-adapter.js';
import { ResearchProviderError } from './research/ports.js';
import type { SearchQuery } from './research/search-types.js';
import { NOMINAL_OUTPUT, output, result } from './research/testing/legifrance-search-fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');

const QUERY: SearchQuery = {
  text: 'préavis démission',
  matchMode: 'all_terms',
  asOf: '2019-05-24',
  page: { number: 1, size: 5 },
};

interface FakeSearchToolOptions {
  readonly out?: unknown;
  readonly fails?: boolean;
  readonly rejectInput?: boolean;
}

/** Fausse Tool `legifrance.search` : même contrat `Tool` générique, sans dépendre de `@jarvis/connectors`. Mémorise les entrées reçues. */
function buildSearchTool(options: FakeSearchToolOptions = {}): {
  tool: Tool<unknown, unknown>;
  inputs: unknown[];
} {
  const inputs: unknown[] = [];
  const tool: Tool<unknown, unknown> = {
    name: 'legifrance.search',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: {} },
    validateInput: (input) => (options.rejectInput ? invalid('entrée refusée.') : valid(input)),
    async execute(input) {
      inputs.push(input);
      if (options.fails)
        throw new Error('Légifrance : requête API refusée (HTTP 404, client_error).');
      return options.out ?? NOMINAL_OUTPUT;
    },
  };
  return { tool, inputs };
}

function buildExecutor(
  tool: Tool<unknown, unknown>,
  policy: ConstructorParameters<typeof PermissionManager>[0] = { default: 'allow' },
) {
  const registry = new ToolRegistry();
  registry.register(tool);
  return new ToolExecutor(registry, new PermissionManager(policy));
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return expect.unreachable('devait lever');
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchProviderError);
    return (error as ResearchProviderError).reason;
  }
}

describe('LegifranceSearchAdapter — appel via ToolExecutor', () => {
  it('construit l’entrée structurée du Tool (jamais un payload HTTP) et renvoie une SearchResultPage', async () => {
    const { tool, inputs } = buildSearchTool();
    const adapter = new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool), now: NOW });

    const page = await adapter.search({ ...QUERY, field: 'article_number' });

    expect(inputs).toEqual([
      {
        fond: 'CODE_DATE',
        text: 'préavis démission',
        matchMode: 'all_terms',
        field: 'article_number',
        dateVersion: '2019-05-24',
        pageNumber: 1,
        pageSize: 5,
      },
    ]);
    expect(page.references).toHaveLength(4);
    expect(page.references[0]!.provenance.executedAt).toBe('2026-09-23T18:00:00.000Z');
  });

  it('l’entrée ne contient ni typePagination, ni sort, ni filtres, ni sourceTypes : le connecteur construit le payload', async () => {
    const { tool, inputs } = buildSearchTool();
    await new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool) }).search(QUERY);
    for (const forbidden of [
      'typePagination',
      'sort',
      'filtres',
      'recherche',
      'sourceTypes',
      'field',
    ]) {
      expect(inputs[0]).not.toHaveProperty(forbidden);
    }
  });

  it('pagination : la page et la taille demandées sont transmises et reprises dans la provenance et les métadonnées', async () => {
    const { tool, inputs } = buildSearchTool({
      out: output([result()], { totalResultNumber: 42 }),
    });
    const page = await new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool) }).search({
      ...QUERY,
      page: { number: 3, size: 10 },
    });

    expect(inputs[0]).toMatchObject({ pageNumber: 3, pageSize: 10 });
    expect(page.metadata).toMatchObject({
      page: 3,
      pageSize: 10,
      resultCount: 1,
      totalResults: 42,
      unexposedArticleCount: 14,
    });
    expect(page.references[0]!.provenance.page).toBe(3);
  });

  it('providerId vaut legifrance', () => {
    expect(
      new LegifranceSearchAdapter({ toolExecutor: buildExecutor(buildSearchTool().tool) })
        .providerId,
    ).toBe('legifrance');
  });
});

describe('LegifranceSearchAdapter — requêtes non traduisibles (refus explicite, aucun appel)', () => {
  it('sourceTypes non vide : invalid_request, jamais ignoré en silence, aucun appel au Tool', async () => {
    const { tool, inputs } = buildSearchTool();
    const adapter = new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool) });

    expect(await reasonOf(adapter.search({ ...QUERY, sourceTypes: ['code_article'] }))).toBe(
      'invalid_request',
    );
    expect(inputs).toEqual([]);
  });

  it('sourceTypes vide : aucune restriction demandée, la requête est traitée', async () => {
    const { tool, inputs } = buildSearchTool();
    await new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool) }).search({
      ...QUERY,
      sourceTypes: [],
    });
    expect(inputs).toHaveLength(1);
  });

  it('asOf absent : invalid_request (CODE_DATE exige DATE_VERSION), aucun appel', async () => {
    const { tool, inputs } = buildSearchTool();
    const { asOf: _asOf, ...withoutAsOf } = QUERY;
    void _asOf;

    expect(
      await reasonOf(
        new LegifranceSearchAdapter({ toolExecutor: buildExecutor(tool) }).search(withoutAsOf),
      ),
    ).toBe('invalid_request');
    expect(inputs).toEqual([]);
  });
});

describe('LegifranceSearchAdapter — erreurs du ToolExecutor (contrat existant, message jamais analysé)', () => {
  it('refus PermissionManager : denied', async () => {
    const { tool } = buildSearchTool();
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(tool, { default: 'deny' }),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('denied');
  });

  it('Tool inconnu du registre : unknown_tool', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: new ToolExecutor(
        new ToolRegistry(),
        new PermissionManager({ default: 'allow' }),
      ),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('unknown_tool');
  });

  it('entrée refusée par le Tool : invalid_request', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(buildSearchTool({ rejectInput: true }).tool),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('invalid_request');
  });

  it('confirmation requise : awaiting_confirmation', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(buildSearchTool().tool, {
        rules: { 'legifrance.search': 'require_confirmation' },
      }),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('awaiting_confirmation');
  });

  it('échec technique : execution_error, même si le message évoque un HTTP 404 (jamais analysé)', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(buildSearchTool({ fails: true }).tool),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('execution_error');
  });

  it('le message d’origine est conservé pour un humain, sans secret', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(buildSearchTool({ fails: true }).tool),
    });
    await adapter.search(QUERY).catch((error: unknown) => {
      expect((error as Error).message).toContain('HTTP 404');
      expect((error as Error).message).not.toMatch(/client_secret|access_token|Bearer/i);
    });
  });

  it('sortie inexploitable du Tool : malformed_response', async () => {
    const adapter = new LegifranceSearchAdapter({
      toolExecutor: buildExecutor(buildSearchTool({ out: { results: 'x' } }).tool),
    });
    expect(await reasonOf(adapter.search(QUERY))).toBe('malformed_response');
  });
});
