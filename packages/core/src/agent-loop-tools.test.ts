import { describe, expect, it } from 'vitest';

import { AgentLoop } from './agent-loop.js';
import { PermissionManager } from './permissions.js';
import { type ActionLevel, type Tool, type ToolValidationResult, invalid, valid } from './tool.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';

/**
 * Provider de test : rejoue un script de réponses (la dernière est répétée si le
 * script est épuisé). Aucun réseau.
 */
class ScriptedLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  private index = 0;
  private readonly script: readonly LlmResponse[];

  constructor(script: LlmResponse | readonly LlmResponse[]) {
    this.script = Array.isArray(script) ? script : [script as LlmResponse];
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const response = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return response;
  }
}

interface CounterInput {
  readonly n: number;
}

/** Outil de test qui compte ses exécutions réelles. */
class CountingTool implements Tool<CounterInput, { doubled: number }> {
  public executeCount = 0;
  readonly description = 'compteur de test';

  constructor(
    readonly name = 'demo.counter',
    readonly action: ActionLevel = 'execute',
  ) {}

  validateInput(input: unknown): ToolValidationResult<CounterInput> {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as Record<string, unknown>).n !== 'number'
    ) {
      return invalid('demo.counter : { n: number } attendu.');
    }
    return valid({ n: (input as { n: number }).n });
  }

  async execute(input: CounterInput): Promise<{ doubled: number }> {
    this.executeCount += 1;
    return { doubled: input.n * 2 };
  }
}

/** Outil dont l'exécution lève toujours (erreur technique, pas un refus). */
class ThrowingTool implements Tool<{ n: number }, { doubled: number }> {
  public executeCount = 0;
  readonly name = 'demo.thrower';
  readonly description = 'lève toujours';
  readonly action: ActionLevel = 'execute';

  validateInput(input: unknown): ToolValidationResult<{ n: number }> {
    if (
      typeof input === 'object' &&
      input !== null &&
      typeof (input as Record<string, unknown>).n === 'number'
    ) {
      return valid({ n: (input as { n: number }).n });
    }
    return invalid('demo.thrower : { n: number } attendu.');
  }

  async execute(): Promise<{ doubled: number }> {
    this.executeCount += 1;
    throw new Error('panne interne simulée');
  }
}

function buildAgent(options: {
  llm: LlmProvider;
  tool?: Tool;
  decision?: 'allow' | 'deny' | 'require_confirmation';
  maxIterations?: number;
  withExecutor?: boolean;
}) {
  const registry = new ToolRegistry();
  const tool = options.tool ?? new CountingTool();
  registry.register(tool);
  const permissions = new PermissionManager(
    options.decision ? { rules: { [tool.name]: options.decision } } : {},
  );
  const executor = new ToolExecutor(registry, permissions);
  const agent = new AgentLoop(options.llm, {
    toolExecutor: options.withExecutor === false ? undefined : executor,
    maxIterations: options.maxIterations,
  });
  return { agent, tool, executor };
}

const CALL = (tool: string, input: unknown): LlmResponse => ({ content: '', toolCall: { tool, input } });

