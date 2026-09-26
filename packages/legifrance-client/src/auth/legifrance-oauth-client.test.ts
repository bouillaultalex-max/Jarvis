import { describe, expect, it, vi } from 'vitest';

import { createLegifranceConfig, type LegifranceConfig } from '../config/legifrance-config.js';
import {
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
  LegifranceOAuthError,
} from '../errors/legifrance-errors.js';
import type { LegifranceCredentials } from './legifrance-credentials.js';
import {
  DEFAULT_EXPIRY_SAFETY_MARGIN_MS,
  LegifranceOAuthClient,
} from './legifrance-oauth-client.js';

// Valeurs manifestement factices — jamais des credentials réels, même en test.
const CREDENTIALS: LegifranceCredentials = {
  clientId: 'test-fake-client-id-0000',
  clientSecret: 'test-fake-client-secret-0000-not-real',
};
const SANDBOX_CONFIG: LegifranceConfig = createLegifranceConfig('sandbox');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LegifranceOAuthClient — acquisition et cache (aucun appel réseau réel, fetchFn mocké)', () => {
  it('acquisition d’un token : envoie grant_type=client_credentials avec scope=openid vers oauthTokenUrl', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }),
    );
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    const token = await client.getAccessToken();

    expect(token).toBe('access-token-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(SANDBOX_CONFIG.oauthTokenUrl);
    const body = String(init?.body);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=openid');
    expect(body).toContain(`client_id=${CREDENTIALS.clientId}`);
  });

  it('parsing de expires_in : calcule expiresAtMs = now() + expires_in * 1000', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { access_token: 'access-token-1', expires_in: 100 }),
    );
    let now = 1_000_000;
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
      now: () => now,
    });

    await client.getAccessToken();

    // Juste avant expiration - marge : encore en cache (pas de second appel réseau).
    now += 100_000 - DEFAULT_EXPIRY_SAFETY_MARGIN_MS - 1;
    await client.getAccessToken();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('réutilisation d’un token valide : deux appels rapprochés ne déclenchent qu’une requête', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }),
    );
    let now = 0;
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
      now: () => now,
    });

    await client.getAccessToken();
    now += 1000;
    const token = await client.getAccessToken();

    expect(token).toBe('access-token-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('renouvellement après expiration : un nouveau token est demandé', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return jsonResponse(200, { access_token: `access-token-${call}`, expires_in: 3600 });
    });
    let now = 0;
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
      now: () => now,
    });

    const first = await client.getAccessToken();
    now += 3600_000 + 1;
    const second = await client.getAccessToken();

    expect(first).toBe('access-token-1');
    expect(second).toBe('access-token-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('renouvellement avec marge de sécurité : un token pas encore expiré mais dans la marge est renouvelé', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return jsonResponse(200, { access_token: `access-token-${call}`, expires_in: 100 });
    });
    let now = 0;
    const marginMs = 10_000;
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
      now: () => now,
      marginMs,
    });

    await client.getAccessToken();
    // expiresAtMs = 100_000. On avance à 95_000 : encore *avant* l'expiration réelle,
    // mais dans la marge de 10s (95_000 > 100_000 - 10_000) → doit renouveler.
    now = 95_000;
    const second = await client.getAccessToken();

    expect(second).toBe('access-token-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('marge de sécurité par défaut explicite et testable', () => {
    expect(DEFAULT_EXPIRY_SAFETY_MARGIN_MS).toBeGreaterThan(0);
  });

  it('concurrence : plusieurs demandes simultanées ne déclenchent qu’une seule acquisition OAuth (single-flight)', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchFn = vi.fn(() => fetchPromise);
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    const call1 = client.getAccessToken();
    const call2 = client.getAccessToken();
    const call3 = client.getAccessToken();

    resolveFetch(jsonResponse(200, { access_token: 'shared-token', expires_in: 3600 }));
    const [token1, token2, token3] = await Promise.all([call1, call2, call3]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(token1).toBe('shared-token');
    expect(token2).toBe('shared-token');
    expect(token3).toBe('shared-token');
  });

  it('après une acquisition en vol terminée, un nouvel appel expiré redéclenche une acquisition normale', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return jsonResponse(200, { access_token: `access-token-${call}`, expires_in: 3600 });
    });
    let now = 0;
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
      now: () => now,
    });

    await client.getAccessToken();
    now += 3600_000 + 1;
    await client.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('LegifranceOAuthClient — erreurs typées', () => {
  it.each([400, 401, 403])(
    'OAuth %d : lève LegifranceOAuthError avec le statut exact',
    async (status) => {
      const fetchFn = vi.fn(async () => jsonResponse(status, { error: 'invalid_client' }));
      const client = new LegifranceOAuthClient({
        config: SANDBOX_CONFIG,
        credentials: CREDENTIALS,
        fetchFn,
      });

      await expect(client.getAccessToken()).rejects.toThrowError(LegifranceOAuthError);
      try {
        await client.getAccessToken();
        expect.unreachable('devait lever');
      } catch (error) {
        expect(error).toBeInstanceOf(LegifranceOAuthError);
        expect((error as LegifranceOAuthError).status).toBe(status);
      }
    },
  );

  it('réponse JSON malformée : lève LegifranceMalformedResponseError', async () => {
    const fetchFn = vi.fn(async () => new Response('not-json{{{', { status: 200 }));
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    await expect(client.getAccessToken()).rejects.toThrowError(LegifranceMalformedResponseError);
  });

  it('absence d’access_token : lève LegifranceMalformedResponseError', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { expires_in: 3600 }));
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    await expect(client.getAccessToken()).rejects.toThrowError(LegifranceMalformedResponseError);
  });

  it('absence d’expires_in : rejetée (contrat choisi = obligatoire, pas de valeur par défaut silencieuse)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: 'access-token-1' }));
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    await expect(client.getAccessToken()).rejects.toThrowError(LegifranceMalformedResponseError);
  });

  it('expires_in invalide (négatif ou non numérique) : rejetée', async () => {
    const negative = vi.fn(async () => jsonResponse(200, { access_token: 'a', expires_in: -1 }));
    const nonNumeric = vi.fn(async () =>
      jsonResponse(200, { access_token: 'a', expires_in: '3600' }),
    );

    await expect(
      new LegifranceOAuthClient({
        config: SANDBOX_CONFIG,
        credentials: CREDENTIALS,
        fetchFn: negative,
      }).getAccessToken(),
    ).rejects.toThrowError(LegifranceMalformedResponseError);
    await expect(
      new LegifranceOAuthClient({
        config: SANDBOX_CONFIG,
        credentials: CREDENTIALS,
        fetchFn: nonNumeric,
      }).getAccessToken(),
    ).rejects.toThrowError(LegifranceMalformedResponseError);
  });

  it('erreur réseau : fetchFn qui rejette lève LegifranceNetworkError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    await expect(client.getAccessToken()).rejects.toThrowError(LegifranceNetworkError);
  });
});

