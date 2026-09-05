import { createHash, randomBytes } from 'node:crypto';

import type { GmailOAuthResult } from './gmail-connection.js';

/**
 * Mécanique OAuth Google (Authorization Code + PKCE) — M8-B2.
 *
 * Responsabilité strictement bornée : produire un {@link GmailOAuthResult}
 * à partir d'un callback OAuth réel, sans jamais connaître `AccountStore`,
 * `SecretStore`, `connectGmailAccount`, `GmailApiClient`, `ToolRegistry`,
 * `PermissionManager`, `ToolExecutor` ou `ConfirmationFlow`. Le transport
 * (navigateur, listener local) reste entièrement à la charge de
 * l'appelant (`apps/desktop`) — ce module ne fait qu'échanger avec Google.
 *
 * Distinct de `GoogleOAuthAccessTokenProvider` (`gmail-auth.ts`), qui gère
 * l'échange *refresh_token → access_token* pour un compte déjà connecté :
 * cette classe-ci gère l'échange *consentement initial → premier refresh
 * token*, un grant OAuth différent (`authorization_code`), qui n'a jamais
 * existé dans ce dépôt avant ce jalon.
 */

const DEFAULT_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * Scope Gmail strictement nécessaire à `gmail.send` (principe de moindre
 * privilège, cohérent avec le reste du dépôt) + `openid`/`email` pour
 * l'identité — aucun scope supplémentaire.
 */
const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'] as const;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Aléa cryptographique encodé en base64url (sans padding) — `state` et `code_verifier`. */
function randomUrlSafeToken(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

/** `code_challenge = BASE64URL(SHA256(code_verifier))`, méthode `S256` (RFC 7636). */
function computeCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'utf-8').digest('base64url');
}

export interface GmailOAuthFlowOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
  readonly authorizationEndpoint?: string;
}

/**
 * Paramètres bruts reçus par le callback local — jamais interprétés au-delà
 * de ces trois champs (aucun objet brut de requête HTTP ne remonte ici).
 */
export interface GmailOAuthCallbackParams {
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
}

export interface CompleteGmailOAuthOptions {
  readonly clientSecret: string;
  /** Injectable pour les tests : jamais d'appel réseau réel dans la suite de tests. */
  readonly fetchFn?: typeof fetch;
  readonly tokenEndpoint?: string;
  readonly userinfoEndpoint?: string;
}

type FlowStatus = 'pending' | 'consumed';

/**
 * Une instance = un flux de consentement, à usage unique. `#state` et
 * `#codeVerifier` sont des champs JS réellement privés (pas seulement
 * `private` TypeScript) : ni `JSON.stringify`, ni `Object.keys`, ni
 * `String()` sur l'instance ne les exposent — même discipline que
 * `GmailApiClient`/`GoogleOAuthAccessTokenProvider` depuis M8-A10.
 */
export class GmailOAuthFlow {
  readonly authorizationUrl: string;
  readonly #state: string;
  readonly #codeVerifier: string;
  readonly #clientId: string;
  readonly #redirectUri: string;
  #status: FlowStatus = 'pending';

