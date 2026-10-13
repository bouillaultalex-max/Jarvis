/**
 * Test d'intégration obligatoire (revue finale) : deux **vrais**
 * sous-processus Node tentent `reserve()` sur le **même** fichier de
 * budget. Au plus un doit réussir ; l'autre doit recevoir un refus
 * (`'already_consumed'` ou `'storage_error'`) — jamais les deux
 * `'reserved'`, jamais un fallback permissif.
 *
 * Le schéma est créé une seule fois, **avant** de lancer les deux
 * sous-processus (voir `budget-reserve-harness.ts`) — fait exprès pour ne
 * tester que la contention sur `reserve()` lui-même, pas une course sur la
 * création du schéma (scénario distinct, hors périmètre : l'exclusivité du
 * `MessageStore` empêche déjà deux vrais process réels de coexister).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteSendAttemptBudget } from './sqlite-send-attempt-budget.js';

const HERE = __dirname;
const REPO_ROOT = join(HERE, '..', '..', '..');
const TSX_PREFLIGHT = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'preflight.cjs');
const TSX_LOADER_URL = `file://${join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')}`;
const HARNESS_PATH = join(HERE, 'testing', 'budget-reserve-harness.ts');

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function runReserveHarness(dbPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--require', TSX_PREFLIGHT, '--import', TSX_LOADER_URL, HARNESS_PATH, dbPath],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('exit', () => {
      const match = /RESERVE_RESULT:(\w+)/.exec(output);
      if (match === null) {
        reject(new Error(`sortie inattendue du harnais : "${output}"`));
        return;
      }
      resolve(match[1]!);
    });
    child.once('error', reject);
  });
}

describe('SqliteSendAttemptBudget — deux sous-processus réels concurrents', () => {
  it('au plus une réservation réussit ; aucun succès double, aucun fallback permissif', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-budget-mp-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'send-attempt-budget.db');

    // Schéma créé une seule fois, séquentiellement, avant toute contention
    // réelle (voir en-tête de fichier).
    SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' }).close();

    const [resultA, resultB] = await Promise.all([
      runReserveHarness(dbPath),
      runReserveHarness(dbPath),
    ]);

    const results = [resultA, resultB];
    const reservedCount = results.filter((r) => r === 'reserved').length;
    const refusedCount = results.filter(
      (r) => r === 'already_consumed' || r === 'storage_error',
    ).length;

    expect(reservedCount).toBe(1); // jamais zéro, jamais deux
    expect(refusedCount).toBe(1);

    // L'état durable final confirme une seule tentative réellement retenue.
    const finalCheck = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' });
    expect(finalCheck.getState()?.status).toBe('reserved');
    finalCheck.close();
  }, 15_000);
});
