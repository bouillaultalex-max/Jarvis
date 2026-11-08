import { Writable } from 'node:stream';

import {
  InMemoryAccountStore,
  InMemorySecretStore,
  OBSIDIAN_READ_ERROR_MESSAGES,
  ObsidianReadError,
  PermissionManager,
  type ObsidianVaultClient,
} from '@jarvis/connectors';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';
import {
  OBSIDIAN_ENV,
  loadObsidianVaultConfigFromEnv,
  parseObsidianReadArgs,
  type ObsidianReadDeps,
} from './obsidian-read.js';

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
});

const VAULT_ID = 'Vault — Test';
const VAULT_ROOT = 'C:\\Vaults\\Vault — Test';

/** `DesktopDeps` Gmail inertes — jamais lues par la branche `obsidian-read`. */
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

function fakeClient(overrides: Partial<ObsidianVaultClient> = {}): ObsidianVaultClient & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    vaultId: VAULT_ID,
    vaultRoot: VAULT_ROOT,
    calls,
    vaultPath: async () => {
      calls.push('vaultPath');
      return `${VAULT_ROOT}\n`;
    },
    inspectNote: async () => {
      calls.push('inspect');
      return 'file';
    },
    readNote: async () => {
      calls.push('read');
      return '# Exemple\nTexte de la note\n';
    },
    searchNotes: async () => {
      calls.push('search');
      return 'No matches found.\n';
    },
    ...overrides,
  };
}

async function runCli(
  argv: readonly string[],
  deps: ObsidianReadDeps,
): Promise<{ text: string; exitCode: typeof process.exitCode }> {
  const { output, readText } = collectingOutput();
  await dispatch(
    ['obsidian-read', ...argv],
    INERT_DESKTOP_DEPS,
    { output },
    undefined,
    undefined,
    deps,
  );
  return { text: readText(), exitCode: process.exitCode };
}

const ARGS = ['--vault', VAULT_ID, '--path', 'Dossier/Exemple.md'];

describe('parseObsidianReadArgs', () => {
  it('accepte --opt valeur et --opt=valeur', () => {
    expect(parseObsidianReadArgs(['--vault', 'V', '--path=a/b.md'])).toEqual({
      vault: 'V',
      path: 'a/b.md',
    });
  });

  it.each([
    [[] as string[]],
    [['--vault', 'V']],
    [['--path', 'a.md']],
    [['--vault', 'V', '--path', 'a.md', '--vault', 'W']],
    [['--vault', 'V', '--path']],
    [['--vault', 'V', '--path', 'a.md', '--write', 'x']],
    [['positionnel']],
  ])('rejette %j', (argv) => {
    expect(() => parseObsidianReadArgs(argv)).toThrow(/^obsidian-read : /);
  });

  it('ne cite jamais une valeur fournie dans ses erreurs', () => {
    expect(() => parseObsidianReadArgs(['--vault', 'SECRET-VALUE'])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('SECRET-VALUE') }),
    );
  });
});

describe('loadObsidianVaultConfigFromEnv', () => {
  const ENV = {
    [OBSIDIAN_ENV.vaultId]: VAULT_ID,
    [OBSIDIAN_ENV.vaultRoot]: VAULT_ROOT,
    [OBSIDIAN_ENV.launcherPath]: 'C:\\Programs\\Obsidian\\Obsidian.com',
  };

  it('lit le vault unique configuré', () => {
    expect(loadObsidianVaultConfigFromEnv(ENV)).toEqual({
      vaultId: VAULT_ID,
      vaultRoot: VAULT_ROOT,
      launcherPath: 'C:\\Programs\\Obsidian\\Obsidian.com',
    });
  });

  it.each([
    [OBSIDIAN_ENV.vaultId, undefined],
    [OBSIDIAN_ENV.vaultId, 'a"b'],
    [OBSIDIAN_ENV.vaultRoot, undefined],
    [OBSIDIAN_ENV.vaultRoot, '/mnt/c/Vaults/X'],
    [OBSIDIAN_ENV.launcherPath, undefined],
    [OBSIDIAN_ENV.launcherPath, 'C:\\Programs\\Obsidian\\Obsidian.lnk'],
  ])('refuse %s = %j', (name, value) => {
    expect(() => loadObsidianVaultConfigFromEnv({ ...ENV, [name]: value })).toThrow(name);
  });
});

