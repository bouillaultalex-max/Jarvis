import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/core';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import { ConfirmationService } from '@jarvis/connectors';

import { buildServer } from './server.js';
import { PendingConfirmations } from './pending-confirmations.js';
import {
  INTERNAL_FAKE_EXECUTE_TOOL_NAME,
  internalFakeExecuteTool,
} from './tools/internal-fake-tool.js';

/** Faux provider : enregistre les appels, renvoie une réponse fixe, zéro réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  public response: LlmResponse = { content: 'réponse simulée' };

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}

describe('POST /chat', () => {
  it('transmet un message valide à AgentLoop et renvoie le contenu', async () => {
    const provider = new MockLlmProvider();
    provider.response = { content: 'Bonjour, je suis JARVIS.' };
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'Bonjour' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ content: 'Bonjour, je suis JARVIS.' });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });

  it('renvoie 400 si le corps JSON est absent', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({ method: 'POST', url: '/chat' });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si le corps est un JSON non-objet', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { 'content-type': 'application/json' },
      payload: '"just a string"',
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » est absent', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { autre: 'valeur' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » n’est pas une chaîne', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » est vide', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » ne contient que des espaces', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: '   \t \n ' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });
});

/**
 * Environnement de test pour le protocole de confirmation (ADR-0008/0009) :
 * un vrai `ToolRegistry`/`ToolExecutor`/`ConfirmationService`/
 * `PendingConfirmations`, sans jamais dépendre d'un connecteur réel ni de
 * réseau. `now`/`ttlMs` sont injectables pour les scénarios d'expiration.
 */
function buildToolEnvironment(
  options: { now?: () => number; ttlMs?: number; deny?: boolean } = {},
) {
  const registry = new ToolRegistry();
  registry.register(internalFakeExecuteTool);

  const permissions = new PermissionManager({
    actionDefaults: { execute: options.deny === true ? 'deny' : 'require_confirmation' },
    default: 'deny',
  });

  const toolExecutor = new ToolExecutor(registry, permissions);
  const confirmationService = new ConfirmationService(
    options.now !== undefined || options.ttlMs !== undefined
      ? { now: options.now, ttlMs: options.ttlMs }
      : {},
  );
  const pendingConfirmations = new PendingConfirmations(
    options.now !== undefined ? { now: options.now } : {},
  );

  return { toolExecutor, confirmationService, pendingConfirmations };
}

function toolCallResponse(
  input: unknown,
  content = 'Une confirmation est nécessaire.',
): LlmResponse {
  return { content, toolCall: { id: 'call-1', tool: INTERNAL_FAKE_EXECUTE_TOOL_NAME, input } };
}

describe('POST /chat — protocole de confirmation (ADR-0008/0009)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renvoie 202 avec une ConfirmationRequest sans secret ni ticket brut (awaiting_confirmation)', async () => {
    const provider = new MockLlmProvider();
    provider.response = toolCallResponse({ mode: 'confirm' });
    const env = buildToolEnvironment();
    const app = buildServer(provider, env);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'Confirme.' },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('confirmation_required');
    expect(body.confirmation).toMatchObject({
      toolName: INTERNAL_FAKE_EXECUTE_TOOL_NAME,
      action: 'execute',
      account: {
        accountId: 'internal-fake-tool',
        provider: 'internal',
        accountIdentifier: 'internal-fake-tool',
      },
    });
    // Assertions négatives de sécurité : la vue de compte restreinte
    // (ConfirmationAccountView) ne porte jamais `status`/`createdAt`/
    // `updatedAt`/`metadata` — seuls des champs propres à ConfirmationRequest
    // lui-même (créé/expire) apparaissent au niveau racine, ce qui est attendu.
    expect(body.confirmation.account).toStrictEqual({
      accountId: 'internal-fake-tool',
      provider: 'internal',
      accountIdentifier: 'internal-fake-tool',
    });
    expect(body.confirmation.account).not.toHaveProperty('status');
    expect(body.confirmation.account).not.toHaveProperty('createdAt');
    expect(body.confirmation.account).not.toHaveProperty('updatedAt');
    expect(body.confirmation.account).not.toHaveProperty('metadata');

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/fingerprint/i);
    expect(raw).not.toMatch(/secret|token|refreshToken|accessToken|clientSecret|apiKey/i);
    expect(raw).not.toMatch(/oauth|clientId|redirectUri|scope=/i);
    expect(raw).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // pas de stack trace
  });

  it('renvoie 422 avec le message fixe pour un input invalide (jamais avant de créer un ticket)', async () => {
    const provider = new MockLlmProvider();
    provider.response = toolCallResponse({ mode: 'bogus' });
    const env = buildToolEnvironment();
    const app = buildServer(provider, env);

    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'x' } });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ status: 'invalid_tool_input', reason: 'Invalid tool input.' });
  });

  it('renvoie 403 avec le message fixe si la policy refuse l’outil (denied avant confirmation)', async () => {
    const provider = new MockLlmProvider();
    provider.response = toolCallResponse({ mode: 'confirm' });
    const env = buildToolEnvironment({ deny: true });
    const app = buildServer(provider, env);

    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'x' } });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ status: 'tool_denied', reason: 'Action denied by policy.' });
  });

  it('renvoie 500 générique si le LLM demande un outil inconnu, sans jamais nommer l’outil', async () => {
    const provider = new MockLlmProvider();
    provider.response = {
      content: '...',
      toolCall: { id: 'call-1', tool: 'some.unregistered.tool', input: {} },
    };
    const env = buildToolEnvironment();
    const app = buildServer(provider, env);

    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'x' } });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ status: 'internal_tool_error', reason: 'Internal tool error.' });
    expect(res.body).not.toContain('some.unregistered.tool');
  });
});

