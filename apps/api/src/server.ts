import Fastify, { type FastifyInstance } from 'fastify';
import { AgentLoop, type LlmProvider } from '@jarvis/core';

/**
 * Construit le serveur HTTP de l'API JARVIS.
 *
 * Le provider LLM est injecté : `main.ts` fournit un `AnthropicProvider`, les
 * tests fournissent un faux provider. Le serveur ne connaît que l'abstraction
 * {@link LlmProvider} et n'effectue aucun appel réseau par lui-même.
 *
 *   POST /chat  { "message": string }  →  { "content": string }
 */
export function buildServer(llm: LlmProvider): FastifyInstance {
  const app = Fastify({ logger: false });
  const agent = new AgentLoop(llm);

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
      const content = await agent.process(message);
      return reply.send({ content });
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

  return app;
}
