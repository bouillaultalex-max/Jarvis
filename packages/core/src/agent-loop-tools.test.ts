import { describe, expect, it } from 'vitest';

import { AgentLoop } from './agent-loop.js';
import { PermissionManager } from './permissions.js';
import { type ActionLevel, type Tool, type ToolValidationResult, invalid, valid } from './tool.js';
import { ToolExecutor, type ToolExecutionResult, type ToolRequest } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import type {
  LlmAssistantToolCallMessage,
  LlmChatOptions,
  LlmConversationMessage,
  LlmProvider,
  LlmResponse,
  LlmToolResultMessage,
} from '@jarvis/llm';

/**
 * Provider de test : rejoue un script de réponses (la dernière est répétée si le
 * script est épuisé). Aucun réseau. Enregistre les **messages** et les
 * **options** (`tools`) réellement reçus à chaque appel.
 */
class ScriptedLlmProvider implements LlmProvider {
  public readonly calls: LlmConversationMessage[][] = [];
  public readonly optionsCalls: Array<LlmChatOptions | undefined> = [];
  private index = 0;
  private readonly script: readonly LlmResponse[];

  constructor(script: LlmResponse | readonly LlmResponse[]) {
    this.script = Array.isArray(script) ? script : [script as LlmResponse];
  }

