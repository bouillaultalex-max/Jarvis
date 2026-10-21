import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { InMemoryAccountStore, InMemorySecretStore } from '@jarvis/connectors';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';

/**
 * Câblage de `verify-demo` dans `dispatch()` (doubles, aucun process réel)
 * puis vérification du **vrai** point d'entrée (`tsx src/main.ts verify-demo`,
 * aucun credential) — même répartition que `main-send.test.ts` /
 * `main-entry.test.ts`.
 */

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
});

/** `DesktopDeps` Gmail inertes — jamais lues par la branche `verify-demo` de `dispatch()`. */
const INERT_DESKTOP_DEPS: DesktopDeps = {
  accountStore: new InMemoryAccountStore(),
  secretStore: new InMemorySecretStore(),
  appCredentials: { clientId: '', clientSecret: '' },
};

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

describe('dispatch — verify-demo (câblage, doubles)', () => {
  it('« oui » → exécuté et vérifié, code de sortie 0, aucune livraison externe mentionnée comme réelle', async () => {
    const { output, readText } = collectingOutput();

    await dispatch(['verify-demo'], INERT_DESKTOP_DEPS, {
      input: Readable.from(['oui\n']),
      output,
    });

    const text = readText();
    expect(text).toContain('Résultat technique : executed.');
    expect(text).toContain('satisfied');
    expect(text).toContain('aucune livraison externe');
    expect(process.exitCode).toBe(0);
  });

  it("l'avis « démonstration locale, aucune livraison externe » est affiché AVANT le prompt de confirmation", async () => {
    const { output, readText } = collectingOutput();

    await dispatch(['verify-demo'], INERT_DESKTOP_DEPS, {
      input: Readable.from(['oui\n']),
      output,
    });

    const text = readText();
    const noticeIndex = text.indexOf('aucune livraison externe');
    const promptIndex = text.indexOf("Confirmer l'envoi");
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThan(noticeIndex);
  });

  it('« non » → refusé, code de sortie 1', async () => {
    const { output, readText } = collectingOutput();

    await dispatch(['verify-demo'], INERT_DESKTOP_DEPS, {
      input: Readable.from(['non\n']),
      output,
    });

    expect(readText()).toContain('Confirmation refusée');
    expect(process.exitCode).toBe(1);
  });

  it('EOF immédiat (stdin déjà fermé) → refusé, code de sortie 1', async () => {
    const { output, readText } = collectingOutput();

    await dispatch(['verify-demo'], INERT_DESKTOP_DEPS, { input: Readable.from([]), output });

    expect(readText()).toContain('Confirmation refusée');
    expect(process.exitCode).toBe(1);
  });

  it('argument inattendu → rejeté avant toute construction (aucune lecture de confirmation, aucune sortie écrite)', async () => {
    const { output, readText } = collectingOutput();

    await expect(
      dispatch(['verify-demo', '--foo'], INERT_DESKTOP_DEPS, { output }),
    ).rejects.toThrowError('verify-demo : aucun argument accepté.');
    expect(readText()).toBe('');
  });
});

describe('main() — vrai point d’entrée, process réel (tsx src/main.ts verify-demo)', () => {
  const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
  const MAIN_ENTRY = join(__dirname, 'main.ts');
  const DESKTOP_DIR = join(__dirname, '..');
  const PROCESS_TIMEOUT_MS = 20_000;

  function cleanEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.GMAIL_CLIENT_ID;
    delete env.GMAIL_CLIENT_SECRET;
    delete env.ANTHROPIC_API_KEY;
    return env;
  }

  /**
   * Lance `verify-demo` comme un vrai process `tsx`, attend que le prompt de
   * confirmation apparaisse réellement sur stdout avant d'écrire la réponse
   * — une écriture stdin immédiate, avant que `readline` ne soit attaché
   * côté process, pourrait sinon être perdue (course classique avec un pipe).
   * `answer === undefined` : ferme stdin immédiatement, sans attendre le
   * prompt (simule une EOF avant toute saisie).
   */
  function runVerifyDemoInteractive(
    answer: string | undefined,
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(TSX_BIN, [MAIN_ENTRY, 'verify-demo'], {
        cwd: DESKTOP_DIR,
        env: cleanEnv(),
      });

      let stdout = '';
      let stderr = '';
      let answered = false;
      // Un seul des trois dénouements possibles (timeout / erreur de spawn /
      // fermeture réelle) doit jamais résoudre/rejeter plus d'une fois — sans
      // quoi un `close` tardif après un rejet par timeout planterait le test.
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('verify-demo (process réel) : délai dépassé sans terminaison.'));
      }, PROCESS_TIMEOUT_MS);

      // `spawn` peut échouer de façon asynchrone (ex. binaire introuvable) —
      // sans cet écouteur, le test resterait bloqué jusqu'au timeout au lieu
      // d'échouer immédiatement avec une cause claire.
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        reject(err);
      });
      // Écrire sur `stdin` après la fermeture du process (ex. sortie précoce
      // sur une autre branche) lèverait `EPIPE` de façon non gérée — déjà
      // couvert par `settled`/`close` ci-dessous, mais jamais laissé crasher.
      child.stdin.on('error', () => {});

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!answered && answer !== undefined && stdout.includes("Confirmer l'envoi ? [y/N]")) {
          answered = true;
          child.stdin.end(`${answer}\n`);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve({ status, stdout, stderr });
      });

      if (answer === undefined) {
        child.stdin.end();
      }
    });
  }

  it(
    'oui, écrit seulement après apparition réelle du prompt → exécuté et vérifié, code de sortie 0',
    async () => {
      const { status, stdout, stderr } = await runVerifyDemoInteractive('oui');

      expect(status).toBe(0);
      expect(stdout).toContain('Résultat technique : executed.');
      expect(stdout).toContain('satisfied');
      expect(stderr).toBe('');
      expect(stdout.indexOf('aucune livraison externe')).toBeLessThan(
        stdout.indexOf("Confirmer l'envoi"),
      );
    },
    PROCESS_TIMEOUT_MS + 5_000,
  );

  it(
    'non, écrit seulement après apparition réelle du prompt → refusé, code de sortie 1',
    async () => {
      const { status, stdout } = await runVerifyDemoInteractive('non');

      expect(status).toBe(1);
      expect(stdout).toContain('Confirmation refusée');
    },
    PROCESS_TIMEOUT_MS + 5_000,
  );

  it(
    'EOF immédiat (stdin fermé avant toute saisie) → refusé, code de sortie 1',
    async () => {
      const { status, stdout } = await runVerifyDemoInteractive(undefined);

      expect(status).toBe(1);
      expect(stdout).toContain('Confirmation refusée');
    },
    PROCESS_TIMEOUT_MS + 5_000,
  );

  it('argument inattendu → rejeté avant toute confirmation, code de sortie 1, aucun prompt affiché', () => {
    const result = spawnSync(TSX_BIN, [MAIN_ENTRY, 'verify-demo', '--foo'], {
      cwd: DESKTOP_DIR,
      env: cleanEnv(),
      encoding: 'utf8',
      timeout: PROCESS_TIMEOUT_MS,
      input: '',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('verify-demo : aucun argument accepté.');
    expect(result.stdout).not.toContain("Confirmer l'envoi");
  });
});