describe('POST /chat/confirmations/:id — protocole de confirmation (ADR-0008/0009)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function proposeConfirmationViaChat(
    env: ReturnType<typeof buildToolEnvironment>,
    mode: 'confirm' | 'error',
  ): Promise<{ app: ReturnType<typeof buildServer>; confirmationId: string }> {
    const provider = new MockLlmProvider();
    provider.response = toolCallResponse({ mode });
    const app = buildServer(provider, env);

    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'x' } });
    expect(res.statusCode).toBe(202);
    const confirmationId: string = res.json().confirmation.confirmationId;
    return { app, confirmationId };
  }

  it('approve:true exécute exactement une fois via ConfirmationService puis ToolExecutor', async () => {
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    const res = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mode: 'confirm' });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('approve:false renvoie le corps exact du refus, sans payload ni secret', async () => {
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    const res = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'confirmation_denied' });
  });

  it('confirmationId inconnu → 404', async () => {
    const env = buildToolEnvironment();
    const app = buildServer(new MockLlmProvider(), env);

    const res = await app.inject({
      method: 'POST',
      url: '/chat/confirmations/never-existed',
      payload: { approve: true },
    });

    expect(res.statusCode).toBe(404);
  });

  it('ticket expiré → 409 générique, jamais exécuté', async () => {
    let now = 1_000_000;
    const env = buildToolEnvironment({ now: () => now, ttlMs: 1_000 });
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    now += 2_000; // au-delà du ttlMs

    const res = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });

    expect(res.statusCode).toBe(409);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('ticket déjà consommé (rejeu après approbation) → 409, une seule exécution réelle', async () => {
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    const first = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('ticket déjà refusé (rejeu approve:true après approve:false) → 409, aucune exécution', async () => {
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: false },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });

    expect(res.statusCode).toBe(409);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('mode error confirmé → 502 ; rejeu → 409, une seule exécution réelle, aucune nouvelle confirmation', async () => {
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'error');

    const first = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });
    expect(first.statusCode).toBe(502);
    expect(first.json()).toEqual({
      status: 'tool_execution_failed',
      reason: 'Tool execution failed.',
    });

    const replay = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true },
    });

    expect(replay.statusCode).toBe(409);
    expect(replay.json()).not.toHaveProperty('confirmation');
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('deux approbations concurrentes sur le même id → exactement une exécution', async () => {
    const executeSpy = vi.spyOn(internalFakeExecuteTool, 'execute');
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/chat/confirmations/${confirmationId}`,
        payload: { approve: true },
      }),
      app.inject({
        method: 'POST',
        url: `/chat/confirmations/${confirmationId}`,
        payload: { approve: true },
      }),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('corps malformé (clé en trop) → 400, aucune consommation du ticket', async () => {
    const env = buildToolEnvironment();
    const { app, confirmationId } = await proposeConfirmationViaChat(env, 'confirm');

    const res = await app.inject({
      method: 'POST',
      url: `/chat/confirmations/${confirmationId}`,
      payload: { approve: true, input: { mode: 'confirm' } },
    });

    expect(res.statusCode).toBe(400);
  });
});
