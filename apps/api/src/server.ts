import Fastify, { type FastifyInstance } from 'fastify';
import { AgentLoop, type LlmProvider, type ToolExecutor } from '@jarvis/core';
import {
  ConfirmationService,
  buildConfirmationRequest,
  confirmAndExecute,
  type Account,
} from '@jarvis/connectors';

import { PendingConfirmations } from './pending-confirmations.js';
import {
  confirmationDeniedResponse,
  mapChatToolBlockedResult,
  mapConfirmAndExecuteResult,
} from './http-mapping.js';

/**
 * Construit le serveur HTTP de l'API JARVIS.
 *
 * Le provider LLM est injecté : `main.ts` fournit un `AnthropicProvider`, les
 * tests fournissent un faux provider. Le serveur ne connaît que l'abstraction
 * {@link LlmProvider} et n'effectue aucun appel réseau par lui-même.
 *
 *   POST /chat  { "message": string }  →  { "content": string }
 *
 * Protocole de confirmation (ADR-0008, ADR-0009), activé uniquement si
 * `toolExecutor` est fourni — comportement historique strictement inchangé
 * en son absence (ex. tests existants appelant `buildServer(llm)` seul) :
 *
 *   POST /chat  → 202 { status: "confirmation_required", confirmation }
 *   POST /chat/confirmations/:confirmationId  { approve: boolean }
 */
export interface BuildServerDependencies {
  /** Absent → aucun outil n'est présenté au LLM, comportement historique inchangé. */
  readonly toolExecutor?: ToolExecutor;
  /** Défaut : nouvelle instance dédiée à ce serveur. */
  readonly confirmationService?: ConfirmationService;
  /** Défaut : nouvelle table pending dédiée à ce serveur. */
  readonly pendingConfirmations?: PendingConfirmations;
  /**
   * Compte synthétique utilisé pour construire le `ConfirmationRequest` de
   * l'outil factice interne (ADR-0009 §7) — jamais persisté, jamais une
   * authentification réelle, jamais réutilisable par un connecteur réel.
   */
  readonly syntheticAccount?: Account;
}

const SYNTHETIC_ACCOUNT_ID = 'internal-fake-tool';

function buildDefaultSyntheticAccount(): Account {
  const nowIso = new Date().toISOString();
  return {
    id: SYNTHETIC_ACCOUNT_ID,
    provider: 'internal',
    accountIdentifier: SYNTHETIC_ACCOUNT_ID,
    status: 'connected',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function buildServer(llm: LlmProvider, deps: BuildServerDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const { toolExecutor } = deps;
  const confirmationService = deps.confirmationService ?? new ConfirmationService();
  const pendingConfirmations = deps.pendingConfirmations ?? new PendingConfirmations();
  const syntheticAccount = deps.syntheticAccount ?? buildDefaultSyntheticAccount();

  const agent = new AgentLoop(llm, { toolExecutor });

  app.post('/chat', async (request, reply) => {
    const body = request.body;

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Corps de requête JSON manquant ou invalide.' });
    }

    const { message } = body as Record<string, unknown>;

    if (message === undefined || message === null) {
      return reply.code(400).send({ error: 'Champ « message » manquant.' });
    }

    if (typeof message !== 'string') {
      return reply.code(400).send({ error: 'Le champ « message » doit être une chaîne.' });
    }

    if (message.trim().length === 0) {
      return reply.code(400).send({ error: 'Le champ « message » est vide.' });
    }

    try {
      const result = await agent.run(message);

      if (result.stopReason === 'llm_final') {
        return reply.send({ content: result.content });
      }

      // `tool_blocked`, ou `max_iterations` (non spécifié par ADR-0008/0009,
      // structurellement inatteignable avec la policy actuelle — voir
      // `mapChatToolBlockedResult`) : la distinction se fait sur le dernier
      // `toolOutcome`, jamais sur `stopReason` seul.
      const last = result.toolOutcomes[result.toolOutcomes.length - 1];

      if (last?.status === 'awaiting_confirmation') {
        const payload = {
          toolName: last.toolName,
          action: last.action,
          accountId: syntheticAccount.id,
          input: last.input,
        };
        const createdAt = new Date().toISOString();
        const ticket = await confirmationService.create(payload);
        const confirmationRequest = buildConfirmationRequest({
          confirmationId: ticket.confirmationId,
          createdAt,
          expiresAt: ticket.expiresAt,
          toolName: last.toolName,
          action: last.action,
          account: syntheticAccount,
          summary: { fields: [] },
        });
        pendingConfirmations.set(ticket.confirmationId, { payload, expiresAt: ticket.expiresAt });

        const mapped = mapChatToolBlockedResult(last, confirmationRequest);
        return reply.code(mapped.code).send(mapped.body);
      }

      const mapped = mapChatToolBlockedResult(last);
      return reply.code(mapped.code).send(mapped.body);
    } catch (err) {
      // On ne renvoie jamais le message d'erreur brut au client (défense en
      // profondeur : aucune fuite de configuration ou de clé).
      const detail = err instanceof Error ? err.message : '';
      if (detail.includes('ANTHROPIC_API_KEY manquante')) {
        return reply
          .code(503)
          .send({ error: 'Service LLM non configuré : ANTHROPIC_API_KEY absente côté serveur.' });
      }
      request.log.error(err);
      return reply.code(502).send({ error: 'Le fournisseur LLM a renvoyé une erreur.' });
    }
  });

  app.post('/chat/confirmations/:confirmationId', async (request, reply) => {
    const { confirmationId } = request.params as { confirmationId: string };
    const body = request.body;

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Corps de requête JSON manquant ou invalide.' });
    }

    const keys = Object.keys(body as Record<string, unknown>);
    const approve = (body as Record<string, unknown>).approve;

    if (keys.length !== 1 || keys[0] !== 'approve' || typeof approve !== 'boolean') {
      return reply
        .code(400)
        .send({ error: 'Corps invalide : seul « { approve: boolean } » est accepté.' });
    }

    const entry = pendingConfirmations.get(confirmationId);
    if (entry === undefined) {
      return reply.code(404).send({ status: 'confirmation_not_found' });
    }

    if (toolExecutor === undefined) {
      // Aucun ToolExecutor construit (ex. `buildServer(llm)` historique) :
      // aucune exécution ne peut structurellement avoir lieu.
      return reply
        .code(500)
        .send({ status: 'internal_tool_error', reason: 'Internal tool error.' });
    }

    if (approve === false) {
      await confirmationService.deny(confirmationId);
      const mapped = confirmationDeniedResponse();
      return reply.code(mapped.code).send(mapped.body);
    }

    const result = await confirmAndExecute({
      executor: toolExecutor,
      confirmationService,
      confirmationId,
      payload: entry.payload,
    });

    const mapped = mapConfirmAndExecuteResult(result);
    return reply.code(mapped.code).send(mapped.body);
  });

  return app;
}
