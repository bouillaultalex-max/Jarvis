import type { ToolExecutor } from '@jarvis/core';

import {
  LEGIFRANCE_PROVIDER_ID,
  LEGIFRANCE_SEARCH_COLLECTION,
  parseLegifranceSearchOutput,
} from './legifrance-search-parser.js';
import {
  ResearchProviderError,
  type ResearchProviderErrorReason,
  type SearchPort,
} from './research/ports.js';
import type { SearchQuery, SearchResultPage } from './research/search-types.js';

/**
 * Adaptateur Légifrance de {@link SearchPort} — jalon LEGAL-03B (ADR-0015,
 * ADR-0017).
 *
 * Ne fait **jamais** de HTTP, n'utilise ni `SecretStore` ni
 * `ConnectorRegistry` et ne connaît ni `@jarvis/connectors` ni
 * `@jarvis/legifrance-client` : il construit l'**entrée structurée** du Tool
 * `legifrance.search` (le connecteur construit le payload HTTP) et l'exécute
 * **exclusivement** via le `ToolExecutor` injecté, comme n'importe quel autre
 * appelant d'un Tool.
 *
 * Ne crée aucune `LegalSource`, ne déduplique pas, ne classe pas.
 */

const SEARCH_TOOL_NAME = 'legifrance.search';

/** Mêmes statuts que `ToolExecutionResult`, traduits vers le contrat des ports (`invalid_input` → `invalid_request`). */
const STATUS_TO_REASON: Readonly<Record<string, ResearchProviderErrorReason>> = {
  unknown_tool: 'unknown_tool',
  invalid_input: 'invalid_request',
  denied: 'denied',
  awaiting_confirmation: 'awaiting_confirmation',
  error: 'execution_error',
};

export interface LegifranceSearchAdapterOptions {
  readonly toolExecutor: ToolExecutor;
  /** Injectable pour des tests déterministes — date `provenance.executedAt`. Défaut : `Date.now`. */
  readonly now?: () => number;
}

export class LegifranceSearchAdapter implements SearchPort {
  readonly providerId = LEGIFRANCE_PROVIDER_ID;

  private readonly toolExecutor: ToolExecutor;
  private readonly now: () => number;

  constructor(options: LegifranceSearchAdapterOptions) {
    this.toolExecutor = options.toolExecutor;
    this.now = options.now ?? Date.now;
  }

  /**
   * @throws {ResearchProviderError} `invalid_request` si la requête ne peut pas
   *   être traduite (voir {@link assertTranslatable}) ou refusée par la
   *   validation du Tool ; `denied`/`unknown_tool`/`awaiting_confirmation`/
   *   `execution_error` selon `ToolExecutionResult` ; `malformed_response` si la
   *   sortie est inexploitable. Le message d'erreur d'un échec technique n'est
   *   **jamais** analysé pour distinguer 404/429/5xx (décision D3).
   */
  async search(query: SearchQuery): Promise<SearchResultPage> {
    assertTranslatable(query);

    const result = await this.toolExecutor.run({
      tool: SEARCH_TOOL_NAME,
      input: {
        fond: LEGIFRANCE_SEARCH_COLLECTION,
        text: query.text,
        matchMode: query.matchMode,
        ...(query.field !== undefined ? { field: query.field } : {}),
        dateVersion: query.asOf,
        pageNumber: query.page.number,
        pageSize: query.page.size,
      },
    });

    if (result.status !== 'executed') {
      const reason = STATUS_TO_REASON[result.status] ?? 'execution_error';
      throw new ResearchProviderError(LEGIFRANCE_PROVIDER_ID, reason, result.reason);
    }

    return parseLegifranceSearchOutput(result.output, {
      query,
      executedAt: new Date(this.now()).toISOString(),
    });
  }
}

/**
 * Refuse explicitement ce que l'adaptateur ne sait pas traduire — jamais
 * d'ignorance silencieuse :
 *   - `sourceTypes` : aucun filtre de nature n'a été observé dans le contrat
 *     réel Légifrance, aucun mapping n'est inventé (décision D6) ;
 *   - `asOf` : `CODE_DATE` exige `DATE_VERSION` (sans lui, l'ordre est
 *     non déterministe et les articles se répètent — ADR-0017).
 */
function assertTranslatable(
  query: SearchQuery,
): asserts query is SearchQuery & { readonly asOf: string } {
  if (query.sourceTypes !== undefined && query.sourceTypes.length > 0) {
    throw new ResearchProviderError(
      LEGIFRANCE_PROVIDER_ID,
      'invalid_request',
      '« sourceTypes » non supporté : aucun filtre de nature observé pour ce fournisseur.',
    );
  }
  if (query.asOf === undefined) {
    throw new ResearchProviderError(
      LEGIFRANCE_PROVIDER_ID,
      'invalid_request',
      `« asOf » est obligatoire pour ${LEGIFRANCE_SEARCH_COLLECTION} (filtre DATE_VERSION).`,
    );
  }
}
