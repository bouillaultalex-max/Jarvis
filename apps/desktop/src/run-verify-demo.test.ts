import {
  ConfirmationService,
  InMemoryMailClient,
  type ConfirmationPayload,
  type ConfirmationRequest,
} from '@jarvis/connectors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEMO_SEND_INPUT,
  VERIFY_DEMO_NOTICE,
  describeVerifyDemoResult,
  runVerifyDemo,
  verifyDemoExitCode,
  type VerifyDemoResult,
} from './run-verify-demo.js';

/**
 * `runVerifyDemo` — logique pure (sans process réel, voir
 * `main-verify-demo.test.ts` pour le câblage `dispatch()` et les tests de
 * process `tsx`). Chaque test fournit son propre `confirm` (et, lorsque
 * nécessaire, son propre `ConfirmationService`) : jamais de double partagé
 * entre deux appels.
 *
 * L'effet réel (mutation de l'`InMemoryMailClient` interne, jamais exposé
 * par `runVerifyDemo`) est prouvé par un espion sur
 * `InMemoryMailClient.prototype.send` — jamais une simple confiance dans le
 * contrôle de flux. `vi.restoreAllMocks()` après chaque test : aucun espion
 * ne doit jamais fuiter vers un autre test.
 */

const alwaysConfirm = async (): Promise<boolean> => true;
const alwaysDecline = async (): Promise<boolean> => false;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runVerifyDemo — confirmation acceptée', () => {
  it('propose → confirme → exécute exactement un effet réel → verdict satisfied, code de sortie 0', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const result = await runVerifyDemo({ confirm: alwaysConfirm });

    expect(result.kind).toBe('executed');
    if (result.kind !== 'executed') throw new Error('unreachable');
    expect(result.technicalStatus).toBe('executed');
    expect(result.verification).toMatchObject({ verdict: 'satisfied' });
    expect(verifyDemoExitCode(result)).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]).toMatchObject({ to: 'demo@example.test' });
  });

  it("l'entrée synthétique utilisée est fixe (demo@example.test), jamais vide, et gelée", () => {
    expect(DEMO_SEND_INPUT.to).toBe('demo@example.test');
    expect(DEMO_SEND_INPUT.subject.length).toBeGreaterThan(0);
    expect(DEMO_SEND_INPUT.body.length).toBeGreaterThan(0);
    expect(Object.isFrozen(DEMO_SEND_INPUT)).toBe(true);
    expect(() => {
      (DEMO_SEND_INPUT as { to: string }).to = 'muté';
    }).toThrow();
  });

  it("l'avis « démonstration locale / aucune livraison externe » existe et est stable", () => {
    expect(VERIFY_DEMO_NOTICE.toLowerCase()).toContain('local');
    expect(VERIFY_DEMO_NOTICE).toContain('aucune livraison externe');
  });
});

