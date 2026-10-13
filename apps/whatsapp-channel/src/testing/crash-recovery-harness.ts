/**
 * Harnais de test **uniquement** (jamais importé par le code applicatif) —
 * exécuté comme un vrai sous-processus par
 * `durable-message-worker.crash-recovery.test.ts` pour prouver la reprise
 * après un arrêt brutal (`SIGKILL`) à une étape précise (ADR-0023).
 *
 * Avance un message unique, synthétique, jusqu'à l'étape demandée
 * (`process.argv[3]`), imprime un sentinel déterministe sur stdout une fois
 * cette étape atteinte, puis bloque indéfiniment (jamais de délai arbitraire
 * côté parent pour synchroniser — le parent attend ce sentinel exact avant
 * d'envoyer `SIGKILL`).
 */
import { SqliteMessageStore } from '../sqlite-message-store.js';

const PROVIDER_MESSAGE_ID = 'wamid.crash-test';
const SENDER_ID = '33600000000';
const RESPONSE_TEXT = 'réponse générée avant le crash simulé';

function nowIso(): string {
  return new Date().toISOString();
}

/** Garde l'event loop active jusqu'au `SIGKILL` du parent — n'arrête jamais le process lui-même. */
function haltForever(): void {
  console.log('HALT_READY');
  setInterval(() => {}, 1_000);
}

function main(): void {
  const [, , dbPath, haltAt] = process.argv;
  if (dbPath === undefined || haltAt === undefined) {
    console.error(
      'usage: crash-recovery-harness.ts <dbPath> <queued|processing|response_ready|sending|complete>',
    );
    process.exit(2);
  }

  const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
  store.admit({
    providerMessageId: PROVIDER_MESSAGE_ID,
    senderId: SENDER_ID,
    text: 'bonjour',
    now: nowIso(),
  });

  if (haltAt === 'queued') {
    haltForever();
    return;
  }

  const claimed = store.claimNextQueued(nowIso());
  if (claimed === undefined) {
    throw new Error('admission ratée — le harnais ne peut pas continuer');
  }

  if (haltAt === 'processing') {
    haltForever();
    return;
  }

  store.recordResponseReady(PROVIDER_MESSAGE_ID, RESPONSE_TEXT, nowIso());

  if (haltAt === 'response_ready') {
    haltForever();
    return;
  }

  store.claimNextResponseReady(nowIso());

  if (haltAt === 'sending') {
    haltForever();
    return;
  }

  store.recordSent(PROVIDER_MESSAGE_ID, nowIso());
  console.log('COMPLETE');
  store.close();
  process.exit(0);
}

main();
