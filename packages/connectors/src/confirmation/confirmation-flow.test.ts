import { describe, expect, it, vi } from 'vitest';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type Tool,
  type ToolExecutionResult,
} from '@jarvis/core';

import type { Account } from '../account.js';
import { InMemoryMailClient } from '../in-memory/in-memory-client.js';
import { inMemoryConnector } from '../in-memory/in-memory-connector.js';
import {
  confirmAndExecute,
  proposeConfirmation,
  type ConfirmAndExecuteResult,
  type ConfirmationFailed,
} from './confirmation-flow.js';
import type { ConfirmationInputSummary } from './confirmation-request.js';
import { ConfirmationService, type ConfirmationPayload } from './confirmation-service.js';

/**
 * Tests d'orchestration M8-A5 — utilisent exclusivement `inmemory.send`
 * (connecteur de test déjà existant, `action: 'execute'`) : aucun nouveau
 * connecteur fictif, aucune connaissance de Gmail.
 */

const SUMMARY: ConfirmationInputSummary = {
  fields: [{ key: 'to', label: 'Destinataire', value: 'carol@example.test' }],
};

function makeAccount(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    provider: 'inmemory',
    accountIdentifier: `${id}@example.test`,
    status: 'connected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildExecutor(
  client: InMemoryMailClient,
  sendDecision: 'allow' | 'deny' | 'require_confirmation',
): ToolExecutor {
  const registry = new ToolRegistry();
  for (const tool of inMemoryConnector.createTools(client)) {
    registry.register(tool);
  }
  const permissions = new PermissionManager({ rules: { 'inmemory.send': sendDecision } });
  return new ToolExecutor(registry, permissions);
}

/** Extrait le payload exact proposé par `ToolExecutor` — jamais reconstruit arbitrairement. */
function payloadFrom(result: ToolExecutionResult, accountId: string): ConfirmationPayload {
  if (result.status !== 'awaiting_confirmation') {
    throw new Error(`Statut inattendu pour ce test : « ${result.status} ».`);
  }
  return { toolName: result.toolName, action: result.action, accountId, input: result.input };
}

const SEND_INPUT = { to: 'carol@example.test', subject: 'Salut', body: 'ça marche' };

describe('confirmation-flow — nominal', () => {
  it('propose → awaiting_confirmation + ConfirmationRequest → confirm → executed', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });

    expect(proposed.result.status).toBe('awaiting_confirmation');
    expect(proposed.confirmationRequest).toBeDefined();
    expect(proposed.confirmationRequest?.toolName).toBe('inmemory.send');
    expect(proposed.confirmationRequest?.action).toBe('execute');
    expect(proposed.confirmationRequest?.account.accountId).toBe('acc-1');
    expect(client.listSent()).toHaveLength(0);

    const payload = payloadFrom(proposed.result, account.id);
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('executed');
    expect(client.listSent()).toHaveLength(1);
    expect(client.listSent()[0]).toMatchObject({ to: 'carol@example.test' });
  });

  it('un résultat immédiatement "executed" (politique allow) ne produit aucun ConfirmationRequest', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'allow');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });

    expect(proposed.result.status).toBe('executed');
    expect(proposed.confirmationRequest).toBeUndefined();
    expect(client.listSent()).toHaveLength(1);
  });
});

describe('confirmation-flow — PermissionManager reste souverain', () => {
  it('deny : propose → denied, aucun ConfirmationRequest, aucune exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'deny');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });

    expect(proposed.result.status).toBe('denied');
    expect(proposed.confirmationRequest).toBeUndefined();
    expect(client.listSent()).toHaveLength(0);
  });

  it('deny : un ticket valide ne contourne jamais PermissionManager (confirmAndExecute → denied)', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'deny');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');
    const payload: ConfirmationPayload = {
      toolName: 'inmemory.send',
      action: 'execute',
      accountId: account.id,
      input: SEND_INPUT,
    };

    // Ticket créé directement (hors propose, puisque deny n'en crée jamais) : prouve
    // qu'un ticket valide n'est pas, à lui seul, une autorisation.
    const ticket = await confirmationService.create(payload);

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: ticket.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('denied');
    expect(client.listSent()).toHaveLength(0);
  });
});

