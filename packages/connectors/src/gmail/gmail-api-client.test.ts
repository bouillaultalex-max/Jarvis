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

  it('expose sendMessage() (M8-A6) mais aucune méthode de modification ou de suppression', () => {
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider() });

    expect(typeof client.sendMessage).toBe('function');
    expect((client as unknown as Record<string, unknown>).modify).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

describe('GmailApiClient.sendMessage() — M8-A6 (aucun appel réseau réel, fetchFn mocké)', () => {
  it('envoie un message et renvoie {id, threadId} minimal', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: 'sent-1', threadId: 'thread-1', labelIds: ['SENT'] }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider('token-xyz'), fetchFn });

    const result = await client.sendMessage({ to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' });

    expect(result).toEqual({ id: 'sent-1', threadId: 'thread-1' });
  });

  it('la requête HTTP est exactement celle attendue par Gmail (URL, méthode, en-têtes)', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider('token-xyz'), fetchFn });

    await client.sendMessage({ to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-xyz');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('le MIME est correctement construit (To, Subject, Content-Type, corps)', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });

    await client.sendMessage({ to: 'carol@example.test', subject: 'Salut', body: 'Contenu du message.' });

    const [, init] = fetchFn.mock.calls[0]!;
    const payload = JSON.parse(init!.body as string) as { raw: string };
    const mime = decodeBase64Url(payload.raw);

    expect(mime).toContain('To: carol@example.test');
    expect(mime).toContain('Subject: Salut');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime.endsWith('Contenu du message.')).toBe(true);
    // En-têtes séparés du corps par une ligne vide, comme l'exige RFC 2822.
    expect(mime).toContain('\r\n\r\nContenu du message.');
  });

  it('UTF-8 est correctement transporté dans le sujet et le corps (accents, emoji)', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });
    const subject = 'Café à Noël ☕🎄';
    const body = 'Voici un résumé accentué : élève, forêt, être.';

    await client.sendMessage({ to: 'carol@example.test', subject, body });

    const [, init] = fetchFn.mock.calls[0]!;
    const payload = JSON.parse(init!.body as string) as { raw: string };
    const mime = decodeBase64Url(payload.raw);

    expect(mime).toContain(`Subject: ${subject}`);
    expect(mime.endsWith(body)).toBe(true);
  });

  it('threadId est transmis lorsqu’il est fourni, absent sinon', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });

    await client.sendMessage({ to: 'carol@example.test', subject: 's', body: 'b', threadId: 'thread-42' });
    const withThread = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(withThread.threadId).toBe('thread-42');

    await client.sendMessage({ to: 'carol@example.test', subject: 's', body: 'b' });
    const withoutThread = JSON.parse(fetchFn.mock.calls[1]![1]!.body as string) as Record<string, unknown>;
    expect('threadId' in withoutThread).toBe(false);
  });

  it('une erreur HTTP Gmail est gérée proprement, sans fuite du token d’accès', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { error: 'insufficient permissions' }));
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider('FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK'),
      fetchFn,
    });

    await expect(client.sendMessage({ to: 'x@example.test', subject: 's', body: 'b' })).rejects.toThrow(
      /statut HTTP 403/,
    );
    try {
      await client.sendMessage({ to: 'x@example.test', subject: 's', body: 'b' });
      throw new Error('unreachable');
    } catch (err) {
      expect((err as Error).message).not.toContain('FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK');
    }
  });

  it('un échec réseau est enveloppé dans une erreur explicite, sans fuite de credential', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider('FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK'),
      fetchFn,
    });

    await expect(client.sendMessage({ to: 'x@example.test', subject: 's', body: 'b' })).rejects.toThrow(
      /échec réseau/,
    );
  });

  it('authentification absente/invalide : l’erreur du provider se propage, aucune requête HTTP n’est faite', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider(new Error('refresh token invalide')),
      fetchFn,
    });

    await expect(client.sendMessage({ to: 'x@example.test', subject: 's', body: 'b' })).rejects.toThrow(
      'refresh token invalide',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('une réponse Gmail sans « id » exploitable est rejetée explicitement', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { threadId: 'thread-1' }));
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });

    await expect(client.sendMessage({ to: 'x@example.test', subject: 's', body: 'b' })).rejects.toThrow(/« id »/);
  });
});
