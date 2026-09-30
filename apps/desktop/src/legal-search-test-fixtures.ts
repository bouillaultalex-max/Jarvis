import { vi } from 'vitest';
import { InMemorySecretStore } from '@jarvis/connectors';
import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from '@jarvis/legifrance-client';

/**
 * Doubles partagés par `run-legal-search-flow.test.ts` et
 * `main-legal-search.test.ts` — formes de réponse brute Légifrance
 * (`/search`, `/consult/getArticle`) reprises, facticement, du style de
 * `packages/legal-research/src/research/testing/legifrance-search-fixtures.ts`
 * et de `packages/connectors/src/legifrance/legifrance-connector.test.ts`
 * (`SAMPLE_ARTICLE_RESPONSE`) — ni l'un ni l'autre n'étant exporté
 * publiquement par leur package, ce fichier ne les importe pas mais en
 * reproduit la forme. Aucune valeur n'est réelle.
 */

export const FAKE_CLIENT_ID = 'test-legifrance-client-id-0000';
export const FAKE_CLIENT_SECRET = 'test-legifrance-client-secret-0000';

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function extract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'LEGIARTI000006901174',
    title: 'L1237-1',
    legalStatus: 'VIGUEUR',
    dateVersion: '2008-05-01T00:00:00.000+0000',
    dateDebut: '2008-05-01T00:00:00.000+0000',
    dateFin: '2999-01-01T00:00:00.000+0000',
    type: 'articles',
    values: ['extrait factice — préavis licenciement'],
    ...overrides,
  };
}

export function searchResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'data_legi',
    nature: 'code',
    origin: 'LEGI',
    etat: 'VIGUEUR',
    text: null,
    date: '1973-01-03T00:00:00.000+0000',
    datePublication: '2999-01-01T00:00:00.000+0000',
    moreArticlesCount: 0,
    moreArticle: false,
    titles: [{ id: 'LEGITEXT000006072050_01-01-2026' }],
    sections: [{ extracts: [extract()] }],
    ...overrides,
  };
}

export function searchOutput(
  results: readonly unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    totalResultNumber: results.length,
    totalArticleResultNumber: 0,
    typePagination: 'DEFAUT',
    results,
    ...overrides,
  };
}

export const EMPTY_SEARCH_OUTPUT = searchOutput([]);
export const NOMINAL_SEARCH_OUTPUT = searchOutput([searchResult()]);

export function articleResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executionTime: 5,
    dereferenced: false,
    article: {
      id: 'LEGIARTI000006901174',
      cid: 'LEGIARTI000006901174',
      idTexte: 'LEGITEXT000006072050',
      cidTexte: null,
      type: 'AUTONOME',
      nature: 'Article',
      num: 'L1237-1',
      texte: 'Texte factice — article de test.',
      versionArticle: '1.0',
      etat: 'VIGUEUR',
      dateDebut: 1_000_000_000_000,
      dateFin: 32_472_144_000_000,
      versionPrecedente: null,
      isMultipleVersions: false,
      sectionParentTitre: null,
      fullSectionsTitre: null,
      articleVersions: [
        {
          id: 'LEGIARTI000006901174',
          etat: 'VIGUEUR',
          version: '1.0',
          dateDebut: 1_000_000_000_000,
          dateFin: 32_472_144_000_000,
        },
      ],
      lienModifications: [],
      lienCitations: [],
      ...overrides,
    },
  };
}

export const ARTICLE_RESPONSE = articleResponse();

export interface FetchFnOptions {
  readonly searchOutput?: unknown;
  readonly searchStatus?: number;
  readonly articleOutput?: unknown;
  readonly articleStatus?: number;
}

export function buildFetchFn(options: FetchFnOptions = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/oauth/token')) {
      return jsonResponse(200, { access_token: 'FAKE-LEGIFRANCE-TOKEN', expires_in: 3600 });
    }
    if (url.includes('/search')) {
      return jsonResponse(
        options.searchStatus ?? 200,
        options.searchOutput ?? NOMINAL_SEARCH_OUTPUT,
      );
    }
    if (url.includes('/consult/getArticle')) {
      return jsonResponse(options.articleStatus ?? 200, options.articleOutput ?? ARTICLE_RESPONSE);
    }
    throw new Error(`URL inattendue dans le test : ${url}`);
  }) as unknown as typeof fetch;
}

export async function buildLegifranceSecretStore(): Promise<InMemorySecretStore> {
  const store = new InMemorySecretStore();
  await store.set(legifranceClientIdSecretKey('sandbox'), FAKE_CLIENT_ID);
  await store.set(legifranceClientSecretSecretKey('sandbox'), FAKE_CLIENT_SECRET);
  return store;
}