describe('confirmation-flow — intégrité du ticket (ConfirmationService.verify)', () => {
  it('payload modifié entre propose et confirm → payload_mismatch, ToolExecutor.run jamais appelé', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const originalPayload = payloadFrom(proposed.result, account.id);

    const runSpy = vi.spyOn(executor, 'run');
    const tamperedPayload: ConfirmationPayload = {
      ...originalPayload,
      input: { to: 'carol@example.test', subject: 'Salut', body: 'TAMPERED' },
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: tamperedPayload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('payload_mismatch');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);
  });

  it('ticket déjà consommé → confirmation_failed already_consumed, aucune seconde exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);
    const confirmationId = proposed.confirmationRequest!.confirmationId;

    const first = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });
    expect(first.status).toBe('executed');

    const runSpy = vi.spyOn(executor, 'run');
    const second = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });

    expect(second.status).toBe('confirmation_failed');
    expect((second as ConfirmationFailed).failureReason).toBe('already_consumed');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(1);
  });

  it('ticket expiré (horloge injectable existante) → confirmation_failed expired, aucune exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    let currentTimeMs = 0;
    const confirmationService = new ConfirmationService({ ttlMs: 1000, now: () => currentTimeMs });
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
      now: () => currentTimeMs,
    });
    const payload = payloadFrom(proposed.result, account.id);

    currentTimeMs += 2000; // dépasse le TTL de 1000ms

    const runSpy = vi.spyOn(executor, 'run');
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('expired');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);
  });

  it('ticket révoqué (revokeForAccount) → confirmation_failed revoked, aucune exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);

    await confirmationService.revokeForAccount(account.id);

    const runSpy = vi.spyOn(executor, 'run');
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('revoked');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);
  });

  it('mauvais compte : ticket(account-A) + payload(account-B) → échec, aucune exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const accountA = makeAccount('acc-A');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account: accountA,
      summary: SUMMARY,
    });
    const payloadA = payloadFrom(proposed.result, accountA.id);
    const payloadForAccountB: ConfirmationPayload = { ...payloadA, accountId: 'acc-B' };

    const runSpy = vi.spyOn(executor, 'run');
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: payloadForAccountB,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);
  });

  it('mauvais outil : ticket(tool-A) + payload(tool-B) → échec, aucune exécution', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payloadSend = payloadFrom(proposed.result, account.id);
    const payloadWrongTool: ConfirmationPayload = {
      ...payloadSend,
      toolName: 'inmemory.prepare_reply',
    };

    const runSpy = vi.spyOn(executor, 'run');
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: payloadWrongTool,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect(runSpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);
  });
});

