import { describe, expect, it } from 'vitest';

import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { echoTool } from './echo.js';

function buildExecutor(decision: 'allow' | 'deny' | 'require_confirmation') {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  const permissions = new PermissionManager({ rules: { echo: decision } });
  return new ToolExecutor(registry, permissions);
}

describe('echo — bout en bout (registre → validation → permissions → exécution)', () => {
  it('permission allow → l’outil s’exécute', async () => {
    const result = await buildExecutor('allow').run({ tool: 'echo', input: { text: 'Bonjour' } });

    expect(result).toMatchObject({ status: 'executed', output: { text: 'Bonjour' } });
  });

  it('permission deny → aucune exécution', async () => {
    const result = await buildExecutor('deny').run({ tool: 'echo', input: { text: 'Bonjour' } });

    expect(result.status).toBe('denied');
  });

  it('permission require_confirmation → pas d’exécution sans confirmation', async () => {
    const executor = buildExecutor('require_confirmation');

    const pending = await executor.run({ tool: 'echo', input: { text: 'Bonjour' } });
    expect(pending.status).toBe('awaiting_confirmation');

    const confirmed = await executor.run({
      tool: 'echo',
      input: { text: 'Bonjour' },
      confirmed: true,
    });
    expect(confirmed).toMatchObject({ status: 'executed', output: { text: 'Bonjour' } });
  });

  it('entrée invalide → refus avant permissions', async () => {
    const result = await buildExecutor('allow').run({ tool: 'echo', input: { text: 123 } });

    expect(result.status).toBe('invalid_input');
  });
});
