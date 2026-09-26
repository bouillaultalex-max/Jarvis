import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry, valid, type Tool } from '@jarvis/core';

import { LegifranceRetrievalAdapter } from './legifrance-retrieval-adapter.js';
import {
  LegifranceMappingError,
  mapLegifranceArticleToLegalSource,
} from './legifrance-source-mapping.js';
import {
  LegifranceSourceProvider,
  type LegalSourceProvider,
} from './legifrance-source-provider.js';
import { computeContentHash } from './research/content-hash.js';
import { ResearchProviderError } from './research/ports.js';
import { ContentIntegrityError, RetrievedContent } from './research/retrieved-content.js';
import type { SearchReference } from './research/search-types.js';
import {
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  SINGLE_CONTAINER_PAGE,
} from './research/testing/fixtures.js';

/**
 * Content Exposure (ADR-0021) : le texte est capturé pendant l'appel `getArticle`
 * existant et exposé comme `content` vérifié, par `retrieve` **et** `retrieveVersion`.
 * Chaîne réelle mapper → provider → adaptateur, avec un faux Tool (aucun réseau).
 */

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');
const V1 = 'LEGIARTI000006902466';
const V2 = 'LEGIARTI000033020376';

const RAW_BY_ID: Record<string, Record<string, unknown>> = {
  [V1]: L3121_27_V1_RAW,
  [V2]: L3121_27_V2_RAW,
};

function reference(candidateId: string): SearchReference {
  return { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId };
}

function harness(rawFor: (id: string) => unknown = (id) => RAW_BY_ID[id]) {
  const calls: string[] = [];
  const tool: Tool<{ id: string }, unknown> = {
    name: 'legifrance.get_article',
    description: 'Fausse Tool de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    validateInput: (input) => valid(input as { id: string }),
    async execute(input) {
      calls.push(input.id);
      return rawFor(input.id);
    },
  };
  const registry = new ToolRegistry();
  registry.register(tool as Tool);
  const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));
  const provider = new LegifranceSourceProvider({ toolExecutor: executor, now: NOW });
  return { calls, provider, adapter: new LegifranceRetrievalAdapter({ provider }) };
}

async function reasonOf(promise: Promise<unknown>): Promise<ResearchProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchProviderError);
    return error as ResearchProviderError;
  }
  return expect.unreachable('devait lever');
}

describe('retrieve / retrieveVersion — le contenu est capturé pendant l’appel existant', () => {
  it('5. retrieve : contenu conservé, vérifié contre source.contentHash, un seul appel getArticle', async () => {
    const { adapter, calls } = harness();

    const result = await adapter.retrieve({ reference: reference(V2) });

    expect(calls).toEqual([V2]); // 12. aucun appel de plus pour obtenir le contenu
    expect(result.content).toBeInstanceOf(RetrievedContent);
    expect(result.content!.revealText()).toBe(L3121_27_V2_RAW.texte);
    expect(result.content!.contentHash).toBe(result.source.contentHash);
    expect(computeContentHash(result.content!.revealText())).toBe(result.source.contentHash);
  });

  it('7. retrieveVersion : contenu de la version cible conservé, un seul appel', async () => {
    const { adapter, calls } = harness();

    const result = await adapter.retrieveVersion({
      targetId: V2,
      authority: 'legifrance',
      identifier: V1,
    });

    expect(calls).toEqual([V2]);
    expect(result.content!.revealText()).toBe(L3121_27_V2_RAW.texte);
    expect(result.content!.contentHash).toBe(result.source.contentHash);
  });

  it('8. deux versions : chaque résultat porte son propre contenu et son propre hash', async () => {
    const { adapter } = harness();

    const initial = await adapter.retrieve({ reference: reference(V1) });
    const target = await adapter.retrieveVersion({
      targetId: V2,
      authority: 'legifrance',
      identifier: V1,
    });

    expect(initial.content!.revealText()).toBe('Texte factice version 1.');
    expect(target.content!.revealText()).toBe('Texte factice version 2.');
    expect(initial.content!.contentHash).not.toBe(target.content!.contentHash);
    expect(initial.content!.contentHash).toBe(initial.source.contentHash);
    expect(target.content!.contentHash).toBe(target.source.contentHash);
  });

  it('D4 : le hash est celui du texte brut reçu, sans normalisation (espaces, CRLF conservés)', async () => {
    const texte = '  Article\r\n\tL1 é  ';
    const { adapter } = harness(() => ({ ...L3121_27_V2_RAW, texte }));

    const result = await adapter.retrieve({ reference: reference(V2) });

    expect(result.content!.revealText()).toBe(texte);
    expect(result.source.contentHash).toBe(computeContentHash(texte));
    expect(result.source.contentHash).not.toBe(computeContentHash(texte.trim()));
  });
});

