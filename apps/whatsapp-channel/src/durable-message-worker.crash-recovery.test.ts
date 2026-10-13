/**
 * Test d'intégration obligatoire (ADR-0023 § tests d'acceptation) : un vrai
 * sous-processus Node, tué par `SIGKILL` à une étape précise, puis une
 * reprise dans **ce** process sur le même fichier `.db`. Synchronisation
 * déterministe par sentinel stdout (`HALT_READY`) — jamais un délai
 * arbitraire pour décider du moment du `SIGKILL`.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ExclusivityError } from './message-store.js';
import { SqliteMessageStore } from './sqlite-message-store.js';

const HERE = __dirname;
const REPO_ROOT = join(HERE, '..', '..', '..');
// `node_modules/.bin/tsx` est un CLI qui **spawn un sous-process node
// supplémentaire** pour exécuter le script (vérifié par inspection de
// l'arbre de process, `ps --forest`) — tuer le PID du CLI ne tue PAS ce
// grand-enfant, qui continuerait alors à détenir le verrou SQLite
// indéfiniment. On reproduit ici exactement les flags que le CLI utilise
// pour lancer ce grand-enfant, afin que `spawn()` en obtienne le PID
// directement et qu'un seul `SIGKILL` suffise.
const TSX_PREFLIGHT = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'preflight.cjs');
const TSX_LOADER_URL = `file://${join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')}`;
const HARNESS_PATH = join(HERE, 'testing', 'crash-recovery-harness.ts');
const PROVIDER_MESSAGE_ID = 'wamid.crash-test';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/**
 * Démarre le harnais et attend le sentinel `HALT_READY` sur stdout (ligne
 * par ligne, jamais un `setTimeout` deviné) — le process réel détient alors
 * le verrou SQLite, vivant, en attente d'un `SIGKILL`.
 */
function spawnAndWaitForHalt(
  dbPath: string,
  haltAt: string,
): { child: ReturnType<typeof spawn>; ready: Promise<void> } {
  const child = spawn(
    process.execPath,
    ['--require', TSX_PREFLIGHT, '--import', TSX_LOADER_URL, HARNESS_PATH, dbPath, haltAt],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const ready = new Promise<void>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    const timeoutHandle = setTimeout(() => {
      lines.close();
      reject(new Error(`Le harnais n'a jamais émis HALT_READY (étape « ${haltAt} »).`));
    }, 10_000);
    lines.on('line', (line) => {
      if (line.trim() === 'HALT_READY') {
        clearTimeout(timeoutHandle);
        lines.close();
        resolve();
      }
    });
  });

  return { child, ready };
}

/** `SIGKILL` le process et résout seulement une fois réellement terminé (évite une course avec la réouverture). */
async function killAndWaitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

async function runUntilHaltThenKill(dbPath: string, haltAt: string): Promise<void> {
  const { child, ready } = spawnAndWaitForHalt(dbPath, haltAt);
  await ready;
  await killAndWaitForExit(child);
}

describe('DurableMessageWorker — reprise après arrêt brutal (sous-processus réel)', () => {
  it('processing interrompu (crash pendant la génération) → repris proprement après recoverAfterRestart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');

    await runUntilHaltThenKill(dbPath, 'processing');

    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    const report = store.recoverAfterRestart(new Date().toISOString());
    expect(report.resumedProcessing).toBe(1);
    expect(store.getRow(PROVIDER_MESSAGE_ID)?.status).toBe('queued');
    store.close();
  }, 15_000);

  it('response_ready interrompu (crash après génération, avant envoi) → réponse déjà générée conservée, jamais régénérée', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');

    await runUntilHaltThenKill(dbPath, 'response_ready');

    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    const report = store.recoverAfterRestart(new Date().toISOString());
    expect(report.pendingResponseReady).toBe(1);
    const row = store.getRow(PROVIDER_MESSAGE_ID);
    expect(row?.status).toBe('response_ready');
    expect(row?.responseText).toBe('réponse générée avant le crash simulé');

    const resumed = store.claimNextResponseReady(new Date().toISOString());
    expect(resumed?.responseText).toBe('réponse générée avant le crash simulé');
    store.close();
  }, 15_000);

  it("sending interrompu (crash pendant l'envoi, issue inconnue) → jamais classé « non envoyé », quarantaine uncertain, jamais relancé", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');

    await runUntilHaltThenKill(dbPath, 'sending');

    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    const report = store.recoverAfterRestart(new Date().toISOString());
    expect(report.quarantinedSending).toBe(1);
    const row = store.getRow(PROVIDER_MESSAGE_ID);
    expect(row?.status).toBe('uncertain');
    expect(row?.lastError).toBe('interrupted_by_restart');

    // Jamais relancé automatiquement : une admission ultérieure reste un doublon.
    const admission = store.admit({
      providerMessageId: PROVIDER_MESSAGE_ID,
      senderId: '33600000000',
      text: 'bonjour',
      now: new Date().toISOString(),
    });
    expect(admission).toEqual({ kind: 'duplicate', contentMismatch: false });
    store.close();
  }, 15_000);

  it("l'exclusivité est bien libérée par le noyau après SIGKILL — la reprise peut rouvrir le même fichier immédiatement", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');

    await runUntilHaltThenKill(dbPath, 'queued');

    // Aucune attente supplémentaire : la réouverture doit réussir
    // immédiatement, preuve qu'aucun fichier de verrou ambigu ne subsiste.
    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    expect(store.getRow(PROVIDER_MESSAGE_ID)?.status).toBe('queued');
    store.close();
  }, 15_000);

  it('le verrou exclusif est bien détenu pendant toute la vie du worker (process réel, vivant) — pas seulement à son ouverture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');

    const { child, ready } = spawnAndWaitForHalt(dbPath, 'processing');
    await ready;

    // Le sous-process réel est TOUJOURS VIVANT ici (pas encore tué) — une
    // ouverture concurrente depuis ce process de test doit échouer, preuve
    // que le verrou tient pendant toute la durée de vie du worker, pas
    // seulement pendant la transaction d'ouverture initiale.
    expect(() => SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      ExclusivityError,
    );
    expect(child.exitCode).toBeNull(); // bien vivant au moment du test ci-dessus

    await killAndWaitForExit(child);

    // Une fois le process réellement mort, la reprise fonctionne immédiatement.
    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    expect(store.getRow(PROVIDER_MESSAGE_ID)?.status).toBeDefined();
    store.close();
  }, 15_000);
});
