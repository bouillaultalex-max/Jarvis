import type { AccessTokenProvider } from './access-token-provider.js';

import type { LegifranceConfig } from '../config/legifrance-config.js';
import {
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
  LegifranceOAuthError,
} from '../errors/legifrance-errors.js';
import type { LegifranceCredentials } from './legifrance-credentials.js';

/**
 * Client OAuth 2.0 *Client Credentials* pour PISTE — jalon LEGAL-02B.1.
 *
 * Implémente {@link AccessTokenProvider} — même forme que celle de
 * `@jarvis/connectors` (`gmail-auth.ts`) pour `GoogleOAuthAccessTokenProvider`,
 * redéclarée localement (`./access-token-provider.js`) pour que
 * `@jarvis/legifrance-client` reste une feuille sans dépendance `@jarvis/*`
 * (cycle de packages corrigé — voir PROJECT_STATE.md). Le typage structurel
 * de TypeScript rend les deux déclarations interchangeables.
 *
 * Différences volontaires avec `GoogleOAuthAccessTokenProvider` :
 *   - **pas de refresh token** : PISTE utilise `grant_type=client_credentials`
 *     — chaque renouvellement redemande un jeton avec `clientId`/`clientSecret`,
 *     jamais un `refresh_token` (explicitement hors périmètre) ;
 *   - **`expires_in` est obligatoire**, pas silencieusement remplacé par une
 *     valeur par défaut si absent — voir {@link LegifranceMalformedResponseError} ;
 *     `GoogleOAuthAccessTokenProvider` suppose 3600s si absent, ce qui risquerait
 *     de faire vivre un jeton PISTE plus longtemps que ce que le serveur a
 *     réellement annoncé ;
 *   - **single-flight** : plusieurs appels concurrents à `getAccessToken()`
 *     alors qu'aucun jeton valide n'existe partagent la **même** requête
 *     OAuth en vol, au lieu d'en déclencher une par appelant (un renouvellement
 *     immédiat après un cache-miss expiré n'a par nature pas de premier appel
 *     "already in flight" à rejoindre : c'est la fenêtre exacte que cette
 *     stratégie protège). `GoogleOAuthAccessTokenProvider` ne le fait pas —
 *     amélioration délibérée, pas un report d'un défaut préexistant.
 */

export interface LegifranceOAuthClientOptions {
  readonly config: LegifranceConfig;
  readonly credentials: LegifranceCredentials;
  /** Injectable pour les tests : jamais d'appel réseau réel dans la suite de tests. */
  readonly fetchFn?: typeof fetch;
  /** Injectable pour les tests (contrôle déterministe de l'expiration). Défaut : `Date.now`. */
  readonly now?: () => number;
  /**
   * Marge de sécurité avant l'expiration annoncée par PISTE, en
   * millisecondes — explicite et testable (constructeur), pas une
   * constante interne opaque. Défaut : {@link DEFAULT_EXPIRY_SAFETY_MARGIN_MS}.
   */
  readonly marginMs?: number;
}

/** Marge de sécurité par défaut avant expiration — voir {@link LegifranceOAuthClientOptions.marginMs}. */
export const DEFAULT_EXPIRY_SAFETY_MARGIN_MS = 60_000;

interface CachedLegifranceToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class LegifranceOAuthClient implements AccessTokenProvider {
  /**
   * Champs JS réellement privés (pas seulement `private` TypeScript, qui
   * n'empêche que les accès à la compilation) — même précaution que
   * `GoogleOAuthAccessTokenProvider.#credentials` et `ConfirmationService.#records` :
   * `#cached` porte l'access token en clair, `#credentials` le
   * `client_secret`. Aucun des deux ne doit jamais apparaître via
   * `JSON.stringify(client)`, `console.log(client)` ou `Object.keys(client)`
   * — un simple `private` TypeScript laisserait ces deux mécanismes fuiter
   * la valeur (testé explicitement, voir `legifrance-oauth-client.test.ts`).
   */
  readonly #credentials: LegifranceCredentials;
  #cached: CachedLegifranceToken | undefined;
  /** Requête OAuth actuellement en vol, partagée par tout appel concurrent — voir la note de classe (single-flight). */
  #pending: Promise<string> | undefined;
  private readonly tokenUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly marginMs: number;

  constructor(options: LegifranceOAuthClientOptions) {
    this.#credentials = options.credentials;
    this.tokenUrl = options.config.oauthTokenUrl;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.marginMs = options.marginMs ?? DEFAULT_EXPIRY_SAFETY_MARGIN_MS;
  }

  async getAccessToken(): Promise<string> {
    if (this.#cached !== undefined && this.#cached.expiresAtMs - this.marginMs > this.now()) {
      return this.#cached.accessToken;
    }

    if (this.#pending !== undefined) {
      return this.#pending;
    }

    this.#pending = this.acquireToken();
    try {
      return await this.#pending;
    } finally {
      this.#pending = undefined;
    }
  }

  private async acquireToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
      scope: 'openid',
    });

    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new LegifranceNetworkError(describeError(err));
    }

    if (!response.ok) {
      throw new LegifranceOAuthError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LegifranceMalformedResponseError('réponse OAuth non-JSON.');
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new LegifranceMalformedResponseError('réponse OAuth : objet attendu.');
    }
    const { access_token: accessToken, expires_in: expiresIn } = payload as {
      access_token?: unknown;
      expires_in?: unknown;
    };

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new LegifranceMalformedResponseError(
        'réponse OAuth sans « access_token » exploitable.',
      );
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new LegifranceMalformedResponseError('réponse OAuth sans « expires_in » exploitable.');
    }

    this.#cached = { accessToken, expiresAtMs: this.now() + expiresIn * 1000 };
    return this.#cached.accessToken;
  }
}
