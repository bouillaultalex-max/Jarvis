import { describe, expect, it } from 'vitest';

import { PermissionManager } from './permissions.js';
import { type ActionLevel, type Tool, type ToolValidationResult, invalid, valid } from './tool.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import {
  runWithVerification,
  type PostconditionVerifier,
  type VerificationOutcome,
} from './verification.js';

interface CounterInput {
  readonly n: number;
}

/** Outil de test qui compte ses exécutions réelles — même convention que `tool-executor.test.ts`. */
class CountingTool implements Tool<CounterInput, { doubled: number }> {
  public executeCount = 0;
  readonly description = 'compteur de test';
  readonly inputSchema = {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
  };

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

/** Vérificateur fictif minimal : compare `n` attendu (depuis la demande) à `n` observé. */
interface CounterSnapshot {
  readonly lastDoubled: number | undefined;
}

function buildCounterVerifier(
  observe: () => CounterSnapshot,
): PostconditionVerifier<CounterSnapshot, number> {
  return {
    snapshot: observe,
    expectedFrom(request) {
      return (request.input as CounterInput).n;
    },
    verify(expected, _before, after): VerificationOutcome {
      if (after.lastDoubled === expected * 2) {
        return { verdict: 'satisfied', reason: `doublé attendu (${expected * 2}) observé.` };
      }
      return {
        verdict: 'contradicted',
        reason: `doublé attendu ${expected * 2}, observé ${String(after.lastDoubled)}.`,
      };
    },
  };
}

describe('runWithVerification — sans vérificateur', () => {
  it('équivaut à un appel direct à executor.run() : verification toujours undefined', async () => {
    const { tool, executor } = setup('allow');

    const outcome = await runWithVerification(executor, { tool: 'test.counter', input: { n: 3 } });

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('executed');
    expect(outcome.verification).toBeUndefined();
    expect(tool.executeCount).toBe(1);
  });
});

describe('runWithVerification — effet correspondant', () => {
  it('produit satisfied quand l’effet observé correspond à la demande autorisée', async () => {
    let lastDoubled: number | undefined;
    const { tool, executor } = setup('allow');
    const originalExecute = tool.execute.bind(tool);
    tool.execute = async (input) => {
      const out = await originalExecute(input);
      lastDoubled = out.doubled;
      return out;
    };
    const verifier = buildCounterVerifier(() => ({ lastDoubled }));

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 7 } },
      verifier,
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('executed');
    expect(outcome.verification).toEqual({ verdict: 'satisfied', reason: expect.any(String) });
  });
});

describe('runWithVerification — contradiction', () => {
  it('produit contradicted quand l’effet observé ne correspond pas à la demande autorisée', async () => {
    // L'outil déclare un succès, mais l'état réellement observé (figé à 0)
    // ne correspond jamais à ce qui était demandé.
    const { executor } = setup('allow');
    const verifier = buildCounterVerifier(() => ({ lastDoubled: 0 }));

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 9 } },
      verifier,
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('executed');
    expect(outcome.verification?.verdict).toBe('contradicted');
  });
});

describe('runWithVerification — mutation des arguments', () => {
  it('une mutation en place de l’entrée par l’outil n’altère jamais la postcondition déjà calculée', async () => {
    const registry = new ToolRegistry();
    const mutatingTool: Tool<{ n: number }, { n: number }> = {
      name: 'test.mutator',
      description: 'mute son entrée en place avant de répondre',
      action: 'execute',
      inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      validateInput(input) {
        // Pas-through délibéré : AUCUNE reconstruction, pour exposer un
        // éventuel partage d'objet mutable si le contrat ne s'en protège pas.
        return valid(input as { n: number });
      },
      async execute(input) {
        (input as { n: number }).n = 999;
        return { n: input.n };
      },
    };
    registry.register(mutatingTool);
    const executor = new ToolExecutor(
      registry,
      new PermissionManager({ rules: { 'test.mutator': 'allow' } }),
    );

    let capturedExpected: number | undefined;
    const verifier: PostconditionVerifier<Record<string, never>, number> = {
      snapshot: () => ({}),
      expectedFrom(request) {
        const n = (request.input as { n: number }).n;
        capturedExpected = n;
        return n;
      },
      verify(expected): VerificationOutcome {
        return expected === 5
          ? { verdict: 'satisfied', reason: 'postcondition intacte.' }
          : { verdict: 'contradicted', reason: `postcondition corrompue : ${expected}.` };
      },
    };

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.mutator', input: { n: 5 } },
      verifier,
    );

    expect(capturedExpected).toBe(5);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.verification).toEqual({ verdict: 'satisfied', reason: expect.any(String) });
  });
});

describe('runWithVerification — erreur avant exécution (préparation)', () => {
  it('arrête sans exécuter l’outil et renvoie une erreur contrôlée distincte, sans message brut', async () => {
    const { tool, executor } = setup('allow');
    const verifier: PostconditionVerifier<unknown, unknown> = {
      snapshot() {
        throw new Error('détail interne sensible qui ne doit jamais fuiter');
      },
      expectedFrom: () => undefined,
      verify: () => ({ verdict: 'satisfied', reason: 'jamais atteint' }),
    };

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 1 } },
      verifier,
    );

    expect(outcome.kind).toBe('preparation_failed');
    if (outcome.kind !== 'preparation_failed') throw new Error('unreachable');
    expect(outcome.reason).not.toContain('détail interne sensible');
    expect(tool.executeCount).toBe(0);
  });
});