describe('runVerifyDemo — confirmation refusée', () => {
  it('confirm résout false → déclinée, zéro effet réel, code de sortie 1', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const result = await runVerifyDemo({ confirm: alwaysDecline });

    expect(result).toEqual({ kind: 'declined' });
    expect(verifyDemoExitCode(result)).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('un deuxième appel après un refus réussit normalement (le refus précédent ne laisse aucun effet résiduel)', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const declined = await runVerifyDemo({ confirm: alwaysDecline });
    expect(declined.kind).toBe('declined');
    expect(sendSpy).not.toHaveBeenCalled();

    const executed = await runVerifyDemo({ confirm: alwaysConfirm });
    expect(executed.kind).toBe('executed');
    if (executed.kind !== 'executed') throw new Error('unreachable');
    expect(executed.verification).toMatchObject({ verdict: 'satisfied' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('runVerifyDemo — EOF / exception du callback confirm', () => {
  it('confirm qui lève → traité comme un refus contrôlé, zéro effet réel, jamais le message brut', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirm = async (): Promise<boolean> => {
      throw new Error('détail interne sensible qui ne doit jamais fuiter');
    };

    const result = await runVerifyDemo({ confirm });

    expect(result).toEqual({ kind: 'declined' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('détail interne sensible');
    for (const line of describeVerifyDemoResult(result)) {
      expect(line).not.toContain('détail interne sensible');
    }
  });

  it('confirm qui résout une valeur non strictement true (ex. undefined, simulant une EOF amont) → refus, zéro effet réel', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirm = async (): Promise<boolean> => undefined as unknown as boolean;

    const result = await runVerifyDemo({ confirm });

    expect(result).toEqual({ kind: 'declined' });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('runVerifyDemo — erreurs de proposition/vérification contrôlées', () => {
  class ThrowingCreateConfirmationService extends ConfirmationService {
    override async create(): Promise<never> {
      throw new Error('détail sensible de create() qui ne doit jamais fuiter');
    }
  }

  class ThrowingVerifyConfirmationService extends ConfirmationService {
    override async verify(): Promise<never> {
      throw new Error('détail sensible de verify() qui ne doit jamais fuiter');
    }
  }

  it('ConfirmationService.create() qui lève (depuis proposeConfirmation) → internal_error contrôlé, zéro effet réel, jamais le message brut', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ThrowingCreateConfirmationService();

    const result = await runVerifyDemo({ confirm: alwaysConfirm, confirmationService });

    expect(result).toEqual({ kind: 'internal_error' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('détail sensible');
    for (const line of describeVerifyDemoResult(result)) {
      expect(line).not.toContain('détail sensible');
    }
  });

  it('ConfirmationService.verify() qui lève → internal_error contrôlé, zéro effet réel (send jamais appelé), jamais le message brut', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ThrowingVerifyConfirmationService();

    const result = await runVerifyDemo({ confirm: alwaysConfirm, confirmationService });

    expect(result).toEqual({ kind: 'internal_error' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('détail sensible');
    for (const line of describeVerifyDemoResult(result)) {
      expect(line).not.toContain('détail sensible');
    }
  });
});

describe('runVerifyDemo — protocole réel de ConfirmationService', () => {
  it(
    'ticket vérifié puis consommé par le service réel ; un payload altéré, vérifié directement via ' +
      'ce même service pendant la confirmation, est rejeté sans jamais affecter l’exécution réelle',
    async () => {
      const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
      const confirmationService = new ConfirmationService();
      let capturedRequest: ConfirmationRequest | undefined;

      const confirm = async (request: ConfirmationRequest): Promise<boolean> => {
        capturedRequest = request;
        // Tentative de vérification avec un payload altéré (corps différent),
        // via le VRAI `ConfirmationService` — ne doit jamais réussir, et ne
        // doit jamais consommer le ticket légitime.
        const tampered = await confirmationService.verify(request.confirmationId, {
          toolName: request.toolName,
          action: request.action,
          accountId: request.account.accountId,
          input: { ...DEMO_SEND_INPUT, body: 'TAMPERED' },
        });
        expect(tampered.ok).toBe(false);
        return true;
      };

      const result = await runVerifyDemo({ confirm, confirmationService });

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.toolName).toBe('inmemory.send');
      expect(result.kind).toBe('executed');
      if (result.kind !== 'executed') throw new Error('unreachable');
      expect(result.technicalStatus).toBe('executed');
      expect(result.verification).toMatchObject({ verdict: 'satisfied' });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0]?.[0]).toMatchObject({ to: 'demo@example.test' });
    },
  );

  it('ticket invalidé entre-temps (refusé via le service réel avant la vérification finale) → confirmation_failed, zéro effet réel', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ConfirmationService();

    const confirm = async (request: ConfirmationRequest): Promise<boolean> => {
      await confirmationService.deny(request.confirmationId);
      return true;
    };

    const result = await runVerifyDemo({ confirm, confirmationService });

    expect(result).toEqual({ kind: 'confirmation_failed' });
    expect(verifyDemoExitCode(result)).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('ticket déjà consommé (deuxième vérification directe avec le payload réel avant la confirmation) → confirmation_failed, zéro effet réel', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
    const confirmationService = new ConfirmationService();

    const confirm = async (request: ConfirmationRequest): Promise<boolean> => {
      // Consomme le ticket légitime nous-mêmes, directement via le service
      // réel, avant que `runVerifyDemo` ne tente sa propre vérification.
      const firstVerify = await confirmationService.verify(request.confirmationId, {
        toolName: request.toolName,
        action: request.action,
        accountId: request.account.accountId,
        input: DEMO_SEND_INPUT,
      });
      expect(firstVerify.ok).toBe(true);
      return true;
    };

    const result = await runVerifyDemo({ confirm, confirmationService });

    expect(result).toEqual({ kind: 'confirmation_failed' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it(
    'un service qui mute payload.input (après son propre verify() réussi, via le vrai super.verify()) ' +
      'n’altère jamais ce qui est réellement exécuté — deux clones indépendants, jamais partagés',
    async () => {
      class MutatingAfterVerifyConfirmationService extends ConfirmationService {
        override async verify(confirmationId: string, payload: ConfirmationPayload) {
          const outcome = await super.verify(confirmationId, payload);
          if (outcome.ok) {
            // Tentative de mutation tardive du payload REÇU par le service,
            // après un `verify()` légitimement réussi — ne doit jamais
            // atteindre ce que `runVerifyDemo` exécute réellement.
            (payload.input as { to: string }).to = 'attacker@example.test';
          }
          return outcome;
        }
      }

      const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');
      const confirmationService = new MutatingAfterVerifyConfirmationService();

      const result = await runVerifyDemo({ confirm: alwaysConfirm, confirmationService });

      expect(result.kind).toBe('executed');
      if (result.kind !== 'executed') throw new Error('unreachable');
      expect(result.verification).toMatchObject({ verdict: 'satisfied' });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0]?.[0]).toMatchObject({ to: 'demo@example.test' });
    },
  );
});

describe('runVerifyDemo — deux invocations isolées', () => {
  it('deux appels successifs réussissent chacun indépendamment, un effet réel distinct par appel (client distinct)', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const first = await runVerifyDemo({ confirm: alwaysConfirm });
    const second = await runVerifyDemo({ confirm: alwaysConfirm });

    for (const result of [first, second]) {
      expect(result.kind).toBe('executed');
      if (result.kind !== 'executed') throw new Error('unreachable');
      expect(result.technicalStatus).toBe('executed');
      expect(result.verification).toMatchObject({ verdict: 'satisfied' });
    }
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Deux instances `InMemoryMailClient` distinctes — jamais un client
    // partagé entre les deux invocations (même preuve que le verdict
    // `satisfied` individuel, mais au niveau de l'identité de l'objet).
    expect(sendSpy.mock.instances[0]).not.toBe(sendSpy.mock.instances[1]);
  });

  it('deux invocations concurrentes (confirmationService distincts) n’interfèrent jamais entre elles', async () => {
    const sendSpy = vi.spyOn(InMemoryMailClient.prototype, 'send');

    const [first, second] = await Promise.all([
      runVerifyDemo({ confirm: alwaysConfirm, confirmationService: new ConfirmationService() }),
      runVerifyDemo({ confirm: alwaysConfirm, confirmationService: new ConfirmationService() }),
    ]);

    for (const result of [first, second]) {
      expect(result.kind).toBe('executed');
      if (result.kind !== 'executed') throw new Error('unreachable');
      expect(result.verification).toMatchObject({ verdict: 'satisfied' });
    }
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.instances[0]).not.toBe(sendSpy.mock.instances[1]);
  });
});

describe('describeVerifyDemoResult — affichage', () => {
  it('sépare toujours le résultat technique du verdict (le rappel « effet local » vit dans VERIFY_DEMO_NOTICE, affiché par main.ts avant la confirmation)', () => {
    const result: VerifyDemoResult = {
      kind: 'executed',
      technicalStatus: 'executed',
      verification: {
        verdict: 'satisfied',
        reason: 'un enregistrement correspondant a été observé.',
      },
    };

    const lines = describeVerifyDemoResult(result);

    expect(lines.some((l) => l.includes('Résultat technique : executed.'))).toBe(true);
    expect(lines.some((l) => l.includes('satisfied'))).toBe(true);
  });

  it('ne contient jamais d’accolade (jamais une sérialisation brute de l’objet)', () => {
    const results: VerifyDemoResult[] = [
      { kind: 'declined' },
      { kind: 'confirmation_failed' },
      { kind: 'not_awaiting_confirmation', technicalStatus: 'denied' },
      { kind: 'preparation_failed' },
      { kind: 'internal_error' },
      { kind: 'executed', technicalStatus: 'executed', verification: undefined },
    ];

    for (const result of results) {
      for (const line of describeVerifyDemoResult(result)) {
        expect(line).not.toContain('{');
      }
    }
  });

  it('un échec de préparation de vérification (preparation_failed) n’invente jamais un statut technique exécuté', () => {
    const lines = describeVerifyDemoResult({ kind: 'preparation_failed' });
    expect(lines.join(' ')).not.toContain('executed');
  });
});

describe('verifyDemoExitCode — contrat strict', () => {
  it('0 uniquement pour executed + statut technique executed + verdict satisfied', () => {
    expect(
      verifyDemoExitCode({
        kind: 'executed',
        technicalStatus: 'executed',
        verification: { verdict: 'satisfied', reason: 'ok' },
      }),
    ).toBe(0);
  });

  it.each<VerifyDemoResult>([
    { kind: 'declined' },
    { kind: 'confirmation_failed' },
    { kind: 'not_awaiting_confirmation', technicalStatus: 'denied' },
    { kind: 'preparation_failed' },
    { kind: 'internal_error' },
    { kind: 'executed', technicalStatus: 'awaiting_confirmation', verification: undefined },
    { kind: 'executed', technicalStatus: 'executed', verification: undefined },
    {
      kind: 'executed',
      technicalStatus: 'executed',
      verification: { verdict: 'contradicted', reason: 'écart observé' },
    },
    {
      kind: 'executed',
      technicalStatus: 'executed',
      verification: { verdict: 'insufficient_evidence', reason: 'panne d’observation' },
    },
  ])('1 pour tout le reste (%j)', (result) => {
    expect(verifyDemoExitCode(result)).toBe(1);
  });
});