  async chat(messages: LlmConversationMessage[], options?: LlmChatOptions): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    this.optionsCalls.push(options);
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
  readonly inputSchema = {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
  };

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
  readonly inputSchema = {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
  };

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

const CALL = (tool: string, input: unknown): LlmResponse => ({
  content: '',
  toolCall: { id: 'call-1', tool, input },
});

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

/** Registre + executor pour N Tools nommés, tous en politique `allow`. */
function executorWith(...toolNames: string[]): { executor: ToolExecutor; tools: CountingTool[] } {
  const registry = new ToolRegistry();
  const tools = toolNames.map((name) => new CountingTool(name, 'execute'));
  for (const tool of tools) {
    registry.register(tool);
  }
  const rules = Object.fromEntries(toolNames.map((n) => [n, 'allow' as const]));
  return { executor: new ToolExecutor(registry, new PermissionManager({ rules })), tools };
}

describe('AgentLoop → ToolExecutor → LLM : transmission des définitions de Tools', () => {
  it('TEST A — sans ToolExecutor : provider.chat ne reçoit aucune définition de tool', async () => {
    const llm = new ScriptedLlmProvider({ content: 'Bonjour.' });
    const agent = new AgentLoop(llm);

    await agent.run('Salut');

    expect(llm.optionsCalls).toEqual([undefined]);
  });

  it('TEST B — un Tool : provider.chat reçoit { name, description, inputSchema }', async () => {
    const { executor, tools } = executorWith('demo.counter');
    const llm = new ScriptedLlmProvider({ content: 'ok' });
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Salut');

    expect(llm.optionsCalls[0]).toEqual({
      tools: [
        {
          name: 'demo.counter',
          description: tools[0]!.description,
          inputSchema: tools[0]!.inputSchema,
        },
      ],
    });
    // inputSchema est recopié tel quel, jamais reconstruit.
    expect(llm.optionsCalls[0]!.tools![0]!.inputSchema).toBe(tools[0]!.inputSchema);
  });

  it('TEST C — plusieurs Tools : toutes les définitions, dans l’ordre du registry', async () => {
    const { executor } = executorWith('demo.alpha', 'demo.beta', 'demo.gamma');
    const llm = new ScriptedLlmProvider({ content: 'ok' });
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Salut');

    expect(llm.optionsCalls[0]!.tools!.map((t) => t.name)).toEqual([
      'demo.alpha',
      'demo.beta',
      'demo.gamma',
    ]);
  });

  it('TEST D — toolCall du provider : l’outil n’est exécuté que via ToolExecutor', async () => {
    const { executor, tools } = executorWith('demo.counter');
    let executorRunCalls = 0;
    const originalRun = executor.run.bind(executor);
    executor.run = async (req) => {
      executorRunCalls += 1;
      return originalRun(req);
    };
    const llm = new ScriptedLlmProvider([CALL('demo.counter', { n: 3 }), { content: 'Fait.' }]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Double 3');

    expect(executorRunCalls).toBe(1);
    expect(tools[0]!.executeCount).toBe(1);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed', output: { doubled: 6 } });
  });

  it('TEST E — après exécution : le prochain appel provider contient assistant{toolCall} puis role:tool', async () => {
    const { executor } = executorWith('demo.counter');
    const llm = new ScriptedLlmProvider([CALL('demo.counter', { n: 21 }), { content: 'Fini.' }]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Double 21');

    expect(llm.calls).toHaveLength(2);
    const secondCall = llm.calls[1]!;
    expect(secondCall[0]).toEqual({ role: 'user', content: 'Double 21' });
    expect(secondCall[1]).toEqual({
      role: 'assistant',
      content: '',
      toolCall: { id: 'call-1', tool: 'demo.counter', input: { n: 21 } },
    });
    expect(secondCall[2]).toEqual({
      role: 'tool',
      toolCallId: 'call-1',
      content: JSON.stringify({ doubled: 42 }),
    });
    // Jamais l'ancien format texte.
    expect(JSON.stringify(secondCall)).not.toContain("Résultat de l'outil");
  });

  it('TEST F — outil bloqué (deny) : aucun second appel LLM, stopReason tool_blocked inchangé', async () => {
    const registry = new ToolRegistry();
    const tool = new CountingTool('demo.counter', 'execute');
    registry.register(tool);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'demo.counter': 'deny' } }),
    );
    const llm = new ScriptedLlmProvider([CALL('demo.counter', { n: 1 }), { content: 'jamais' }]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Vas-y');

    expect(result.stopReason).toBe('tool_blocked');
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'denied' });
    expect(tool.executeCount).toBe(0);
    // Politique inchangée : un outcome non exécuté arrête la boucle, pas de
    // second appel provider.
    expect(llm.calls).toHaveLength(1);
  });

  it('TEST G — ToolExecutor avec registre vide : aucun tools envoyé au provider', async () => {
    const executor = new ToolExecutor(new ToolRegistry(), new PermissionManager());
    const llm = new ScriptedLlmProvider({ content: 'ok' });
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Salut');

    expect(llm.optionsCalls).toEqual([undefined]);
  });

  it('TEST H — maxIterations respecté, avec les tools transmis à chaque appel', async () => {
    const { executor } = executorWith('demo.counter');
    // Le modèle redemande toujours le même outil autorisé.
    const llm = new ScriptedLlmProvider(CALL('demo.counter', { n: 1 }));
    const agent = new AgentLoop(llm, { toolExecutor: executor, maxIterations: 3 });

    const result = await agent.run('Boucle');

    expect(result.stopReason).toBe('max_iterations');
    expect(result.iterations).toBe(3);
    expect(llm.calls).toHaveLength(3);
    for (const opt of llm.optionsCalls) {
      expect(opt?.tools).toHaveLength(1);
    }
  });

  it('toolCall sans id (provider non typé) : arrêt explicite, l’outil n’est jamais exécuté', async () => {
    const { executor, tools } = executorWith('demo.counter');
    const broken = {
      content: '',
      toolCall: { tool: 'demo.counter', input: { n: 1 } },
    } as unknown as LlmResponse;
    const llm = new ScriptedLlmProvider(broken);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await expect(agent.run('Vas-y')).rejects.toThrow(/sans « id »/);
    expect(tools[0]!.executeCount).toBe(0);
  });
});

/**
 * Durcissement du cycle tool-use séquentiel — le cycle est déjà implémenté
 * (voir bloc précédent) ; ces tests garantissent explicitement le
 * comportement multi-tool, la corrélation `id`, la borne `maxIterations` et
 * l'absence de couplage à un provider concret.
 */