describe('runWithVerification — erreur après exécution', () => {
  it('conserve le résultat technique, un seul appel, et renvoie insufficient_evidence sans message brut', async () => {
    const { tool, executor } = setup('allow');
    let snapshotCalls = 0;
    const verifier: PostconditionVerifier<unknown, unknown> = {
      snapshot() {
        snapshotCalls += 1;
        if (snapshotCalls === 1) return {};
        throw new Error('panne d’observation sensible qui ne doit jamais fuiter');
      },
      expectedFrom: () => undefined,
      verify: () => ({ verdict: 'satisfied', reason: 'jamais atteint' }),
    };

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 4 } },
      verifier,
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('executed');
    expect(outcome.technicalResult).toMatchObject({ output: { doubled: 8 } });
    expect(outcome.verification?.verdict).toBe('insufficient_evidence');
    expect(outcome.verification?.reason).not.toContain('panne d’observation sensible');
    expect(tool.executeCount).toBe(1);
  });
});

describe('runWithVerification — absence d’exécution (refus, confirmation en attente)', () => {
  it('deny : verification est undefined, jamais un verdict de réussite', async () => {
    const { tool, executor } = setup('deny');
    const verifier = buildCounterVerifier(() => ({ lastDoubled: undefined }));

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 2 } },
      verifier,
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('denied');
    expect(outcome.verification).toBeUndefined();
    expect(tool.executeCount).toBe(0);
  });

  it('require_confirmation non confirmé : verification est undefined, jamais un verdict de réussite', async () => {
    const { tool, executor } = setup('require_confirmation');
    const verifier = buildCounterVerifier(() => ({ lastDoubled: undefined }));

    const outcome = await runWithVerification(
      executor,
      { tool: 'test.counter', input: { n: 2 } },
      verifier,
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') throw new Error('unreachable');
    expect(outcome.technicalResult.status).toBe('awaiting_confirmation');
    expect(outcome.verification).toBeUndefined();
    expect(tool.executeCount).toBe(0);
  });
});

describe('runWithVerification — préparation suspendue et mutation de la demande originale', () => {
  it(
    'une mutation de request.input pendant un snapshot() asynchrone en attente ne doit jamais ' +
      'faire exécuter une demande différente de celle utilisée pour calculer la postcondition',
    async () => {
      const { tool, executor } = setup('allow');
      let releaseSnapshot: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });

      const verifier: PostconditionVerifier<Record<string, never>, number> = {
        async snapshot() {
          await gate; // suspend la préparation ici, le temps du test
          return {};
        },
        expectedFrom(request) {
          return (request.input as CounterInput).n;
        },
        verify(expected): VerificationOutcome {
          return expected === 5
            ? { verdict: 'satisfied', reason: 'postcondition intacte malgré la mutation tardive.' }
            : { verdict: 'contradicted', reason: `postcondition corrompue : ${expected}.` };
        },
      };

      const request = { tool: 'test.counter', input: { n: 5 } };
      const pending = runWithVerification(executor, request, verifier);

      // Mutation de la demande ORIGINALE pendant que la préparation est
      // suspendue sur `snapshot()` — avant toute reprise.
      (request.input as { n: number }).n = 999;

      releaseSnapshot?.();
      const outcome = await pending;

      expect(outcome.kind).toBe('executed');
      if (outcome.kind !== 'executed') throw new Error('unreachable');
      // L'outil doit avoir reçu n=5 (valeur capturée avant la suspension),
      // jamais n=999 (mutation survenue pendant l'attente).
      expect(outcome.technicalResult).toMatchObject({ output: { doubled: 10 } });
      expect(outcome.verification).toEqual({ verdict: 'satisfied', reason: expect.any(String) });
      expect(tool.executeCount).toBe(1);
    },
  );

  it(
    'une mutation de request.tool pendant un snapshot() asynchrone en attente ne doit jamais ' +
      'faire exécuter un outil différent de celui utilisé pour calculer la postcondition',
    async () => {
      const registry = new ToolRegistry();
      const counter = new CountingTool('test.counter');
      const other = new CountingTool('test.other');
      registry.register(counter);
      registry.register(other);
      const executor = new ToolExecutor(
        registry,
        new PermissionManager({ rules: { 'test.counter': 'allow', 'test.other': 'allow' } }),
      );

      let releaseSnapshot: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      const verifier: PostconditionVerifier<Record<string, never>, number> = {
        async snapshot() {
          await gate;
          return {};
        },
        expectedFrom(request) {
          return (request.input as CounterInput).n;
        },
        verify(): VerificationOutcome {
          return { verdict: 'satisfied', reason: 'non pertinent pour ce test.' };
        },
      };

      const request = { tool: 'test.counter', input: { n: 3 } };
      const pending = runWithVerification(executor, request, verifier);

      // Mutation du NOM D'OUTIL pendant la préparation suspendue.
      request.tool = 'test.other';

      releaseSnapshot?.();
      await pending;

      expect(counter.executeCount).toBe(1);
      expect(other.executeCount).toBe(0);
    },
  );
});

describe('runWithVerification — aucun retry ni nouvelle action déclenchée par un verdict', () => {
  it('executor.run n’est jamais rappelé après un verdict contradicted ou insufficient_evidence', async () => {
    const { tool, executor } = setup('allow');
    const originalRun = executor.run.bind(executor);
    let runCalls = 0;
    executor.run = async (request) => {
      runCalls += 1;
      return originalRun(request);
    };
    const verifier = buildCounterVerifier(() => ({ lastDoubled: 0 })); // ne correspondra jamais

    await runWithVerification(executor, { tool: 'test.counter', input: { n: 6 } }, verifier);

    expect(runCalls).toBe(1);
    expect(tool.executeCount).toBe(1);
  });
});