describe('confirmation-flow — ordre strict verify() → ToolExecutor.run()', () => {
  it('verify() réussi est appelé avant ToolExecutor.run() (jamais l’inverse)', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);

    const callOrder: string[] = [];

    const originalVerify = confirmationService.verify.bind(confirmationService);
    vi.spyOn(confirmationService, 'verify').mockImplementation(async (...args) => {
      callOrder.push('verify');
      return originalVerify(...args);
    });

    const originalRun = executor.run.bind(executor);
    vi.spyOn(executor, 'run').mockImplementation(async (...args) => {
      callOrder.push('run');
      return originalRun(...args);
    });

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('executed');
    expect(callOrder).toEqual(['verify', 'run']);
  });

  it('verify() en échec → ToolExecutor.run() n’est jamais appelé', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);

    const runSpy = vi.spyOn(executor, 'run');

    // confirmationId inconnu du service : verify() échoue nécessairement (`not_found`).
    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: 'unknown-confirmation-id',
      payload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('not_found');
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe('confirmation-flow — permission ré-évaluée à l’exécution (ADR-0008 §5)', () => {
  it('politique passée à deny après la proposition → confirmAndExecute renvoie denied, aucune exécution, malgré un ticket valide', async () => {
    const client = new InMemoryMailClient();
    const registry = new ToolRegistry();
    for (const tool of inMemoryConnector.createTools(client)) {
      registry.register(tool);
    }
    // Instance de PermissionManager conservée localement (pas via buildExecutor)
    // pour pouvoir la modifier avec setRule() entre la proposition et la
    // confirmation — c'est exactement le scénario que ce test vérifie.
    const permissions = new PermissionManager({
      rules: { 'inmemory.send': 'require_confirmation' },
    });
    const executor = new ToolExecutor(registry, permissions);
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    expect(proposed.result.status).toBe('awaiting_confirmation');
    const payload = payloadFrom(proposed.result, account.id);
    const confirmationId = proposed.confirmationRequest!.confirmationId;

    // La politique change entre la proposition (ci-dessus) et la confirmation
    // (ci-dessous) — même PermissionManager, même outil, même ticket, valide.
    permissions.setRule('inmemory.send', 'deny');

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('denied');
    expect(client.listSent()).toHaveLength(0);

    // Le ticket a été consommé par le verify() réussi (avant la ré-évaluation
    // de permission) — même principe déjà couvert pour le cas « error » côté
    // apps/api (server.test.ts, « mode error confirmé »). Un rejeu échoue donc
    // pour « already_consumed », jamais par une nouvelle tentative d'exécution.
    const replay = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });
    expect(replay.status).toBe('confirmation_failed');
    expect((replay as ConfirmationFailed).failureReason).toBe('already_consumed');
    expect(client.listSent()).toHaveLength(0);
  });
});

describe('confirmation-flow — cohérence entre le payload vérifié et celui réellement exécuté', () => {
  it('payload.input muté juste après l’appel (avant résolution de la vérification) n’affecte jamais ce qui est réellement exécuté', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);
    const mutableInput = payload.input as { to: string; subject: string; body: string };
    const originalBody = mutableInput.body;

    const confirmedPromise = confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });
    // Mutation synchrone, dans le même tick que l'appel ci-dessus — avant que
    // confirmAndExecute() ne reprenne après son unique `await verify(...)`.
    // Simule un appelant qui conserverait (à tort) une référence mutable au
    // payload après l'avoir transmis.
    mutableInput.body = 'MUTÉ APRÈS L’APPEL — NE DOIT JAMAIS ÊTRE TRANSMIS À L’OUTIL';

    const confirmed = await confirmedPromise;

    expect(confirmed.status).toBe('executed');
    expect(client.listSent()).toHaveLength(1);
    expect(client.listSent()[0]).toMatchObject({ body: originalBody });
  });

  it('payload.toolName muté juste après l’appel (avant résolution) n’affecte jamais l’outil réellement recherché/exécuté', async () => {
    const client = new InMemoryMailClient();
    const registry = new ToolRegistry();
    for (const tool of inMemoryConnector.createTools(client)) {
      registry.register(tool);
    }
    let decoyExecuteCount = 0;
    // Outil leurre distinct, sous la même politique — ce test prouve qu'une
    // confirmation fingerprintée pour `inmemory.send` ne peut jamais être
    // redirigée vers un autre outil, même « execute », par une mutation
    // post-appel de `payload.toolName`.
    const decoyTool: Tool<Record<string, never>, { ok: true }> = {
      name: 'inmemory.decoy',
      description: 'outil leurre — ne doit jamais être invoqué par ce test',
      action: 'execute',
      inputSchema: { type: 'object', properties: {} },
      validateInput: () => ({ ok: true, value: {} }),
      execute: async () => {
        decoyExecuteCount += 1;
        return { ok: true };
      },
    };
    registry.register(decoyTool);
    const permissions = new PermissionManager({
      rules: { 'inmemory.send': 'require_confirmation', 'inmemory.decoy': 'require_confirmation' },
    });
    const executor = new ToolExecutor(registry, permissions);
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    expect(proposed.result.status).toBe('awaiting_confirmation');
    const payload = { ...payloadFrom(proposed.result, account.id) } as {
      toolName: string;
      action: ConfirmationPayload['action'];
      accountId: string;
      input: unknown;
    };

    const confirmedPromise = confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });
    // Mutation synchrone, dans le même tick que l'appel ci-dessus — avant que
    // confirmAndExecute() ne reprenne après son unique `await verify(...)`.
    payload.toolName = 'inmemory.decoy';

    const confirmed = await confirmedPromise;

    expect(decoyExecuteCount).toBe(0);
    expect(confirmed.status).toBe('executed');
    expect(client.listSent()).toHaveLength(1);
  });
});

