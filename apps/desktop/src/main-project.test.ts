import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { InMemoryAccountStore, InMemorySecretStore } from '@jarvis/connectors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';

/**
 * Câblage CLI de `project` au niveau `dispatch()` — la commande réelle
 * (`apps/desktop project ...`), au-dessus de `runProjectFlow` (couvert en
 * détail par `run-project-flow.test.ts`, non dupliqué ici). Aucun credential
 * Gmail/Légifrance/LLM n'est lu : `JARVIS_PROJECT_BRIEFS_DIR` isole chaque
 * test dans un répertoire temporaire, jamais le répertoire réel de
 * l'utilisateur.
 */

const originalExitCode = process.exitCode;
const originalDir = process.env.JARVIS_PROJECT_BRIEFS_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-main-project-'));
  process.env.JARVIS_PROJECT_BRIEFS_DIR = dir;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  if (originalDir === undefined) {
    delete process.env.JARVIS_PROJECT_BRIEFS_DIR;
  } else {
    process.env.JARVIS_PROJECT_BRIEFS_DIR = originalDir;
  }
  rmSync(dir, { recursive: true, force: true });
});

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

/** Jamais lues par la branche `project` de `dispatch()` — comme pour `legal-search`/`chat`. */
const INERT_DESKTOP_DEPS: DesktopDeps = {
  accountStore: new InMemoryAccountStore(),
  secretStore: new InMemorySecretStore(),
  appCredentials: { clientId: '', clientSecret: '' },
};

describe('dispatch — project (câblage CLI)', () => {
  it('bootstrap réel sans aucun credential Gmail/Légifrance/LLM : create → show', async () => {
    const { output, readText } = collectingOutput();
    await dispatch(
      ['project', 'create', 'boutique-asiatique', 'Boutique asiatique'],
      INERT_DESKTOP_DEPS,
      {
        output,
      },
    );
    expect(readText()).toContain('Boutique asiatique');
    expect(process.exitCode).toBe(0);

    const { output: output2, readText: readText2 } = collectingOutput();
    await dispatch(['project', 'show', 'boutique-asiatique'], INERT_DESKTOP_DEPS, {
      output: output2,
    });
    expect(readText2()).toContain('boutique-asiatique');
  });

  it('projet absent → message clair, code de sortie non nul', async () => {
    const { output, readText } = collectingOutput();
    await dispatch(['project', 'show', 'absent'], INERT_DESKTOP_DEPS, { output });
    expect(readText()).toContain('introuvable');
    expect(process.exitCode).toBe(1);
  });

  it('parcours complet facts/hypotheses/questions/decisions puis next-question', async () => {
    const run = async (...argv: string[]): Promise<string> => {
      const { output, readText } = collectingOutput();
      await dispatch(['project', ...argv], INERT_DESKTOP_DEPS, { output });
      return readText();
    };

    await run('create', 'p1', 'Projet');
    await run('add-fact', 'p1', 'Un fait');
    await run('add-hypothesis', 'p1', 'Une hypothèse');
    await run('add-question', 'p1', 'Une question');
    await run('add-decision', 'p1', 'Une décision');

    const shown = await run('show', 'p1');
    expect(shown).toContain('Un fait');
    expect(shown).toContain('Une hypothèse');
    expect(shown).toContain('Une question');
    expect(shown).toContain('Une décision');

    const next = await run('next-question', 'p1');
    expect(next).toContain('Une question');
    expect(process.exitCode).toBe(0);
  });

  it('export-markdown : parcours CLI complet avec fichier temporaire réel', async () => {
    const run = async (...argv: string[]): Promise<string> => {
      const { output, readText } = collectingOutput();
      await dispatch(['project', ...argv], INERT_DESKTOP_DEPS, { output });
      return readText();
    };

    await run('create', 'p1', 'Projet');
    await run('add-fact', 'p1', 'Un fait exporté');

    const outputPath = join(dir, 'export.md');
    const exported = await run('export-markdown', 'p1', '--output', outputPath);
    expect(exported).toContain(outputPath);
    expect(process.exitCode).toBe(0);

    const markdown = readFileSync(outputPath, 'utf-8');
    expect(markdown).toContain('Un fait exporté');
    expect(markdown).toContain('Instantané exporté');

    // Une seconde tentative sur le même chemin est refusée, jamais écrasée.
    const retried = await run('export-markdown', 'p1', '--output', outputPath);
    expect(retried).toContain('existe déjà');
    expect(process.exitCode).toBe(1);
    expect(readFileSync(outputPath, 'utf-8')).toBe(markdown);
  });

  it(
    'answer-question (commande existante) refuse une seconde réponse sur une question déjà ' +
      "résolue — la protection already_answered du store s'applique ici aussi, sans commande " +
      "d'écrasement ni de réouverture",
    async () => {
      const run = async (...argv: string[]): Promise<string> => {
        const { output, readText } = collectingOutput();
        await dispatch(['project', ...argv], INERT_DESKTOP_DEPS, { output });
        return readText();
      };

      await run('create', 'p1', 'Projet');
      await run('add-question', 'p1', 'Une question');
      const first = await run('answer-question', 'p1', 'q-1', 'première réponse');
      expect(first).toContain('première réponse');
      expect(process.exitCode).toBe(0);

      const second = await run('answer-question', 'p1', 'q-1', 'seconde réponse');
      expect(second).toContain('already_answered');
      expect(process.exitCode).toBe(1);

      const shown = await run('show', 'p1');
      expect(shown).toContain('première réponse');
      expect(shown).not.toContain('seconde réponse');
    },
  );

  it(
    'sources et justifications de bout en bout : liens affichés par show, justification ' +
      'refusée après validation, sans mutation',
    async () => {
      const run = async (...argv: string[]): Promise<string> => {
        const { output, readText } = collectingOutput();
        await dispatch(['project', ...argv], INERT_DESKTOP_DEPS, { output });
        return readText();
      };

      await run('create', 'p1', 'Projet');
      await run('add-fact', 'p1', 'Retrait au comptoir prévu');
      await run('add-source', 'p1', 'Échange oral fictif');
      await run('link-source', 'p1', 'fact-1', 'src-1');
      await run('add-decision', 'p1', 'Proposer le retrait');
      const justified = await run('justify-decision', 'p1', 'dec-1', 'fact-1');
      expect(process.exitCode).toBe(0);
      expect(justified).toContain('[dec-1:proposed] Proposer le retrait {justifiée par : fact-1}');
      expect(justified).toContain('[fact-1] Retrait au comptoir prévu {sources : src-1}');
      expect(justified).toContain('Sources déclarées, non vérifiées (1)');

      await run('validate-decision', 'p1', 'dec-1');
      const before = readFileSync(join(dir, 'p1.json'), 'utf-8');
      await run('add-fact', 'p1', 'Autre fait');
      const afterFact = readFileSync(join(dir, 'p1.json'), 'utf-8');
      const refused = await run('justify-decision', 'p1', 'dec-1', 'fact-2');
      expect(refused).toContain('invalid_transition');
      expect(process.exitCode).toBe(1);
      expect(readFileSync(join(dir, 'p1.json'), 'utf-8')).toBe(afterFact);
      expect(afterFact).not.toBe(before);

      const unknown = await run('link-source', 'p1', 'fact-2', 'src-9');
      expect(unknown).toContain('unknown_source');
      expect(process.exitCode).toBe(1);
    },
  );
});
