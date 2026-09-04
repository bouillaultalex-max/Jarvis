import { describe, expect, it, vi } from 'vitest';

import { GoogleOAuthAccessTokenProvider, loadGmailCredentialsFromEnv } from './gmail-auth.js';
import type { GmailCredentials } from './gmail-auth.js';

const CREDENTIALS: GmailCredentials = {
  clientId: 'fake-client-id',
  clientSecret: 'FAKE-CLIENT-SECRET-NOT-REAL',
  refreshToken: 'FAKE-REFRESH-TOKEN-NOT-REAL',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleOAuthAccessTokenProvider — aucun appel réseau réel (fetchFn mocké)', () => {
  it('échange le refresh token contre un access token', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }),
    );
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    const token = await provider.getAccessToken();

    expect(token).toBe('access-token-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init?.body)).toContain('grant_type=refresh_token');
  });

  it('met en cache l’access token et ne re-sollicite pas l’endpoint avant expiration', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }));
    let now = 0;
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn, now: () => now });

    await provider.getAccessToken();
    now += 1000; // bien avant expiration
    await provider.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('renouvelle automatiquement l’access token une fois expiré', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return jsonResponse(200, { access_token: `access-token-${call}`, expires_in: 3600 });
    });
    let now = 0;
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn, now: () => now });

    const first = await provider.getAccessToken();
    now += 3600_000 + 1; // au-delà de l'expiration + marge de sécurité
    const second = await provider.getAccessToken();

    expect(first).toBe('access-token-1');
    expect(second).toBe('access-token-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('authentification invalide (refresh token refusé) : erreur claire, sans fuite de secret', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant' }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/renouvellement.*refusé/);
    try {
      await provider.getAccessToken();
      expect.unreachable();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(CREDENTIALS.clientSecret);
      expect(message).not.toContain(CREDENTIALS.refreshToken);
    }
  });

  it('réponse sans access_token exploitable : erreur explicite', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { expires_in: 3600 }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/access_token/);
  });

  it('échec réseau (fetchFn qui lève) : erreur explicite, jamais un access token', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('DNS lookup failed');
    });
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/échec réseau/);
  });

  it('revoke() appelle l’endpoint de révocation et efface le cache local', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-token-2', expires_in: 3600 }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await provider.getAccessToken();
    await provider.revoke();
    const tokenAfterRevoke = await provider.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe('https://oauth2.googleapis.com/revoke');
    expect(tokenAfterRevoke).toBe('access-token-2');
  });
});

describe('loadGmailCredentialsFromEnv', () => {
  it('charge les credentials depuis un objet env fourni explicitement', () => {
    const credentials = loadGmailCredentialsFromEnv({
      GMAIL_CLIENT_ID: ' client-id ',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
    });

    expect(credentials).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    });
  });

  it('rejette si une variable requise est absente, sans jamais faire de réseau', () => {
    expect(() => loadGmailCredentialsFromEnv({})).toThrow(/GMAIL_CLIENT_ID/);
    expect(() =>
      loadGmailCredentialsFromEnv({ GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y' }),
    ).toThrow(/GMAIL_REFRESH_TOKEN/);
  });
});
