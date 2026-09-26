import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import { createLegifranceConfig, LegifranceHttpClient } from '@jarvis/legifrance-client';

import type { AccessTokenProvider } from '../gmail/gmail-auth.js';
import { legifranceConnector, type LegifranceGetArticleOutput } from './legifrance-connector.js';

const FAKE_TOKEN_MARKER = 'FAKE-LEGIFRANCE-ACCESS-TOKEN-MARKER-NOT-REAL';

class FakeAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly token: string | Error = FAKE_TOKEN_MARKER) {}

  async getAccessToken(): Promise<string> {
    if (this.token instanceof Error) {
      throw this.token;
    }
    return this.token;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildClient(
  fetchFn: typeof fetch,
  accessTokenProvider: AccessTokenProvider = new FakeAccessTokenProvider(),
): LegifranceHttpClient {
  return new LegifranceHttpClient({
    config: createLegifranceConfig('sandbox'),
    accessTokenProvider,
    fetchFn,
  });
}

// Forme réaliste, alignée sur la réponse réellement observée en sandbox PISTE
// (LEGAL-02B.2.1/LEGAL-02B.2.2) — mêmes noms de champs, mêmes types (dates en
// epoch ms, pas ISO).
const SAMPLE_ARTICLE_RESPONSE = {
  executionTime: 12,
  dereferenced: false,
  article: {
    id: 'LEGIARTI000006307920',
    cid: 'LEGIARTI000006307919',
    idTexte: 'LEGITEXT000006069577',
    cidTexte: null,
    type: 'AUTONOME',
    nature: 'Article',
    num: '1',
    texte: 'Article de test.',
    versionArticle: '2.0',
    etat: 'VIGUEUR',
    dateDebut: 1475971200000,
    dateFin: 32472144000000,
    versionPrecedente: 'LEGIARTI000006307918',
    isMultipleVersions: true,
    sectionParentTitre: 'Section 1 : Test',
    fullSectionsTitre: 'Partie législative > Section 1 : Test',
    articleVersions: [
      {
        id: 'LEGIARTI000006307918',
        etat: 'MODIFIE',
        version: '1.0',
        dateDebut: 838425600000,
        dateFin: 1475971200000,
      },
      {
        id: 'LEGIARTI000006307920',
        etat: 'VIGUEUR',
        version: '2.0',
        dateDebut: 1475971200000,
        dateFin: 32472144000000,
      },
    ],
    lienModifications: [
      {
        textCid: 'JORFTEXT000033202746',
        textTitle: 'Loi de test',
        linkType: 'MODIFIE',
        linkOrientation: 'cible',
        articleNum: '40',
        articleId: 'LEGIARTI000033205172',
        natureText: 'LOI',
        datePubliTexte: '2016-10-08',
        dateSignaTexte: '2016-10-07',
        dateDebutCible: '2016-10-09',
      },
    ],
    lienCitations: [
      {
        textCid: 'JORFTEXT000000512205',
        textTitle: 'Loi citée',
        linkType: 'CITATION',
        linkOrientation: 'source',
        articleNum: '26',
        articleId: 'LEGIARTI000006420293',
        natureText: 'LOI',
        parentCid: null,
        numTexte: '86-1067',
        datePubli: 528508800000,
        dateDebut: 601084800000,
      },
    ],
  },
};

describe('legifranceConnector — architecture (lecture seule uniquement, aucun réseau réel)', () => {
  it('1. construction correcte : id/name non vides, un client construit trois Tool', () => {
    expect(legifranceConnector.id).toBe('legifrance');
    expect(legifranceConnector.name.length).toBeGreaterThan(0);

    const client = buildClient(vi.fn());
    const tools = legifranceConnector.createTools(client);
    expect(tools).toHaveLength(3);
  });

  it('2. metadata correcte', () => {
    expect(legifranceConnector.id).toBe('legifrance');
    expect(legifranceConnector.name).toMatch(/légifrance/i);
  });

  it('3. identification correcte du service : capabilities exactes', () => {
    expect(legifranceConnector.capabilities).toEqual([
      'legifrance.ping',
      'legifrance.get_article',
      'legifrance.search',
    ]);
  });

  it('4. les trois Tools exposées sont READ', () => {
    const client = buildClient(vi.fn());
    const tools = legifranceConnector.createTools(client);

    expect(tools.map((tool) => tool.name)).toEqual([
      'legifrance.ping',
      'legifrance.get_article',
      'legifrance.search',
    ]);
    for (const tool of tools) {
      expect(tool.action).toBe('read');
    }
  });

  it('5. aucune Tool PREPARE', () => {
    const client = buildClient(vi.fn());
    expect(legifranceConnector.createTools(client).some((tool) => tool.action === 'prepare')).toBe(
      false,
    );
  });

  it('6. aucune Tool EXECUTE', () => {
    const client = buildClient(vi.fn());
    expect(legifranceConnector.createTools(client).some((tool) => tool.action === 'execute')).toBe(
      false,
    );
  });

  it('7. inputs invalides rejetés (legifrance.ping)', () => {
    const [pingTool] = legifranceConnector.createTools(buildClient(vi.fn()));
    expect(pingTool!.validateInput({ unexpected: true }).ok).toBe(false);
    expect(pingTool!.validateInput([]).ok).toBe(false);
    expect(pingTool!.validateInput('x').ok).toBe(false);
  });

  it('7. inputs invalides rejetés (legifrance.get_article)', () => {
    const [, getArticleTool] = legifranceConnector.createTools(buildClient(vi.fn()));
    expect(getArticleTool!.validateInput({}).ok).toBe(false);
    expect(getArticleTool!.validateInput({ id: '' }).ok).toBe(false);
    expect(getArticleTool!.validateInput({ id: 'not-a-real-id' }).ok).toBe(false);
    expect(getArticleTool!.validateInput({ id: 'LEGIARTI000006307920', extra: 1 }).ok).toBe(false);
    expect(getArticleTool!.validateInput(null).ok).toBe(false);
  });

  it('8. inputs valides acceptés (les deux Tools)', () => {
    const [pingTool, getArticleTool] = legifranceConnector.createTools(buildClient(vi.fn()));

    expect(pingTool!.validateInput(undefined)).toEqual({ ok: true, value: {} });
    expect(pingTool!.validateInput({})).toEqual({ ok: true, value: {} });
    expect(getArticleTool!.validateInput({ id: 'LEGIARTI000006307920' })).toEqual({
      ok: true,
      value: { id: 'LEGIARTI000006307920' },
    });
  });

  it("n'expose que le contrat générique Tool : aucun champ credential/client attaché", () => {
    const client = buildClient(vi.fn());
    for (const tool of legifranceConnector.createTools(client)) {
      expect(Object.keys(tool).sort()).toEqual(
        ['action', 'description', 'execute', 'inputSchema', 'name', 'validateInput'].sort(),
      );
    }
  });
});

describe('legifranceConnector — appels HTTP (via legifrance-client, aucun accès réseau réel)', () => {
  it('12/13. legifrance.ping : appelle GET /list/ping ; Authorization géré par le client HTTP, pas par le Connector', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { status: 'pong' }),
    );
    const client = buildClient(fetchFn);
    const [pingTool] = legifranceConnector.createTools(client);

    const output = await pingTool!.execute({});

    expect(output).toEqual({ raw: { status: 'pong' } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/list/ping');
    expect(String(url)).toMatch(/^https:\/\/sandbox-api\.piste\.gouv\.fr/);
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN_MARKER}`);
  });

  it('12. legifrance.get_article : appelle POST /consult/getArticle avec { id }', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, SAMPLE_ARTICLE_RESPONSE),
    );
    const client = buildClient(fetchFn);
    const [, getArticleTool] = legifranceConnector.createTools(client);

    await getArticleTool!.execute({ id: 'LEGIARTI000006307920' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/consult/getArticle');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ id: 'LEGIARTI000006307920' }));
  });

  it('14. la réponse API est correctement transformée en ToolResult technique', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, SAMPLE_ARTICLE_RESPONSE));
    const client = buildClient(fetchFn);
    const [, getArticleTool] = legifranceConnector.createTools(client);

    const output = await getArticleTool!.execute({ id: 'LEGIARTI000006307920' });

    expect(output).toEqual({
      id: 'LEGIARTI000006307920',
      cid: 'LEGIARTI000006307919',
      idTexte: 'LEGITEXT000006069577',
      cidTexte: null,
      type: 'AUTONOME',
      nature: 'Article',
      num: '1',
      texte: 'Article de test.',
      versionArticle: '2.0',
      etat: 'VIGUEUR',
      dateDebut: 1475971200000,
      dateFin: 32472144000000,
      versionPrecedente: 'LEGIARTI000006307918',
      isMultipleVersions: true,
      sectionParentTitre: 'Section 1 : Test',
      fullSectionsTitre: 'Partie législative > Section 1 : Test',
      articleVersions: [
        {
          id: 'LEGIARTI000006307918',
          etat: 'MODIFIE',
          version: '1.0',
          dateDebut: 838425600000,
          dateFin: 1475971200000,
        },
        {
          id: 'LEGIARTI000006307920',
          etat: 'VIGUEUR',
          version: '2.0',
          dateDebut: 1475971200000,
          dateFin: 32472144000000,
        },
      ],
      lienModifications: [
        {
          textCid: 'JORFTEXT000033202746',
          textTitle: 'Loi de test',
          linkType: 'MODIFIE',
          linkOrientation: 'cible',
          articleNum: '40',
          articleId: 'LEGIARTI000033205172',
          natureText: 'LOI',
          datePubliTexte: '2016-10-08',
          dateSignaTexte: '2016-10-07',
          dateDebutCible: '2016-10-09',
        },
      ],
      lienCitations: [
        {
          textCid: 'JORFTEXT000000512205',
          textTitle: 'Loi citée',
          linkType: 'CITATION',
          linkOrientation: 'source',
          articleNum: '26',
          articleId: 'LEGIARTI000006420293',
          natureText: 'LOI',
          parentCid: null,
          numTexte: '86-1067',
          datePubli: 528508800000,
          dateDebut: 601084800000,
        },
      ],
    });
  });

  it('mapping défensif : champs additionnels absents/mal typés deviennent null/[] sans faire échouer le mapping (seul article.id reste obligatoire)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        article: {
          id: 'LEGIARTI000006307920',
          dateDebut: 'not-a-number',
          articleVersions: 'not-an-array',
        },
      }),
    );
    const client = buildClient(fetchFn);
    const [, getArticleTool] = legifranceConnector.createTools(client);

    const output = (await getArticleTool!.execute({
      id: 'LEGIARTI000006307920',
    })) as LegifranceGetArticleOutput;

    expect(output.id).toBe('LEGIARTI000006307920');
    expect(output.dateDebut).toBeNull();
    expect(output.articleVersions).toEqual([]);
    expect(output.cid).toBeNull();
  });

  it('15. erreur réseau : remonte via ToolExecutor comme status "error", jamais "executed"', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const client = buildClient(fetchFn);
    const registry = new ToolRegistry();
    for (const tool of legifranceConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    const result = await executor.run({ tool: 'legifrance.ping', input: {} });

    expect(result.status).toBe('error');
  });

  it.each([400, 401, 403, 429, 500, 503])(
    '%d. HTTP %d sur getArticle remonte comme status "error" via ToolExecutor, jamais "executed"',
    async (status) => {
      const fetchFn = vi.fn(async () => jsonResponse(status, { error: 'refused' }));
      const client = buildClient(fetchFn);
      const registry = new ToolRegistry();
      for (const tool of legifranceConnector.createTools(client)) registry.register(tool);
      const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

      const result = await executor.run({
        tool: 'legifrance.get_article',
        input: { id: 'LEGIARTI000006307920' },
      });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.reason).toContain(String(status));
      }
    },
  );

  it('réponse getArticle malformée (article absent) : erreur, jamais un résultat partiel silencieux', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { executionTime: 1, dereferenced: false }));
    const client = buildClient(fetchFn);
    const [, getArticleTool] = legifranceConnector.createTools(client);

    await expect(getArticleTool!.execute({ id: 'LEGIARTI000006307920' })).rejects.toThrowError();
  });
});

describe('legifranceConnector — sécurité', () => {
  it('21/22/23. aucun access_token, client_secret ou header Authorization dans un ToolResult réussi', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, SAMPLE_ARTICLE_RESPONSE));
    const client = buildClient(fetchFn);
    const registry = new ToolRegistry();
    for (const tool of legifranceConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    const result = await executor.run({
      tool: 'legifrance.get_article',
      input: { id: 'LEGIARTI000006307920' },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_TOKEN_MARKER);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toMatch(/client_secret/i);
  });

  it('24. aucune donnée sensible dans les erreurs (réseau, HTTP, OAuth)', async () => {
    const networkClient = buildClient(
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const httpErrorClient = buildClient(
      vi.fn(async () => jsonResponse(500, { error: 'internal', detail: FAKE_TOKEN_MARKER })),
    );
    // Un `AccessTokenProvider` correctement écrit (comme le `LegifranceOAuthClient` réel,
    // déjà vérifié en LEGAL-02B.1) ne met jamais de secret dans son propre message
    // d'erreur — ce test vérifie que le Connector ne fait qu'y ajouter aucune fuite,
    // pas qu'il assainit un fournisseur mal écrit (hors de sa responsabilité).
    const oauthErrorProvider = new FakeAccessTokenProvider(new Error('échec OAuth (HTTP 401).'));
    const oauthErrorClient = buildClient(vi.fn(), oauthErrorProvider);

    for (const client of [networkClient, httpErrorClient, oauthErrorClient]) {
      const [pingTool] = legifranceConnector.createTools(client);
      try {
        await pingTool!.execute({});
        expect.unreachable('devait lever');
      } catch (error) {
        expect((error as Error).message).not.toContain(FAKE_TOKEN_MARKER);
      }
    }
  });
});
