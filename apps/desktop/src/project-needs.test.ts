import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileProjectBriefStore } from '@jarvis/project-briefs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseProjectArgs } from './project-args.js';
import { runExportMarkdownFlow } from './project-export-markdown.js';
import { describeProjectResult, projectExitCode, runProjectFlow } from './run-project-flow.js';

const NEED = 'Je veux suivre mon stock sans ressaisir mes commandes.';
let dir: string;
let store: FileProjectBriefStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-project-needs-'));
  store = new FileProjectBriefStore({ baseDir: dir });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fileText = (): string => readFileSync(join(dir, 'p1.json'), 'utf-8');

function run(...argv: string[]): ReturnType<typeof runProjectFlow> {
  const input = parseProjectArgs(argv);
  if (input.op === 'export-markdown' || input.op === 'interview') throw new Error('hors périmètre');
  return runProjectFlow(input, { store });
}

describe('parseProjectArgs — add-need', () => {
  it('sans source', () => {
    expect(parseProjectArgs(['add-need', 'p1', NEED])).toEqual({
      op: 'add-need',
      id: 'p1',
      text: NEED,
      sourceIds: [],
    });
  });

  it('0..n --source, ordre conservé', () => {
    expect(
      parseProjectArgs(['add-need', 'p1', NEED, '--source', 'src-2', '--source', 'src-1']),
    ).toEqual({ op: 'add-need', id: 'p1', text: NEED, sourceIds: ['src-2', 'src-1'] });
  });

  it.each([
    [['add-need']],
    [['add-need', 'p1']],
    [['add-need', 'p1', '']],
    [['add-need', 'p1', NEED, '--source']],
    [['add-need', 'p1', NEED, '--source', '']],
    [['add-need', 'p1', NEED, 'src-1']],
    [['add-need', 'p1', NEED, '--sources', 'src-1']],
    [['add-need', 'p1', NEED, '--source', 'src-1', 'extra']],
  ])('argument invalide %j → erreur avant tout accès disque', (argv) => {
    expect(() => parseProjectArgs(argv)).toThrow(/project :/);
  });

  it('sous-commande listée dans le message d’inconnue', () => {
    expect(() => parseProjectArgs(['nope'])).toThrow(/add-need/);
  });
});

describe('parseProjectArgs — link-source / justify-decision (deux parseurs distincts)', () => {
  it('link-source accepte need-n, fact-n, hyp-n', () => {
    expect(parseProjectArgs(['link-source', 'p1', 'need-1', 'src-1'])).toMatchObject({
      item: { kind: 'need', id: 'need-1' },
      sourceId: 'src-1',
    });
    expect(parseProjectArgs(['link-source', 'p1', 'fact-1', 'src-1'])).toMatchObject({
      item: { kind: 'fact' },
    });
    expect(parseProjectArgs(['link-source', 'p1', 'hyp-1', 'src-1'])).toMatchObject({
      item: { kind: 'hypothesis' },
    });
    expect(() => parseProjectArgs(['link-source', 'p1', 'dec-1', 'src-1'])).toThrow(/need-/);
  });

  it('justify-decision need-n refusé côté CLI ; fact-n/hyp-n toujours acceptés', () => {
    expect(() => parseProjectArgs(['justify-decision', 'p1', 'dec-1', 'need-1'])).toThrow(
      /project : élément « need-1 » invalide/,
    );
    expect(parseProjectArgs(['justify-decision', 'p1', 'dec-1', 'fact-1'])).toMatchObject({
      item: { kind: 'fact' },
    });
  });
});

describe('runProjectFlow — besoins', () => {
  it('add-need puis show : affichage « source non renseignée » ou sources, code 0', () => {
    run('create', 'p1', 'Boutique');
    run('add-source', 'p1', 'Échange oral');
    run('add-need', 'p1', NEED);
    const result = run('add-need', 'p1', 'Deuxième', '--source', 'src-1');
    expect(projectExitCode(result)).toBe(0);
    const shown = describeProjectResult(run('show', 'p1')).join('\n');
    expect(shown).toContain('Besoins déclarés, non vérifiés (2)');
    expect(shown).toContain(`[need-1] ${NEED} {source non renseignée}`);
    expect(shown).toContain('[need-2] Deuxième {sources : src-1}');
  });

  it('link-source need-1 src-1 fonctionne', () => {
    run('create', 'p1', 'Boutique');
    run('add-source', 'p1', 'S');
    run('add-need', 'p1', NEED);
    const result = run('link-source', 'p1', 'need-1', 'src-1');
    expect(result).toMatchObject({ status: 'ok' });
    expect(store.get('p1')!.needs[0]!.sourceIds).toEqual(['src-1']);
  });

  it.each([
    ['source inconnue', ['add-need', 'p1', NEED, '--source', 'src-9'], 'unknown_source'],
    [
      'source en double',
      ['add-need', 'p1', NEED, '--source', 'src-1', '--source', 'src-1'],
      'already_linked',
    ],
    ['texte blanc', ['add-need', 'p1', '   '], 'invalid_input'],
    ['besoin absent', ['link-source', 'p1', 'need-4', 'src-1'], 'unknown_item'],
    ['lien déjà posé', ['link-source', 'p1', 'need-1', 'src-1'], 'already_linked'],
  ])('refus (%s) : erreur contrôlée, code 1, fichier inchangé', (_label, argv, reason) => {
    run('create', 'p1', 'Boutique');
    run('add-source', 'p1', 'S');
    run('add-need', 'p1', NEED, '--source', 'src-1');
    const before = fileText();
    const result = run(...argv);
    expect(result).toMatchObject({ status: 'error', reason });
    expect(projectExitCode(result)).toBe(1);
    expect(fileText()).toBe(before);
  });

  it('add-need sur projet absent → erreur not_found, aucun fichier créé', () => {
    const result = run('add-need', 'absent', NEED);
    expect(result).toMatchObject({ status: 'error', reason: 'not_found' });
  });
});

describe('export-markdown — besoins', () => {
  it('contient la section « Besoins déclarés (non vérifiés) » et le besoin', () => {
    run('create', 'p1', 'Boutique');
    run('add-need', 'p1', NEED);
    const outputPath = join(dir, 'export.md');
    const result = runExportMarkdownFlow({ id: 'p1', outputPath }, { store });
    expect(result.status).toBe('exported');
    const md = readFileSync(outputPath, 'utf-8');
    expect(md).toContain('## Besoins déclarés (non vérifiés)');
    expect(md).toContain('[need\\-1]');
    expect(md).toContain('source non renseignée');
  });
});
