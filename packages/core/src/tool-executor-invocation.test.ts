import { describe, expect, it } from 'vitest';

import { PermissionManager } from './permissions.js';
import { type Tool, invalid, valid } from './tool.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';

const echo: Tool<{ text: string }, { echoed: string }> = {
  name: 'test.echo',
  description: 'écho de test',
  action: 'read',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  validateInput: (input) =>
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { text?: unknown }).text === 'string'
      ? valid({ text: (input as { text: string }).text })
      : invalid('test.echo : { text: string } attendu.'),
  execute: async ({ text }) => ({ echoed: text }),
};

const boom: Tool = {
  name: 'test.boom',
  description: 'échoue',
  action: 'read',
  inputSchema: { type: 'object', properties: {} },
  validateInput: () => valid({}),
  execute: async () => {
    throw new Error('panne technique');
  },
};

const secret: Tool = { ...echo, name: 'test.secret', action: 'execute' };

function makeExecutor(policy: ConstructorParameters<typeof PermissionManager>[0]): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(echo);
  registry.register(boom);
  registry.register(secret);
  return new ToolExecutor(registry, new PermissionManager(policy));
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

describe('ToolExecutor.runTracked — identifiant d’invocation', () => {
  const executor = makeExecutor({
    actionDefaults: { read: 'allow', execute: 'require_confirmation' },
  });

  it('renvoie un invocationId et le résultat, identique à celui de run', async () => {
    const tracked = await executor.runTracked({ tool: 'test.echo', input: { text: 'a' } });
    const plain = await executor.run({ tool: 'test.echo', input: { text: 'a' } });

    expect(tracked.result).toEqual(plain);
    expect(tracked.result).toEqual({
      status: 'executed',
      decision: 'allow',
      output: { echoed: 'a' },
    });
    expect(typeof tracked.invocationId).toBe('string');
  });

  it('l’identifiant est unique par exécution', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      ids.add(
        (await executor.runTracked({ tool: 'test.echo', input: { text: 'a' } })).invocationId,
      );
    }
    expect(ids.size).toBe(50);
  });

  it('l’identifiant est un identifiant opaque valide pour la provenance juridique (sans secret)', async () => {
    const { invocationId } = await executor.runTracked({ tool: 'test.echo', input: { text: 'a' } });
    expect(invocationId).toMatch(OPAQUE_ID);
    expect(invocationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('couvre tous les statuts : outil inconnu, entrée invalide, refus, confirmation requise, échec technique', async () => {
    const denied = makeExecutor({ default: 'deny' });
    const cases = [
      await executor.runTracked({ tool: 'test.inconnu', input: {} }),
      await executor.runTracked({ tool: 'test.echo', input: { text: 1 } }),
      await denied.runTracked({ tool: 'test.echo', input: { text: 'a' } }),
      await executor.runTracked({ tool: 'test.secret', input: { text: 'a' } }),
      await executor.runTracked({ tool: 'test.boom', input: {} }),
    ];
    expect(cases.map((c) => c.result.status)).toEqual([
      'unknown_tool',
      'invalid_input',
      'denied',
      'awaiting_confirmation',
      'error',
    ]);
    expect(new Set(cases.map((c) => c.invocationId)).size).toBe(cases.length);
  });

  it('n’ajoute aucun champ au résultat : la forme de ToolExecutionResult est inchangée', async () => {
    const { result } = await executor.runTracked({ tool: 'test.echo', input: { text: 'a' } });
    expect(Object.keys(result).sort()).toEqual(['decision', 'output', 'status']);
    expect(result).not.toHaveProperty('invocationId');
  });

  it('run reste inchangé et ne consomme aucun identifiant observable', async () => {
    const result = await executor.run({ tool: 'test.echo', input: { text: 'b' } });
    expect(result).toEqual({ status: 'executed', decision: 'allow', output: { echoed: 'b' } });
  });
});
