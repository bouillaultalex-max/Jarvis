import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileProjectBriefStore } from './project-brief-file-store.js';

/**
 * Concurrence **réelle** entre deux process OS séparés (pas deux instances
 * de store dans le même process vitest, déjà couvert ailleurs) — avec
 * synchronisation déterministe par ligne stdout/stdin, jamais un `sleep`.
 */

const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const HOLDER_SCRIPT = join(__dirname, 'testing', 'lock-holder-process.ts');
const MUTATE_SCRIPT = join(__dirname, 'testing', 'mutate-once-process.ts');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-project-briefs-concurrency-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function waitForLine(
  child: ChildProcessWithoutNullStreams,
  expected: string,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error(`timeout en attendant la ligne « ${expected} »`));
    }, timeoutMs);
    rl.on('line', (line) => {
      if (line.trim() === expected) {
        clearTimeout(timer);
        rl.close();
        resolve();
      }
    });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout en attendant la sortie du process')),
      timeoutMs,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mutateOnce(
  baseDir: string,
  id: string,
  text: string,
): { ok: boolean; reason?: string; revision?: number; factCount?: number } {
  const result = spawnSync(TSX_BIN, [MUTATE_SCRIPT, baseDir, id, text], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error(
      `mutate-once-process a échoué : status=${result.status} stderr=${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

describe('Concurrence réelle entre deux process OS', () => {
  it(
    'process B reçoit un conflit contrôlé tant que A détient le verrou ; après libération, B réussit ; ' +
      'aucun contenu ni révision perdu',
    async () => {
      const baseDir = dir;
      const id = 'p1';
      const filePath = join(baseDir, `${id}.json`);
      const store = new FileProjectBriefStore({ baseDir });
      store.create(id, 'Projet'); // revision 1, 0 fait

      const holder = spawn(TSX_BIN, [HOLDER_SCRIPT, filePath], { stdio: ['pipe', 'pipe', 'pipe'] });
      await waitForLine(holder, 'LOCKED');

      // Pendant que A détient le verrou : B (un vrai second process) est
      // refusé explicitement, jamais mis en file silencieusement.
      const blocked = mutateOnce(baseDir, id, 'écrit par B pendant le verrou');
      expect(blocked).toEqual({ ok: false, reason: 'locked' });

      // Rien n'a été écrit pendant le refus.
      expect(store.get(id)!.revision).toBe(1);
      expect(store.get(id)!.facts).toHaveLength(0);

      holder.stdin.write('RELEASE\n');
      await waitForLine(holder, 'RELEASED');
      await waitForExit(holder);

      // Après libération, une nouvelle mutation réussit — exactement une
      // fois, rien perdu ni dupliqué.
      const retried = mutateOnce(baseDir, id, 'écrit par B après libération');
      expect(retried).toEqual({ ok: true, revision: 2, factCount: 1 });

      const final = store.get(id)!;
      expect(final.revision).toBe(2);
      expect(final.facts.map((f) => f.text)).toEqual(['écrit par B après libération']);
    },
  );

  it(
    'arrêt brutal du détenteur (SIGKILL) : le verrou reste présent, la commande suivante refuse ' +
      'prudemment, aucune suppression automatique',
    async () => {
      const baseDir = dir;
      const id = 'p2';
      const filePath = join(baseDir, `${id}.json`);
      const lockPath = `${filePath}.lock`;
      const store = new FileProjectBriefStore({ baseDir });
      store.create(id, 'Projet');

      const holder = spawn(TSX_BIN, [HOLDER_SCRIPT, filePath], { stdio: ['pipe', 'pipe', 'pipe'] });
      await waitForLine(holder, 'LOCKED');
      expect(existsSync(lockPath)).toBe(true);

      holder.kill('SIGKILL');
      await waitForExit(holder); // déterministe : confirme que le process est bien mort, pas un sleep arbitraire

      // Le verrou n'est jamais supprimé automatiquement par la mort du
      // process qui le détenait — ce code ne porte ni PID ni TTL.
      expect(existsSync(lockPath)).toBe(true);
      const refused = mutateOnce(baseDir, id, 'ne doit jamais être écrit');
      expect(refused).toEqual({ ok: false, reason: 'locked' });
      expect(existsSync(lockPath)).toBe(true); // toujours présent : aucune auto-suppression, même après un refus

      // Procédure de récupération MANUELLE documentée (project-brief-lock.ts) :
      // vérifier explicitement qu'aucun écrivain n'est actif avant de
      // supprimer le verrou. `waitForExit` ci-dessus a déjà joué ce rôle de
      // vérification (le process holder est confirmé terminé) ; un·e
      // opérateur·rice réel·le vérifierait de même (liste des process) avant
      // cette suppression manuelle — jamais automatisée par ce code.
      await unlink(lockPath);
      const recovered = mutateOnce(baseDir, id, 'après récupération manuelle vérifiée');
      expect(recovered).toEqual({ ok: true, revision: 2, factCount: 1 });
    },
  );
});
