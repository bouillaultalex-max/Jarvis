import { Writable } from 'node:stream';

import {
  OBSIDIAN_READ_ERROR_MESSAGES,
  ObsidianReadError,
  PermissionManager,
  type ObsidianVaultClient,
} from '@jarvis/connectors';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';
import { OBSIDIAN_ENV, type ObsidianReadDeps } from './obsidian-read.js';
import { parseObsidianSearchArgs } from './obsidian-search.js';

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
});

const VAULT_ID = 'Vault — Test';
const VAULT_ROOT = 'C:\\Vaults\\Vault — Test';
const ARGS = ['--vault', VAULT_ID, '--query', 'JARVIS'];

/**
 * `DesktopDeps` Gmail piégées : toute lecture lève. Prouve que la branche
 * `obsidian-search` ne touche jamais aux dépendances Gmail.
 */
const GMAIL_TRAP_DEPS = new Proxy({} as DesktopDeps, {
  get(_target, property) {
    throw new Error(`Dépendance Gmail lue : ${String(property)}`);
  },
});

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
      return 'CONTENU-DE-NOTE-NE-DOIT-JAMAIS-APPARAITRE';
    },
    searchNotes: async () => {
      calls.push('search');
      return '["B/second.md","A/premier.md"]\n';
    },
    ...overrides,
  };
}

async function runCli(
  argv: readonly string[],
  deps: ObsidianReadDeps,
): Promise<{ text: string; exitCode: typeof process.exitCode }> {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  await dispatch(
    ['obsidian-search', ...argv],
    GMAIL_TRAP_DEPS,
    { output },
    undefined,
    undefined,
    deps,
  );
  return { text, exitCode: process.exitCode };
}

const withSearch = (out: string | Error) =>
  fakeClient({
    searchNotes: async () => {
      if (out instanceof Error) {
        throw out;
      }
      return out;
    },
  });

describe('parseObsidianSearchArgs', () => {
  it('accepte --opt valeur et --opt=valeur', () => {
    expect(parseObsidianSearchArgs(['--vault', 'V', '--query=a b'])).toEqual({
      vault: 'V',
      query: 'a b',
    });
  });

  it.each([
    [[] as string[]],
    [['--vault', 'V']],
    [['--query', 'x']],
    [['--vault', 'V', '--query', 'x', '--query', 'y']],
    [['--vault', 'V', '--query', 'x', '--limit', '50']],
    [['--vault', 'V', '--path', 'a.md']],
    [['positionnel']],
  ])('rejette %j', (argv) => {
    expect(() => parseObsidianSearchArgs(argv)).toThrow(/^obsidian-search : /);
  });
});

describe('dispatch — obsidian-search', () => {
  it('résultats : un chemin par ligne, ordre d’Obsidian, code 0, aucune note lue', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe('B/second.md\nA/premier.md\n');
    expect(exitCode).toBe(0);
    expect(client.calls).toEqual(['vaultPath', 'search']);
    expect(text).not.toContain('CONTENU-DE-NOTE');
  });

  it.each([['No matches found.\n'], ['[]']])(
    'aucun résultat (%j) : message, code 0',
    async (out) => {
      const client = withSearch(out);
      const { text, exitCode } = await runCli(ARGS, { client });
      expect(text).toBe('Aucune note trouvée.\n');
      expect(exitCode).toBe(0);
      expect(client.calls).not.toContain('read');
    },
  );

  it('fichiers non Markdown : écartés et comptés après les chemins', async () => {
    const client = withSearch('["A/plan.canvas","B/note.md","C/doc.pdf"]');
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe('B/note.md\n(2 résultat(s) non Markdown ignoré(s).)\n');
    expect(exitCode).toBe(0);
  });

  it('uniquement des fichiers non Markdown : aucune note, compteur affiché', async () => {
    const client = withSearch('["A/plan.canvas"]');
    const { text } = await runCli(ARGS, { client });
    expect(text).toBe('Aucune note trouvée.\n(1 résultat(s) non Markdown ignoré(s).)\n');
  });

  it('chemin invalide : erreur JARVIS fixe, code 1, rien de la sortie brute', async () => {
    const client = withSearch('["A/note.md","../secret-hors-racine.md"]');
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toBe(
      `Recherche Obsidian échouée : ${OBSIDIAN_READ_ERROR_MESSAGES.search_output_invalid}\n`,
    );
    expect(text).not.toContain('A/note.md');
    expect(text).not.toContain('secret-hors-racine');
    expect(exitCode).toBe(1);
  });

  it('sortie mal formée : erreur JARVIS fixe, jamais le texte du lanceur', async () => {
    const client = withSearch('Error: quelque chose de brut\n');
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toContain(OBSIDIAN_READ_ERROR_MESSAGES.search_output_invalid);
    expect(text).not.toContain('brut');
    expect(exitCode).toBe(1);
  });

  it('Obsidian fermé : message fixe, code 1, aucune recherche', async () => {
    const client = fakeClient({
      vaultPath: async () => {
        throw new ObsidianReadError('obsidian_not_running');
      },
    });
    const { text, exitCode } = await runCli(ARGS, { client });
    expect(text).toContain(OBSIDIAN_READ_ERROR_MESSAGES.obsidian_not_running);
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('permission refusée : aucun appel au client, code 1', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(ARGS, {
      client,
      permissionManager: new PermissionManager(),
    });
    expect(text).toBe('Recherche Obsidian refusée par la politique de permissions.\n');
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('vault non configuré : refus avant tout appel', async () => {
    const client = fakeClient();
    const { text, exitCode } = await runCli(['--vault', 'Autre', '--query', 'x'], { client });
    expect(text).toContain('ne correspond pas au vault configuré');
    expect(exitCode).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('argument invalide : rejeté avant toute construction des dépendances', async () => {
    await expect(
      dispatch(['obsidian-search', '--vault', VAULT_ID], GMAIL_TRAP_DEPS, {}),
    ).rejects.toThrow('--vault et --query sont obligatoires');
  });

  it('configuration Obsidian absente : erreur nommant la variable, sans dépendance Gmail', async () => {
    const saved = process.env[OBSIDIAN_ENV.vaultId];
    delete process.env[OBSIDIAN_ENV.vaultId];
    try {
      await expect(dispatch(['obsidian-search', ...ARGS], GMAIL_TRAP_DEPS, {})).rejects.toThrow(
        OBSIDIAN_ENV.vaultId,
      );
    } finally {
      if (saved !== undefined) {
        process.env[OBSIDIAN_ENV.vaultId] = saved;
      }
    }
  });
});