describe('dispatch — obsidian-read', () => {
  it('lecture réussie : contenu affiché, code 0, vault vérifié avant la lecture', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe('# Exemple\nTexte de la note\n');
    expect(exitCode).toBe(0);
    expect(client.calls).toEqual(['vaultPath', 'inspect', 'read']);
  });

  it('une note commençant par « Error: » est affichée comme du contenu', async () => {
    const client = fakeClient({ readNote: async () => 'Error: simple titre de note\n' });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe('Error: simple titre de note\n');
    expect(exitCode).toBe(0);
  });

  it.each([
    ['sans saut de ligne final', '# Titre\nDernière ligne — sans fin'],
    ['avec fins de ligne CRLF', '# Titre\r\nLigne 1\r\nLigne 2\r\n'],
    ['vide', ''],
  ])('note %s : stdout est exactement le texte reçu, octet pour octet', async (_label, note) => {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk: Buffer | string, _enc, cb): void {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
        cb();
      },
    });
    const client = fakeClient({ readNote: async () => note });

    await dispatch(
      ['obsidian-read', ...ARGS],
      INERT_DESKTOP_DEPS,
      { output },
      undefined,
      undefined,
      {
        client,
      },
    );

    expect(Buffer.concat(chunks).equals(Buffer.from(note, 'utf8'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('permission refusée : aucun appel au client, code 1', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(ARGS, {
      client,
      permissionManager: new PermissionManager(),
    });
    expect(text).toContain('refusée par la politique de permissions');
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('vault non configuré : refus avant tout appel', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(['--vault', 'Autre', '--path', 'a.md'], { client });
    expect(text).toContain('ne correspond pas au vault configuré');
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('vault rapporté par Obsidian différent : erreur claire, aucune lecture', async () => {
    const client = fakeClient({ vaultPath: async () => 'C:\\Vaults\\Autre\n' });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toContain(OBSIDIAN_READ_ERROR_MESSAGES.vault_mismatch);
    expect(exitCode).toBe(1);
  });

  it('chemin hors racine : refus avant tout appel', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(['--vault', VAULT_ID, '--path', '../hors.md'], {
      client,
    });
    expect(text).toContain('doit rester sous la racine');
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('Obsidian fermé : message fixe, code 1', async () => {
    const client = fakeClient({
      vaultPath: async () => {
        throw new ObsidianReadError('obsidian_not_running');
      },
    });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toContain(OBSIDIAN_READ_ERROR_MESSAGES.obsidian_not_running);
    expect(exitCode).toBe(1);
  });

  it('fichier absent : « Note introuvable », code 1, lecture jamais appelée', async () => {
    const client = fakeClient({ inspectNote: async () => 'absent' });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe('Note introuvable dans le vault configuré.\n');
    expect(exitCode).toBe(1);
  });

  it('diagnostic ambigu : message d’ambiguïté, jamais le diagnostic brut', async () => {
    const client = fakeClient({
      readNote: async () => 'Error: File "Dossier/Exemple.md" not found.\n',
    });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toContain(OBSIDIAN_READ_ERROR_MESSAGES.ambiguous_not_found);
    expect(text).not.toContain('not found');
    expect(exitCode).toBe(1);
  });

  it('argument invalide : rejeté avant toute construction des dépendances', async () => {
    const { output } = collectingOutput();
    await expect(
      dispatch(['obsidian-read', '--vault', VAULT_ID], INERT_DESKTOP_DEPS, { output }),
    ).rejects.toThrow('--vault et --path sont obligatoires');
  });

  it('configuration absente : erreur nommant la variable, aucun processus', async () => {
    const saved = process.env[OBSIDIAN_ENV.vaultId];
    delete process.env[OBSIDIAN_ENV.vaultId];
    try {
      const { output } = collectingOutput();
      await expect(
        dispatch(['obsidian-read', ...ARGS], INERT_DESKTOP_DEPS, { output }),
      ).rejects.toThrow(OBSIDIAN_ENV.vaultId);
    } finally {
      if (saved !== undefined) {
        process.env[OBSIDIAN_ENV.vaultId] = saved;
      }
    }
  });
});
