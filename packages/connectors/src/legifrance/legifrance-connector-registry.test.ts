import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import { createLegifranceConfig, LegifranceHttpClient } from '@jarvis/legifrance-client';

import { ConnectorRegistry } from '../connector-registry.js';
import { UnknownConnectorError } from '../errors.js';
import type { AccessTokenProvider } from '../gmail/gmail-auth.js';
import { legifranceConnector } from './legifrance-connector.js';

/**
 * Wiring ConnectorRegistry → createTools → ToolRegistry → PermissionManager
 * → ToolExecutor — même pattern que `security.test.ts` (`inMemoryConnector`),
 * appliqué à `legifranceConnector` (jalon LEGAL-02B.2, item 6 du périmètre).
 */

class FakeAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    return 'fake-access-token-not-real';
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ConnectorRegistry — legifranceConnector', () => {
  it('9. le connector est enregistré sans erreur', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.register(legifranceConnector)).not.toThrow();
  });

  it('10. le connector est retrouvable par son identifiant', () => {
    const registry = new ConnectorRegistry();
    registry.register(legifranceConnector);

    expect(registry.has('legifrance')).toBe(true);
    expect(registry.get('legifrance')).toBe(legifranceConnector);
  });

  it('un identifiant inconnu échoue proprement (UnknownConnectorError), sans jamais atteindre ToolExecutor', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.get('legifrance')).toThrowError(UnknownConnectorError);
  });

  it('11. les capabilities/Tools du connector sont découvrables via le Registry', () => {
    const registry = new ConnectorRegistry();
    registry.register(legifranceConnector);

    expect(registry.listCapabilities('legifrance')).toEqual([
      'legifrance.ping',
      'legifrance.get_article',
      'legifrance.search',
    ]);

    const client = new LegifranceHttpClient({
      config: createLegifranceConfig('sandbox'),
      accessTokenProvider: new FakeAccessTokenProvider(),
      fetchFn: vi.fn(),
    });
    const tools = registry.get('legifrance').createTools(client);
    expect(tools.map((tool) => tool.name)).toEqual([
      'legifrance.ping',
      'legifrance.get_article',
      'legifrance.search',
    ]);
  });

  it('bout-en-bout : ConnectorRegistry → ToolRegistry → PermissionManager → ToolExecutor exécute legifrance.get_article', async () => {
    const connectorRegistry = new ConnectorRegistry();
    connectorRegistry.register(legifranceConnector);

    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        article: { id: 'LEGIARTI000006307920', idTexte: null, type: 'AUTONOME', texte: 'Contenu.' },
      }),
    );
    const client = new LegifranceHttpClient({
      config: createLegifranceConfig('sandbox'),
      accessTokenProvider: new FakeAccessTokenProvider(),
      fetchFn,
    });

    const connector = connectorRegistry.get('legifrance');
    const toolRegistry = new ToolRegistry();
    for (const tool of connector.createTools(client)) toolRegistry.register(tool);

    const executor = new ToolExecutor(toolRegistry, new PermissionManager({ default: 'allow' }));
    const result = await executor.run({
      tool: 'legifrance.get_article',
      input: { id: 'LEGIARTI000006307920' },
    });

    expect(result.status).toBe('executed');
    // Vérifie le wiring bout-en-bout (Registry → ToolExecutor → mapping), pas
    // l'exhaustivité du mapping lui-même (couverte par legifrance-connector.test.ts).
    if (result.status === 'executed') {
      expect(result.output).toMatchObject({
        id: 'LEGIARTI000006307920',
        type: 'AUTONOME',
        texte: 'Contenu.',
      });
    }
  });

  it('ConnectorRegistry ne prend aucune décision d’autorisation : une politique deny refuse même une Tool READ', async () => {
    const connectorRegistry = new ConnectorRegistry();
    connectorRegistry.register(legifranceConnector);

    const client = new LegifranceHttpClient({
      config: createLegifranceConfig('sandbox'),
      accessTokenProvider: new FakeAccessTokenProvider(),
      fetchFn: vi.fn(),
    });
    const toolRegistry = new ToolRegistry();
    for (const tool of connectorRegistry.get('legifrance').createTools(client))
      toolRegistry.register(tool);

    const executor = new ToolExecutor(toolRegistry, new PermissionManager({ default: 'deny' }));
    const result = await executor.run({ tool: 'legifrance.ping', input: {} });

    expect(result.status).toBe('denied');
  });
});
