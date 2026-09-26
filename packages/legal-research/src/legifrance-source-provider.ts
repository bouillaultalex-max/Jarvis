import type { ToolExecutor } from '@jarvis/core';

import {
  mapLegifranceArticleToLegalSource,
  type MapLegifranceArticleResult,
} from './legifrance-source-mapping.js';

/**
 * Abstraction juridique générique au-dessus d'un connecteur — jalon
 * LEGAL-02B.3. Un seul membre pour l'instant (`getArticle`, Légifrance
 * uniquement) : point d'extension pour de futures sources institutionnelles
 * (BOFiP, Judilibre…), sans qu'aucune n'existe encore.
 */
export interface LegalSourceProvider {
  getArticle(id: string): Promise<MapLegifranceArticleResult>;
}

export type LegifranceProviderErrorReason =
  'unknown_tool' | 'invalid_input' | 'denied' | 'awaiting_confirmation' | 'execution_error';

/**
 * Le Tool `legifrance.get_article` n'a pas produit de résultat exploitable
 * — jamais de secret, jamais le corps d'une réponse HTTP (le `reason` vient
 * de `ToolExecutionResult`, déjà sûr par construction — voir
 * `@jarvis/core`/`@jarvis/legifrance-client`).
 */
export class LegifranceProviderError extends Error {
  constructor(
    readonly reason: LegifranceProviderErrorReason,
    detail: string,
  ) {
    super(`LegifranceSourceProvider : ${detail}`);
    this.name = 'LegifranceProviderError';
  }
}

const GET_ARTICLE_TOOL_NAME = 'legifrance.get_article';

const STATUS_TO_REASON: Readonly<Record<string, LegifranceProviderErrorReason>> = {
  unknown_tool: 'unknown_tool',
  invalid_input: 'invalid_input',
  denied: 'denied',
  awaiting_confirmation: 'awaiting_confirmation',
  error: 'execution_error',
};

export interface LegifranceSourceProviderOptions {
  readonly toolExecutor: ToolExecutor;
  /** Injectable pour des tests déterministes — propagé au mapping (`consultedAt`). Défaut : `Date.now`. */
  readonly now?: () => number;
}

/**
 * Implémentation Légifrance de {@link LegalSourceProvider} — jalon
 * LEGAL-02B.3.
 *
 * Ne gère jamais elle-même l'authentification, le HTTP, ni
 * `ConnectorRegistry` : elle passe **exclusivement** par le `ToolExecutor`
 * injecté, exactement comme n'importe quel autre appelant de
 * `legifrance.get_article` — jamais de raccourci vers
 * `LegifranceHttpClient`/`AccessTokenProvider`/`SecretStore` (`@jarvis/legal-research`
 * ne dépend d'ailleurs ni de `@jarvis/connectors` ni de
 * `@jarvis/legifrance-client`, voir `legifrance-source-mapping.ts`). Même
 * choix de conception que `proposeConfirmation`/`confirmAndExecute`
 * (`@jarvis/connectors`) : `ToolExecutor` reste le seul point de passage
 * pour exécuter une action, y compris une lecture — jamais contourné,
 * jamais un second système d'exécution.
 */
export class LegifranceSourceProvider implements LegalSourceProvider {
  private readonly toolExecutor: ToolExecutor;
  private readonly now: () => number;

  constructor(options: LegifranceSourceProviderOptions) {
    this.toolExecutor = options.toolExecutor;
    this.now = options.now ?? Date.now;
  }

  /**
   * @throws {LegifranceProviderError} si `ToolExecutor` ne renvoie pas
   *   `status: 'executed'` (refusé par `PermissionManager`, outil inconnu,
   *   entrée invalide, confirmation requise, ou échec technique).
   * @throws {LegifranceMappingError} si la réponse exécutée n'a pas la
   *   forme attendue (voir `legifrance-source-mapping.ts`).
   */
  async getArticle(id: string): Promise<MapLegifranceArticleResult> {
    const result = await this.toolExecutor.run({ tool: GET_ARTICLE_TOOL_NAME, input: { id } });

    if (result.status !== 'executed') {
      const reason = STATUS_TO_REASON[result.status] ?? 'execution_error';
      throw new LegifranceProviderError(reason, result.reason);
    }

    return mapLegifranceArticleToLegalSource(result.output, { now: this.now });
  }
}
