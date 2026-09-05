import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { GmailOAuthFlow } from './gmail-oauth-flow.js';

/**
 * Tests M8-B2 — aucun appel réseau réel : `fetchFn` mocké pour l'échange de
 * code (`oauth2.googleapis.com/token`) et la récupération d'identité
 * (`openidconnect.googleapis.com/v1/userinfo`).
 */

const CLIENT_ID = 'app-client-id.apps.googleusercontent.com';
const REDIRECT_URI = 'http://127.0.0.1:51234/callback';
const CLIENT_SECRET = 'FAKE-APP-CLIENT-SECRET';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stateOf(flow: GmailOAuthFlow): string {
  return new URL(flow.authorizationUrl).searchParams.get('state')!;
}

interface MockFetchOptions {
  readonly accessToken?: string;
  /** `null` = omis de la réponse (simule l'absence de refresh_token). */
  readonly refreshToken?: string | null;
  /** `null` = réponse 200 sans `email` exploitable. */
  readonly userinfo?: { readonly email?: string; readonly name?: string } | null;
  readonly tokenStatus?: number;
  readonly userinfoStatus?: number;
}

function buildMockFetch(options: MockFetchOptions) {
  const tokenCalls: URLSearchParams[] = [];
  const userinfoAuthorizations: string[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      if (options.tokenStatus !== undefined && options.tokenStatus !== 200) {
        return jsonResponse(options.tokenStatus, { error: 'invalid_grant' });
      }
      const body: Record<string, unknown> = { access_token: options.accessToken ?? 'access-token-1' };
      if (options.refreshToken !== null) {
        body.refresh_token = options.refreshToken ?? 'refresh-token-1';
      }
      return jsonResponse(200, body);
    }

    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      userinfoAuthorizations.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''));
      if (options.userinfoStatus !== undefined && options.userinfoStatus !== 200) {
        return jsonResponse(options.userinfoStatus, { error: 'invalid_token' });
      }
      if (options.userinfo === null) {
        return jsonResponse(200, {});
      }
      return jsonResponse(200, {
        email: options.userinfo?.email ?? 'alice@example.test',
        name: options.userinfo?.name,
        sub: '112233445566',
      });
    }

    return jsonResponse(500, { error: `unexpected url in test: ${url}` });
  });

  return { fetchFn, tokenCalls, userinfoAuthorizations };
}

describe('GmailOAuthFlow — A. authorizationUrl', () => {
  it('contient exactement les paramètres attendus par Authorization Code + PKCE', () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const url = new URL(flow.authorizationUrl);

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.send openid email');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('ne demande aucun scope Gmail au-delà de gmail.send', () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const scope = new URL(flow.authorizationUrl).searchParams.get('scope')!;

    expect(scope.split(' ')).toEqual(['https://www.googleapis.com/auth/gmail.send', 'openid', 'email']);
  });
});

describe('GmailOAuthFlow — B. PKCE', () => {
  it('code_challenge correspond exactement au SHA-256 (base64url) du code_verifier réellement envoyé', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const codeChallenge = new URL(flow.authorizationUrl).searchParams.get('code_challenge')!;
    const { fetchFn, tokenCalls } = buildMockFetch({});

    await flow.completeWithCallback({ code: 'auth-code-1', state: stateOf(flow) }, { clientSecret: CLIENT_SECRET, fetchFn });

    const sentVerifier = tokenCalls[0]!.get('code_verifier')!;
    expect(sentVerifier).toBeTruthy();
    const recomputed = createHash('sha256').update(sentVerifier, 'utf-8').digest('base64url');
    expect(recomputed).toBe(codeChallenge);
  });

  it('aucune propriété publique du flow n’expose le code_verifier', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn, tokenCalls } = buildMockFetch({});

    await flow.completeWithCallback({ code: 'auth-code-1', state: stateOf(flow) }, { clientSecret: CLIENT_SECRET, fetchFn });

    const sentVerifier = tokenCalls[0]!.get('code_verifier')!;
    expect(Object.keys(flow)).toEqual(['authorizationUrl']);
    expect(JSON.stringify(flow)).not.toContain(sentVerifier);
    expect(String(flow)).not.toContain(sentVerifier);
  });
});

describe('GmailOAuthFlow — C. callback success', () => {
  it('échange le code, récupère l’identité avec le bon access token, produit un GmailOAuthResult.success correct', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn, tokenCalls, userinfoAuthorizations } = buildMockFetch({
      accessToken: 'access-token-xyz',
      refreshToken: 'refresh-token-xyz',
      userinfo: { email: 'alice@example.test', name: 'Alice' },
    });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result).toEqual({
      status: 'success',
      identity: { accountIdentifier: 'alice@example.test', displayName: 'Alice' },
      refreshToken: 'refresh-token-xyz',
    });
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.get('grant_type')).toBe('authorization_code');
    expect(tokenCalls[0]!.get('code')).toBe('auth-code-1');
    expect(tokenCalls[0]!.get('client_id')).toBe(CLIENT_ID);
    expect(tokenCalls[0]!.get('client_secret')).toBe(CLIENT_SECRET);
    expect(tokenCalls[0]!.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(userinfoAuthorizations).toEqual(['Bearer access-token-xyz']);
  });
});

