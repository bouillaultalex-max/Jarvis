import { OsCredentialSecretStore } from '@jarvis/connectors';

import { buildChannelDependencies } from './build-channel-dependencies.js';
import { InvalidChannelModeError, resolveChannelMode } from './channel-mode.js';
import { DEFAULT_QUEUE_MAX_CONCURRENCY } from './config.js';
import { resolveMessagesDbPath, resolveSendAttemptBudgetDbPath } from './data-path.js';
import { DurableMessageWorker } from './durable-message-worker.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { ExclusivityError, UnsupportedSchemaError } from './message-store.js';
import { IncompleteRealConfigError, SecretNotFoundError } from './real-whatsapp-config.js';
import { buildWhatsAppChannelServer } from './server.js';
import { SqliteSendAttemptBudget } from './sqlite-send-attempt-budget.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
import { HmacSha256SignatureVerifier } from './webhook-signature.js';

/**
 * Bootstrap — **aucun secret réel lu, aucun réseau métier, aucun mode réel
 * activé** tant que `WHATSAPP_CHANNEL_MODE=real` n'est pas explicitement
 * positionné (défaut : `simulated`, comportement inchangé). Voir
 * `channel-mode.ts`/`build-channel-dependencies.ts`.
 *
 * Ordre délibéré : la configuration (mode + dépendances) est entièrement
 * résolue et validée **avant** d'ouvrir quelque store que ce soit — un
 * mode réel mal configuré échoue avant tout effet de bord, jamais après
 * avoir déjà acquis l'exclusivité ou créé un fichier.
 */
async function bootstrap(): Promise<void> {
  const mode = resolveChannelMode(process.env);
  console.log(`🤖 Canal WhatsApp — mode : ${mode}.`);

  const secretStore = new OsCredentialSecretStore();
  const dependencies = await buildChannelDependencies({
    mode,
    env: process.env,
    secretStore,
    openSendAttemptBudget: () =>
      SqliteSendAttemptBudget.open({ filePath: resolveSendAttemptBudgetDbPath(mode), mode }),
  });

  const allowlist = new InMemoryAllowlist(new Set([dependencies.config.allowedSenderId]));

  let store: SqliteMessageStore;
  try {
    store = SqliteMessageStore.open({ filePath: resolveMessagesDbPath(mode), mode });
  } catch (err) {
    if (err instanceof ExclusivityError) {
      throw new Error(
        `Démarrage refusé : un autre process détient déjà l'exclusivité sur le store de ` +
          `réception durable. Un seul worker exclusif est supporté (ADR-0023). Détail : ${err.message}`,
      );
    }
    if (err instanceof UnsupportedSchemaError) {
      throw new Error(`Démarrage refusé : ${err.message}`);
    }
    throw err;
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
    conversationalService: dependencies.conversationalService,
    transport: dependencies.transport,
    maxConcurrency: DEFAULT_QUEUE_MAX_CONCURRENCY,
  });
  worker.start();

  const app = buildWhatsAppChannelServer({
    config: dependencies.config,
    allowlist,
    signatureVerifier: new HmacSha256SignatureVerifier(dependencies.config.appSecret),
    worker,
  });

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  const HOST = '127.0.0.1';

  await app.listen({ port, host: HOST });
  console.log(
    `🤖 JARVIS WhatsApp channel (${mode}, réception durable) à l'écoute sur 127.0.0.1:${port}.`,
  );

  /**
   * Fermeture maîtrisée et bornée — voir l'historique de ce fichier
   * (ADR-0023 suite) : le store n'est jamais fermé explicitement tant
   * qu'un envoi peut encore être en vol ; seule la terminaison du process
   * libère alors le verrou OS, de façon atomique.
   */
  const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

  async function shutdown(): Promise<void> {
    await app.close();
    const result = await worker.close(SHUTDOWN_DRAIN_TIMEOUT_MS);
    if (result.status === 'closed_with_pending_work') {
      console.warn(
        `Arrêt après ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms : ${result.activeCount} traitement(s) encore en ` +
          `cours, un envoi peut encore être en vol — le store n'est PAS fermé explicitement. ` +
          `Repris au prochain démarrage (voir recoverAfterRestart()).`,
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
}

bootstrap().catch((err: unknown) => {
  // Jamais de pile ni de détail brut ici au-delà du message déjà contrôlé
  // par chaque type d'erreur connu — voir les classes importées ci-dessus,
  // aucune ne cite de valeur de secret.
  if (
    err instanceof InvalidChannelModeError ||
    err instanceof IncompleteRealConfigError ||
    err instanceof SecretNotFoundError
  ) {
    console.error(`Démarrage refusé : ${err.message}`);
  } else {
    console.error('Démarrage refusé :', err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
