import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import type { Account } from '../account.js';
import {
  confirmAndExecute,
  proposeConfirmation,
  type ConfirmationFailed,
} from '../confirmation/confirmation-flow.js';
import type { ConfirmationInputSummary } from '../confirmation/confirmation-request.js';
import {
  ConfirmationService,
  type ConfirmationPayload,
} from '../confirmation/confirmation-service.js';
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function buildClient(
  messages: readonly ReturnType<typeof rawGmailMessage>[],
  accessTokenProvider?: AccessTokenProvider,
) {
  return new GmailApiClient({
    accessTokenProvider: accessTokenProvider ?? new FakeAccessTokenProvider(),
    fetchFn: buildFakeFetch(messages),
  });
}

describe('gmailConnector — architecture (lecture seule + préparation, aucun réseau réel)', () => {
  it('fournit exactement trois Tool, déclarés "read", "prepare" et "execute"', () => {
    const client = buildClient([]);
    const tools = gmailConnector.createTools(client);

    expect(tools).toHaveLength(3);
    expect(tools[0]?.name).toBe('gmail.read');
    expect(tools[0]?.action).toBe('read');
    expect(tools[1]?.name).toBe('gmail.prepare_reply');
    expect(tools[1]?.action).toBe('prepare');
    expect(tools[2]?.name).toBe('gmail.send');
    expect(tools[2]?.action).toBe('execute');
  });

  it('n’expose aucune capacité de modification ou de suppression (gmail.send existe désormais depuis M8-A6)', () => {
    expect(gmailConnector.capabilities).toEqual([
      'gmail.read',
      'gmail.prepare_reply',
      'gmail.send',
    ]);

    const client = buildClient([]);
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    for (const forbidden of ['gmail.modify', 'gmail.delete']) {
      expect(registry.has(forbidden)).toBe(false);
    }
    // Même avec une politique "tout autoriser", un outil inexistant ne peut jamais s'exécuter.
    return expect(
      executor.run({
        tool: 'gmail.modify',
        input: { to: 'x@example.test', subject: 's', body: 'b' },
      }),
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
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.read': 'allow' } }),
    );

    const result = await executor.run({ tool: 'gmail.read', input: {} });

    expect(result.status).toBe('executed');
    if (result.status !== 'executed') throw new Error('unreachable');
    const output = result.output as { messages: unknown[] };
    expect(output.messages).toHaveLength(3);
    expect(output.messages[0]).toMatchObject({
      id: 'm1',
      sender: 'boss@example.com',
      subject: 'Sujet 1',
    });
    expect(output.messages[1]).toMatchObject({ id: 'm2', sender: 'newsletter@promo.example' });
    expect(output.messages[2]).toMatchObject({ id: 'm3', sender: 'carol@example.com' });
  });

  it('n’expose que le contrat générique Tool : aucun champ credential/client attaché (les deux Tool)', () => {
    const client = buildClient([]);

    for (const tool of gmailConnector.createTools(client)) {
      expect(Object.keys(tool).sort()).toEqual(
        ['action', 'description', 'execute', 'inputSchema', 'name', 'validateInput'].sort(),
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
    const client = buildClient(
      [],
      new FakeAccessTokenProvider(new Error('Gmail OAuth : refresh token invalide.')),
    );
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.read': 'allow' } }),
    );

    const result = await executor.run({ tool: 'gmail.read', input: {} });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('refresh token invalide');
    }
  });

  it('validateInput rejette un maxResults hors bornes, sans jamais appeler le client', async () => {
    const fetchFn = vi.fn();
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider(),
      fetchFn,
    });
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
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }),
    );

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
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }),
    );

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
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'allow' } }),
    );

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

  it('une confirmation sur gmail.prepare_reply ne débloque jamais un autre outil (ex. gmail.send)', async () => {
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

    // gmail.send existe désormais (M8-A6) mais n'a aucune règle explicite dans cette
    // politique : il retombe sur SAFE_DEFAULT_DECISION ('deny'). Même avec confirmed:true,
    // une confirmation ciblée sur « gmail.prepare_reply » ne « débloque » jamais un autre
    // outil qu'elle ne nomme pas explicitement.
    const stillDeniedSend = await executor.run({
      tool: 'gmail.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
      confirmed: true,
    });
    expect(stillDeniedSend.status).toBe('denied');
  });

  it('require_confirmation sans confirmation : gmail.prepare_reply reste bloqué', async () => {
    const client = buildClient([rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')]);
    const registry = buildRegistry(client);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.prepare_reply': 'require_confirmation' } }),
    );

    const result = await executor.run({
      tool: 'gmail.prepare_reply',
      input: { messageId: 'm1', body: 'x' },
    });

    expect(result.status).toBe('awaiting_confirmation');
  });
});

