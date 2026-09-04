import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { describeCapabilities } from './capability.js';
import { inMemoryConnector } from './in-memory/in-memory-connector.js';
import { InMemoryMailClient } from './in-memory/in-memory-client.js';

describe('describeCapabilities', () => {
  it('dérive une Capability par Tool, avec le même action que Tool.action', () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);

    const capabilities = describeCapabilities(inMemoryConnector.id, tools);

    expect(capabilities).toEqual([
      { id: 'inmemory.read', connectorId: 'inmemory', action: 'read', description: expect.any(String) },
      {
        id: 'inmemory.prepare_reply',
        connectorId: 'inmemory',
        action: 'prepare',
        description: expect.any(String),
      },
      { id: 'inmemory.send', connectorId: 'inmemory', action: 'execute', description: expect.any(String) },
    ]);
  });

  it('capability disponible : figure dans Connector.capabilities et correspond à un Tool réel du registre', () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);
    const registry = new ToolRegistry();
    for (const tool of tools) registry.register(tool);

    const capabilities = describeCapabilities(inMemoryConnector.id, tools);
    const readCapability = capabilities.find((c) => c.id === 'inmemory.read');

    expect(inMemoryConnector.capabilities).toContain('inmemory.read');
    expect(readCapability).toBeDefined();
    expect(registry.has(readCapability!.id)).toBe(true);
  });

  it('capability inconnue : absente de Connector.capabilities et du ToolRegistry', () => {
    const client = new InMemoryMailClient();
    const registry = new ToolRegistry();
    for (const tool of inMemoryConnector.createTools(client)) registry.register(tool);

    expect(inMemoryConnector.capabilities).not.toContain('inmemory.delete_everything');
    expect(registry.has('inmemory.delete_everything')).toBe(false);
  });

  it('capability non supportée par ce connector : gmail.send n’existe ni comme capability ni comme Tool exécutable', () => {
    expect(inMemoryConnector.capabilities).not.toContain('gmail.send');
  });

  it('describeCapabilities ne fait aucun choix d’autorisation : une Capability "execute" reste soumise au PermissionManager', async () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);
    const capabilities = describeCapabilities(inMemoryConnector.id, tools);
    const sendCapability = capabilities.find((c) => c.id === 'inmemory.send')!;
    expect(sendCapability.action).toBe('execute');

    const registry = new ToolRegistry();
    for (const tool of tools) registry.register(tool);
    // Politique explicite de refus : la Capability existe, mais l'exécution
    // reste refusée — describeCapabilities n'a aucun pouvoir d'autoriser.
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'deny' }));

    const result = await executor.run({
      tool: sendCapability.id,
      input: { to: 'x@example.test', subject: 's', body: 'b' },
    });

    expect(result.status).toBe('denied');
  });
});