describe('texte absent, vide ou blanc — comportement conservé (D6)', () => {
  it.each([
    ['null', null],
    ['chaîne vide', ''],
    ['espaces seulement', '   \n\t '],
    ['absent', undefined],
  ])('3/4. texte %s → malformed_response, aucun contenu', async (_label, texte) => {
    const { adapter } = harness(() => ({ ...L3121_27_V2_RAW, texte }));

    const failure = await reasonOf(adapter.retrieve({ reference: reference(V2) }));
    expect(failure.reason).toBe('malformed_response');

    const viaVersion = await reasonOf(
      adapter.retrieveVersion({ targetId: V2, authority: 'legifrance', identifier: V1 }),
    );
    expect(viaVersion.reason).toBe('malformed_response');
  });

  it.each([null, '', '   '])(
    'le mapping refuse un article au texte %j (missing_required_field)',
    (texte) => {
      let caught: unknown;
      try {
        mapLegifranceArticleToLegalSource({ ...L3121_27_V2_RAW, texte }, { now: NOW });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LegifranceMappingError);
      expect((caught as LegifranceMappingError).reason).toBe('missing_required_field');
    },
  );
});

describe('intégrité — hash incohérent : échec dur (D5)', () => {
  /** Fournisseur incohérent : le contenu rendu n'est pas celui dont la source porte le hash. */
  function inconsistentProvider(real: LegalSourceProvider, otherText: string): LegalSourceProvider {
    return {
      async getArticle(id) {
        const result = await real.getArticle(id);
        return {
          ...result,
          content: RetrievedContent.verified(otherText, computeContentHash(otherText)),
        };
      },
    };
  }

  it('2. contenu dont le hash diffère de source.contentHash : malformed_response, rien n’est exposé', async () => {
    const { provider } = harness();
    const adapter = new LegifranceRetrievalAdapter({
      provider: inconsistentProvider(provider, 'un tout autre texte secret-de-test'),
    });

    const failure = await reasonOf(adapter.retrieve({ reference: reference(V2) }));
    const failureVersion = await reasonOf(
      adapter.retrieveVersion({ targetId: V2, authority: 'legifrance', identifier: V1 }),
    );

    expect(failure.reason).toBe('malformed_response');
    expect(failureVersion.reason).toBe('malformed_response');
  });

  it('source sans contentHash : intégrité invérifiable → refus (jamais un contenu « vérifié » sans référence)', async () => {
    const { provider } = harness();
    const noHash: LegalSourceProvider = {
      async getArticle(id) {
        const result = await provider.getArticle(id);
        const { contentHash: _contentHash, ...source } = result.source;
        void _contentHash;
        return { ...result, source };
      },
    };

    const failure = await reasonOf(
      new LegifranceRetrievalAdapter({ provider: noHash }).retrieve({ reference: reference(V2) }),
    );
    expect(failure.reason).toBe('malformed_response');
  });

  it('11. aucune erreur ne contient le texte : intégrité, mapping, provider', async () => {
    const secret = 'secret-de-test-texte-juridique';
    const { provider } = harness(() => ({ ...L3121_27_V2_RAW, texte: secret }));
    const adapter = new LegifranceRetrievalAdapter({
      provider: inconsistentProvider(provider, `${secret} modifié`),
    });
    const integrity = await reasonOf(adapter.retrieve({ reference: reference(V2) }));

    const emptyText = harness(() => ({ ...L3121_27_V2_RAW, texte: '' }));
    const mapping = await reasonOf(emptyText.adapter.retrieve({ reference: reference(V2) }));

    for (const failure of [integrity, mapping]) {
      expect(failure.message).not.toContain(secret);
      expect(String(failure.stack)).not.toContain(secret);
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
    expect(integrity.cause ?? null).toBeNull();
    // L'erreur d'intégrité d'origine ne porte que des hash.
    expect(
      (() => {
        try {
          RetrievedContent.verified(secret, computeContentHash('x'));
          return '';
        } catch (error) {
          return (error as ContentIntegrityError).message;
        }
      })(),
    ).not.toContain(secret);
  });
});

describe('sérialisation — le texte n’apparaît pas (D9)', () => {
  it('9. JSON.stringify d’un résultat de récupération : jamais le texte, marqueur rédigé à la place', async () => {
    const { adapter } = harness();

    const retrieved = await adapter.retrieve({ reference: reference(V2) });
    const target = await adapter.retrieveVersion({
      targetId: V2,
      authority: 'legifrance',
      identifier: V1,
    });

    for (const result of [retrieved, target]) {
      const json = JSON.stringify(result);
      expect(json).not.toContain('Texte factice');
      expect(JSON.parse(json).content).toEqual({
        redacted: true,
        contentHash: result.source.contentHash,
      });
      expect(result.source).not.toHaveProperty('content');
    }
  });
});