describe('confirmation-flow — concurrence', () => {
  it('un même ticket soumis plusieurs fois produit exactement 1 exécution réussie', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);
    const confirmationId = proposed.confirmationRequest!.confirmationId;

    const results: ConfirmAndExecuteResult[] = await Promise.all(
      Array.from({ length: 5 }, () =>
        confirmAndExecute({ executor, confirmationService, confirmationId, payload }),
      ),
    );

    const executedCount = results.filter((r) => r.status === 'executed').length;
    expect(executedCount).toBe(1);
    expect(client.listSent()).toHaveLength(1);
  });
});

describe('confirmation-flow — sécurité', () => {
  const FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';

  it('un échec de confirmation n’expose jamais le contenu du payload', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: {
        tool: 'inmemory.send',
        input: {
          to: 'carol@example.test',
          subject: 'Salut',
          body: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
        },
      },
      account,
      summary: SUMMARY,
    });
    const originalPayload = payloadFrom(proposed.result, account.id);
    const tamperedPayload: ConfirmationPayload = {
      ...originalPayload,
      input: { to: 'carol@example.test', subject: 'Salut', body: 'autre chose' },
    };

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload: tamperedPayload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect(JSON.stringify(confirmed)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });

  it('le confirmationId n’apparaît jamais dans le ToolExecutionResult exécuté', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const payload = payloadFrom(proposed.result, account.id);
    const confirmationId = proposed.confirmationRequest!.confirmationId;

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('executed');
    expect(JSON.stringify(confirmed)).not.toContain(confirmationId);
  });

  it('l’orchestrateur n’introduit aucun champ non prévu du compte (ex. metadata) dans le ConfirmationRequest', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1', {
      metadata: { secretLike: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK },
    });

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });

    expect(JSON.stringify(proposed.confirmationRequest)).not.toContain(
      FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
    );
  });
});

describe('confirmation-flow — cohérence du chemin complet (create → verify → execute)', () => {
  it('un payload imbriqué (objets/tableaux) traverse propose → confirm sans aucune divergence entre ce qui a été fingerprinté et ce que l’outil reçoit réellement', async () => {
    const registry = new ToolRegistry();
    let received: unknown;
    const echoTool: Tool<unknown, { received: unknown }> = {
      name: 'test.echo-input',
      description: 'renvoie exactement l’input reçu — sonde de bout en bout',
      action: 'execute',
      inputSchema: { type: 'object', properties: {} },
      validateInput: (input) => ({ ok: true, value: input }),
      execute: async (input) => {
        received = input;
        return { received: input };
      },
    };
    registry.register(echoTool);
    const permissions = new PermissionManager({
      rules: { 'test.echo-input': 'require_confirmation' },
    });
    const executor = new ToolExecutor(registry, permissions);
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const richInput = {
      to: ['a@example.test', 'b@example.test'],
      meta: { priority: 2, tags: ['urgent', 'legal'], flags: { starred: true, archived: false } },
      note: null,
    };

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'test.echo-input', input: richInput },
      account,
      summary: SUMMARY,
    });
    expect(proposed.result.status).toBe('awaiting_confirmation');
    const payload = payloadFrom(proposed.result, account.id);

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId: proposed.confirmationRequest!.confirmationId,
      payload,
    });

    expect(confirmed.status).toBe('executed');
    // Ce que l'outil a réellement reçu (capture #3, confirmAndExecute) égale
    // exactement ce qui a été proposé à l'origine (avant capture #1, create()) —
    // aucune des trois captures indépendantes (create/verify/confirmAndExecute)
    // n'a fait diverger la donnée en chemin.
    expect(received).toEqual(richInput);
    expect(received).not.toBe(richInput);
  });
});

