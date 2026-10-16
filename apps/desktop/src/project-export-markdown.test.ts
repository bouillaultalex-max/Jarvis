import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileProjectBriefStore } from '@jarvis/project-briefs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  describeExportMarkdownResult,
  exportMarkdownExitCode,
  runExportMarkdownFlow,
} from './project-export-markdown.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let dataDir: string;
let outDir: string;
let store: FileProjectBriefStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'jarvis-export-md-data-'));
  outDir = await mkdtemp(join(tmpdir(), 'jarvis-export-md-out-'));
  store = new FileProjectBriefStore({ baseDir: dataDir });
});

afterEach(async () => {
  await chmod(outDir, 0o700).catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
});

describe('runExportMarkdownFlow', () => {
  it('projet absent → not-found, aucun fichier créé, code non nul', () => {
    const outputPath = join(outDir, 'export.md');
    const result = runExportMarkdownFlow({ id: 'absent', outputPath }, { store });
    expect(result).toEqual({ status: 'not-found', id: 'absent' });
    expect(exportMarkdownExitCode(result)).toBe(1);
    expect(describeExportMarkdownResult(result).join('\n')).toContain('introuvable');
  });

  it('exporte avec succès ; le JSON source et sa révision restent inchangés', () => {
    store.create('p1', 'Boutique');
    store.addFact('p1', 'Un fait');
    const before = store.get('p1')!;

    const outputPath = join(outDir, 'export.md');
    const result = runExportMarkdownFlow({ id: 'p1', outputPath }, { store });

    expect(result).toEqual({ status: 'exported', outputPath, revision: before.revision });
    expect(exportMarkdownExitCode(result)).toBe(0);

    const after = store.get('p1')!;
    expect(after).toEqual(before); // aucune mutation du JSON source par l'export
  });

  it('destination déjà existante → jamais écrasée, contenu intact, erreur contrôlée', async () => {
    store.create('p1', 'Boutique');
    const outputPath = join(outDir, 'export.md');
    await writeFile(outputPath, 'contenu préexistant intact');

    const result = runExportMarkdownFlow({ id: 'p1', outputPath }, { store });
    expect(result).toEqual({ status: 'already-exists', outputPath });
    expect(exportMarkdownExitCode(result)).toBe(1);
    expect(await readFile(outputPath, 'utf-8')).toBe('contenu préexistant intact');
  });

  it.skipIf(isRoot)(
    "erreur d'écriture (répertoire destination en lecture seule) → résultat contrôlé, code non nul",
    async () => {
      store.create('p1', 'Boutique');
      const outputPath = join(outDir, 'export.md');

      await chmod(outDir, 0o500);
      const result = runExportMarkdownFlow({ id: 'p1', outputPath }, { store });
      await chmod(outDir, 0o700);

      expect(result.status).toBe('write-error');
      expect(exportMarkdownExitCode(result)).toBe(1);
    },
  );

  it('création exclusive : jamais d’écrasement même simulée comme contention (fichier déjà présent au moment de l’ouverture)', async () => {
    store.create('p1', 'Boutique');
    const outputPath = join(outDir, 'export.md');
    // Simule un concurrent qui aurait déjà créé le fichier juste avant.
    await writeFile(outputPath, 'déjà écrit par un autre export');

    const result = runExportMarkdownFlow({ id: 'p1', outputPath }, { store });
    expect(result.status).toBe('already-exists');
    expect(await readFile(outputPath, 'utf-8')).toBe('déjà écrit par un autre export');
  });
});
