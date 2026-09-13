import { AnthropicProvider } from '@jarvis/llm';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import { ConfirmationService } from '@jarvis/connectors';

import { internalFakeExecuteTool } from './tools/internal-fake-tool.js';
import { PendingConfirmations } from './pending-confirmations.js';
import { buildServer } from './server.js';

// Graphe : AnthropicProvider (LlmProvider) → AgentLoop → serveur HTTP.
// L'instanciation ne requiert pas ANTHROPIC_API_KEY ; une requête /chat sans
// clé renverra une erreur 503 contrôlée.
const llm = new AnthropicProvider();

// Outil factice intérimaire (ADR-0009) : aucun connecteur réel, aucun
// compte OAuth, aucun secret. Sert uniquement à valider le protocole de
// confirmation HTTP d'ADR-0008.
const registry = new ToolRegistry();
registry.register(internalFakeExecuteTool);

const permissions = new PermissionManager({
  actionDefaults: { read: 'allow', prepare: 'allow', execute: 'require_confirmation' },
  default: 'deny',
});

const toolExecutor = new ToolExecutor(registry, permissions);
const confirmationService = new ConfirmationService();
const pendingConfirmations = new PendingConfirmations();

const app = buildServer(llm, { toolExecutor, confirmationService, pendingConfirmations });

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';

app
  .listen({ port, host })
  .then((address) => {
    console.log(`🤖 JARVIS API à l'écoute sur ${address}`);
  })
  .catch((err) => {
    console.error('Échec du démarrage de JARVIS API :', err);
    process.exit(1);
  });
