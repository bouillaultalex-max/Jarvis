import { AgentLoopConversationalService } from './agent-loop-conversational-service.js';
import { buildLocalSyntheticConfig, DEFAULT_QUEUE_MAX_CONCURRENCY } from './config.js';
import { resolveMessagesDbPath } from './data-path.js';
import { DurableMessageWorker } from './durable-message-worker.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { ExclusivityError, UnsupportedSchemaError } from './message-store.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
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
 *
 * Réception durable (ADR-0023) : le store SQLite acquiert l'exclusivité de
 * process **avant** toute reprise (`recoverAfterRestart`), elle-même
 * **avant** `app.listen()` — voir `sqlite-message-store.ts`.
 */
const config = buildLocalSyntheticConfig();
const allowlist = new InMemoryAllowlist(new Set([config.allowedSenderId]));

let store: SqliteMessageStore;
try {
  store = SqliteMessageStore.open({ filePath: resolveMessagesDbPath() });
} catch (err) {
  if (err instanceof ExclusivityError) {
    console.error(
      `Impossible de démarrer : un autre process détient déjà l'exclusivité sur le store ` +
        `de réception durable. Un seul worker exclusif est supporté dans cette tranche ` +
        `(ADR-0023). Détail : ${err.message}`,
    );
  } else if (err instanceof UnsupportedSchemaError) {
    console.error(`Impossible de démarrer : ${err.message}`);
  } else {
    console.error('Impossible de démarrer le store de réception durable :', err);
  }
  process.exit(1);
}

const recovery = store.recoverAfterRestart(new Date().toISOString());
if (
  recovery.resumedProcessing > 0 ||
  recovery.quarantinedSending > 0 ||
  recovery.pendingResponseReady > 0
) {
  console.log(
    `🤖 Reprise après redémarrage : ${recovery.resumedProcessing} traitement(s) relancé(s) depuis zéro, ` +
      `${recovery.quarantinedSending} envoi(s) en quarantaine (« uncertain », jamais relancé automatiquement), ` +
      `${recovery.pendingResponseReady} réponse(s) déjà générée(s) en attente d'envoi.`,
  );
}

const worker = new DurableMessageWorker({
  store,
  allowlist,
  conversationalService: new AgentLoopConversationalService(new SimulatedLlmProvider()),
  transport: new SimulatedOutboundTransport(),
  maxConcurrency: DEFAULT_QUEUE_MAX_CONCURRENCY,
});
worker.start();

const app = buildWhatsAppChannelServer({
  config,
  allowlist,
  signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
  worker,
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const HOST = '127.0.0.1';

app
  .listen({ port, host: HOST })
  .then((address) => {
    console.log(
      `🤖 JARVIS WhatsApp channel (local, simulé, réception durable) à l'écoute sur ${address}`,
    );
  })
  .catch((err) => {
    console.error('Échec du démarrage du canal WhatsApp :', err);
    process.exit(1);
  });

/**
 * Fermeture maîtrisée et bornée : arrête d'accepter des requêtes, laisse le
 * worker se vider au plus {@link SHUTDOWN_DRAIN_TIMEOUT_MS}. Cesser
 * d'**attendre** à l'échéance n'**annule** jamais un envoi en cours
 * (aucun contrat d'annulation sur les ports actuels) — ce délai ne fait
 * que décider jusqu'où ce process patiente, pas ce que le travail en vol
 * devient réellement.
 *
 * **Le verrou SQLite n'est jamais relâché explicitement tant qu'un envoi
 * peut encore être en vol.** Si `worker.close()` rapporte du travail
 * encore actif à l'échéance, `store.close()` n'est **pas** appelé : fermer
 * le store libérerait le verrou OS pendant qu'un `fetch()` en cours
 * pourrait encore aboutir (une exception de `fetch` ne prouve jamais une
 * absence d'envoi, voir `durable-message-worker.ts`) — un second process
 * démarré dans cette fenêtre pourrait alors reprendre et traiter le **même**
 * message, provoquant un double envoi réel. Dans ce cas, la seule
 * fermeture **sûre** du verrou est la **terminaison du process**
 * (`process.exit(1)`, qui libère le verrou OS atomiquement à la mort du
 * process — vérifié empiriquement même sous `SIGKILL`, voir
 * `sqlite-message-store.ts`) : on ne prétend **pas** pouvoir rendre la main
 * « proprement » pendant qu'un envoi reste ambigu. Le store reste cohérent
 * dans tous les cas : une ligne encore `sending`/`processing` à la
 * terminaison du process sera reprise par `recoverAfterRestart()` au
 * prochain démarrage.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

async function shutdown(): Promise<void> {
  await app.close();
  const result = await worker.close(SHUTDOWN_DRAIN_TIMEOUT_MS);
  if (result.status === 'closed_with_pending_work') {
    console.warn(
      `Arrêt après ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms : ${result.activeCount} traitement(s) encore en ` +
        `cours, un envoi peut encore être en vol — le store n'est PAS fermé explicitement ` +
        `(garder le verrou jusqu'à la terminaison réelle du process, jamais une fermeture ` +
        `« propre » pendant que ce travail reste ambigu). Repris au prochain démarrage ` +
        `(voir recoverAfterRestart()).`,
    );
    process.exit(1);
    return;
  }
  store.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