  constructor(options: GmailOAuthFlowOptions) {
    this.#clientId = options.clientId;
    this.#redirectUri = options.redirectUri;
    this.#state = randomUrlSafeToken(32);
    this.#codeVerifier = randomUrlSafeToken(32);

    const url = new URL(options.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.#clientId);
    url.searchParams.set('redirect_uri', this.#redirectUri);
    url.searchParams.set('scope', (options.scopes ?? DEFAULT_SCOPES).join(' '));
    url.searchParams.set('state', this.#state);
    url.searchParams.set('code_challenge', computeCodeChallenge(this.#codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    // Nécessaires pour obtenir un refresh token dès le premier consentement.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    this.authorizationUrl = url.toString();
  }

  /**
   * Traite le callback OAuth reçu par le listener local et produit un
   * {@link GmailOAuthResult}. Usage unique : un second appel — quel que
   * soit le résultat du premier (succès, annulation, erreur, ou `state`
   * invalide) — échoue immédiatement sans aucun appel réseau.
   *
   * Ordre strict, jamais inversé :
   *   1. usage unique (avant tout) ;
   *   2. validation du `state` (avant même de regarder `error`/`code`) —
   *      un `state` invalide ne doit renseigner l'appelant sur rien
   *      d'autre, ni distinguer un déni de consentement d'une autre cause ;
   *   3. `error` du callback (annulation/refus) → aucun réseau ;
   *   4. `code` absent → aucun réseau ;
   *   5. échange `authorization_code` → tokens ;
   *   6. `refresh_token` absent de la réponse → échec explicite, jamais un
   *      `success` incomplet (Google peut omettre le refresh token hors
   *      premier consentement) ;
   *   7. récupération de l'identité (userinfo) avec l'access token obtenu.
   */
  async completeWithCallback(
    callback: GmailOAuthCallbackParams,
    options: CompleteGmailOAuthOptions,
  ): Promise<GmailOAuthResult> {
    if (this.#status === 'consumed') {
      return { status: 'error', reason: 'Ce flux de connexion Gmail a déjà été utilisé.' };
    }
    this.#status = 'consumed';

    if (callback.state === undefined || callback.state !== this.#state) {
      return { status: 'error', reason: 'Google OAuth : paramètre « state » manquant ou invalide.' };
    }

    if (callback.error !== undefined) {
      if (callback.error === 'access_denied') {
        return { status: 'cancelled' };
      }
      return { status: 'error', reason: `Google OAuth : consentement refusé (${callback.error}).` };
    }

    if (callback.code === undefined || callback.code.length === 0) {
      return { status: 'error', reason: 'Google OAuth : paramètre « code » manquant.' };
    }

    const fetchFn = options.fetchFn ?? fetch;
    const tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    const userinfoEndpoint = options.userinfoEndpoint ?? DEFAULT_USERINFO_ENDPOINT;

    let tokenResponse: Response;
    try {
      tokenResponse = await fetchFn(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: callback.code,
          client_id: this.#clientId,
          client_secret: options.clientSecret,
          redirect_uri: this.#redirectUri,
          code_verifier: this.#codeVerifier,
        }).toString(),
      });
    } catch (err) {
      return {
        status: 'error',
        reason: `Google OAuth : échec réseau lors de l'échange du code (${describeError(err)}).`,
      };
    }

    if (!tokenResponse.ok) {
      return {
        status: 'error',
        reason: `Google OAuth : échange du code refusé (statut HTTP ${tokenResponse.status}).`,
      };
    }

    const tokenPayload = (await tokenResponse.json()) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof tokenPayload.access_token !== 'string' || tokenPayload.access_token.length === 0) {
      return { status: 'error', reason: "Google OAuth : réponse d'échange sans « access_token » exploitable." };
    }
    if (typeof tokenPayload.refresh_token !== 'string' || tokenPayload.refresh_token.length === 0) {
      // Jamais un `success` avec un refreshToken vide/absent : voir l'ordre
      // strict documenté ci-dessus.
      return {
        status: 'error',
        reason:
          "Google OAuth : aucun refresh token retourné par Google pour ce consentement " +
          '(un nouveau consentement complet peut être nécessaire).',
      };
    }
    const accessToken = tokenPayload.access_token;
    const refreshToken = tokenPayload.refresh_token;

    let userinfoResponse: Response;
    try {
      userinfoResponse = await fetchFn(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      return {
        status: 'error',
        reason: `Google OAuth : échec réseau lors de la récupération de l'identité (${describeError(err)}).`,
      };
    }

    if (!userinfoResponse.ok) {
      return {
        status: 'error',
        reason: `Google OAuth : récupération de l'identité refusée (statut HTTP ${userinfoResponse.status}).`,
      };
    }

    const identityPayload = (await userinfoResponse.json()) as { email?: unknown; name?: unknown };
    // `email` est l'identifiant retenu, cohérent avec la sémantique déjà
    // établie de `GmailOAuthIdentity.accountIdentifier` (« adresse Gmail du
    // compte », voir gmail-connection.ts) — `sub` (l'identifiant Google
    // réellement immuable) n'est pas utilisé ici pour ne pas diverger du
    // contrat existant, non modifié par ce jalon.
    if (typeof identityPayload.email !== 'string' || identityPayload.email.length === 0) {
      return { status: 'error', reason: "Google OAuth : réponse d'identité sans « email » exploitable." };
    }
    const displayName =
      typeof identityPayload.name === 'string' && identityPayload.name.length > 0 ? identityPayload.name : undefined;

    return {
      status: 'success',
      identity: {
        accountIdentifier: identityPayload.email,
        ...(displayName !== undefined ? { displayName } : {}),
      },
      refreshToken,
    };
  }
}
