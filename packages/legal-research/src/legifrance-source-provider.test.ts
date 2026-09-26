import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry, valid, type Tool } from '@jarvis/core';

import { LegifranceMappingError } from './legifrance-source-mapping.js';
import { LegifranceProviderError, LegifranceSourceProvider } from './legifrance-source-provider.js';

const SAMPLE_ARTICLE = {
  id: 'LEGIARTI000006528277',
  cid: 'LEGIARTI000006528277',
  nature: 'Article',
  num: '57',
  texte: 'Contenu bref.',
  versionArticle: '1.0',
  dateDebut: 269568000000,
  dateFin: 32472144000000,
  versionPrecedente: null,
  articleVersions: [],
};

/**
 * Fausse Tool `legifrance.get_article` — même contrat `Tool` générique que
 * n'importe quel connecteur réel (`@jarvis/core`), sans dépendre de
 * `@jarvis/connectors` : `@jarvis/legal-research` ne connaît que
 * `ToolExecutor`, jamais un connecteur concret.
 */
function buildGetArticleTool(
  options: { output?: unknown; fails?: boolean } = {},
): Tool<{ id: string }, unknown> {
  return {
    name: 'legifrance.get_article',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    validateInput: (input) => valid(input as { id: string }),
    async execute() {
      if (options.fails) {
        throw new Error('échec technique simulé.');
      }
      return options.output ?? SAMPLE_ARTICLE;
    },
  };
}

function buildToolExecutor(
  tool: Tool,
  policy: ConstructorParameters<typeof PermissionManager>[0] = { default: 'allow' },
): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(tool);
  return new ToolExecutor(registry, new PermissionManager(policy));
}

describe('LegifranceSourceProvider — appel via ToolExecutor (jamais contourné)', () => {
  it('getArticle réussit et mappe le résultat en LegalSource', async () => {
    const toolExecutor = buildToolExecutor(buildGetArticleTool());
    const provider = new LegifranceSourceProvider({ toolExecutor });

    const { source } = await provider.getArticle('LEGIARTI000006528277');

    expect(source.id).toBe('LEGIARTI000006528277');
    expect(source.sourceType).toBe('code_article');
  });

  it('propage une erreur de mapping si le Tool renvoie une forme invalide (jamais un LegalSource partiel)', async () => {
    const toolExecutor = buildToolExecutor(
      buildGetArticleTool({ output: { id: 'LEGIARTI000006528277' } }),
    );
    const provider = new LegifranceSourceProvider({ toolExecutor });

    await expect(provider.getArticle('LEGIARTI000006528277')).rejects.toThrowError(
      LegifranceMappingError,
    );
  });

  it('refus par PermissionManager (deny) : LegifranceProviderError, jamais un contournement', async () => {
    const toolExecutor = buildToolExecutor(buildGetArticleTool(), { default: 'deny' });
    const provider = new LegifranceSourceProvider({ toolExecutor });

    await expect(provider.getArticle('LEGIARTI000006528277')).rejects.toThrowError(
      LegifranceProviderError,
    );
    try {
      await provider.getArticle('LEGIARTI000006528277');
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegifranceProviderError);
      expect((error as LegifranceProviderError).reason).toBe('denied');
    }
  });

  it('outil inconnu du ToolRegistry : LegifranceProviderError avec reason "unknown_tool"', async () => {
    const registry = new ToolRegistry(); // aucun Tool enregistré
    const toolExecutor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));
    const provider = new LegifranceSourceProvider({ toolExecutor });

    try {
      await provider.getArticle('LEGIARTI000006528277');
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegifranceProviderError);
      expect((error as LegifranceProviderError).reason).toBe('unknown_tool');
    }
  });

  it('échec technique du Tool : LegifranceProviderError avec reason "execution_error"', async () => {
    const toolExecutor = buildToolExecutor(buildGetArticleTool({ fails: true }));
    const provider = new LegifranceSourceProvider({ toolExecutor });

    try {
      await provider.getArticle('LEGIARTI000006528277');
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegifranceProviderError);
      expect((error as LegifranceProviderError).reason).toBe('execution_error');
    }
  });

  it('ne contient jamais de donnée sensible dans ses erreurs', async () => {
    const toolExecutor = buildToolExecutor(buildGetArticleTool({ fails: true }));
    const provider = new LegifranceSourceProvider({ toolExecutor });

    await provider.getArticle('LEGIARTI000006528277').catch((error: unknown) => {
      expect((error as Error).message).not.toMatch(/client_secret|access_token|Bearer/i);
    });
  });

  it('now injectable : consultedAt déterministe', async () => {
    const toolExecutor = buildToolExecutor(buildGetArticleTool());
    const provider = new LegifranceSourceProvider({
      toolExecutor,
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
    });

    const { source } = await provider.getArticle('LEGIARTI000006528277');
    expect(source.consultedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
