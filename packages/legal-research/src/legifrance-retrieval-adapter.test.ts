import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry, valid, type Tool } from '@jarvis/core';

import { LegifranceRetrievalAdapter } from './legifrance-retrieval-adapter.js';
import {
  LegifranceSourceProvider,
  type LegalSourceProvider,
} from './legifrance-source-provider.js';
import { ResearchProviderError } from './research/ports.js';
import type { SearchReference } from './research/search-types.js';
import {
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  SINGLE_CONTAINER_PAGE,
} from './research/testing/fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');

function reference(candidateId: string): SearchReference {
  return { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId };
}

function buildGetArticleTool(options: { out?: unknown; fails?: boolean } = {}): {
  tool: Tool<{ id: string }, unknown>;
  calls: string[];
} {
  const calls: string[] = [];
  const tool: Tool<{ id: string }, unknown> = {
    name: 'legifrance.get_article',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    validateInput: (input) => valid(input as { id: string }),
    async execute(input) {
      calls.push(input.id);
      if (options.fails) throw new Error('échec technique simulé.');
      return options.out ?? L3121_27_V2_RAW;
    },
  };
  return { tool, calls };
}

function buildAdapter(
  tool: Tool<{ id: string }, unknown>,
  policy: ConstructorParameters<typeof PermissionManager>[0] = { default: 'allow' },
) {
  const registry = new ToolRegistry();
  registry.register(tool as Tool);
  const executor = new ToolExecutor(registry, new PermissionManager(policy));
  return new LegifranceRetrievalAdapter({
    provider: new LegifranceSourceProvider({ toolExecutor: executor, now: NOW }),
  });
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

describe('LegifranceRetrievalAdapter — enveloppe LegifranceSourceProvider.getArticle', () => {
  it('récupère via le provider existant et renvoie LegalSource + versions + version précédente + référence', async () => {
    const { tool, calls } = buildGetArticleTool();
    const ref = reference('LEGIARTI000033020376');

    const result = await buildAdapter(tool).retrieve({ reference: ref });

    expect(calls).toEqual(['LEGIARTI000033020376']);
    expect(result.source).toMatchObject({
      id: 'LEGIARTI000033020376',
      identifier: 'LEGIARTI000006902466',
      version: '2.0',
      authority: 'legifrance',
    });
    expect(result.previousVersionId).toBe('LEGIARTI000006902466');
    expect(result.reference).toBe(ref);
    expect(result.versions).toEqual([
      {
        id: 'LEGIARTI000006902466',
        version: '1.0',
        state: 'ABROGE',
        effectiveFrom: '2008-05-01T00:00:00.000Z',
        effectiveTo: '2008-08-22T00:00:00.000Z',
      },
      {
        id: 'LEGIARTI000033020376',
        version: '2.0',
        state: 'VIGUEUR',
        effectiveFrom: '2016-08-10T00:00:00.000Z',
      },
    ]);
  });

  it('première version : aucune version précédente ; l’historique complet est rendu tel quel, sans résolution ni fusion', async () => {
    const { tool } = buildGetArticleTool({ out: L3121_27_V1_RAW });
    const result = await buildAdapter(tool).retrieve({
      reference: reference('LEGIARTI000006902466'),
    });

    expect(result).not.toHaveProperty('previousVersionId');
    expect(result.versions).toHaveLength(2);
  });

  it('le texte n’est jamais un champ de la source ni du résultat en clair : `content` est opaque et rédigé (ADR-0021)', async () => {
    const { tool } = buildGetArticleTool();
    const result = await buildAdapter(tool).retrieve({
      reference: reference('LEGIARTI000033020376'),
    });

    expect(result).not.toHaveProperty('text');
    expect(result.source).not.toHaveProperty('text');
    expect(result.source).not.toHaveProperty('content');
    expect(result.content).toBeDefined(); // capturé, mais opaque
    expect(JSON.stringify(result)).not.toContain('Texte factice');
    expect(result.source.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.content!.contentHash).toBe(result.source.contentHash);
  });

  it('canRetrieve : seule une référence legifrance à identifiant LEGIARTI + 12 chiffres est récupérable', () => {
    const adapter = buildAdapter(buildGetArticleTool().tool);
    expect(adapter.canRetrieve(reference('LEGIARTI000033020376'))).toBe(true);
    expect(adapter.canRetrieve(reference('LEGISCTA000006189234'))).toBe(false);
    expect(adapter.canRetrieve(reference('LEGIARTI12'))).toBe(false);
    expect(adapter.canRetrieve({ ...reference('LEGIARTI000033020376'), authority: 'other' })).toBe(
      false,
    );
  });

  it('référence non récupérable : invalid_request, sans aucun appel au Tool', async () => {
    const { tool, calls } = buildGetArticleTool();
    expect(
      await reasonOf(buildAdapter(tool).retrieve({ reference: reference('JORFTEXT000000000001') })),
    ).toBe('invalid_request');
    expect(calls).toEqual([]);
  });

  it('providerId vaut legifrance', () => {
    expect(buildAdapter(buildGetArticleTool().tool).providerId).toBe('legifrance');
  });
});

describe('LegifranceRetrievalAdapter — erreurs adaptées au contrat Retrieval', () => {
  const ref = reference('LEGIARTI000033020376');

  it('refus PermissionManager : denied', async () => {
    expect(
      await reasonOf(
        buildAdapter(buildGetArticleTool().tool, { default: 'deny' }).retrieve({ reference: ref }),
      ),
    ).toBe('denied');
  });

  it('Tool inconnu : unknown_tool', async () => {
    const executor = new ToolExecutor(
      new ToolRegistry(),
      new PermissionManager({ default: 'allow' }),
    );
    const adapter = new LegifranceRetrievalAdapter({
      provider: new LegifranceSourceProvider({ toolExecutor: executor }),
    });
    expect(await reasonOf(adapter.retrieve({ reference: ref }))).toBe('unknown_tool');
  });

  it('échec technique : execution_error', async () => {
    expect(
      await reasonOf(
        buildAdapter(buildGetArticleTool({ fails: true }).tool).retrieve({ reference: ref }),
      ),
    ).toBe('execution_error');
  });

  it('confirmation requise : awaiting_confirmation', async () => {
    const adapter = buildAdapter(buildGetArticleTool().tool, {
      rules: { 'legifrance.get_article': 'require_confirmation' },
    });
    expect(await reasonOf(adapter.retrieve({ reference: ref }))).toBe('awaiting_confirmation');
  });

  it('réponse dont le mapping échoue : malformed_response (jamais une LegalSource partielle)', async () => {
    const adapter = buildAdapter(buildGetArticleTool({ out: { id: 'LEGIARTI000033020376' } }).tool);
    expect(await reasonOf(adapter.retrieve({ reference: ref }))).toBe('malformed_response');
  });

  it('une erreur inattendue du provider (bug) est propagée telle quelle, jamais transformée', async () => {
    const provider: LegalSourceProvider = {
      async getArticle() {
        throw new TypeError('bug inattendu');
      },
    };
    await expect(
      new LegifranceRetrievalAdapter({ provider }).retrieve({ reference: ref }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('ne fait aucune récupération directe : seul provider.getArticle est appelé, une fois', async () => {
    const seen: string[] = [];
    const provider: LegalSourceProvider = {
      async getArticle(id) {
        seen.push(id);
        return new LegifranceSourceProvider({
          toolExecutor: (() => {
            const registry = new ToolRegistry();
            registry.register(buildGetArticleTool().tool as Tool);
            return new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));
          })(),
          now: NOW,
        }).getArticle(id);
      },
    };
    await new LegifranceRetrievalAdapter({ provider }).retrieve({ reference: ref });
    expect(seen).toEqual(['LEGIARTI000033020376']);
  });
});

describe('LegifranceRetrievalAdapter — version cible (ADR-0019)', () => {
  const request = {
    targetId: 'LEGIARTI000033020376',
    authority: 'legifrance',
    identifier: 'LEGIARTI000006902466',
  } as const;

  it('récupère par id via le même getArticle, sans référence de découverte ni texte', async () => {
    const { tool, calls } = buildGetArticleTool();

    const result = await buildAdapter(tool).retrieveVersion(request);

    expect(calls).toEqual(['LEGIARTI000033020376']);
    expect(result.source).toMatchObject({ id: request.targetId, identifier: request.identifier });
    expect(result.previousVersionId).toBe('LEGIARTI000006902466');
    expect(result.versions).toHaveLength(2);
    expect(result).not.toHaveProperty('reference');
    expect(JSON.stringify(result)).not.toContain('Texte factice');
  });

  it('canRetrieveVersion : seule une cible legifrance à identifiant LEGIARTI + 12 chiffres est récupérable', () => {
    const adapter = buildAdapter(buildGetArticleTool().tool);
    expect(adapter.canRetrieveVersion(request)).toBe(true);
    expect(adapter.canRetrieveVersion({ ...request, targetId: 'LEGISCTA000006189234' })).toBe(
      false,
    );
    expect(adapter.canRetrieveVersion({ ...request, targetId: 'LEGIARTI12' })).toBe(false);
    expect(adapter.canRetrieveVersion({ ...request, authority: 'other' })).toBe(false);
  });

  it('cible non récupérable : invalid_request, sans aucun appel au Tool', async () => {
    const { tool, calls } = buildGetArticleTool();
    expect(
      await reasonOf(buildAdapter(tool).retrieveVersion({ ...request, targetId: 'JORFTEXT1' })),
    ).toBe('invalid_request');
    expect(calls).toEqual([]);
  });

  it.each([
    ['denied', { default: 'deny' } as const, undefined],
    [
      'awaiting_confirmation',
      { rules: { 'legifrance.get_article': 'require_confirmation' } } as const,
      undefined,
    ],
    ['execution_error', { default: 'allow' } as const, { fails: true }],
    ['malformed_response', { default: 'allow' } as const, { out: { id: request.targetId } }],
  ])('mêmes erreurs que retrieve : %s', async (reason, policy, toolOptions) => {
    const adapter = buildAdapter(buildGetArticleTool(toolOptions).tool, policy);
    expect(await reasonOf(adapter.retrieveVersion(request))).toBe(reason);
  });

  it('ne vérifie pas l’identité de la source reçue : ce contrôle appartient au moteur', async () => {
    // L'article renvoyé est la v1.0 alors que la v2.0 est demandée : l'adaptateur la rend telle quelle.
    const { tool } = buildGetArticleTool({ out: L3121_27_V1_RAW });
    const result = await buildAdapter(tool).retrieveVersion(request);
    expect(result.source.id).toBe('LEGIARTI000006902466');
  });
});