describe('AgentLoop — cycle tool-use séquentiel (durcissement)', () => {
  it('A — réponse directe du LLM (tools disponibles) : un seul appel LLM, aucun outil', async () => {
    const { executor, tools } = executorWith('demo.counter');
    const llm = new ScriptedLlmProvider({ content: 'Voici la réponse.' });
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Question');

    expect(llm.calls).toHaveLength(1);
    expect(result).toMatchObject({ stopReason: 'llm_final', iterations: 1, toolOutcomes: [] });
    expect(result.content).toBe('Voici la réponse.');
    expect(tools[0]!.executeCount).toBe(0);
    // Les tools sont bien proposés dès le 1er appel même s'ils ne servent pas.
    expect(llm.optionsCalls[0]?.tools).toHaveLength(1);
  });

  it('C — corrélation : assistant.toolCall.id === tool.toolCallId (id distinctif, non « call-1 »)', async () => {
    const { executor } = executorWith('demo.counter');
    const CORR_ID = 'toolu_correlation_9f2c';
    const llm = new ScriptedLlmProvider([
      { content: 'je calcule', toolCall: { id: CORR_ID, tool: 'demo.counter', input: { n: 4 } } },
      { content: 'fini' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Double 4');

    const secondCall = llm.calls[1]!;
    const assistantMsg = secondCall[1] as LlmAssistantToolCallMessage;
    const toolMsg = secondCall[2] as LlmToolResultMessage;

    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.toolCall.id).toBe(CORR_ID);
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.toolCallId).toBe(CORR_ID);
    expect(assistantMsg.toolCall.id).toBe(toolMsg.toolCallId);
    // Résultat sérialisé de façon déterministe.
    expect(toolMsg.content).toBe(JSON.stringify({ doubled: 8 }));
  });

  it('D — deux tool-calls successifs (A puis B) → réponse finale', async () => {
    const { executor, tools } = executorWith('demo.a', 'demo.b');
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 'id-a', tool: 'demo.a', input: { n: 1 } } },
      { content: '', toolCall: { id: 'id-b', tool: 'demo.b', input: { n: 10 } } },
      { content: 'Terminé.' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Enchaîne A puis B');

    expect(result.stopReason).toBe('llm_final');
    expect(result.iterations).toBe(3);
    expect(result.content).toBe('Terminé.');
    expect(llm.calls).toHaveLength(3);

    // Chaque outil a été exécuté exactement une fois, dans l'ordre.
    expect(tools[0]!.executeCount).toBe(1); // demo.a
    expect(tools[1]!.executeCount).toBe(1); // demo.b
    expect(result.toolOutcomes).toHaveLength(2);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed', output: { doubled: 2 } });
    expect(result.toolOutcomes[1]).toMatchObject({ status: 'executed', output: { doubled: 20 } });

    // Le 3e appel LLM porte l'historique complet : user, (assistant+A, tool A), (assistant+B, tool B).
    const thirdCall = llm.calls[2]!;
    expect(thirdCall).toHaveLength(5);
    expect(thirdCall[1]).toMatchObject({
      role: 'assistant',
      toolCall: { id: 'id-a', tool: 'demo.a' },
    });
    expect(thirdCall[2]).toMatchObject({ role: 'tool', toolCallId: 'id-a' });
    expect(thirdCall[3]).toMatchObject({
      role: 'assistant',
      toolCall: { id: 'id-b', tool: 'demo.b' },
    });
    expect(thirdCall[4]).toMatchObject({ role: 'tool', toolCallId: 'id-b' });

    // Tools proposés à chaque appel.
    for (const opt of llm.optionsCalls) {
      expect(opt?.tools?.map((t) => t.name)).toEqual(['demo.a', 'demo.b']);
    }
  });

  it('E — maxIterations borne une séquence de tools DIFFÉRENTS continus', async () => {
    const { executor, tools } = executorWith('demo.a', 'demo.b');
    // Le modèle demande sans cesse un outil (jamais de réponse finale).
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 'id-a', tool: 'demo.a', input: { n: 1 } } },
      { content: '', toolCall: { id: 'id-b', tool: 'demo.b', input: { n: 1 } } },
      { content: '', toolCall: { id: 'id-a2', tool: 'demo.a', input: { n: 1 } } },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor, maxIterations: 2 });

    const result = await agent.run('Boucle infinie potentielle');

    expect(result.stopReason).toBe('max_iterations');
    expect(result.iterations).toBe(2);
    expect(llm.calls).toHaveLength(2);
    // Exactement maxIterations exécutions — jamais une de plus.
    expect(tools[0]!.executeCount).toBe(1);
    expect(tools[1]!.executeCount).toBe(1);
    expect(result.toolOutcomes).toHaveLength(2);
  });

  it('G — erreur d’exécution : outcome « error », boucle stoppée, aucun 2e appel LLM', async () => {
    const thrower = new ThrowingTool();
    const registry = new ToolRegistry();
    registry.register(thrower);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'demo.thrower': 'allow' } }),
    );
    const llm = new ScriptedLlmProvider([
      CALL('demo.thrower', { n: 1 }),
      { content: 'jamais atteint' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Vas-y');

    expect(result.stopReason).toBe('tool_blocked');
    expect(result.iterations).toBe(1);
    expect(llm.calls).toHaveLength(1);
    expect(result.toolOutcomes).toHaveLength(1);
    expect(result.toolOutcomes[0].status).toBe('error');
    expect(result.toolOutcomes[0].status).not.toBe('executed');
    // AgentLoop ne relaie jamais un objet/exception brut : c'est ToolExecutor qui
    // a formaté l'erreur (`reason: string`).
    if (result.toolOutcomes[0].status === 'error') {
      expect(typeof result.toolOutcomes[0].reason).toBe('string');
    }
  });

  it('I — chaque LlmToolDefinition transmise = exactement { name, description, inputSchema }', async () => {
    const { executor, tools } = executorWith('demo.a', 'demo.b', 'demo.c');
    const llm = new ScriptedLlmProvider({ content: 'ok' });
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    await agent.run('Salut');

    const sent = llm.optionsCalls[0]!.tools!;
    expect(sent).toHaveLength(3);
    sent.forEach((def, i) => {
      expect(Object.keys(def).sort()).toEqual(['description', 'inputSchema', 'name']);
      expect(def.name).toBe(tools[i]!.name);
      expect(def.description).toBe(tools[i]!.description);
      // Recopié tel quel, jamais reconstruit.
      expect(def.inputSchema).toBe(tools[i]!.inputSchema);
      expect(def.inputSchema.type).toBe('object');
    });
  });

  it('J — aucun couplage à un provider concret : le cycle fonctionne avec un LlmProvider minimal', async () => {
    // Provider maison, sans aucun rapport avec Anthropic : n'implémente que
    // `chat`, ignore même les messages. Prouve qu'AgentLoop ne dépend que de
    // l'interface LlmProvider.
    class MinimalProvider implements LlmProvider {
      private i = 0;
      constructor(private readonly script: readonly LlmResponse[]) {}
      async chat(): Promise<LlmResponse> {
        return this.script[Math.min(this.i++, this.script.length - 1)]!;
      }
    }

    const { executor, tools } = executorWith('demo.counter');
    const provider = new MinimalProvider([
      { content: '', toolCall: { id: 'm1', tool: 'demo.counter', input: { n: 3 } } },
      { content: 'résultat : 6' },
    ]);
    const agent = new AgentLoop(provider, { toolExecutor: executor });

    const result = await agent.run('Double 3');

    expect(result.stopReason).toBe('llm_final');
    expect(result.content).toBe('résultat : 6');
    expect(tools[0]!.executeCount).toBe(1);
    expect(result.toolOutcomes[0]).toMatchObject({ status: 'executed', output: { doubled: 6 } });
  });
});

