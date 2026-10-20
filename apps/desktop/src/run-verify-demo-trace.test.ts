import {
  ConfirmationService,
  InMemoryMailClient,
  type ConfirmationRequest,
} from '@jarvis/connectors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_SEND_INPUT, runVerifyDemo } from './run-verify-demo.js';

/**
 * Trace structurée (`VerifyDemoTrace`, `verify-demo-trace.ts`) renvoyée par
 * `runVerifyDemo` — assertions dédiées, distinctes de `run-verify-demo.test.ts`
 * (résultat applicatif). Jamais d'input/output/payload/summary/confirmationId
 * ni de raison d'exception : seules des valeurs contrôlées (phase/statut) et
 * des `invocationId` opaques.
 */

const alwaysConfirm = async (): Promise<boolean> => true;
const alwaysDecline = async (): Promise<boolean> => false;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trace — parcours positif', () => {
  it('reconstitue la séquence complète : proposition → décision approuvée → exécution → vérification satisfied', async () => {
    const result = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(result.trace.missionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.trace.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.trace.events.map((e) => e.phase)).toEqual([
      'proposal',
      'confirmation_decision',
      'execution',
      'verification',
    ]);
    expect(result.trace.events.map((e) => e.status)).toEqual([
      'awaiting_confirmation',
      'approved',
      'executed',
      'satisfied',
    ]);

    const proposal = result.trace.events[0];
    const execution = result.trace.events[2];
    expect(typeof proposal?.invocationId).toBe('string');
    expect(typeof execution?.invocationId).toBe('string');
    expect(proposal?.invocationId).not.toBe(execution?.invocationId);
  });
});

