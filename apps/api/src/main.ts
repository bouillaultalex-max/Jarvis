import { AnthropicProvider } from '@jarvis/llm';

import { buildServer } from './server.js';

// Graphe : AnthropicProvider (LlmProvider) → AgentLoop → serveur HTTP.
// L'instanciation ne requiert pas ANTHROPIC_API_KEY ; une requête /chat sans
// clé renverra une erreur 503 contrôlée.
const llm = new AnthropicProvider();
const app = buildServer(llm);

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
