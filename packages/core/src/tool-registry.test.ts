import { describe, expect, it } from 'vitest';

import { type Tool, type ToolValidationResult, valid } from './tool.js';
import { ToolRegistry } from './tool-registry.js';

function stubTool(name: string): Tool<{ v: unknown }, { v: unknown }> {
  return {
    name,
    description: `stub ${name}`,
    action: 'read',
    validateInput(input: unknown): ToolValidationResult<{ v: unknown }> {
      return valid({ v: input });
    },
    async execute(input: { v: unknown }): Promise<{ v: unknown }> {
      return input;
    },
  };
}

describe('ToolRegistry', () => {
  it('register + get retourne le même outil', () => {
    const registry = new ToolRegistry();
    const tool = stubTool('alpha');

    registry.register(tool);

    expect(registry.get('alpha')).toBe(tool);
    expect(registry.has('alpha')).toBe(true);
  });

  it('list retourne tous les outils enregistrés dans l’ordre', () => {
    const registry = new ToolRegistry();
    const a = stubTool('a');
    const b = stubTool('b');

    registry.register(a);
    registry.register(b);

    expect(registry.list()).toEqual([a, b]);
  });

  it('enregistrer deux fois le même nom lève une erreur claire', () => {
    const registry = new ToolRegistry();
    registry.register(stubTool('dup'));

    expect(() => registry.register(stubTool('dup'))).toThrow(/déjà enregistré/);
  });

  it('get sur un outil inexistant lève une erreur claire', () => {
    const registry = new ToolRegistry();

    expect(() => registry.get('absent')).toThrow(/aucun outil/i);
    expect(registry.has('absent')).toBe(false);
  });
});