describe('AgentLoop + ToolExecutor', () => {
  it('sans ToolExecutor : comportement historique inchangé', async () => {
    const llm = new ScriptedLlmProvider({ content: 'Bonjour !' });
    const agent = new AgentLoop(llm);

    expect(await agent.process('Salut')).toBe('Bonjour !');

    const result = await agent.run('Salut');
    expect(result).toMatchObject({ stopReason: 'llm_final', iterations: 1, toolOutcomes: [] });
  });

  it('avec ToolExecutor mais réponse LLM normale : aucun outil exécuté', async () => {
    const llm = new ScriptedLlmProvider({ content: 'Réponse simple, aucun outil.' });
    const { agent, tool } = buildAgent({ llm, decision: 'allow' });

    const result = await agent.run('Bonjour');

    expect(result.stopReason).toBe('llm_final');
    expect(result.toolOutcomes).toEqual([]);
    expect((tool as CountingTool).executeCount).toBe(0);
  });

  it('demande d’outil simulée : le ToolExecutor est bien sollicité', async () => {
    const llm = new ScriptedLlmProvider([CALL('demo.counter', { n: 2 }), { content: 'Terminé.' }]);
    const { agent, executor } = buildAgent({ llm, decision: 'allow' });
    let executorCalls = 0;
    const originalRun = executor.run.bind(executor);
    executor.run = async (req) => {
      executorCalls += 1;
      return originalRun(req);
    };

    await agent.run('Double 2');

    expect(executorCalls).toBe(1);
  });

  it('outil autorisé : réellement exécuté, résultat capturé', async () => {
    const llm = new ScriptedLlmProvider([
      CALL('demo.counter', { n: 21 }),
      { content: 'Le double de 21 est 42.' },
    ]);
    const { agent, tool } = buildAgent({ llm, decision: 'allow' });

    const result = await agent.run('Double 21');

    expect((tool as CountingTool).executeCount).toBe(1);
    expect(result.stopReason).toBe('llm_final');
    expect(result.content).toBe('Le double de 21 est 42.');
    expect(result.toolOutcomes).toHaveLength(1);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed', output: { doubled: 42 } });
  });

  it('outil refusé : non exécuté (compteur inchangé)', async () => {
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'deny' });

    const result = await agent.run('Vas-y');

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'denied' });
  });

  it('confirmation requise sans confirmation : non exécuté', async () => {
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'require_confirmation' });

    const result = await agent.run('Vas-y');

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({
      status: 'awaiting_confirmation',
      toolName: 'demo.counter',
      action: 'execute',
    });
  });

  it('confirmation accordée (confirmedTools) : outil exécuté', async () => {
    const llm = new ScriptedLlmProvider([CALL('demo.counter', { n: 4 }), { content: 'Fait.' }]);
    const { agent, tool } = buildAgent({ llm, decision: 'require_confirmation' });

    const result = await agent.run('Vas-y', { confirmedTools: ['demo.counter'] });

    expect((tool as CountingTool).executeCount).toBe(1);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed', output: { doubled: 8 } });
    expect(result.stopReason).toBe('llm_final');
  });

  it('outil inconnu : aucune exécution', async () => {
    const llm = new ScriptedLlmProvider(CALL('outil.absent', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'allow' });

    const result = await agent.run('Vas-y');

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'unknown_tool' });
  });

  it('entrée invalide : aucune exécution', async () => {
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 'pas un nombre' }));
    const { agent, tool } = buildAgent({ llm, decision: 'allow' });

    const result = await agent.run('Vas-y');

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'invalid_input' });
  });

  it('limite d’itérations respectée : la boucle ne tourne pas indéfiniment', async () => {
    // Le modèle redemande *toujours* le même outil autorisé.
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'allow', maxIterations: 3 });

    const result = await agent.run('Boucle');

    expect(result.stopReason).toBe('max_iterations');
    expect(result.iterations).toBe(3);
    expect(llm.calls).toHaveLength(3);
    expect((tool as CountingTool).executeCount).toBe(3);
    expect(result.toolOutcomes).toHaveLength(3);
  });

  it('rejette une configuration maxIterations invalide', () => {
    const llm = new ScriptedLlmProvider({ content: 'x' });
    expect(() => new AgentLoop(llm, { maxIterations: 0 })).toThrow(/maxIterations/);
    expect(() => new AgentLoop(llm, { maxIterations: 1.5 })).toThrow(/maxIterations/);
  });

  // ── Invariants de sécurité ────────────────────────────────────────────────

  it('une confirmation ne vaut QUE pour l’outil nommé (autre outil → toujours bloqué)', async () => {
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'require_confirmation' });

    // On confirme un AUTRE outil : demo.counter reste en attente.
    const result = await agent.run('Vas-y', { confirmedTools: ['un.autre.outil'] });

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'awaiting_confirmation' });
  });

  it('confirmation ciblée : l’outil confirmé s’exécute, un autre outil require_confirmation reste bloqué', async () => {
    const confirmed = new CountingTool('demo.confirmed', 'execute');
    const other = new CountingTool('demo.other', 'execute');
    const registry = new ToolRegistry();
    registry.register(confirmed);
    registry.register(other);
    const permissions = new PermissionManager({
      rules: { 'demo.confirmed': 'require_confirmation', 'demo.other': 'require_confirmation' },
    });
    const executor = new ToolExecutor(registry, permissions);
    const llm = new ScriptedLlmProvider([
      CALL('demo.confirmed', { n: 2 }),
      CALL('demo.other', { n: 3 }),
      { content: 'jamais atteint' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Vas-y', { confirmedTools: ['demo.confirmed'] });

    expect(confirmed.executeCount).toBe(1);
    expect(other.executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes).toHaveLength(2);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed' });
    expect(result.toolOutcomes[1]).toMatchObject({ status: 'awaiting_confirmation' });
  });

  it('erreur technique d’un outil : jamais convertie en succès, la boucle s’arrête', async () => {
    const thrower = new ThrowingTool();
    const registry = new ToolRegistry();
    registry.register(thrower);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'demo.thrower': 'allow' } }),
    );
    const llm = new ScriptedLlmProvider(CALL('demo.thrower', { n: 1 }));
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Vas-y');

    expect(result.stopReason).toBe('tool_blocked');
    expect(result.iterations).toBe(1);
    expect(result.toolOutcomes).toHaveLength(1);
    expect(result.toolOutcomes[0].status).toBe('error');
    expect(result.toolOutcomes[0].status).not.toBe('executed');
  });

  it('un outil refusé n’est jamais exécuté même si le modèle insiste (boucle)', async () => {
    // Le modèle redemande sans cesse un outil refusé.
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const { agent, tool } = buildAgent({ llm, decision: 'deny', maxIterations: 5 });

    const result = await agent.run('Insiste');

    expect((tool as CountingTool).executeCount).toBe(0);
    expect(result.stopReason).toBe('tool_blocked');
    expect(result.iterations).toBe(1);
  });
});