/**
 * Faux `ToolExecutor` : n'exécute aucun vrai outil, rejoue des outcomes
 * scriptés et enregistre chaque `ToolRequest` reçu.
 *
 * Le contrat `ToolExecutor` est une **classe concrète** (pas une interface) —
 * on l'étend donc plutôt que de l'implémenter. `super(...)` reçoit des
 * dépendances jamais utilisées : `run`/`listTools` sont intégralement
 * surchargés. Prouve qu'`AgentLoop` ne consomme que ces deux méthodes
 * publiques, sans toucher aux internes.
 */
class FakeToolExecutor extends ToolExecutor {
  public readonly requests: ToolRequest[] = [];
  private readonly toolDefs: readonly Tool[];
  private readonly outcomes: readonly ToolExecutionResult[];
  private outcomeIndex = 0;

  constructor(toolDefs: readonly Tool[], outcomes: readonly ToolExecutionResult[]) {
    super(new ToolRegistry(), new PermissionManager());
    this.toolDefs = toolDefs;
    this.outcomes = outcomes;
  }

  override listTools(): readonly Tool[] {
    return this.toolDefs;
  }

  override async run(request: ToolRequest): Promise<ToolExecutionResult> {
    this.requests.push(request);
    const outcome = this.outcomes[Math.min(this.outcomeIndex, this.outcomes.length - 1)];
    this.outcomeIndex += 1;
    if (outcome === undefined) {
      throw new Error('FakeToolExecutor : aucun outcome scripté.');
    }
    return outcome;
  }
}

