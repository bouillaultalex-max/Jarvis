import type { AccessTokenProvider } from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import { createLegifranceConfig } from '../config/legifrance-config.js';
import {
  LegifranceHttpError,
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
} from '../errors/legifrance-errors.js';
import { LegifranceHttpClient } from './legifrance-http-client.js';

const SANDBOX_CONFIG = createLegifranceConfig('sandbox');
const FAKE_TOKEN = 'super-secret-access-token-not-real';

function fakeTokenProvider(token: string = FAKE_TOKEN): AccessTokenProvider {
  return { getAccessToken: vi.fn(async () => token) };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LegifranceHttpClient — requêtes authentifiées (aucun appel réseau réel, fetchFn mocké)', () => {
  it('ajoute automatiquement Authorization: Bearer <token> et les headers JSON', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { ok: true }),
    );
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn,
    });

    await client.request({ method: 'POST', path: '/list/ping', body: { hello: 'world' } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${SANDBOX_CONFIG.apiBaseUrl}/list/ping`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('gère une réponse HTTP ok et renvoie le corps JSON désérialisé', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { result: 'value' }));
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn,
    });

    const result = await client.request({ method: 'GET', path: '/list/ping' });

    expect(result).toEqual({ result: 'value' });
  });

  it('distingue erreur réseau (fetchFn rejette) et erreur HTTP (statut non-2xx)', async () => {
    const networkClient = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    const httpErrorClient = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => jsonResponse(404, { error: 'not_found' })),
    });

    await expect(networkClient.request({ method: 'GET', path: '/x' })).rejects.toThrowError(
      LegifranceNetworkError,
    );
    await expect(httpErrorClient.request({ method: 'GET', path: '/x' })).rejects.toThrowError(
      LegifranceHttpError,
    );
  });

  it('HTTP 4xx : LegifranceHttpError.kind === "client_error"', async () => {
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => jsonResponse(429, { error: 'rate_limited' })),
    });

    try {
      await client.request({ method: 'GET', path: '/x' });
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegifranceHttpError);
      expect((error as LegifranceHttpError).kind).toBe('client_error');
      expect((error as LegifranceHttpError).status).toBe(429);
    }
  });

  it('HTTP 5xx : LegifranceHttpError.kind === "server_error"', async () => {
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => jsonResponse(503, { error: 'unavailable' })),
    });

    try {
      await client.request({ method: 'GET', path: '/x' });
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegifranceHttpError);
      expect((error as LegifranceHttpError).kind).toBe('server_error');
      expect((error as LegifranceHttpError).status).toBe(503);
    }
  });

  it('réponse JSON malformée sur l’API : lève LegifranceMalformedResponseError', async () => {
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => new Response('not-json{{{', { status: 200 })),
    });

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrowError(
      LegifranceMalformedResponseError,
    );
  });

  it('ne journalise jamais le token, et ne l’inclut jamais dans un message d’erreur', async () => {
    const client = new LegifranceHttpClient({
      config: SANDBOX_CONFIG,
      accessTokenProvider: fakeTokenProvider(),
      fetchFn: vi.fn(async () => jsonResponse(500, { error: 'internal' })),
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await client.request({ method: 'GET', path: '/x' }).catch((error: unknown) => {
        expect((error as Error).message).not.toContain(FAKE_TOKEN);
      });
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
