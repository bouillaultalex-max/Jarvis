import type { AccessTokenProvider } from '../auth/access-token-provider.js';
import type { LegifranceConfig } from '../config/legifrance-config.js';
import {
  LegifranceHttpError,
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
} from '../errors/legifrance-errors.js';

/**
 * Client HTTP minimal et injectable pour l'API Légifrance — jalon
 * LEGAL-02B.1.
 *
 * Volontairement **sans connaissance d'aucun endpoint Légifrance
 * particulier** (pas de recherche de texte, pas de récupération
 * d'article, aucun mapping vers `LegalSource`/`LegalCitation`) : ce module
 * ne fait que porter un jeton d'accès et des headers JSON sur une requête
 * HTTP générique. Le détail des endpoints appartient à LEGAL-02B.2+.
 *
 * Dépend d'un {@link AccessTokenProvider} (implémenté ici par
 * `LegifranceOAuthClient` ; même forme que celle de `@jarvis/connectors`,
 * redéclarée localement — voir `./access-token-provider.js`) plutôt que
 * d'un `LegifranceOAuthClient` concret : ce client HTTP n'a besoin de
 * savoir « obtenir un token », jamais « comment » — même séparation que
 * `GmailApiClient`/`AccessTokenProvider`.
 */

export interface LegifranceHttpClientOptions {
  readonly config: LegifranceConfig;
  readonly accessTokenProvider: AccessTokenProvider;
  /** Injectable pour les tests : jamais d'appel réseau réel dans la suite de tests. */
  readonly fetchFn?: typeof fetch;
}

export interface LegifranceRequestOptions {
  readonly method: 'GET' | 'POST';
  /** Chemin relatif à `apiBaseUrl` (ex. `/list/ping`) — jamais une URL absolue. */
  readonly path: string;
  /** Corps JSON de la requête, si applicable. Sérialisé tel quel — aucune connaissance d'un endpoint particulier. */
  readonly body?: unknown;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class LegifranceHttpClient {
  private readonly apiBaseUrl: string;
  private readonly accessTokenProvider: AccessTokenProvider;
  private readonly fetchFn: typeof fetch;

  constructor(options: LegifranceHttpClientOptions) {
    this.apiBaseUrl = options.config.apiBaseUrl;
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * Exécute une requête authentifiée contre l'API Légifrance et renvoie le
   * corps JSON déjà désérialisé (non typé — le typage d'un endpoint précis
   * appartient à la couche qui le connaît, hors périmètre LEGAL-02B.1).
   *
   * @throws {LegifranceNetworkError} si l'appel réseau échoue avant toute réponse.
   * @throws {LegifranceHttpError} si la réponse a un statut HTTP non 2xx.
   * @throws {LegifranceMalformedResponseError} si la réponse 2xx n'est pas un JSON valide.
   */
  async request(options: LegifranceRequestOptions): Promise<unknown> {
    const accessToken = await this.accessTokenProvider.getAccessToken();

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiBaseUrl}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      throw new LegifranceNetworkError(describeError(err));
    }

    if (!response.ok) {
      throw new LegifranceHttpError(response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new LegifranceMalformedResponseError('réponse API non-JSON.');
    }
  }
}