describe('LegifranceOAuthClient — aucune fuite de secret', () => {
  it('aucune erreur ne contient le client_secret ou un access_token', async () => {
    const oauthErrorClient = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn: vi.fn(async () =>
        jsonResponse(401, { error: 'invalid_client', error_description: CREDENTIALS.clientSecret }),
      ),
    });
    const networkErrorClient = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    const errors: unknown[] = [];
    await oauthErrorClient.getAccessToken().catch((error: unknown) => errors.push(error));
    await networkErrorClient.getAccessToken().catch((error: unknown) => errors.push(error));

    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain(CREDENTIALS.clientSecret);
      expect(message).not.toContain(CREDENTIALS.clientId);
    }
  });

  it('ne journalise jamais le token acquis, et ne l’expose pas via JSON.stringify/Object.keys de l’instance', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { access_token: 'super-secret-access-token', expires_in: 3600 }),
    );
    const client = new LegifranceOAuthClient({
      config: SANDBOX_CONFIG,
      credentials: CREDENTIALS,
      fetchFn,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await client.getAccessToken();

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      expect(JSON.stringify(client)).not.toContain(CREDENTIALS.clientSecret);
      expect(JSON.stringify(client)).not.toContain('super-secret-access-token');
      expect(Object.keys(client)).not.toContain('credentials');
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
