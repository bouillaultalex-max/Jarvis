import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import { createLegifranceConfig, LegifranceHttpClient } from '@jarvis/legifrance-client';

import type { AccessTokenProvider } from '../gmail/gmail-auth.js';
import { legifranceConnector } from './legifrance-connector.js';
import {
  buildLegifranceSearchPayload,
  createLegifranceSearchTool,
  type LegifranceSearchInput,
} from './legifrance-search-tool.js';

const FAKE_TOKEN_MARKER = 'FAKE-LEGIFRANCE-ACCESS-TOKEN-MARKER-NOT-REAL';

class FakeAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    return FAKE_TOKEN_MARKER;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildClient(fetchFn: typeof fetch): LegifranceHttpClient {
  return new LegifranceHttpClient({
    config: createLegifranceConfig('sandbox'),
    accessTokenProvider: new FakeAccessTokenProvider(),
    fetchFn,
  });
}

function buildExecutor(
  fetchFn: typeof fetch,
  policy: ConstructorParameters<typeof PermissionManager>[0] = { default: 'allow' },
) {
  const registry = new ToolRegistry();
  for (const tool of legifranceConnector.createTools(buildClient(fetchFn))) registry.register(tool);
  return new ToolExecutor(registry, new PermissionManager(policy));
}

const VALID_INPUT = {
  fond: 'CODE_DATE',
  text: 'préavis démission',
  matchMode: 'all_terms',
  dateVersion: '2019-05-24',
  pageNumber: 1,
  pageSize: 5,
};

/** Même entrée, typée pour appeler directement `buildLegifranceSearchPayload` (les tests de validation utilisent l'objet brut). */
const VALID_INPUT_TYPED = VALID_INPUT as unknown as LegifranceSearchInput;

// Forme réduite alignée sur la réponse observée en Sandbox (LEGAL-03.0A) : dates en chaînes, sentinelle textuelle.
const SAMPLE_SEARCH_RESPONSE = {
  executionTime: 20,
  totalResultNumber: 7,
  totalArticleResultNumber: 0,
  typePagination: 'DEFAUT',
  facets: [],
  results: [
    {
      type: 'data_legi',
      nature: 'code',
      origin: 'LEGI',
      etat: 'VIGUEUR',
      text: null,
      moreArticlesCount: 5,
      moreArticle: true,
      titles: [{ id: 'LEGITEXT000006072050_24-05-2019' }],
      sections: [
        {
          extracts: [
            {
              id: 'LEGIARTI000033020376',
              title: 'L3121-27',
              legalStatus: 'VIGUEUR',
              dateVersion: '2016-08-10T00:00:00.000+0000',
              dateDebut: '2016-08-10T00:00:00.000+0000',
              dateFin: '2999-01-01T00:00:00.000+0000',
              type: 'articles',
              values: ['extrait factice'],
            },
          ],
        },
      ],
    },
  ],
};

function tool() {
  return createLegifranceSearchTool(buildClient(vi.fn()));
}

