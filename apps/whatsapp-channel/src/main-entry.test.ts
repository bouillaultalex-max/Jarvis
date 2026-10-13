/**
 * Tests du **vrai** point d'entrée (`main.ts`, lancé comme un vrai
 * sous-process `tsx`) — pas seulement `buildChannelDependencies()` avec des
 * doubles (déjà couvert par `build-channel-dependencies.test.ts`). Même
 * style que `apps/desktop/src/main-entry.test.ts`.
 *
 * **Strictement limité** aux scénarios qui échouent avant tout accès au
 * trousseau OS réel ou au réseau — jamais le mode réel exécuté avec un
 * vrai `SecretStore`/`fetch`, conformément au périmètre de cette mission.
 * Un mode real avec variables non secrètes COMPLÈTES ferait réellement
 * interroger le trousseau OS de cette machine : volontairement exclu
 * d'ici (couvert avec doubles par `build-channel-dependencies.test.ts`).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const MAIN_ENTRY = join(__dirname, 'main.ts');
const WHATSAPP_CHANNEL_DIR = join(__dirname, '..');

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function runMain(envOverrides: Record<string, string | undefined> = {}): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.WHATSAPP_GRAPH_API_VERSION;
  delete env.WHATSAPP_PHONE_NUMBER_ID;
  delete env.WHATSAPP_ALLOWED_SENDER_ID;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const result = spawnSync(TSX_BIN, [MAIN_ENTRY], {
    cwd: WHATSAPP_CHANNEL_DIR,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('main() — vrai point d’entrée (tsx src/main.ts)', () => {
  it('WHATSAPP_CHANNEL_MODE invalide → rejeté immédiatement, jamais un repli vers "simulated"', () => {
    const { status, stderr, stdout } = runMain({ WHATSAPP_CHANNEL_MODE: 'prod' });

    expect(status).toBe(1);
    expect(stderr).toContain('WHATSAPP_CHANNEL_MODE');
    expect(stderr).toContain('prod');
    // Jamais le message de démarrage normal — la résolution du mode a
    // échoué avant toute autre étape, avant même de construire
    // `OsCredentialSecretStore` (voir main.ts).
    expect(stdout).not.toContain('à l’écoute');
  });

  it('mode real, variables non secrètes absentes → IncompleteRealConfigError avant tout secret, AUCUN store jamais créé', () => {
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-main-entry-'));
    tempDirs.push(dir);

    const { status, stderr, stdout } = runMain({
      WHATSAPP_CHANNEL_MODE: 'real',
      JARVIS_DATA_DIR: dir,
    });

    expect(status).toBe(1);
    // La toute première variable non secrète vérifiée (voir l'ordre
    // délibéré de `real-whatsapp-config.ts`) — jamais un secret cité ici,
    // puisque le trousseau n'a jamais été interrogé.
    expect(stderr).toContain('WHATSAPP_GRAPH_API_VERSION');
    expect(stdout).not.toContain('à l’écoute');
    expect(stdout).not.toContain('Reprise après redémarrage');
    // Ni le store de messages ni le budget n'ont jamais été ouverts —
    // configuration invalide détectée avant toute ouverture de fichier.
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
