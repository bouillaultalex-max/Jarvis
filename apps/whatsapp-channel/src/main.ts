import { AgentLoopConversationalService } from './agent-loop-conversational-service.js';
import {
  buildLocalSyntheticConfig,
  DEFAULT_QUEUE_MAX_CONCURRENCY,
  DEFAULT_QUEUE_MAX_SIZE,
} from './config.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { InMemoryDeduplicator } from './in-memory-deduplicator.js';
import { LocalMessageQueue } from './local-message-queue.js';
import { SimulatedLlmProvider } from './simulated-llm-provider.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import { buildWhatsAppChannelServer } from './server.js';
import { HmacSha256SignatureVerifier } from './webhook-signature.js';

/**
 * Bootstrap local — **aucun secret réel, aucun réseau métier**. Démarre
 * avec une configuration synthétique explicite (`config.ts`) et des
 * doubles (`SimulatedLlmProvider`, `SimulatedOutboundTransport`) :
 * `AnthropicProvider` réel n'est jamais construit ici. Lié strictement à
 * `127.0.0.1` — aucun mode public dans cette tranche.
 */
const config = buildLocalSyntheticConfig();

const allowlist = new InMemoryAllowlist(new Set([config.allowedSenderId]));

const queue = new LocalMessageQueue({
  deduplicator: new InMemoryDeduplicator(),
  allowlist,
  conversationalService: new AgentLoopConversationalService(new SimulatedLlmProvider()),
  transport: new SimulatedOutboundTransport(),
  maxQueueSize: DEFAULT_QUEUE_MAX_SIZE,
  maxConcurrency: DEFAULT_QUEUE_MAX_CONCURRENCY,
});

const app = buildWhatsAppChannelServer({
  config,
  allowlist,
  signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
  queue,
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const HOST = '127.0.0.1';

app
  .listen({ port, host: HOST })
  .then((address) => {
    console.log(`🤖 JARVIS WhatsApp channel (local, simulé) à l'écoute sur ${address}`);
  })
  .catch((err) => {
    console.error('Échec du démarrage du canal WhatsApp :', err);
    process.exit(1);
  });

/**
 * Fermeture maîtrisée et bornée : arrête d'accepter des requêtes, puis
 * laisse la file se vider au plus {@link SHUTDOWN_DRAIN_TIMEOUT_MS}. Si du
 * travail est toujours en cours à l'échéance, ce délai ne l'annule jamais
 * (aucune annulation réelle possible sur les ports actuels — voir
 * `local-message-queue.ts`) : il est seulement rapporté, jamais masqué.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

async function shutdown(): Promise<void> {
  await app.close();
  const result = await queue.close(SHUTDOWN_DRAIN_TIMEOUT_MS);
  if (result.status === 'closed_with_pending_work') {
    console.warn(
      `Arrêt après ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms : ${result.activeCount} traitement(s) encore en ` +
        `cours, ${result.pendingCount} en attente — travail abandonné à l'arrêt du process (file volatile).`,
    );
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
