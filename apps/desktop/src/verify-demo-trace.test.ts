import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/connectors';
import { invalid, valid, type Tool } from '@jarvis/core';
import { describe, expect, it } from 'vitest';

import { TracingToolExecutor, VerifyDemoTraceRecorder } from './verify-demo-trace.js';

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

function makeExecutor(
  onInvocation: (invocationId: string, status: string) => void,
): TracingToolExecutor {
  const registry = new ToolRegistry();
  registry.register(echo);
  const permissions = new PermissionManager({ actionDefaults: { read: 'allow' } });
  return new TracingToolExecutor(registry, permissions, (invocationId, result) =>
    onInvocation(invocationId, result.status),
  );
}

describe('VerifyDemoTraceRecorder', () => {
  it('numérote les événements en séquence et conserve leur ordre', () => {
    const recorder = new VerifyDemoTraceRecorder();
    recorder.record('proposal', 'awaiting_confirmation', 'a');
    recorder.record('confirmation_decision', 'approved');
    recorder.record('execution', 'executed', 'b');

    const trace = recorder.snapshot();
    expect(trace.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(trace.events.map((e) => e.phase)).toEqual([
      'proposal',
      'confirmation_decision',
      'execution',
    ]);
  });

  it('un missionId est un UUID distinct par instance', () => {
    const first = new VerifyDemoTraceRecorder();
    const second = new VerifyDemoTraceRecorder();
    expect(first.missionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.missionId).not.toBe(second.missionId);
  });

  it('snapshot renvoie une copie détachée : la muter ne modifie ni le recorder ni un autre snapshot', () => {
    const recorder = new VerifyDemoTraceRecorder();
    recorder.record('proposal', 'awaiting_confirmation', 'a');

    const first = recorder.snapshot();
    const mutableFirst = first as unknown as { events: unknown[] };
    expect(() => {
      mutableFirst.events.push({ sequence: 99, phase: 'execution', status: 'executed' });
    }).toThrow();

    recorder.record('confirmation_decision', 'approved');
    const second = recorder.snapshot();

    expect(first.events.length).toBe(1);
    expect(second.events.length).toBe(2);
    expect(() => {
      (first.events[0] as unknown as { status: string }).status = 'injected';
    }).toThrow();
    expect(second.events[0]?.status).toBe('awaiting_confirmation');
  });

  it('omet invocationId quand non fourni (pas de champ undefined explicite)', () => {
    const recorder = new VerifyDemoTraceRecorder();
    recorder.record('confirmation_decision', 'declined');
    expect(Object.keys(recorder.snapshot().events[0] as object).sort()).toEqual([
      'phase',
      'sequence',
      'status',
    ]);
  });
});

describe('TracingToolExecutor', () => {
  it('run() délègue à runTracked une seule fois et renvoie le résultat inchangé', async () => {
    const calls: Array<{ invocationId: string; status: string }> = [];
    const executor = makeExecutor((invocationId, status) => calls.push({ invocationId, status }));

    const result = await executor.run({ tool: 'test.echo', input: { text: 'hello' } });

    expect(result).toEqual({ status: 'executed', decision: 'allow', output: { echoed: 'hello' } });
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]?.invocationId).toBe('string');
    expect(calls[0]?.status).toBe('executed');
  });

  it('deux appels successifs produisent deux invocationId distincts', async () => {
    const ids: string[] = [];
    const executor = makeExecutor((invocationId) => ids.push(invocationId));

    await executor.run({ tool: 'test.echo', input: { text: 'a' } });
    await executor.run({ tool: 'test.echo', input: { text: 'b' } });

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('reste un ToolExecutor réel (instanceof), jamais un double déconnecté du protocole', () => {
    const executor = makeExecutor(() => {});
    expect(executor).toBeInstanceOf(ToolExecutor);
  });
});
