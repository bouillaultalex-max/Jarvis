import { describe, expect, it, vi } from 'vitest';

import { GmailApiClient } from './gmail-api-client.js';
import type { AccessTokenProvider } from './gmail-auth.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

class FakeAccessTokenProvider implements AccessTokenProvider {
  constructor(
    private readonly token: string | Error = 'fake-access-token',
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token instanceof Error) {
      throw this.token;
    }
    return this.token;
  }
}

describe('GmailApiClient — aucun appel réseau réel (fetchFn mocké)', () => {
  it('listMessageIds() renvoie les ids et transmet le token en Authorization', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { messages: [{ id: 'a' }, { id: 'b' }] }),
    );
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider('token-xyz'),
      fetchFn,
    });

    const ids = await client.listMessageIds({ maxResults: 5 });

    expect(ids).toEqual(['a', 'b']);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('maxResults=5');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-xyz');
  });

  it('getMessage() renvoie la forme brute Gmail telle quelle', async () => {
    const raw = { id: 'msg-1', threadId: 't1', payload: { headers: [] } };
    const fetchFn = vi.fn(async () => jsonResponse(200, raw));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });

    const result = await client.getMessage('msg-1');

    expect(result).toEqual(raw);
  });

  it('propage une erreur explicite si l’API Gmail répond en erreur', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: 'unauthorized' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });

    await expect(client.listMessageIds()).rejects.toThrow(/statut HTTP 401/);
  });

  it('authentification absente/invalide : l’erreur du provider se propage, aucune requête HTTP n’est faite', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { messages: [] }));
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider(new Error('refresh token invalide')),
      fetchFn,
    });

    await expect(client.listMessageIds()).rejects.toThrow('refresh token invalide');
    await expect(client.getMessage('any')).rejects.toThrow('refresh token invalide');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('n’expose aucune méthode d’écriture (send/modify/delete)', () => {
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider() });

    expect((client as unknown as Record<string, unknown>).send).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).modify).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
