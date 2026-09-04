import { describe, expect, it } from 'vitest';

import { AgentLoop, PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/core';

import { echoTool } from './echo.js';

/** Provider de test qui rejoue un script fixe. Aucun réseau. */
class ScriptedLlmProvider implements LlmProvider {
  private index = 0;
  constructor(private readonly script: readonly LlmResponse[]) {}
  async chat(_messages: LlmMessage[]): Promise<LlmResponse> {
    const response = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return response;
  }
}

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

  it('bout en bout via AgentLoop : LLM → echo → LLM → réponse finale', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { echo: 'allow' } }),
    );
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { tool: 'echo', input: { text: 'Salut' } } },
      { content: 'L’outil echo a répondu « Salut ».' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Fais un echo de Salut');

    expect(result.stopReason).toBe('llm_final');
    expect(result.content).toBe('L’outil echo a répondu « Salut ».');
    expect(result.toolOutcomes).toHaveLength(1);
    expect(result.toolOutcomes[0]).toMatchObject({
      status: 'executed',
      output: { text: 'Salut' },
    });
  });
});
