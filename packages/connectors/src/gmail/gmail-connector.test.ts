import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { GmailApiClient } from './gmail-api-client.js';
import type { AccessTokenProvider } from './gmail-auth.js';
import { gmailConnector } from './gmail-connector.js';

const FAKE_TOKEN_MARKER = 'FAKE-ACCESS-TOKEN-MARKER-NOT-A-REAL-SECRET';

class FakeAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly token: string | Error = FAKE_TOKEN_MARKER) {}

  async getAccessToken(): Promise<string> {
    if (this.token instanceof Error) {
      throw this.token;
    }
    return this.token;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

function rawGmailMessage(id: string, sender: string, subject: string, body: string) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: '1757000000000',
    payload: {
      headers: [
        { name: 'From', value: sender },
        { name: 'To', value: 'me@example.test' },
        { name: 'Subject', value: subject },
      ],
      mimeType: 'text/plain',
      body: { data: encode(body) },
    },
  };
}

/** Fausse API Gmail : sert une petite boîte de réception fixe, aucun réseau réel. */
function buildFakeFetch(messages: readonly ReturnType<typeof rawGmailMessage>[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/messages?')) {
      return jsonResponse(200, { messages: messages.map((m) => ({ id: m.id })) });
    }
    const match = url.match(/\/messages\/([^/?]+)/);
    const id = match?.[1];
    const found = messages.find((m) => m.id === id);
    if (found === undefined) {
      return jsonResponse(404, { error: 'not found' });
    }
    return jsonResponse(200, found);
  });
}

function buildClient(messages: readonly ReturnType<typeof rawGmailMessage>[], accessTokenProvider?: AccessTokenProvider) {
  return new GmailApiClient({
    accessTokenProvider: accessTokenProvider ?? new FakeAccessTokenProvider(),
    fetchFn: buildFakeFetch(messages),
  });
}

describe('gmailConnector — architecture (lecture seule, aucun réseau réel)', () => {
  it('ne fournit qu’un seul Tool, déclaré action: "read"', () => {
    const client = buildClient([]);
    const tools = gmailConnector.createTools(client);

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('gmail.read');
    expect(tools[0]?.action).toBe('read');
  });

  it('n’expose aucune capacité d’envoi, de modification, de suppression ou de réponse', () => {
    expect(gmailConnector.capabilities).toEqual(['gmail.read']);

    const client = buildClient([]);
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    for (const forbidden of ['gmail.send', 'gmail.modify', 'gmail.delete', 'gmail.prepare_reply']) {
      expect(registry.has(forbidden)).toBe(false);
    }
    // Même avec une politique "tout autoriser", un outil inexistant ne peut jamais s'exécuter.
    return expect(
      executor.run({ tool: 'gmail.send', input: { to: 'x@example.test', subject: 's', body: 'b' } }),
    ).resolves.toMatchObject({ status: 'unknown_tool' });
  });

  it('récupère plusieurs emails et les convertit en EmailMessage', async () => {
    const messages = [
      rawGmailMessage('m1', 'boss@example.com', 'Sujet 1', 'Corps 1'),
      rawGmailMessage('m2', 'newsletter@promo.example', 'Sujet 2', 'Corps 2'),
      rawGmailMessage('m3', 'carol@example.com', 'Sujet 3', 'Corps 3'),
    ];
    const client = buildClient(messages);
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.read': 'allow' } }));

    const result = await executor.run({ tool: 'gmail.read', input: {} });

    expect(result.status).toBe('executed');
    if (result.status !== 'executed') throw new Error('unreachable');
    const output = result.output as { messages: unknown[] };
    expect(output.messages).toHaveLength(3);
    expect(output.messages[0]).toMatchObject({ id: 'm1', sender: 'boss@example.com', subject: 'Sujet 1' });
    expect(output.messages[1]).toMatchObject({ id: 'm2', sender: 'newsletter@promo.example' });
    expect(output.messages[2]).toMatchObject({ id: 'm3', sender: 'carol@example.com' });
  });

  it('n’expose que le contrat générique Tool : aucun champ credential/client attaché', () => {
    const client = buildClient([]);
    const [tool] = gmailConnector.createTools(client);

    expect(Object.keys(tool!).sort()).toEqual(
      ['action', 'description', 'execute', 'name', 'validateInput'].sort(),
    );
  });

  it('aucun credential (marqueur du token d’accès) ne fuit dans l’EmailMessage ni dans l’output du Tool', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')];
    const client = buildClient(messages);
    const [tool] = gmailConnector.createTools(client);

    const output = await tool!.execute({});

    expect(JSON.stringify(output)).not.toContain(FAKE_TOKEN_MARKER);
  });

  it('authentification absente/invalide : l’exécution échoue proprement via ToolExecutor (status "error", jamais "executed")', async () => {
    const client = buildClient([], new FakeAccessTokenProvider(new Error('Gmail OAuth : refresh token invalide.')));
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.read': 'allow' } }));

    const result = await executor.run({ tool: 'gmail.read', input: {} });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('refresh token invalide');
    }
  });

  it('validateInput rejette un maxResults hors bornes, sans jamais appeler le client', async () => {
    const fetchFn = vi.fn();
    const client = new GmailApiClient({ accessTokenProvider: new FakeAccessTokenProvider(), fetchFn });
    const [tool] = gmailConnector.createTools(client);

    expect(tool!.validateInput({ maxResults: 0 }).ok).toBe(false);
    expect(tool!.validateInput({ maxResults: 51 }).ok).toBe(false);
    expect(tool!.validateInput({ maxResults: 'dix' }).ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
