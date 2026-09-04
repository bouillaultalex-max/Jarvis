import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { AccountStore, type Account } from './account.js';
import { ConnectorRegistry } from './connector-registry.js';
import { AmbiguousAccountError, SecretNotFoundError, UnknownConnectorError } from './errors.js';
import { InMemoryMailClient } from './in-memory/in-memory-client.js';
import { inMemoryConnector } from './in-memory/in-memory-connector.js';
import { InMemorySecretStore } from './in-memory/in-memory-secret-store.js';
import { requireSecret } from './secret-store.js';

/**
 * Tests de frontières de sécurité pour l'architecture connectors (M5).
 *
 * Ces tests ne créent AUCUN nouveau mécanisme d'autorisation : ils
 * vérifient que l'architecture additive de M5 (ConnectorRegistry,
 * AccountStore, SecretStore, Capability) respecte le flux existant
 *
 *   Tool → ActionLevel → PermissionManager → ToolExecutor → Connector
 *
 * et ne fournit aucun raccourci qui le contournerait.
 */

const FAKE_SECRET = 'FAKE-REFRESH-TOKEN-NOT-REAL-xyz789';

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'provider' | 'accountIdentifier'>): Account {
  return {
    displayName: undefined,
    status: 'connected',
    metadata: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Sécurité — SecretStore : aucun secret dans les erreurs ou représentations publiques', () => {
  it('SecretNotFoundError ne cite jamais de valeur, uniquement la clé', async () => {
    const store = new InMemorySecretStore();
    await store.set('gmail.acc-1.refreshToken', FAKE_SECRET);

    try {
      await requireSecret(store, 'gmail.acc-2.refreshToken');
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretNotFoundError);
      expect((err as Error).message).not.toContain(FAKE_SECRET);
    }
  });

  it('JSON.stringify(store) et l’énumération de ses propriétés ne révèlent aucun secret', async () => {
    const store = new InMemorySecretStore();
    await store.set('k', FAKE_SECRET);

    expect(JSON.stringify(store)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(store)).toBe('{}');
    expect(Object.keys(store)).toEqual([]);
    expect(String(store)).not.toContain(FAKE_SECRET);
  });

  it('un secret absent après delete() n’apparaît dans aucune erreur ultérieure', async () => {
    const store = new InMemorySecretStore();
    await store.set('k', FAKE_SECRET);
    await store.delete('k');

    await expect(requireSecret(store, 'k')).rejects.toThrowError(SecretNotFoundError);
  });
});

describe('Sécurité — un secret n’est jamais exposé à un Tool, au LLM ou à l’appelant', () => {
  it('un Tool produit par un connector n’a aucun champ credential/secret, et son output ne contient jamais le secret du client', async () => {
    const client = new InMemoryMailClient();
    const tools = inMemoryConnector.createTools(client);

    for (const tool of tools) {
      // Contrat générique Tool uniquement — aucune propriété "secret", "token", "client"…
      expect(Object.keys(tool).sort()).toEqual(['action', 'description', 'execute', 'name', 'validateInput'].sort());
    }

    const readTool = tools.find((t) => t.name === 'inmemory.read')!;
    const output = await readTool.execute({});
    expect(JSON.stringify(output)).not.toContain(client.debugAuthMarkerForTests());
  });

  it('un ToolExecutionResult "executed" ne transporte que l’output métier — jamais un secret du SecretStore', async () => {
    const secretStore = new InMemorySecretStore();
    await secretStore.set('inmemory.acc-1.token', FAKE_SECRET);

    const client = new InMemoryMailClient();
    const registry = new ToolRegistry();
    for (const tool of inMemoryConnector.createTools(client)) registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager({ default: 'allow' }));

    const result = await executor.run({ tool: 'inmemory.read', input: {} });

    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET);
  });
});