describe('gmail.send — M8-A6 (aucun appel réseau réel, fetchFn mocké)', () => {
  function buildSendSetup(
    sendDecision: 'allow' | 'deny' | 'require_confirmation',
    accessTokenProvider?: AccessTokenProvider,
  ) {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { id: 'sent-1', threadId: 'thread-xyz' }),
    );
    const client = new GmailApiClient({
      accessTokenProvider: accessTokenProvider ?? new FakeAccessTokenProvider(),
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.send': sendDecision } }),
    );
    return { executor, fetchFn };
  }

  it('le Tool existe, action "execute", contrat générique strict (aucun credential/état caché)', () => {
    const client = buildClient([]);
    const [, , sendTool] = gmailConnector.createTools(client);

    expect(sendTool?.name).toBe('gmail.send');
    expect(sendTool?.action).toBe('execute');
    expect(Object.keys(sendTool!).sort()).toEqual(
      ['action', 'description', 'execute', 'inputSchema', 'name', 'validateInput'].sort(),
    );
  });

  it('validateInput rejette une entrée invalide (to manquant/vide, types incorrects)', () => {
    const client = buildClient([]);
    const [, , sendTool] = gmailConnector.createTools(client);

    expect(sendTool!.validateInput('pas un objet').ok).toBe(false);
    expect(sendTool!.validateInput({}).ok).toBe(false);
    expect(sendTool!.validateInput({ to: '', subject: 's', body: 'b' }).ok).toBe(false);
    expect(sendTool!.validateInput({ subject: 's', body: 'b' }).ok).toBe(false);
    expect(sendTool!.validateInput({ to: 'x@example.test', subject: 1, body: 'b' }).ok).toBe(false);
    expect(sendTool!.validateInput({ to: 'x@example.test', subject: 's', body: 42 }).ok).toBe(
      false,
    );
    expect(
      sendTool!.validateInput({ to: 'x@example.test', subject: 's', body: 'b', threadId: 7 }).ok,
    ).toBe(false);
  });

  it('validateInput rejette toute propriété inconnue — jamais ignorée silencieusement', () => {
    const client = buildClient([]);
    const [, , sendTool] = gmailConnector.createTools(client);

    const withCc = sendTool!.validateInput({
      to: 'x@example.test',
      subject: 's',
      body: 'b',
      cc: 'y@example.test',
    });
    expect(withCc.ok).toBe(false);
    if (!withCc.ok) {
      expect(withCc.error).toContain('cc');
    }

    // Un « to » falsifié via une clé superflue ne doit jamais être toléré (contrairement
    // à gmail.prepare_reply, qui ignore silencieusement les clés superflues : ici, un
    // envoi réel doit échouer plutôt que de deviner quelle valeur retenir).
    expect(
      sendTool!.validateInput({
        to: 'x@example.test',
        subject: 's',
        body: 'b',
        from: 'attaquant@evil.example',
      }).ok,
    ).toBe(false);
  });

  it('threadId optionnel : accepté si fourni, absent de la valeur validée sinon', () => {
    const client = buildClient([]);
    const [, , sendTool] = gmailConnector.createTools(client);

    expect(
      sendTool!.validateInput({ to: 'x@example.test', subject: 's', body: 'b', threadId: 't1' }),
    ).toEqual({
      ok: true,
      value: { to: 'x@example.test', subject: 's', body: 'b', threadId: 't1' },
    });

    const withoutThread = sendTool!.validateInput({
      to: 'x@example.test',
      subject: 's',
      body: 'b',
    });
    expect(withoutThread.ok).toBe(true);
    if (withoutThread.ok) {
      expect('threadId' in (withoutThread.value as Record<string, unknown>)).toBe(false);
    }
  });

  it('permission allow : exécution réelle (mockée), output minimal {id, threadId}', async () => {
    const { executor, fetchFn } = buildSendSetup('allow');

    const result = await executor.run({
      tool: 'gmail.send',
      input: { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' },
    });

    expect(result).toMatchObject({
      status: 'executed',
      output: { id: 'sent-1', threadId: 'thread-xyz' },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('permission deny : denied, zéro appel réseau', async () => {
    const { executor, fetchFn } = buildSendSetup('deny');

    const result = await executor.run({
      tool: 'gmail.send',
      input: { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' },
    });

    expect(result.status).toBe('denied');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('aucun token/credential dans l’output ni dans un message d’erreur', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const { executor, fetchFn } = buildSendSetup('allow', new FakeAccessTokenProvider(marker));

    const result = await executor.run({
      tool: 'gmail.send',
      input: { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' },
    });

    expect(JSON.stringify(result)).not.toContain(marker);
    // Le token est bien utilisé pour l'appel HTTP réel (mocké) — il ne doit
    // simplement jamais revenir dans ce que voit l'appelant du Tool.
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${marker}`);
  });

  it('erreur Gmail (HTTP refusé) : status "error" via ToolExecutor, jamais "executed", aucune fuite de credential', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const fetchFn = vi.fn(async () => jsonResponse(403, { error: 'insufficient permissions' }));
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider(marker),
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.send': 'allow' } }),
    );

    const result = await executor.run({
      tool: 'gmail.send',
      input: { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' },
    });

    expect(result.status).toBe('error');
    expect(result.status).not.toBe('executed');
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

describe('gmail.send + ConfirmationFlow — M8-A6 (proposition → confirmation → verify → PermissionManager → ToolExecutor → Gmail)', () => {
  const SEND_INPUT = { to: 'carol@example.test', subject: 'Salut', body: 'Ça marche' };
  const SUMMARY: ConfirmationInputSummary = {
    fields: [{ key: 'to', label: 'Destinataire', value: SEND_INPUT.to }],
  };

  function makeAccount(id: string): Account {
    return {
      id,
      provider: 'gmail',
      accountIdentifier: `${id}@example.test`,
      status: 'connected',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function buildRequireConfirmationSetup(accessTokenProvider?: AccessTokenProvider) {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: 'sent-1', threadId: 'thread-xyz' }));
    const client = new GmailApiClient({
      accessTokenProvider: accessTokenProvider ?? new FakeAccessTokenProvider(),
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) {
      registry.register(tool);
    }
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } }),
    );
    return { executor, fetchFn };
  }

  it('proposition → awaiting_confirmation + ConfirmationRequest → confirmation valide → exactement une exécution', async () => {
    const { executor, fetchFn } = buildRequireConfirmationSetup();
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });

    expect(proposed.result.status).toBe('awaiting_confirmation');
    expect(proposed.confirmationRequest?.toolName).toBe('gmail.send');
    expect(proposed.confirmationRequest?.action).toBe('execute');
    expect(fetchFn).not.toHaveBeenCalled();
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: account.id,
      input: proposed.result.input,
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed).toMatchObject({
      status: 'executed',
      output: { id: 'sent-1', threadId: 'thread-xyz' },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('confirmation invalide (confirmationId inconnu) → confirmation_failed, zéro appel réseau', async () => {
    const { executor, fetchFn } = buildRequireConfirmationSetup();
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');
    const payload: ConfirmationPayload = {
      toolName: 'gmail.send',
      action: 'execute',
      accountId: account.id,
      input: SEND_INPUT,
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: 'confirmation-id-inconnu',
      payload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('not_found');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('payload modifié entre propose et confirm → confirmation_failed (payload_mismatch), zéro appel réseau, jamais exécuté', async () => {
    const { executor, fetchFn } = buildRequireConfirmationSetup();
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const tamperedPayload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: account.id,
      input: { ...SEND_INPUT, body: 'contenu modifié après la proposition' },
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: tamperedPayload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('payload_mismatch');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('un ticket consommé ne peut pas être rejoué : une seule exécution malgré une seconde confirmation', async () => {
    const { executor, fetchFn } = buildRequireConfirmationSetup();
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');
    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: account.id,
      input: proposed.result.input,
    };
    const confirmationId = proposed.confirmationRequest!.confirmationId;

    const first = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });
    expect(first.status).toBe('executed');

    const second = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });
    expect(second.status).toBe('confirmation_failed');
    expect((second as ConfirmationFailed).failureReason).toBe('already_consumed');

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('le compte utilisé est bien celui attendu : un payload présentant un autre accountId échoue', async () => {
    const { executor, fetchFn } = buildRequireConfirmationSetup();
    const confirmationService = new ConfirmationService();
    const accountA = makeAccount('acc-gmail-A');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account: accountA,
      summary: SUMMARY,
    });
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const payloadForWrongAccount: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: 'acc-gmail-B',
      input: proposed.result.input,
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: payloadForWrongAccount,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('confirmation valide + PermissionManager deny → denied, zéro appel Gmail (une confirmation ne contourne jamais PermissionManager)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: 'sent-1' }));
    const client = new GmailApiClient({
      accessTokenProvider: new FakeAccessTokenProvider(),
      fetchFn,
    });
    const registry = new ToolRegistry();
    for (const tool of gmailConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.send': 'deny' } }),
    );
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');
    const payload: ConfirmationPayload = {
      toolName: 'gmail.send',
      action: 'execute',
      accountId: account.id,
      input: SEND_INPUT,
    };

    // Ticket créé directement (hors propose, puisque deny n'en crée jamais) : prouve
    // qu'un ticket valide n'est pas, à lui seul, une autorisation.
    const ticket = await confirmationService.create(payload);
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: ticket.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('denied');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('aucun token/credential n’apparaît dans le ConfirmationRequest ni dans le résultat exécuté', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const { executor, fetchFn } = buildRequireConfirmationSetup(
      new FakeAccessTokenProvider(marker),
    );
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-gmail-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'gmail.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    expect(JSON.stringify(proposed.confirmationRequest)).not.toContain(marker);
    if (proposed.result.status !== 'awaiting_confirmation') throw new Error('unreachable');

    const payload: ConfirmationPayload = {
      toolName: proposed.result.toolName,
      action: proposed.result.action,
      accountId: account.id,
      input: proposed.result.input,
    };
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(JSON.stringify(confirmed)).not.toContain(marker);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

/**
 * Vérifie qu'un `inputSchema` de Tool est structurellement sain et cohérent
 * avec les attentes déclarées. Ne teste pas seulement l'existence du champ.
 */
function assertToolSchema(
  schema: Record<string, unknown>,
  expected: {
    readonly properties: readonly string[];
    readonly required: readonly string[];
    readonly additionalPropertiesFalse: boolean;
  },
): void {
  expect(typeof schema).toBe('object');
  expect(schema).not.toBeNull();
  expect(schema.type).toBe('object');

  const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
  expect(Object.keys(props).sort()).toEqual([...expected.properties].sort());

  const required = (schema.required as string[] | undefined) ?? [];
  expect([...required].sort()).toEqual([...expected.required].sort());

  if (expected.additionalPropertiesFalse) {
    expect(schema.additionalProperties).toBe(false);
  } else {
    expect(schema.additionalProperties).not.toBe(false);
  }

  // Aucun champ sensible / interne, à quelque profondeur que ce soit.
  expect(JSON.stringify(schema)).not.toMatch(
    /account[iI]d|token|secret|credential|refresh|oauth|api[_-]?key/,
  );
}

describe('gmailConnector — inputSchema (cohérence avec validateInput)', () => {
  const tools = () => gmailConnector.createTools(buildClient([]));

  it('chaque Tool expose un inputSchema object structurellement sain', () => {
    for (const tool of tools()) {
      expect(typeof tool.inputSchema).toBe('object');
      expect(tool.inputSchema.type).toBe('object');
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(
        /account[iI]d|token|secret|credential|refresh|oauth|api[_-]?key/,
      );
    }
  });

  it('gmail.read : maxResults optionnel borné, aucune propriété requise, clés inconnues tolérées', () => {
    const [read] = tools();
    assertToolSchema(read!.inputSchema, {
      properties: ['maxResults'],
      required: [],
      additionalPropertiesFalse: false,
    });
    const maxResults = (read!.inputSchema.properties as Record<string, Record<string, unknown>>)
      .maxResults;
    expect(maxResults.type).toBe('integer');
    expect(maxResults.minimum).toBe(1);
    expect(maxResults.maximum).toBe(50);
  });

  it('gmail.prepare_reply : messageId + body requis, clés inconnues tolérées (jamais additionalProperties:false)', () => {
    const [, prepare] = tools();
    assertToolSchema(prepare!.inputSchema, {
      properties: ['messageId', 'body'],
      required: ['messageId', 'body'],
      additionalPropertiesFalse: false,
    });
  });

  it('gmail.send : to/subject/body requis + additionalProperties:false (validateInput rejette les clés inconnues)', () => {
    const [, , send] = tools();
    assertToolSchema(send!.inputSchema, {
      properties: ['to', 'subject', 'body', 'threadId'],
      required: ['to', 'subject', 'body'],
      additionalPropertiesFalse: true,
    });
    // Le schema n'introduit AUCUN accountId : le Tool n'en accepte pas.
    expect(Object.keys(send!.inputSchema.properties as object)).not.toContain('accountId');
  });

  it('l’ajout du schema ne change pas la validation : gmail.send rejette toujours une clé inconnue', () => {
    const [, , send] = tools();
    expect(
      send!.validateInput({ to: 'a@x.test', subject: 's', body: 'b', cc: 'x@y.test' }).ok,
    ).toBe(false);
    expect(send!.validateInput({ to: 'a@x.test', subject: 's', body: 'b' }).ok).toBe(true);
  });
});
