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

describe('gmailConnector — architecture (lecture seule + préparation, aucun réseau réel)', () => {
  it('fournit exactement deux Tool, déclarés "read" et "prepare"', () => {
    const client = buildClient([]);
    const tools = gmailConnector.createTools(client);

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe('gmail.read');
    expect(tools[0]?.action).toBe('read');
    expect(tools[1]?.name).toBe('gmail.prepare_reply');
    expect(tools[1]?.action).toBe('prepare');
  });

  it('n’expose aucune capacité d’envoi, de modification ou de suppression', () => {
    expect(gmailConnector.capabilities).toEqual(['gmail.read', 'gmail.prepare_reply']);

    const client = buildClient([]);
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    for (const forbidden of ['gmail.send', 'gmail.modify', 'gmail.delete']) {
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

  it('n’expose que le contrat générique Tool : aucun champ credential/client attaché (les deux Tool)', () => {
    const client = buildClient([]);

    for (const tool of gmailConnector.createTools(client)) {
      expect(Object.keys(tool).sort()).toEqual(
        ['action', 'description', 'execute', 'name', 'validateInput'].sort(),
      );
    }
  });

  it('aucun credential (marqueur du token d’accès) ne fuit dans l’EmailMessage ni dans l’output des Tool', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')];
    const client = buildClient(messages);
    const [readTool, prepareReplyTool] = gmailConnector.createTools(client);

    const readOutput = await readTool!.execute({});
    expect(JSON.stringify(readOutput)).not.toContain(FAKE_TOKEN_MARKER);

    const prepareOutput = await prepareReplyTool!.execute({ messageId: 'm1', body: 'Réponse.' });
    expect(JSON.stringify(prepareOutput)).not.toContain(FAKE_TOKEN_MARKER);
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

describe('gmail.prepare_reply — M7.3', () => {
  function buildRegistry(client: GmailApiClient) {
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    return registry;
  }

  it('dérive to/subject/threadId du message Gmail réellement lu ; body vient de l’appelant', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Point hebdo', 'Contenu original')];
    const client = buildClient(messages);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }));

    const result = await executor.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'm1', body: 'Voici ma réponse.' },
    });

    expect(result).toMatchObject({
      status: 'executed',
      output: {
        to: 'boss@example.com',
        subject: 'Re: Point hebdo',
        threadId: 'thread-m1',
        body: 'Voici ma réponse.',
      },
    });
  });

  it('aucune cible de réponse fournie par l’appelant ne remplace celle du message réel', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Point hebdo', 'Contenu original')];
    const client = buildClient(messages);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }));

    const result = await executor.run({
      tool: 'gmail.prepare_reply',
      input: {
        messageId: 'm1',
        body: 'Réponse.',
        // Ces champs, s'ils étaient pris en compte, détourneraient la réponse.
        to: 'attaquant@evil.example',
        subject: 'Sujet falsifié',
        threadId: 'thread-falsifie',
      },
    });

    expect(result).toMatchObject({
      status: 'executed',
      output: { to: 'boss@example.com', subject: 'Re: Point hebdo', threadId: 'thread-m1' },
    });
  });

  it('messageId inconnu : échec propre via ToolExecutor (status "error", jamais "executed"), aucune mutation', async () => {
    const client = buildClient([]);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }));

    const result = await executor.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'absent', body: 'Réponse.' },
    });

    expect(result.status).toBe('error');
    expect(result.status).not.toBe('executed');
  });

  it('validateInput rejette une entrée sans messageId ou sans body', () => {
    const client = buildClient([]);
    const [, prepareReplyTool] = gmailConnector.createTools(client);

    expect(prepareReplyTool!.validateInput({}).ok).toBe(false);
    expect(prepareReplyTool!.validateInput({ messageId: 'm1' }).ok).toBe(false);
    expect(prepareReplyTool!.validateInput({ body: 'x' }).ok).toBe(false);
    expect(prepareReplyTool!.validateInput({ messageId: '', body: 'x' }).ok).toBe(false);
    expect(prepareReplyTool!.validateInput('pas un objet').ok).toBe(false);
  });

  it('permissions indépendantes : gmail.prepare_reply refusé n’empêche pas gmail.read, et inversement', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')];
    const client = buildClient(messages);
    const registry = buildRegistry(client);

    const readAllowed = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.read': 'allow', 'gmail.prepare_reply': 'deny' } }),
    );
    const readResult = await readAllowed.run({ tool: 'gmail.read', input: {} });
    const prepareResult = await readAllowed.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'm1', body: 'x' },
    });
    expect(readResult.status).toBe('executed');
    expect(prepareResult.status).toBe('denied');

    const prepareAllowed = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.read': 'deny', 'gmail.prepare_reply': 'allow' } }),
    );
    const readDenied = await prepareAllowed.run({ tool: 'gmail.read', input: {} });
    const prepareExecuted = await prepareAllowed.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'm1', body: 'x' },
    });
    expect(readDenied.status).toBe('denied');
    expect(prepareExecuted.status).toBe('executed');
  });

  it('une confirmation sur gmail.prepare_reply ne débloque jamais un autre outil (ex. un futur gmail.send)', async () => {
    const messages = [rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')];
    const client = buildClient(messages);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'require_confirmation' } }),
    );

    const confirmedPrepare = await executor.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'm1', body: 'x' },
      confirmed: true,
    });
    expect(confirmedPrepare.status).toBe('executed');

    // Un outil « gmail.send » n'existe pas ; même avec confirmed:true, il reste inconnu —
    // la confirmation ne « débloque » jamais un outil qu'elle ne nomme pas explicitement.
    const stillUnknownSend = await executor.run({
      tool: 'gmail.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
      confirmed: true,
    });
    expect(stillUnknownSend.status).toBe('unknown_tool');
  });

  it('require_confirmation sans confirmation : gmail.prepare_reply reste bloqué', async () => {
    const client = buildClient([rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')]);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'require_confirmation' } }),
    );

    const result = await executor.run({ tool: 'gmail.prepare_reply', input: { messageId: 'm1', body: 'x' } });

    expect(result.status).toBe('awaiting_confirmation');
  });
});
