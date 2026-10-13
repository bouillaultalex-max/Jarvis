import { describe, expect, it } from 'vitest';

import { BudgetedOutboundTransport } from './budgeted-outbound-transport.js';
import type { OutboundTransport, TransportResult } from './channel-ports.js';
import type {
  ReserveResult,
  SendAttemptBudget,
  SendAttemptBudgetState,
} from './send-attempt-budget.js';

/** Double minimal, en mémoire, pour isoler ce test de la persistance SQLite. */
class FakeSendAttemptBudget implements SendAttemptBudget {
  public state: SendAttemptBudgetState | undefined;
  private readonly forcedReserve: ReserveResult | undefined;
  private readonly throwOnRecordOutcome: boolean;

  constructor(
    options: {
      readonly alreadyConsumed?: boolean;
      readonly storageErrorOnReserve?: boolean;
      readonly throwOnRecordOutcome?: boolean;
    } = {},
  ) {
    if (options.alreadyConsumed) {
      this.state = { status: 'error', reservedAt: 'x', resolvedAt: 'x', reason: 'déjà consommé' };
      this.forcedReserve = 'already_consumed';
    } else if (options.storageErrorOnReserve) {
      this.forcedReserve = 'storage_error';
    }
    this.throwOnRecordOutcome = options.throwOnRecordOutcome ?? false;
  }

  reserve(now: string): ReserveResult {
    if (this.forcedReserve !== undefined) return this.forcedReserve;
    this.state = { status: 'reserved', reservedAt: now };
    return 'reserved';
  }

  recordOutcome(
    outcome: 'sent' | 'error' | 'uncertain',
    reason: string | undefined,
    now: string,
  ): void {
    if (this.throwOnRecordOutcome) {
      throw new Error('contention synthétique à l’écriture — ne doit jamais remonter au worker');
    }
    this.state = { status: outcome, reservedAt: now, resolvedAt: now, reason };
  }

  getState(): SendAttemptBudgetState | undefined {
    return this.state;
  }

  close(): void {}
}

class RecordingTransport implements OutboundTransport {
  public callCount = 0;
  constructor(private readonly result: TransportResult | (() => Promise<TransportResult>)) {}

  async send(): Promise<TransportResult> {
    this.callCount += 1;
    return typeof this.result === 'function' ? this.result() : this.result;
  }
}

describe('BudgetedOutboundTransport — réservation avant tout fetch', () => {
  it('réserve puis appelle le transport réel une fois — succès consomme le budget', async () => {
    const budget = new FakeSendAttemptBudget();
    const inner = new RecordingTransport({ status: 'sent' });
    const transport = new BudgetedOutboundTransport(inner, budget);

    const result = await transport.send({ recipientId: 'r1', text: 'bonjour' });

    expect(result).toEqual({ status: 'sent' });
    expect(inner.callCount).toBe(1);
    expect(budget.getState()?.status).toBe('sent');
  });

  it('budget déjà consommé → le transport réel n’est JAMAIS appelé, échec démontré immédiat', async () => {
    const budget = new FakeSendAttemptBudget({ alreadyConsumed: true });
    const inner = new RecordingTransport({ status: 'sent' });
    const transport = new BudgetedOutboundTransport(inner, budget);

    const result = await transport.send({ recipientId: 'r1', text: 'bonjour' });

    expect(result.status).toBe('error');
    expect(inner.callCount).toBe(0);
  });

  it("erreur de stockage à la réservation ('storage_error', ex. contention entre deux process) → traitée EXACTEMENT comme 'already_consumed' : jamais un fallback permissif, transport réel jamais appelé", async () => {
    const budget = new FakeSendAttemptBudget({ storageErrorOnReserve: true });
    const inner = new RecordingTransport({ status: 'sent' });
    const transport = new BudgetedOutboundTransport(inner, budget);

    const result = await transport.send({ recipientId: 'r1', text: 'bonjour' });

    expect(result.status).toBe('error');
    expect(inner.callCount).toBe(0);
  });

  it("l'échec de recordOutcome() après un envoi réel (contention à l'écriture) ne remonte jamais au worker — le TransportResult réel est quand même renvoyé", async () => {
    const budget = new FakeSendAttemptBudget({ throwOnRecordOutcome: true });
    const inner = new RecordingTransport({ status: 'sent' });
    const transport = new BudgetedOutboundTransport(inner, budget);

    const result = await transport.send({ recipientId: 'r1', text: 'bonjour' });

    expect(result).toEqual({ status: 'sent' }); // jamais une exception propagée
    expect(inner.callCount).toBe(1);
  });

  it.each(['error', 'uncertain'] as const)(
    'issue "%s" du transport réel consomme aussi le budget (même traitement qu’un succès)',
    async (status) => {
      const budget = new FakeSendAttemptBudget();
      const inner = new RecordingTransport({
        status,
        reason: 'motif synthétique',
      } as TransportResult);
      const transport = new BudgetedOutboundTransport(inner, budget);

      await transport.send({ recipientId: 'r1', text: 'x' });

      expect(budget.getState()?.status).toBe(status);
    },
  );

  it("exception inattendue du transport interne → 'uncertain' (jamais 'error'), motif générique fixe, aucune fuite du message original", async () => {
    const budget = new FakeSendAttemptBudget();
    const secretLookingMessage = 'Bearer sk-fake-leaked-token-should-never-appear';
    const inner: OutboundTransport = {
      async send(): Promise<never> {
        throw new Error(secretLookingMessage);
      },
    };
    const transport = new BudgetedOutboundTransport(inner, budget);

    const result = await transport.send({ recipientId: 'r1', text: 'x' });

    expect(result.status).toBe('uncertain');
    expect(result.status === 'uncertain' ? result.reason : '').not.toContain(secretLookingMessage);
    const state = budget.getState();
    expect(state?.status).toBe('uncertain');
    const recordedReason =
      state !== undefined && state.status !== 'reserved' ? state.reason : undefined;
    expect(recordedReason).not.toContain(secretLookingMessage);
  });
});