/** `Tool` minimal typé pour les scénarios (aucun effet de bord, exécution triviale). */
function stubTool<TIn, TOut>(config: {
  readonly name: string;
  readonly action: ActionLevel;
  readonly inputSchema: Record<string, unknown>;
  readonly validate: (input: unknown) => ToolValidationResult<TIn>;
  readonly run: (input: TIn) => TOut;
}): Tool<TIn, TOut> {
  return {
    name: config.name,
    description: `stub ${config.name}`,
    action: config.action,
    inputSchema: config.inputSchema,
    validateInput: config.validate,
    execute: async (input) => config.run(input),
  };
}

describe('AgentLoop — robustesse orchestration (fake ToolExecutor + scénario réaliste)', () => {
  const EXECUTED = (output: unknown): ToolExecutionResult => ({
    status: 'executed',
    decision: 'allow',
    output,
  });

  it('2 — les 5 outcomes non-executed : run() résout (jamais rejette), tool_blocked, outcome conservé, 1 seul appel LLM', async () => {
    const failures: readonly ToolExecutionResult[] = [
      { status: 'unknown_tool', reason: 'inconnu' },
      { status: 'invalid_input', reason: 'entrée invalide' },
      { status: 'denied', decision: 'deny', reason: 'refusé' },
      {
        status: 'awaiting_confirmation',
        decision: 'require_confirmation',
        toolName: 'demo.x',
        action: 'execute',
        input: {},
        reason: 'confirmation requise',
      },
      { status: 'error', reason: 'exception simulée' },
    ];

    for (const failure of failures) {
      const fakeExec = new FakeToolExecutor([], [failure]);
      const llm = new ScriptedLlmProvider([
        { content: '', toolCall: { id: 'f1', tool: 'demo.x', input: {} } },
        { content: 'jamais atteint' },
      ]);
      const agent = new AgentLoop(llm, { toolExecutor: fakeExec });

      // Doit RÉSOUDRE, jamais rejeter.
      const result = await agent.run('go');

      expect(result.stopReason).toBe('tool_blocked');
      expect(result.iterations).toBe(1);
      expect(result.toolOutcomes).toEqual([failure]);
      expect(llm.calls).toHaveLength(1);
      expect(fakeExec.requests).toHaveLength(1);
    }
  });

  it('4 — corrélation stricte multi-tool : chaque assistant.toolCall.id === tool.toolCallId (ids distincts)', async () => {
    const { executor } = executorWith('demo.a', 'demo.b', 'demo.c');
    const ids = ['id_alpha_1', 'id_bravo_2', 'id_charlie_3'] as const;
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: ids[0], tool: 'demo.a', input: { n: 1 } } },
      { content: '', toolCall: { id: ids[1], tool: 'demo.b', input: { n: 2 } } },
      { content: '', toolCall: { id: ids[2], tool: 'demo.c', input: { n: 3 } } },
      { content: 'fini' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('trois outils');

    expect(result.stopReason).toBe('llm_final');
    expect(result.iterations).toBe(4);
    expect(new Set(ids).size).toBe(3); // ids réellement distincts

    // 4e appel LLM : [user, aA, tA, aB, tB, aC, tC]
    const finalMessages = llm.calls[3]!;
    expect(finalMessages).toHaveLength(7);
    for (let i = 0; i < 3; i += 1) {
      const assistantMsg = finalMessages[1 + i * 2] as LlmAssistantToolCallMessage;
      const toolMsg = finalMessages[2 + i * 2] as LlmToolResultMessage;
      expect(assistantMsg.role).toBe('assistant');
      expect(toolMsg.role).toBe('tool');
      expect(assistantMsg.toolCall.id).toBe(ids[i]);
      expect(toolMsg.toolCallId).toBe(ids[i]);
      expect(assistantMsg.toolCall.id).toBe(toolMsg.toolCallId); // l'invariant de corrélation
    }
  });

  it('8 — ToolExecutor.run reçoit exactement { tool, input, confirmed } (confirmed reflète confirmedTools)', async () => {
    const fakeExec = new FakeToolExecutor([], [EXECUTED({ ok: true })]);
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 't1', tool: 'demo.x', input: { a: 1, b: 'deux' } } },
      { content: 'fini' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: fakeExec });

    await agent.run('go', { confirmedTools: ['demo.x'] });

    expect(fakeExec.requests).toEqual([
      { tool: 'demo.x', input: { a: 1, b: 'deux' }, confirmed: true },
    ]);

    // Sans confirmedTools → confirmed: false
    const fakeExec2 = new FakeToolExecutor([], [EXECUTED({ ok: true })]);
    const llm2 = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 't2', tool: 'demo.y', input: {} } },
      { content: 'fini' },
    ]);
    await new AgentLoop(llm2, { toolExecutor: fakeExec2 }).run('go');
    expect(fakeExec2.requests).toEqual([{ tool: 'demo.y', input: {}, confirmed: false }]);
  });

  it('8 — AgentLoop fonctionne contre un ToolExecutor entièrement scripté (aucun vrai outil, aucun réseau)', async () => {
    const toolDef = stubTool({
      name: 'demo.scripted',
      action: 'read',
      inputSchema: { type: 'object', properties: {}, required: [] },
      validate: (i) => valid(i),
      run: () => ({ unused: true }),
    });
    const fakeExec = new FakeToolExecutor(
      [toolDef],
      [EXECUTED({ answer: 42 }), EXECUTED({ answer: 43 })],
    );
    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 's1', tool: 'demo.scripted', input: { q: 'a' } } },
      { content: '', toolCall: { id: 's2', tool: 'demo.scripted', input: { q: 'b' } } },
      { content: 'Réponse finale.' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: fakeExec });

    const result = await agent.run('deux appels scriptés');

    expect(result.stopReason).toBe('llm_final');
    expect(result.content).toBe('Réponse finale.');
    expect(result.toolOutcomes).toEqual([EXECUTED({ answer: 42 }), EXECUTED({ answer: 43 })]);
    // Les définitions viennent bien de listTools() du fake.
    expect(llm.optionsCalls[0]?.tools?.map((t) => t.name)).toEqual(['demo.scripted']);
    // Le résultat scripté est réinjecté sérialisé.
    expect((llm.calls[2]![2] as LlmToolResultMessage).content).toBe(JSON.stringify({ answer: 42 }));
  });

  it('9 — scénario réaliste : gmail.read → gmail.prepare_reply → réponse finale (outils simulés, Gmail non modifié)', async () => {
    // Faux outils mimant le contrat réel des Tools Gmail. Aucune dépendance à
    // `@jarvis/connectors` (interdit ici + frontière entre packages).
    const gmailRead = stubTool<
      { maxResults?: number },
      { messages: ReadonlyArray<Record<string, unknown>> }
    >({
      name: 'gmail.read',
      action: 'read',
      inputSchema: {
        type: 'object',
        properties: { maxResults: { type: 'integer', minimum: 1, maximum: 50 } },
        required: [],
      },
      validate: (input) => {
        const o = (input ?? {}) as Record<string, unknown>;
        return valid({ maxResults: typeof o.maxResults === 'number' ? o.maxResults : undefined });
      },
      run: () => ({
        messages: [
          {
            id: 'm1',
            sender: 'boss@example.test',
            subject: 'Budget Q3',
            body: 'Peux-tu valider ?',
          },
        ],
      }),
    });
    const gmailPrepareReply = stubTool<
      { messageId: string; body: string },
      Record<string, unknown>
    >({
      name: 'gmail.prepare_reply',
      action: 'prepare',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', minLength: 1 },
          body: { type: 'string', minLength: 1 },
        },
        required: ['messageId', 'body'],
      },
      validate: (input) => {
        const o = (input ?? {}) as Record<string, unknown>;
        if (
          typeof o.messageId === 'string' &&
          o.messageId.length > 0 &&
          typeof o.body === 'string' &&
          o.body.length > 0
        ) {
          return valid({ messageId: o.messageId, body: o.body });
        }
        return invalid('gmail.prepare_reply (fake) : messageId + body requis.');
      },
      run: (input) => ({
        to: 'boss@example.test',
        subject: 'Re: Budget Q3',
        threadId: 'thread-m1',
        body: input.body,
      }),
    });

    const registry = new ToolRegistry();
    registry.register(gmailRead);
    registry.register(gmailPrepareReply);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'gmail.read': 'allow', 'gmail.prepare_reply': 'allow' } }),
    );

    const llm = new ScriptedLlmProvider([
      { content: '', toolCall: { id: 'tu_read', tool: 'gmail.read', input: { maxResults: 5 } } },
      {
        content: '',
        toolCall: {
          id: 'tu_prep',
          tool: 'gmail.prepare_reply',
          input: { messageId: 'm1', body: 'Vu, je valide demain matin.' },
        },
      },
      { content: 'Brouillon prêt pour l’email de boss@example.test.' },
    ]);
    const agent = new AgentLoop(llm, { toolExecutor: executor });

    const result = await agent.run('Lis mes mails et prépare une réponse au plus important');

    expect(result.stopReason).toBe('llm_final');
    expect(result.iterations).toBe(3);
    expect(result.content).toBe('Brouillon prêt pour l’email de boss@example.test.');
    expect(result.toolOutcomes.map((o) => o.status)).toEqual(['executed', 'executed']);

    // Les deux outils sont proposés au LLM avec leur inputSchema, dans l'ordre.
    expect(llm.optionsCalls[0]?.tools?.map((t) => t.name)).toEqual([
      'gmail.read',
      'gmail.prepare_reply',
    ]);

    // Historique du 3e appel : user, aRead, tRead, aPrep, tPrep
    const finalCall = llm.calls[2]!;
    expect(finalCall).toHaveLength(5);
    expect(finalCall[1]).toMatchObject({
      role: 'assistant',
      toolCall: { id: 'tu_read', tool: 'gmail.read' },
    });
    expect(finalCall[2]).toMatchObject({ role: 'tool', toolCallId: 'tu_read' });
    expect(finalCall[3]).toMatchObject({
      role: 'assistant',
      toolCall: { id: 'tu_prep', tool: 'gmail.prepare_reply' },
    });
    expect(finalCall[4]).toMatchObject({ role: 'tool', toolCallId: 'tu_prep' });

    // Le résultat de gmail.prepare_reply est réinjecté sérialisé (corps repris).
    expect((finalCall[4] as LlmToolResultMessage).content).toContain('Vu, je valide demain matin.');
  });
});