describe('trace — refus / EOF', () => {
  it('confirm → false : proposition + décision déclinée, aucun événement execution/verification, aucun send', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const result = await runVerifyDemo({ confirm: alwaysDecline });

    expect(result.trace.events.map((e) => e.phase)).toEqual(['proposal', 'confirmation_decision']);
    expect(result.trace.events.map((e) => e.status)).toEqual(['awaiting_confirmation', 'declined']);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('confirm qui lève (EOF simulée) : même trace qu’un refus explicite, aucune fuite du message', async () => {
    const confirm = async (): Promise<boolean> => {
      throw new Error('détail interne sensible qui ne doit jamais fuiter');
    };

    const result = await runVerifyDemo({ confirm });

    expect(result.trace.events.map((e) => e.status)).toEqual(['awaiting_confirmation', 'declined']);
    expect(JSON.stringify(result.trace)).not.toContain('sensible');
  });
});

describe('trace — ticket de confirmation invalide', () => {
  it('ticket consommé avant la vérification finale → confirmation_failed, aucun événement execution', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ConfirmationService();

    const confirm = async (request: ConfirmationRequest): Promise<boolean> => {
      await confirmationService.verify(request.confirmationId, {
        toolName: request.toolName,
        action: request.action,
        accountId: request.account.accountId,
        input: {
          to: 'demo@example.test',
          subject: 'Démonstration verify-demo (JARVIS)',
          body: 'Message synthétique local, généré par verify-demo — aucune donnée réelle.',
        },
      });
      return true;
    };

    const result = await runVerifyDemo({ confirm, confirmationService });

    expect(result.trace.events.map((e) => e.phase)).toEqual(['proposal', 'confirmation_decision']);
    expect(result.trace.events.map((e) => e.status)).toEqual(['awaiting_confirmation', 'failed']);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('trace — panne interne contrôlée', () => {
  class ThrowingVerifyConfirmationService extends ConfirmationService {
    override async verify(): Promise<never> {
      throw new Error('détail sensible de verify() qui ne doit jamais fuiter');
    }
  }

  it('ConfirmationService.verify() qui lève : décision « error », aucune chaîne sensible dans la trace', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ThrowingVerifyConfirmationService();

    const result = await runVerifyDemo({ confirm: alwaysConfirm, confirmationService });

    expect(result.trace.events.map((e) => e.phase)).toEqual(['proposal', 'confirmation_decision']);
    expect(result.trace.events.map((e) => e.status)).toEqual(['awaiting_confirmation', 'error']);
    expect(JSON.stringify(result.trace)).not.toContain('sensible');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('trace — un seul effet réel par invocation', () => {
  it('un seul événement execution par invocation, un seul send réel', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const result = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(result.trace.events.filter((e) => e.phase === 'execution')).toHaveLength(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('trace — deux invocations isolées', () => {
  it('missionId et invocationId distincts entre deux invocations successives', async () => {
    const first = await runVerifyDemo({ confirm: alwaysConfirm });
    const second = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(first.trace.missionId).not.toBe(second.trace.missionId);

    const firstExecutionId = first.trace.events.find((e) => e.phase === 'execution')?.invocationId;
    const secondExecutionId = second.trace.events.find(
      (e) => e.phase === 'execution',
    )?.invocationId;
    expect(firstExecutionId).toBeDefined();
    expect(secondExecutionId).toBeDefined();
    expect(firstExecutionId).not.toBe(secondExecutionId);
  });

  it('muter le snapshot de trace d’une invocation n’affecte jamais une autre invocation', async () => {
    const first = await runVerifyDemo({ confirm: alwaysConfirm });
    const mutableEvents = first.trace.events as unknown as unknown[];
    expect(() => {
      mutableEvents.push({ sequence: 99, phase: 'execution', status: 'executed' });
    }).toThrow();

    const second = await runVerifyDemo({ confirm: alwaysConfirm });
    expect(second.trace.events).toHaveLength(4);
    expect(first.trace.events).toHaveLength(4);
  });
});

describe('trace — observation indisponible', () => {
  it('panne du premier snapshot : aucune exécution, préparation échouée tracée', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    vi.spyOn(InMemoryMailClient.prototype, 'listSent').mockImplementationOnce(() => {
      throw new Error('observation-sensitive-value');
    });

    const result = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(result.kind).toBe('preparation_failed');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(result.trace.events.some((event) => event.phase === 'execution')).toBe(false);
    expect(result.trace.events.at(-1)).toMatchObject({
      phase: 'verification',
      status: 'preparation_failed',
    });
    expect(JSON.stringify(result.trace)).not.toContain('observation-sensitive-value');
  });

  it('panne du second snapshot : une exécution technique, preuve insuffisante tracée séparément', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    vi.spyOn(InMemoryMailClient.prototype, 'listSent')
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => {
        throw new Error('after-sensitive-value');
      });

    const result = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(result.kind).toBe('executed');
    if (result.kind !== 'executed') throw new Error('unexpected fixture result');
    expect(result.technicalStatus).toBe('executed');
    expect(result.verification?.verdict).toBe('insufficient_evidence');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(result.trace.events.filter((event) => event.phase === 'execution')).toHaveLength(1);
    expect(result.trace.events.at(-1)).toMatchObject({
      phase: 'verification',
      status: 'insufficient_evidence',
    });
    expect(JSON.stringify(result.trace)).not.toContain('after-sensitive-value');
  });
});

describe('trace — allowlist de métadonnées', () => {
  it('ne contient ni entrée, ni sortie, ni ticket de confirmation', async () => {
    let ticket = '';
    const result = await runVerifyDemo({
      confirm: async (request) => {
        ticket = request.confirmationId;
        return true;
      },
    });

    expect(Object.keys(result.trace).sort()).toEqual(['events', 'missionId']);
    for (const event of result.trace.events) {
      expect(Object.keys(event).sort()).toEqual(
        event.invocationId === undefined
          ? ['phase', 'sequence', 'status']
          : ['invocationId', 'phase', 'sequence', 'status'],
      );
    }
    const serialized = JSON.stringify(result.trace);
    expect(ticket).not.toBe('');
    expect(serialized).not.toContain(ticket);
    for (const value of Object.values(DEMO_SEND_INPUT)) expect(serialized).not.toContain(value);
  });
});
