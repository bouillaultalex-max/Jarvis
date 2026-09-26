import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import {
  LegifranceMalformedResponseError,
  type LegifranceHttpClient,
} from '@jarvis/legifrance-client';

/**
 * Tool `legifrance.search` — jalon LEGAL-03B (ADR-0017).
 *
 * Strictement en lecture. Le connecteur **valide l'entrée structurée**,
 * **construit le payload HTTP `/search`** et renvoie la réponse sous une forme
 * technique : aucune logique de recherche juridique, aucune connaissance de
 * `SearchReference`/`LegalSource` (`@jarvis/legal-core` reste interdit ici).
 *
 * Périmètre volontairement étroit, fondé sur ce qui a été **observé** en
 * Sandbox PISTE (LEGAL-03.0A) :
 *   - un seul fond : `CODE_DATE` (aucun autre fond n'a été testé) ;
 *   - `CODE_DATE` **exige** le filtre `DATE_VERSION` : sans lui, l'ordre des
 *     résultats n'est pas déterministe et les mêmes articles se répètent dans
 *     tous les résultats ;
 *   - `typePagination` vaut toujours `DEFAUT` : `ARTICLE` est accepté par
 *     l'API mais n'est pas appliqué, il n'est donc jamais demandé ;
 *   - `pageNumber`/`pageSize` paginent des **résultats** (codes instantanés),
 *     pas des articles.
 *
 * Aucune valeur maximale de `pageSize` n'est inventée : elle n'a pas été
 * établie (ADR-0017, point ouvert).
 */

/** `POST /search` — endpoint documenté par la FAQ officielle Légifrance et observé en Sandbox (LEGAL-03.0A). */
const SEARCH_PATH = '/search';

/** Seul fond dont le contrat a été observé. */
export const LEGIFRANCE_SEARCH_SUPPORTED_FONDS = ['CODE_DATE'] as const;
export type LegifranceSearchFond = (typeof LEGIFRANCE_SEARCH_SUPPORTED_FONDS)[number];

/** Modes de correspondance acceptés en entrée — vocabulaire du Tool, traduit ci-dessous vers `typeRecherche`. */
export const LEGIFRANCE_SEARCH_MATCH_MODES = ['all_terms', 'any_term', 'exact_phrase'] as const;
export type LegifranceSearchMatchMode = (typeof LEGIFRANCE_SEARCH_MATCH_MODES)[number];

export const LEGIFRANCE_SEARCH_FIELDS = ['any', 'article_number'] as const;
export type LegifranceSearchField = (typeof LEGIFRANCE_SEARCH_FIELDS)[number];

/**
 * `all_terms` → `TOUS_LES_MOTS_DANS_UN_CHAMP` (**observé** en Sandbox).
 * `exact_phrase` → `EXACTE` (**observé** avec `NUM_ARTICLE`).
 * `any_term` → `UN_DES_MOTS` (documenté par la FAQ officielle, **non observé**).
 */
const MATCH_MODE_TO_TYPE_RECHERCHE: Readonly<Record<LegifranceSearchMatchMode, string>> = {
  all_terms: 'TOUS_LES_MOTS_DANS_UN_CHAMP',
  any_term: 'UN_DES_MOTS',
  exact_phrase: 'EXACTE',
};

/** `any` → `ALL` et `article_number` → `NUM_ARTICLE` (les deux **observés** en Sandbox). */
const FIELD_TO_TYPE_CHAMP: Readonly<Record<LegifranceSearchField, string>> = {
  any: 'ALL',
  article_number: 'NUM_ARTICLE',
};

const INPUT_KEYS: ReadonlySet<string> = new Set([
  'fond',
  'text',
  'matchMode',
  'field',
  'dateVersion',
  'pageNumber',
  'pageSize',
]);

export interface LegifranceSearchInput {
  readonly fond: LegifranceSearchFond;
  /** Termes recherchés — chaîne non vide. */
  readonly text: string;
  readonly matchMode: LegifranceSearchMatchMode;
  /** Défaut : `any`. */
  readonly field?: LegifranceSearchField;
  /**
   * Date de version demandée (`DATE_VERSION`), ISO 8601 (date seule ou date
   * et heure). Convertie en epoch ms via `Date.parse` : une date seule
   * (`2019-05-24`) vaut minuit UTC — c'est la convention utilisée lors de
   * l'exploration Sandbox. Le fuseau réel appliqué par Légifrance n'est pas
   * établi (ADR-0014, point ouvert).
   */
  readonly dateVersion: string;
  /** À partir de 1. Pagine des résultats, pas des articles. */
  readonly pageNumber: number;
  readonly pageSize: number;
}

/**
 * Sortie **technique** : les champs racine utiles au parsing et `results`
 * tel que reçu, sans renommage ni conversion (dates en chaînes, sentinelle
 * `2999-01-01…` incluse). Le parsing vers `SearchReference` appartient à
 * l'adaptateur de `@jarvis/legal-research`, jamais à ce module.
 */