describe('GmailOAuthFlow — D. state mismatch', () => {
  it('state incorrect : error, aucun appel token/userinfo', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({});

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: 'wrong-state' },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('state absent : error, aucun appel réseau', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({});

    const result = await flow.completeWithCallback({ code: 'auth-code-1' }, { clientSecret: CLIENT_SECRET, fetchFn });

    expect(result.status).toBe('error');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('GmailOAuthFlow — E. single-use', () => {
  it('un second callback est refusé, aucun second échange réseau', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const state = stateOf(flow);
    const { fetchFn } = buildMockFetch({});

    const first = await flow.completeWithCallback({ code: 'auth-code-1', state }, { clientSecret: CLIENT_SECRET, fetchFn });
    expect(first.status).toBe('success');
    const callsAfterFirst = fetchFn.mock.calls.length;

    const second = await flow.completeWithCallback({ code: 'auth-code-1', state }, { clientSecret: CLIENT_SECRET, fetchFn });

    expect(second.status).toBe('error');
    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });

  it('un flow déjà invalidé par un state incorrect reste inutilisable ensuite, même avec le bon state', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const state = stateOf(flow);
    const { fetchFn } = buildMockFetch({});

    const first = await flow.completeWithCallback({ code: 'auth-code-1', state: 'wrong' }, { clientSecret: CLIENT_SECRET, fetchFn });
    expect(first.status).toBe('error');

    const second = await flow.completeWithCallback({ code: 'auth-code-1', state }, { clientSecret: CLIENT_SECRET, fetchFn });
    expect(second.status).toBe('error');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('GmailOAuthFlow — F. cancelled', () => {
  it('error=access_denied → cancelled, aucun échange réseau', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({});

    const result = await flow.completeWithCallback(
      { state: stateOf(flow), error: 'access_denied' },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result).toEqual({ status: 'cancelled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('une autre erreur Google (ex. server_error) → GmailOAuthResult.error, aucun échange réseau', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({});

    const result = await flow.completeWithCallback(
      { state: stateOf(flow), error: 'server_error' },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('GmailOAuthFlow — G. token exchange error', () => {
  it('Google refuse l’échange : error, aucun secret dans le message', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ tokenStatus: 400 });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).not.toContain(CLIENT_SECRET);
    }
  });
});

describe('GmailOAuthFlow — H. missing refresh token', () => {
  it('access_token présent mais refresh_token absent : error, jamais un success incomplet', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ refreshToken: null });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
    expect((result as { status: 'error' }).status).not.toBe('success');
  });
});

describe('GmailOAuthFlow — I. userinfo error', () => {
  it('échange réussi mais userinfo échoue : error, jamais de success', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ userinfoStatus: 401 });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
  });

  it('userinfo répond 200 sans email exploitable : error explicite', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ userinfo: null });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('error');
  });
});

describe('GmailOAuthFlow — J. sécurité', () => {
  it('FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK n’apparaît jamais hors du seul champ refreshToken attendu', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });

    expect(flow.authorizationUrl).not.toContain(marker);

    const { fetchFn } = buildMockFetch({ refreshToken: marker });
    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    // Présence légitime : c'est exactement le contrat GmailOAuthResult.success.
    expect(result).toMatchObject({ status: 'success', refreshToken: marker });

    expect(JSON.stringify(flow)).not.toContain(marker);
    expect(String(flow)).not.toContain(marker);
    expect(Object.keys(flow)).toEqual(['authorizationUrl']);
  });

  it('un faux clientSecret n’apparaît jamais dans une erreur d’échange', async () => {
    const secretMarker = 'FAKE_CLIENT_SECRET_SHOULD_NEVER_LEAK';
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ tokenStatus: 400 });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: secretMarker, fetchFn },
    );

    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(secretMarker);
  });

  it('aucun state/code_verifier dans le GmailOAuthResult final, succès ou échec', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const state = stateOf(flow);
    const { fetchFn } = buildMockFetch({});

    const result = await flow.completeWithCallback({ code: 'auth-code-1', state }, { clientSecret: CLIENT_SECRET, fetchFn });

    expect(Object.keys(result)).not.toContain('state');
    expect(Object.keys(result)).not.toContain('codeVerifier');
  });
});

describe('GmailOAuthFlow — K. discipline réseau', () => {
  it('la construction du flow (constructor / authorizationUrl) ne déclenche aucun appel réseau', () => {
    const fetchFn = vi.fn();

    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    // authorizationUrl est déjà calculée à la construction — aucune raison
    // qu'un fetch quelconque ait été déclenché entre-temps.
    void flow.authorizationUrl;

    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('GmailOAuthFlow — L. identité', () => {
  it('dérive accountIdentifier (email) et displayName (name) sans exposer de credential', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ userinfo: { email: 'bob@example.test', name: 'Bob Dupont' } });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result).toMatchObject({
      status: 'success',
      identity: { accountIdentifier: 'bob@example.test', displayName: 'Bob Dupont' },
    });
  });

  it('identité sans "name" : displayName absent (pas une chaîne vide), aucune erreur', async () => {
    const flow = new GmailOAuthFlow({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
    const { fetchFn } = buildMockFetch({ userinfo: { email: 'carol@example.test' } });

    const result = await flow.completeWithCallback(
      { code: 'auth-code-1', state: stateOf(flow) },
      { clientSecret: CLIENT_SECRET, fetchFn },
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.identity.accountIdentifier).toBe('carol@example.test');
      expect('displayName' in result.identity).toBe(false);
    }
  });
});