describe('Sécurité — aucun contournement de PermissionManager', () => {
  it('ConnectorRegistry et AccountStore ne prennent aucune décision d’autorisation : une capability "execute" reste refusée par une politique deny', async () => {
    const connectorRegistry = new ConnectorRegistry();
    connectorRegistry.register(inMemoryConnector);

    const accountStore = new AccountStore();
    accountStore.register(
      makeAccount({ id: 'acc-1', provider: 'inmemory', accountIdentifier: 'demo@example.test' }),
    );

    // Résolution connector + compte : n'implique ni n'autorise rien.
    const connector = connectorRegistry.get('inmemory');
    const account = accountStore.resolve({ provider: 'inmemory' });
    expect(account.id).toBe('acc-1');

    const client = new InMemoryMailClient();
    const toolRegistry = new ToolRegistry();
    for (const tool of connector.createTools(client)) toolRegistry.register(tool);

    // Seul PermissionManager décide — ici, tout est explicitement refusé.
    const executor = new ToolExecutor(toolRegistry, new PermissionManager({ default: 'deny' }));
    const result = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
    });

    expect(result.status).toBe('denied');
  });

  it('une action require_confirmation reste bloquée tant que confirmed !== true, même via le chemin ConnectorRegistry → AccountStore → ToolExecutor', async () => {
    const connectorRegistry = new ConnectorRegistry();
    connectorRegistry.register(inMemoryConnector);
    const connector = connectorRegistry.get('inmemory');

    const client = new InMemoryMailClient();
    const toolRegistry = new ToolRegistry();
    for (const tool of connector.createTools(client)) toolRegistry.register(tool);

    const executor = new ToolExecutor(
      toolRegistry,
      new PermissionManager({ rules: { 'inmemory.send': 'require_confirmation' } }),
    );

    const unconfirmed = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
    });
    expect(unconfirmed.status).toBe('awaiting_confirmation');

    const confirmed = await executor.run({
      tool: 'inmemory.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
      confirmed: true,
    });
    expect(confirmed.status).toBe('executed');
  });

  it('résoudre un connector/compte inexistant échoue proprement (erreurs typées) sans jamais atteindre ToolExecutor', () => {
    const connectorRegistry = new ConnectorRegistry();
    const accountStore = new AccountStore();

    expect(() => connectorRegistry.get('discord')).toThrowError(UnknownConnectorError);
    expect(() => accountStore.resolve({ provider: 'discord' })).toThrowError();
  });
});

describe('Sécurité — ambiguïté de compte : jamais de sélection implicite', () => {
  it('deux comptes pour le même provider, aucun accountId : AmbiguousAccountError, aucune action ne peut être lancée par erreur', async () => {
    const accountStore = new AccountStore();
    accountStore.register(makeAccount({ id: 'acc-perso', provider: 'inmemory', accountIdentifier: 'perso@example.test' }));
    accountStore.register(makeAccount({ id: 'acc-pro', provider: 'inmemory', accountIdentifier: 'pro@example.test' }));

    expect(() => accountStore.resolve({ provider: 'inmemory' })).toThrowError(AmbiguousAccountError);

    // Simule l'appelant (ex. un Tool ou une route API) qui doit gérer
    // l'échec explicitement plutôt que de continuer avec un compte par défaut.
    let selectedAccountId: string | undefined;
    try {
      const account = accountStore.resolve({ provider: 'inmemory' });
      selectedAccountId = account.id;
    } catch {
      selectedAccountId = undefined;
    }
    expect(selectedAccountId).toBeUndefined();
  });

  it('fournir explicitement accountId lève l’ambiguïté et sélectionne le bon compte', () => {
    const accountStore = new AccountStore();
    accountStore.register(makeAccount({ id: 'acc-perso', provider: 'inmemory', accountIdentifier: 'perso@example.test' }));
    accountStore.register(makeAccount({ id: 'acc-pro', provider: 'inmemory', accountIdentifier: 'pro@example.test' }));

    const resolved = accountStore.resolve({ provider: 'inmemory', accountId: 'acc-pro' });

    expect(resolved.id).toBe('acc-pro');
  });
});
