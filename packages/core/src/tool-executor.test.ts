import { describe, expect, it } from 'vitest';

import { type ActionLevel, type Tool, type ToolValidationResult, invalid, valid } from './tool.js';
import { PermissionManager } from './permissions.js';
import { ToolRegistry } from './tool-registry.js';
import { ToolExecutor } from './tool-executor.js';

interface CounterInput {
  readonly n: number;
}

/** Outil de test qui compte ses exécutions réelles. */
class CountingTool implements Tool<CounterInput, { doubled: number }> {
  public executeCount = 0;
  readonly description = 'compteur de test';

  constructor(
    readonly name = 'test.counter',
    readonly action: ActionLevel = 'execute',
  ) {}

  validateInput(input: unknown): ToolValidationResult<CounterInput> {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as Record<string, unknown>).n !== 'number'
    ) {
      return invalid('test.counter : { n: number } attendu.');
    }
    return valid({ n: (input as { n: number }).n });
  }

  async execute(input: CounterInput): Promise<{ doubled: number }> {
    this.executeCount += 1;
    return { doubled: input.n * 2 };
  }
}

function setup(decision: 'allow' | 'deny' | 'require_confirmation', toolName = 'test.counter') {
  const tool = new CountingTool(toolName);
  const registry = new ToolRegistry();
  registry.register(tool);
  const permissions = new PermissionManager({ rules: { [toolName]: decision } });
  const executor = new ToolExecutor(registry, permissions);
  return { tool, executor };
}

describe('ToolExecutor', () => {
  it('exécute réellement un outil autorisé et renvoie sa sortie', async () => {
    const { tool, executor } = setup('allow');

    const result = await executor.run({ tool: 'test.counter', input: { n: 21 } });

    expect(result.status).toBe('executed');
    expect(result).toMatchObject({ decision: 'allow', output: { doubled: 42 } });
    expect(tool.executeCount).toBe(1);
  });

  it('n’exécute PAS un outil refusé (compteur inchangé)', async () => {
    const { tool, executor } = setup('deny');

    const result = await executor.run({ tool: 'test.counter', input: { n: 1 } });

    expect(result.status).toBe('denied');
    expect(tool.executeCount).toBe(0);
  });

  it('n’exécute PAS un outil en require_confirmation tant qu’il n’est pas confirmé', async () => {
    const { tool, executor } = setup('require_confirmation');

    const result = await executor.run({ tool: 'test.counter', input: { n: 5 } });

    expect(result.status).toBe('awaiting_confirmation');
    expect(result).toMatchObject({
      decision: 'require_confirmation',
      toolName: 'test.counter',
      action: 'execute',
      input: { n: 5 },
    });
    expect(tool.executeCount).toBe(0);
  });

  it('exécute un outil require_confirmation une fois confirmé', async () => {
    const { tool, executor } = setup('require_confirmation');

    const result = await executor.run({
      tool: 'test.counter',
      input: { n: 5 },
      confirmed: true,
    });

    expect(result.status).toBe('executed');
    expect(result).toMatchObject({ decision: 'require_confirmation', output: { doubled: 10 } });
    expect(tool.executeCount).toBe(1);
  });

  it('refuse une entrée invalide sans exécuter l’outil (compteur inchangé)', async () => {
    const { tool, executor } = setup('allow');

    const result = await executor.run({ tool: 'test.counter', input: { n: 'pas un nombre' } });

    expect(result.status).toBe('invalid_input');
    expect(tool.executeCount).toBe(0);
  });

  it('signale un outil inconnu sans rien exécuter', async () => {
    const { tool, executor } = setup('allow');

    const result = await executor.run({ tool: 'outil.absent', input: {} });

    expect(result.status).toBe('unknown_tool');
    expect(tool.executeCount).toBe(0);
  });

  it('applique la politique par défaut sûre (deny) pour un outil sans règle', async () => {
    const tool = new CountingTool('test.counter');
    const registry = new ToolRegistry();
    registry.register(tool);
    const executor = new ToolExecutor(registry, new PermissionManager());

    const result = await executor.run({ tool: 'test.counter', input: { n: 2 } });

    expect(result.status).toBe('denied');
    expect(tool.executeCount).toBe(0);
  });
});