describe('confirmation-flow — contrat strict de `input` (confirmation-input-contract.ts)', () => {
  /** Outil de test dont `validateInput` laisse passer une valeur que le contrat de confirmation refuse — simule un `Tool` mal écrit. */
  function buildExecutorWithBadInputTool(): {
    executor: ToolExecutor;
    getterCalls: () => number;
  } {
    const registry = new ToolRegistry();
    let getterCalls = 0;
    const badInputTool: Tool<unknown, { ok: true }> = {
      name: 'test.bad-input',
      description: 'renvoie un input avec accesseur — simule un Tool mal écrit',
      action: 'execute',
      inputSchema: { type: 'object', properties: {} },
      validateInput: () => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(value, 'x', {
          get() {
            getterCalls += 1;
            return 'leaked';
          },
          enumerable: true,
        });
        return { ok: true, value };
      },
      execute: async () => ({ ok: true }),
    };
    registry.register(badInputTool);
    const permissions = new PermissionManager({
      rules: { 'test.bad-input': 'require_confirmation' },
    });
    return { executor: new ToolExecutor(registry, permissions), getterCalls: () => getterCalls };
  }

  it('proposeConfirmation : input refusé par le contrat → rejectedInput, aucun ConfirmationRequest, aucun ticket, accesseur jamais invoqué', async () => {
    const { executor, getterCalls } = buildExecutorWithBadInputTool();
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'test.bad-input', input: {} },
      account,
      summary: SUMMARY,
    });

    // Le résultat brut de ToolExecutor reste inchangé (contrat de @jarvis/core intact) :
    expect(proposed.result.status).toBe('awaiting_confirmation');
    expect(proposed.confirmationRequest).toBeUndefined();
    expect(proposed.rejectedInput).toBeDefined();
    expect(proposed.rejectedInput?.reason).toBe('accessor');
    expect(getterCalls()).toBe(0);
  });

  it('confirmAndExecute : payload.input déjà une valeur refusée (BigInt) au moment de l’appel → confirmation_failed, verify() jamais appelé, aucune exécution, ticket réutilisable ensuite', async () => {
    const client = new InMemoryMailClient();
    const executor = buildExecutor(client, 'require_confirmation');
    const confirmationService = new ConfirmationService();
    const account = makeAccount('acc-1');

    const proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: 'inmemory.send', input: SEND_INPUT },
      account,
      summary: SUMMARY,
    });
    const validPayload = payloadFrom(proposed.result, account.id);
    const confirmationId = proposed.confirmationRequest!.confirmationId;
    const tamperedPayload: ConfirmationPayload = { ...validPayload, input: { amount: 10n } };

    const verifySpy = vi.spyOn(confirmationService, 'verify');

    const confirmed = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload: tamperedPayload,
    });

    expect(confirmed.status).toBe('confirmation_failed');
    expect((confirmed as ConfirmationFailed).failureReason).toBe('payload_mismatch');
    // La capture (et son rejet) précède tout appel à verify() — un payload de
    // forme invalide ne consulte ni ne consomme jamais le ticket.
    expect(verifySpy).not.toHaveBeenCalled();
    expect(client.listSent()).toHaveLength(0);

    // Le ticket original reste utilisable avec le payload réellement proposé.
    const retry = await confirmAndExecute({
      executor,
      confirmationService,
      confirmationId,
      payload: validPayload,
    });
    expect(retry.status).toBe('executed');
    expect(client.listSent()).toHaveLength(1);
  });
});