describe('legifrance.search — contrat du Tool', () => {
  it('est un Tool READ nommé legifrance.search, sans aucun champ credential', () => {
    const t = tool();
    expect(t.name).toBe('legifrance.search');
    expect(t.action).toBe('read');
    expect(Object.keys(t).sort()).toEqual(
      ['action', 'description', 'execute', 'inputSchema', 'name', 'validateInput'].sort(),
    );
  });

  it('inputSchema interdit les clés inconnues et rend dateVersion obligatoire', () => {
    const schema = tool().inputSchema as { additionalProperties: boolean; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('dateVersion');
  });
});

describe('legifrance.search — validation d’entrée', () => {
  it('accepte une entrée valide et normalise le texte (trim)', () => {
    expect(tool().validateInput({ ...VALID_INPUT, text: '  préavis démission  ' })).toEqual({
      ok: true,
      value: { ...VALID_INPUT, text: 'préavis démission' },
    });
  });

  it('accepte field et un dateVersion date-heure ISO', () => {
    const result = tool().validateInput({
      ...VALID_INPUT,
      field: 'article_number',
      dateVersion: '2019-05-24T10:00:00Z',
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['une valeur non objet', 'x'],
    ['null', null],
    ['un tableau', []],
    ['une propriété inconnue', { ...VALID_INPUT, sort: 'DATE_DESC' }],
    ['typePagination fourni par l’appelant', { ...VALID_INPUT, typePagination: 'ARTICLE' }],
    ['un fond non supporté', { ...VALID_INPUT, fond: 'JURI' }],
    ['un texte vide', { ...VALID_INPUT, text: '   ' }],
    ['un texte non chaîne', { ...VALID_INPUT, text: 3 }],
    ['un matchMode inconnu', { ...VALID_INPUT, matchMode: 'fuzzy' }],
    ['un field inconnu', { ...VALID_INPUT, field: 'title' }],
    ['un dateVersion absent (CODE_DATE l’exige)', { ...VALID_INPUT, dateVersion: undefined }],
    ['un dateVersion non interprétable', { ...VALID_INPUT, dateVersion: 'hier' }],
    ['un pageNumber nul', { ...VALID_INPUT, pageNumber: 0 }],
    ['un pageNumber non entier', { ...VALID_INPUT, pageNumber: 1.5 }],
    ['un pageSize négatif', { ...VALID_INPUT, pageSize: -1 }],
    ['un pageSize chaîne', { ...VALID_INPUT, pageSize: '5' }],
  ])('rejette %s', (_label, input) => {
    expect(tool().validateInput(input).ok).toBe(false);
  });
});

describe('legifrance.search — construction du payload HTTP', () => {
  it('reproduit la forme observée en Sandbox (all_terms, champ ALL, DATE_VERSION en epoch ms, typePagination DEFAUT)', () => {
    const validation = tool().validateInput(VALID_INPUT);
    if (!validation.ok) throw new Error('entrée valide attendue');

    expect(buildLegifranceSearchPayload(validation.value)).toEqual({
      fond: 'CODE_DATE',
      recherche: {
        champs: [
          {
            typeChamp: 'ALL',
            criteres: [
              {
                typeRecherche: 'TOUS_LES_MOTS_DANS_UN_CHAMP',
                valeur: 'préavis démission',
                operateur: 'ET',
              },
            ],
            operateur: 'ET',
          },
        ],
        filtres: [{ facette: 'DATE_VERSION', singleDate: Date.UTC(2019, 4, 24) }],
        pageNumber: 1,
        pageSize: 5,
        sort: 'PERTINENCE',
        typePagination: 'DEFAUT',
        operateur: 'ET',
      },
    });
  });

  it('traduit article_number + exact_phrase en NUM_ARTICLE + EXACTE (combinaison observée)', () => {
    const payload = buildLegifranceSearchPayload({
      ...VALID_INPUT_TYPED,
      text: 'L3121-27',
      matchMode: 'exact_phrase',
      field: 'article_number',
    }) as {
      recherche: {
        champs: Array<{ typeChamp: string; criteres: Array<{ typeRecherche: string }> }>;
      };
    };
    expect(payload.recherche.champs[0]!.typeChamp).toBe('NUM_ARTICLE');
    expect(payload.recherche.champs[0]!.criteres[0]!.typeRecherche).toBe('EXACTE');
  });

  it('traduit any_term en UN_DES_MOTS (documenté, non observé)', () => {
    const payload = buildLegifranceSearchPayload({
      ...VALID_INPUT_TYPED,
      matchMode: 'any_term',
    }) as {
      recherche: { champs: Array<{ criteres: Array<{ typeRecherche: string }> }> };
    };
    expect(payload.recherche.champs[0]!.criteres[0]!.typeRecherche).toBe('UN_DES_MOTS');
  });

  it('ne demande jamais typePagination ARTICLE, quelles que soient les entrées', () => {
    for (const matchMode of ['all_terms', 'any_term', 'exact_phrase'] as const) {
      const payload = buildLegifranceSearchPayload({ ...VALID_INPUT_TYPED, matchMode }) as {
        recherche: { typePagination: string };
      };
      expect(payload.recherche.typePagination).toBe('DEFAUT');
    }
  });

  it('un dateVersion avec décalage horaire est converti à l’instant correspondant', () => {
    const payload = buildLegifranceSearchPayload({
      ...VALID_INPUT_TYPED,
      dateVersion: '2019-05-24T02:00:00+02:00',
    }) as {
      recherche: { filtres: Array<{ singleDate: number }> };
    };
    expect(payload.recherche.filtres[0]!.singleDate).toBe(Date.UTC(2019, 4, 24));
  });
});

describe('legifrance.search — exécution via ToolExecutor (aucun réseau réel)', () => {
  it('appelle POST /search avec le payload construit ; Authorization géré par le client HTTP', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, SAMPLE_SEARCH_RESPONSE),
    );
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result.status).toBe('executed');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`${createLegifranceConfig('sandbox').apiBaseUrl}/search`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as {
      fond: string;
      recherche: { typePagination: string };
    };
    expect(body.fond).toBe('CODE_DATE');
    expect(body.recherche.typePagination).toBe('DEFAUT');
  });

  it('renvoie les totaux et results tels que reçus, sans conversion (sentinelle textuelle conservée)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, SAMPLE_SEARCH_RESPONSE));
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.output).toEqual({
      totalResultNumber: 7,
      totalArticleResultNumber: 0,
      typePagination: 'DEFAUT',
      results: SAMPLE_SEARCH_RESPONSE.results,
    });
    const extract = (result.output as { results: typeof SAMPLE_SEARCH_RESPONSE.results })
      .results[0]!.sections[0]!.extracts[0]!;
    expect(extract.dateFin).toBe('2999-01-01T00:00:00.000+0000');
  });

  it('un champ racine absent ou mal typé devient null, sans faire échouer la réponse', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { results: [], totalResultNumber: 'x' }));
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result).toMatchObject({
      status: 'executed',
      output: {
        totalResultNumber: null,
        totalArticleResultNumber: null,
        typePagination: null,
        results: [],
      },
    });
  });

  it('une entrée invalide n’atteint jamais le réseau', async () => {
    const fetchFn = vi.fn();
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: { ...VALID_INPUT, dateVersion: undefined },
    });

    expect(result.status).toBe('invalid_input');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('une politique deny refuse même ce Tool READ, sans appel réseau', async () => {
    const fetchFn = vi.fn();
    const result = await buildExecutor(fetchFn, { default: 'deny' }).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result.status).toBe('denied');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('erreur HTTP : status "error", jamais "executed", sans corps de réponse ni token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { message: 'CORPS-DISTANT-SENSIBLE' }));
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.reason).toContain('HTTP 500');
    expect(result.reason).not.toContain('CORPS-DISTANT-SENSIBLE');
    expect(result.reason).not.toContain(FAKE_TOKEN_MARKER);
  });

  it('erreur réseau : status "error"', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('connexion refusée');
    });
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });
    expect(result.status).toBe('error');
  });

  it.each([
    ['sans champ results', { totalResultNumber: 1 }],
    ['avec results non tableau', { results: {} }],
    ['dont la racine est un tableau', []],
  ])('réponse malformée %s : status "error", jamais un résultat partiel', async (_label, body) => {
    const fetchFn = vi.fn(async () => jsonResponse(200, body));
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.reason).toContain('réponse malformée');
  });

  it('aucun access_token, client_secret ou header Authorization dans une sortie réussie', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, SAMPLE_SEARCH_RESPONSE));
    const result = await buildExecutor(fetchFn).run({
      tool: 'legifrance.search',
      input: VALID_INPUT,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_TOKEN_MARKER);
    expect(serialized).not.toMatch(/access_token|client_secret|authorization/i);
  });
});