export interface LegifranceSearchOutput {
  readonly totalResultNumber: number | null;
  readonly totalArticleResultNumber: number | null;
  /** Tel qu'annoncé par la réponse (peut valoir `DEFAUT` même si `ARTICLE` était demandé — jamais demandé ici). */
  readonly typePagination: string | null;
  readonly results: readonly unknown[];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function includesLiteral<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function validateSearchInput(input: unknown): ToolValidationResult<LegifranceSearchInput> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('legifrance.search : objet attendu.');
  }
  const record = input as Record<string, unknown>;

  const unknownKeys = Object.keys(record).filter((key) => !INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return invalid(`legifrance.search : propriété(s) inconnue(s) : ${unknownKeys.join(', ')}.`);
  }

  if (!includesLiteral(LEGIFRANCE_SEARCH_SUPPORTED_FONDS, record.fond)) {
    return invalid(
      `legifrance.search : « fond » non supporté (attendu : ${LEGIFRANCE_SEARCH_SUPPORTED_FONDS.join(', ')} — seul fond observé).`,
    );
  }
  if (typeof record.text !== 'string' || record.text.trim().length === 0) {
    return invalid('legifrance.search : « text » doit être une chaîne non vide.');
  }
  if (!includesLiteral(LEGIFRANCE_SEARCH_MATCH_MODES, record.matchMode)) {
    return invalid(
      `legifrance.search : « matchMode » doit valoir l'un de ${LEGIFRANCE_SEARCH_MATCH_MODES.join(', ')}.`,
    );
  }
  if (record.field !== undefined && !includesLiteral(LEGIFRANCE_SEARCH_FIELDS, record.field)) {
    return invalid(
      `legifrance.search : « field » doit valoir l'un de ${LEGIFRANCE_SEARCH_FIELDS.join(', ')}.`,
    );
  }
  // CODE_DATE exige DATE_VERSION (comportement observé : sans filtre, l'ordre n'est pas déterministe).
  if (typeof record.dateVersion !== 'string' || !Number.isFinite(Date.parse(record.dateVersion))) {
    return invalid(
      'legifrance.search : « dateVersion » (date ISO 8601 valide) est obligatoire pour CODE_DATE.',
    );
  }
  if (!isPositiveInteger(record.pageNumber)) {
    return invalid('legifrance.search : « pageNumber » doit être un entier >= 1.');
  }
  if (!isPositiveInteger(record.pageSize)) {
    return invalid('legifrance.search : « pageSize » doit être un entier >= 1.');
  }

  return valid({
    fond: record.fond,
    text: record.text.trim(),
    matchMode: record.matchMode,
    ...(record.field !== undefined ? { field: record.field } : {}),
    dateVersion: record.dateVersion,
    pageNumber: record.pageNumber,
    pageSize: record.pageSize,
  });
}

/**
 * Construit le payload `POST /search` — exactement la forme utilisée lors des
 * appels Sandbox réussis (LEGAL-03.0A). `typePagination` est toujours
 * `DEFAUT` et `sort` toujours `PERTINENCE` (valeur observée acceptée) ; aucun
 * autre filtre n'est émis.
 */
export function buildLegifranceSearchPayload(
  input: LegifranceSearchInput,
): Record<string, unknown> {
  return {
    fond: input.fond,
    recherche: {
      champs: [
        {
          typeChamp: FIELD_TO_TYPE_CHAMP[input.field ?? 'any'],
          criteres: [
            {
              typeRecherche: MATCH_MODE_TO_TYPE_RECHERCHE[input.matchMode],
              valeur: input.text,
              operateur: 'ET',
            },
          ],
          operateur: 'ET',
        },
      ],
      filtres: [{ facette: 'DATE_VERSION', singleDate: Date.parse(input.dateVersion) }],
      pageNumber: input.pageNumber,
      pageSize: input.pageSize,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
      operateur: 'ET',
    },
  };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Traduit la réponse brute (déjà JSON-désérialisée) en {@link LegifranceSearchOutput}.
 * Réutilise `LegifranceMalformedResponseError` (`@jarvis/legifrance-client`) : une
 * réponse 2xx dont la forme est inexploitable relève de la même catégorie que
 * pour `getArticle`. Seul `results` (un tableau) est obligatoire ; ses éléments
 * ne sont **pas** inspectés ici (le parsing appartient à l'adaptateur).
 */
function mapSearchResponse(raw: unknown): LegifranceSearchOutput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LegifranceMalformedResponseError('réponse de /search : objet attendu.');
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.results)) {
    throw new LegifranceMalformedResponseError(
      'réponse de /search : champ « results » (tableau) attendu.',
    );
  }
  return {
    totalResultNumber: toNullableNumber(body.totalResultNumber),
    totalArticleResultNumber: toNullableNumber(body.totalArticleResultNumber),
    typePagination: toNullableString(body.typePagination),
    results: body.results,
  };
}

export function createLegifranceSearchTool(
  client: LegifranceHttpClient,
): Tool<LegifranceSearchInput, LegifranceSearchOutput> {
  return {
    name: 'legifrance.search',
    description:
      'Recherche des références dans le fond CODE_DATE de Légifrance à une date de version donnée (lecture seule, aucun effet de bord). Retourne la réponse technique paginée par résultats.',
    action: 'read',

    inputSchema: {
      type: 'object',
      properties: {
        fond: { type: 'string', enum: [...LEGIFRANCE_SEARCH_SUPPORTED_FONDS] },
        text: { type: 'string', minLength: 1, description: 'Termes recherchés.' },
        matchMode: { type: 'string', enum: [...LEGIFRANCE_SEARCH_MATCH_MODES] },
        field: { type: 'string', enum: [...LEGIFRANCE_SEARCH_FIELDS] },
        dateVersion: {
          type: 'string',
          description: 'Date de version ISO 8601 (obligatoire pour CODE_DATE).',
        },
        pageNumber: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1 },
      },
      required: ['fond', 'text', 'matchMode', 'dateVersion', 'pageNumber', 'pageSize'],
      additionalProperties: false,
    },

    validateInput: validateSearchInput,

    async execute(input: LegifranceSearchInput): Promise<LegifranceSearchOutput> {
      const raw = await client.request({
        method: 'POST',
        path: SEARCH_PATH,
        body: buildLegifranceSearchPayload(input),
      });
      return mapSearchResponse(raw);
    },
  };
}
