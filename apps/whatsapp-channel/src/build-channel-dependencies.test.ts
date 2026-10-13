import { InMemorySecretStore } from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import { buildChannelDependencies } from './build-channel-dependencies.js';
import { BudgetedOutboundTransport } from './budgeted-outbound-transport.js';
import { IncompleteRealConfigError } from './real-whatsapp-config.js';
import type {
  ReserveResult,
  SendAttemptBudget,
  SendAttemptBudgetState,
} from './send-attempt-budget.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import {
  WHATSAPP_ACCESS_TOKEN_KEY,
  WHATSAPP_APP_SECRET_KEY,
  WHATSAPP_VERIFY_TOKEN_KEY,
} from './real-whatsapp-config.js';

class FakeBudget implements SendAttemptBudget {
  public state: SendAttemptBudgetState | undefined;
  reserve(now: string): ReserveResult {
    this.state = { status: 'reserved', reservedAt: now };
    return 'reserved';
  }
  recordOutcome(
    outcome: 'sent' | 'error' | 'uncertain',
    reason: string | undefined,
    now: string,
  ): void {
    this.state = { status: outcome, reservedAt: now, resolvedAt: now, reason };
  }
  getState(): SendAttemptBudgetState | undefined {
    return this.state;
  }
  close(): void {}
}

async function buildCompleteSecretStore(): Promise<InMemorySecretStore> {
  const store = new InMemorySecretStore();
  await store.set(WHATSAPP_APP_SECRET_KEY, 'fake-app-secret');
  await store.set(WHATSAPP_VERIFY_TOKEN_KEY, 'fake-verify-token');
  await store.set(WHATSAPP_ACCESS_TOKEN_KEY, 'fake-access-token');
  return store;
}

const COMPLETE_ENV = {
  WHATSAPP_GRAPH_API_VERSION: 'v26.0',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ALLOWED_SENDER_ID: '33600000001',
};

describe('buildChannelDependencies — mode simulated (défaut, inchangé)', () => {
  it('transport simulé, config synthétique, aucun SecretStore ni budget touché', async () => {
    const openBudget = vi.fn(() => new FakeBudget());
    const secretStore = new InMemorySecretStore(); // volontairement vide — ne doit jamais être lu
    const deps = await buildChannelDependencies({
      mode: 'simulated',
      env: {},
      secretStore,
      openSendAttemptBudget: openBudget,
    });

    expect(deps.transport).toBeInstanceOf(SimulatedOutboundTransport);
    expect(deps.config.allowedSenderId).toBe('33600000000'); // valeur synthétique de config.ts, inchangée
    expect(openBudget).not.toHaveBeenCalled();
  });

  it('le service conversationnel reste le provider simulé — aucun LLM réel jamais atteignable', async () => {
    const deps = await buildChannelDependencies({
      mode: 'simulated',
      env: {},
      secretStore: new InMemorySecretStore(),
      openSendAttemptBudget: () => new FakeBudget(),
    });
    const result = await deps.conversationalService.reply({ senderId: 's1', text: 'bonjour' });
    expect(result).toEqual({ status: 'ok', text: 'réponse simulée' });
  });
});

describe('buildChannelDependencies — mode real, configuration incomplète', () => {
  it('secret manquant → échoue avant même d’invoquer la fabrique de budget (aucun fichier créé)', async () => {
    const openBudget = vi.fn(() => new FakeBudget());
    await expect(
      buildChannelDependencies({
        mode: 'real',
        env: COMPLETE_ENV,
        secretStore: new InMemorySecretStore(), // vide
        openSendAttemptBudget: openBudget,
      }),
    ).rejects.toThrow();
    expect(openBudget).not.toHaveBeenCalled();
  });

  it('variable d’environnement manquante → IncompleteRealConfigError, budget jamais ouvert', async () => {
    const openBudget = vi.fn(() => new FakeBudget());
    const incompleteEnv = { ...COMPLETE_ENV, WHATSAPP_PHONE_NUMBER_ID: undefined };
    await expect(
      buildChannelDependencies({
        mode: 'real',
        env: incompleteEnv,
        secretStore: await buildCompleteSecretStore(),
        openSendAttemptBudget: openBudget,
      }),
    ).rejects.toThrow(IncompleteRealConfigError);
    expect(openBudget).not.toHaveBeenCalled();
  });
});

describe('buildChannelDependencies — mode real, câblage complet avec doubles exclusivement', () => {
  it('transport réel enveloppé du budget, fetch INJECTÉ exclusivement (jamais le fetch global)', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.fake' }] }),
          { status: 200 },
        ),
    );
    const budget = new FakeBudget();

    const deps = await buildChannelDependencies({
      mode: 'real',
      env: COMPLETE_ENV,
      secretStore: await buildCompleteSecretStore(),
      openSendAttemptBudget: () => budget,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    expect(deps.transport).toBeInstanceOf(BudgetedOutboundTransport);
    expect(deps.config).toEqual({
      verifyToken: 'fake-verify-token',
      appSecret: 'fake-app-secret',
      allowedSenderId: COMPLETE_ENV.WHATSAPP_ALLOWED_SENDER_ID,
    });

    const result = await deps.transport.send({
      recipientId: '33600000002',
      text: 'essai synthétique',
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'sent' });
    expect(budget.getState()?.status).toBe('sent');
  });

  it('le service conversationnel reste le provider simulé en mode réel aussi — point 4, aucun LLM réel', async () => {
    const deps = await buildChannelDependencies({
      mode: 'real',
      env: COMPLETE_ENV,
      secretStore: await buildCompleteSecretStore(),
      openSendAttemptBudget: () => new FakeBudget(),
      fetchFn: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    const result = await deps.conversationalService.reply({ senderId: 's1', text: 'bonjour' });
    expect(result).toEqual({ status: 'ok', text: 'réponse simulée' });
  });
});
