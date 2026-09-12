import { describe, expect, it } from 'vitest';
import {
  AgentLoop,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
} from '@jarvis/core';

import { InMemoryMailClient } from './in-memory-client.js';
import { inMemoryConnector } from './in-memory-connector.js';

/** Provider de test : rejoue un script de réponses. Aucun réseau. */
class ScriptedLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  private index = 0;
  constructor(private readonly script: readonly LlmResponse[]) {}

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const response = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return response;
  }
}

const CALL = (tool: string, input: unknown): LlmResponse => ({
  content: '',
  toolCall: { tool, input },
});

function buildFullExecutor(
  client: InMemoryMailClient,
  decisions: Record<string, 'allow' | 'deny' | 'require_confirmation'>,
) {
  const registry = new ToolRegistry();
  for (const tool of inMemoryConnector.createTools(client)) {
    registry.register(tool);
  }
  const permissions = new PermissionManager({ rules: decisions });
  return new ToolExecutor(registry, permissions);
}

describe('InMemoryConnector — architecture connecteurs', () => {
  it('un connecteur peut fournir plusieurs Tools distincts', () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);

    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual([...inMemoryConnector.capabilities].sort());
  });

  it('chaque Tool possède sa propre capacité (ActionLevel)', () => {
    const client = new InMemoryMailClient();
    const [readTool, prepareTool, sendTool] = inMemoryConnector.createTools(client);

    expect(readTool?.name).toBe('inmemory.read');
    expect(readTool?.action).toBe('read');
    expect(prepareTool?.name).toBe('inmemory.prepare_reply');
    expect(prepareTool?.action).toBe('prepare');
    expect(sendTool?.name).toBe('inmemory.send');
    expect(sendTool?.action).toBe('execute');
  });

  it('un ensemble de capacités "lecture seule" ne peut pas exécuter une écriture', async () => {
    const client = new InMemoryMailClient();
    // Seul le Tool de lecture est enregistré : aucune capacité d'écriture n'existe.
    const registry = new ToolRegistry();
    registry.register(inMemoryConnector.createTools(client)[0]!);
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    const result = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'x', subject: 's', body: 'b' },
    });

    expect(result.status).toBe('unknown_tool');
    expect(client.listSent()).toHaveLength(0);
  });

  it('read n\'a aucun effet de bord même avec une politique "allow"', async () => {
    const client = new InMemoryMailClient();
    const executor = buildFullExecutor(client, { 'inmemory.read': 'allow' });

    const result = await executor.run({ tool: 'inmemory.read', input: {} });

    expect(result).toMatchObject({ status: 'executed' });
    expect(client.listSent()).toHaveLength(0);
    expect(client.listInbox()).toHaveLength(2);
  });

  it('prepare ne déclenche aucune action externe (aucun envoi, aucune mutation)', async () => {
    const client = new InMemoryMailClient();
    const executor = buildFullExecutor(client, { 'inmemory.prepare_reply': 'allow' });

    const result = await executor.run({
      tool: 'inmemory.prepare_reply',
      input: { messageId: 'msg-1', body: 'Réponse brouillon' },
    });

    expect(result).toMatchObject({
      status: 'executed',
      output: { to: 'alice@example.test', subject: 'Re: Bonjour', body: 'Réponse brouillon' },
    });
    expect(client.listSent()).toHaveLength(0);
  });

  it("execute passe bien par le ToolExecutor et mute réellement l'état (envoi effectif)", async () => {
    const client = new InMemoryMailClient();
    const executor = buildFullExecutor(client, { 'inmemory.send': 'allow' });

    const result = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'carol@example.test', subject: 'Salut', body: 'ça marche' },
    });

    expect(result).toMatchObject({ status: 'executed' });
    expect(client.listSent()).toHaveLength(1);
    expect(client.listSent()[0]).toMatchObject({ to: 'carol@example.test' });
  });

  it('un deny reste impossible à contourner, même avec confirmed: true', async () => {
    const client = new InMemoryMailClient();
    const executor = buildFullExecutor(client, { 'inmemory.send': 'deny' });

    const result = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
      confirmed: true,
    });

    expect(result.status).toBe('denied');
    expect(client.listSent()).toHaveLength(0);
  });

  it('une confirmation ciblée pour un Tool ne débloque jamais un autre Tool', async () => {
    const client = new InMemoryMailClient();
    const registry = new ToolRegistry();
    for (const tool of inMemoryConnector.createTools(client)) {
      registry.register(tool);
    }
    const permissions = new PermissionManager({
      rules: {
        'inmemory.prepare_reply': 'require_confirmation',
        'inmemory.send': 'require_confirmation',
      },
    });
    const executor = new ToolExecutor(registry, permissions);
    const llm = new ScriptedLlmProvider([
      CALL('inmemory.prepare_reply', { messageId: 'msg-1', body: 'brouillon' }),
      CALL('inmemory.send', { to: 'x@example.test', subject: 's', body: 'b' }),
      { content: 'jamais atteint' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    // Seul inmemory.prepare_reply est confirmé pour ce tour.
    const result = await agent.run('Prépare puis envoie', {
      confirmedTools: ['inmemory.prepare_reply'],
    });

    expect(result.toolOutcomes).toHaveLength(2);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed' });
    expect(result.toolOutcomes[1]).toMatchObject({ status: 'awaiting_confirmation' });
    expect(client.listSent()).toHaveLength(0);
  });

  it("le connecteur reçoit sa dépendance d'authentification par injection, jamais exposée sur le Tool", () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);

    for (const tool of tools) {
      // Le Tool n'expose que le contrat générique : aucune propriété "client",
      // "auth", "token" ou équivalent n'est attachée à l'objet.
      expect(Object.keys(tool).sort()).toEqual(
        ['action', 'description', 'execute', 'inputSchema', 'name', 'validateInput'].sort(),
      );
    }
  });

  it('aucun "credential" (marqueur fictif du client) ne fuit dans l\'input/output d\'un Tool', async () => {
    const client = new InMemoryMailClient();
    const marker = client.debugAuthMarkerForTests();
    const [readTool, prepareTool, sendTool] = inMemoryConnector.createTools(client);

    const readOutput = await readTool!.execute({});
    expect(JSON.stringify(readOutput)).not.toContain(marker);

    const prepareOutput = await prepareTool!.execute({ messageId: 'msg-1', body: 'ok' });
    expect(JSON.stringify(prepareOutput)).not.toContain(marker);

    const sendOutput = await sendTool!.execute({ to: 'x@example.test', subject: 's', body: 'b' });
    expect(JSON.stringify(sendOutput)).not.toContain(marker);
  });

  it('aucun "credential" ne transite par les LlmMessage ni par le LlmToolCall lors d\'un tour complet', async () => {
    const client = new InMemoryMailClient();
    const marker = client.debugAuthMarkerForTests();
    const executor = buildFullExecutor(client, { 'inmemory.read': 'allow' });
    const llm = new ScriptedLlmProvider([
      CALL('inmemory.read', { messageId: 'msg-1' }),
      { content: 'Voici le message.' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Lis le message msg-1');

    expect(result.stopReason).toBe('llm_final');
    for (const sentMessages of llm.calls) {
      expect(JSON.stringify(sentMessages)).not.toContain(marker);
    }
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

describe('inMemoryConnector — inputSchema (cohérence avec validateInput)', () => {
  const tools = () => inMemoryConnector.createTools(new InMemoryMailClient());

  function assertObjectSchema(schema: Record<string, unknown>): void {
    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).not.toMatch(
      /account[iI]d|token|secret|credential|refresh|oauth|api[_-]?key|fakeAuthMarker/,
    );
  }

  it('générique : chaque Tool produit par createTools a un inputSchema object sain', () => {
    const all = tools();
    expect(all).toHaveLength(3);
    for (const tool of all) {
      assertObjectSchema(tool.inputSchema);
    }
  });

  it('inmemory.read : messageId optionnel, rien de requis', () => {
    const [read] = tools();
    assertObjectSchema(read!.inputSchema);
    expect(Object.keys(read!.inputSchema.properties as object).sort()).toEqual(['messageId']);
    expect((read!.inputSchema.required as string[] | undefined) ?? []).toEqual([]);
    expect(read!.inputSchema.additionalProperties).not.toBe(false);
  });

  it('inmemory.prepare_reply : messageId + body requis', () => {
    const [, prepare] = tools();
    expect(Object.keys(prepare!.inputSchema.properties as object).sort()).toEqual([
      'body',
      'messageId',
    ]);
    expect([...(prepare!.inputSchema.required as string[])].sort()).toEqual(['body', 'messageId']);
  });

  it('inmemory.send : to/subject/body requis, clés inconnues tolérées (validateInput ne les rejette pas)', () => {
    const [, , send] = tools();
    expect(Object.keys(send!.inputSchema.properties as object).sort()).toEqual([
      'body',
      'subject',
      'to',
    ]);
    expect([...(send!.inputSchema.required as string[])].sort()).toEqual(['body', 'subject', 'to']);
    expect(send!.inputSchema.additionalProperties).not.toBe(false);
    // Cohérence : validateInput accepte bien une clé inconnue (elle est ignorée).
    expect(send!.validateInput({ to: 'x@y.test', subject: 's', body: 'b', extra: 1 }).ok).toBe(
      true,
    );
  });

  it('l’ajout du schema ne change pas ToolExecutor : inmemory.send exécute toujours et mute l’état', async () => {
    const client = new InMemoryMailClient();
    const executor = buildFullExecutor(client, { 'inmemory.send': 'allow' });

    const result = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'z@example.test', subject: 's', body: 'b' },
    });

    expect(result.status).toBe('executed');
    expect(client.listSent()).toHaveLength(1);
  });
});
