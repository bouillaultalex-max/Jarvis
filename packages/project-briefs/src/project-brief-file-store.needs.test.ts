import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_LINKS_PER_ITEM, MAX_LIST_ITEMS, type SourceableRef } from './project-brief.js';
import { ProjectBriefStoreError } from './project-brief-errors.js';
import { FileProjectBriefStore } from './project-brief-file-store.js';

const NEED = 'Je veux suivre mon stock sans ressaisir mes commandes.';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-project-briefs-needs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = (): FileProjectBriefStore => new FileProjectBriefStore({ baseDir: dir });
const fileText = (): Promise<string> => readFile(join(dir, 'p1.json'), 'utf-8');
const rawFile = async (): Promise<Record<string, unknown>> => JSON.parse(await fileText());

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProjectBriefStoreError) return err.reason;
    throw err;
  }
  return undefined;
}

/** Refus attendu : contenu du fichier (donc révision, dates) strictement inchangé, aucun fichier temporaire. */
async function expectRefusedWithoutWrite(fn: () => unknown, reason: string): Promise<void> {
  const before = await fileText();
  expect(reasonOf(fn)).toBe(reason);
  expect(await fileText()).toBe(before);
  expect((await readdir(dir)).sort()).toEqual(['p1.json']);
}

const V1_TEXT = JSON.stringify(
  {
    id: 'p1',
    name: 'Projet fictif',
    formatVersion: 1,
    revision: 5,
    facts: [{ id: 'fact-1', text: 'Un fait' }],
    hypotheses: [],
    decisions: [],
    questions: [{ id: 'q-1', text: 'Question ?', status: 'open' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  null,
  2,
);

describe('addNeed', () => {
  it('sans source : v3 à la 1re création, need-1, sourceIds omis, révision +1', async () => {
    store().create('p1', 'Projet');
    const brief = store().addNeed('p1', NEED);
    expect(brief.formatVersion).toBe(3);
    expect(brief.revision).toBe(2);
    expect(brief.needs).toEqual([{ id: 'need-1', text: NEED }]);
    const raw = await rawFile();
    expect(raw.formatVersion).toBe(3);
    expect(raw.needs).toEqual([{ id: 'need-1', text: NEED }]);
    expect(store().get('p1')!.needs).toEqual([{ id: 'need-1', text: NEED }]);
  });

  it('avec sources : liens persistés ; ids need-n uniques et stables', () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addSource('p1', 'Échange oral');
    s.addSource('p1', 'Mail client');
    s.addNeed('p1', NEED, ['src-1', 'src-2']);
    s.addNeed('p1', 'Second besoin');
    const needs = store().get('p1')!.needs;
    expect(needs.map((n) => n.id)).toEqual(['need-1', 'need-2']);
    expect(needs[0]!.sourceIds).toEqual(['src-1', 'src-2']);
    expect(needs[1]!.sourceIds).toBeUndefined();
  });

  it('une fiche v1 passe en v3 directement ; une v2 passe en v3', async () => {
    await writeFile(join(dir, 'p1.json'), V1_TEXT, { mode: 0o600 });
    store().addNeed('p1', NEED);
    expect((await rawFile()).formatVersion).toBe(3);
    await rm(join(dir, 'p1.json'));
    store().create('p1', 'Projet');
    store().addSource('p1', 'S');
    expect((await rawFile()).formatVersion).toBe(2);
    store().addNeed('p1', NEED, ['src-1']);
    expect((await rawFile()).formatVersion).toBe(3);
  });

  it('refus sans écriture ni révision : source inconnue (même si une autre est valide)', async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addSource('p1', 'S');
    await expectRefusedWithoutWrite(
      () => s.addNeed('p1', NEED, ['src-1', 'src-9']),
      'unknown_source',
    );
    expect(store().get('p1')!.needs).toEqual([]);
  });

  it('refus sans écriture : doublon de source dans la demande', async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addSource('p1', 'S');
    await expectRefusedWithoutWrite(
      () => s.addNeed('p1', NEED, ['src-1', 'src-1']),
      'already_linked',
    );
  });

  it('refus sans écriture : texte vide, blanc, trop long ; projet absent', async () => {
    const s = store();
    s.create('p1', 'Projet');
    await expectRefusedWithoutWrite(() => s.addNeed('p1', ''), 'invalid_input');
    await expectRefusedWithoutWrite(() => s.addNeed('p1', '   '), 'invalid_input');
    await expectRefusedWithoutWrite(() => s.addNeed('p1', 'x'.repeat(1001)), 'invalid_input');
    expect(reasonOf(() => s.addNeed('absent', NEED))).toBe('not_found');
    expect((await readdir(dir)).sort()).toEqual(['p1.json']);
  });

  it('limites : 20 sources par besoin (21 refusé), 50 besoins (51e refusé), sans écriture', async () => {
    const s = store();
    s.create('p1', 'Projet');
    for (let i = 0; i < MAX_LINKS_PER_ITEM + 1; i++) s.addSource('p1', `S${i}`);
    const all = Array.from({ length: MAX_LINKS_PER_ITEM + 1 }, (_, i) => `src-${i + 1}`);
    await expectRefusedWithoutWrite(() => s.addNeed('p1', NEED, all), 'invalid_input');
    s.addNeed('p1', NEED, all.slice(0, MAX_LINKS_PER_ITEM));
    for (let i = 1; i < MAX_LIST_ITEMS; i++) s.addNeed('p1', `Besoin ${i}`);
    expect(store().get('p1')!.needs).toHaveLength(MAX_LIST_ITEMS);
    await expectRefusedWithoutWrite(() => s.addNeed('p1', 'de trop'), 'invalid_input');
  });
});

describe('linkSource sur un besoin', () => {
  function withNeed(): FileProjectBriefStore {
    const s = store();
    s.create('p1', 'Projet');
    s.addSource('p1', 'S1');
    s.addSource('p1', 'S2');
    s.addNeed('p1', NEED);
    return s;
  }

  it('relie, conserve l’ordre, jamais de retrait ; révision +1 ; reste v3', async () => {
    const s = withNeed();
    s.linkSource('p1', { kind: 'need', id: 'need-1' }, 'src-2');
    const brief = s.linkSource('p1', { kind: 'need', id: 'need-1' }, 'src-1');
    expect(brief.needs[0]!.sourceIds).toEqual(['src-2', 'src-1']);
    expect(brief.formatVersion).toBe(3);
    expect(brief.revision).toBe(6);
  });

  it('refus sans écriture : besoin absent, source inconnue, doublon, 21e lien', async () => {
    const s = withNeed();
    const ref: SourceableRef = { kind: 'need', id: 'need-1' };
    await expectRefusedWithoutWrite(
      () => s.linkSource('p1', { kind: 'need', id: 'need-9' }, 'src-1'),
      'unknown_item',
    );
    await expectRefusedWithoutWrite(() => s.linkSource('p1', ref, 'src-9'), 'unknown_source');
    s.linkSource('p1', ref, 'src-1');
    await expectRefusedWithoutWrite(() => s.linkSource('p1', ref, 'src-1'), 'already_linked');

    const full = store();
    for (let i = 3; i <= MAX_LINKS_PER_ITEM + 1; i++) full.addSource('p1', `S${i}`);
    for (let i = 2; i <= MAX_LINKS_PER_ITEM; i++) full.linkSource('p1', ref, `src-${i}`);
    expect(full.get('p1')!.needs[0]!.sourceIds).toHaveLength(MAX_LINKS_PER_ITEM);
    await expectRefusedWithoutWrite(
      () => full.linkSource('p1', ref, `src-${MAX_LINKS_PER_ITEM + 1}`),
      'invalid_input',
    );
  });

  it('un id need-n n’est pas pris pour un fait : linkSource sur un fait reste inchangé', () => {
    const s = withNeed();
    s.addFact('p1', 'Un fait');
    const brief = s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-1');
    expect(brief.facts[0]!.sourceIds).toEqual(['src-1']);
    expect(brief.needs[0]!.sourceIds).toBeUndefined();
  });
});

describe('justify-decision refuse un besoin (côté store)', () => {
  it('kind need → invalid_input sans écriture, même avec un id need existant', async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addNeed('p1', NEED);
    s.addDecision('p1', 'Décision');
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-1', { kind: 'need', id: 'need-1' } as never),
      'invalid_input',
    );
    expect(store().get('p1')!.decisions[0]!.basis).toBeUndefined();
  });
});

describe('opérations existantes sur une fiche v3 : needs et v3 préservés', () => {
  it('toutes les mutations conservent formatVersion 3 et les besoins', async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addSource('p1', 'S1');
    s.addNeed('p1', NEED, ['src-1']);
    const expected = [{ id: 'need-1', text: NEED, sourceIds: ['src-1'] }];
    const check = (label: string): void => {
      const b = store().get('p1')!;
      expect(b.formatVersion, label).toBe(3);
      expect(b.needs, label).toEqual(expected);
    };
    s.addFact('p1', 'F');
    check('addFact');
    s.addHypothesis('p1', 'H');
    check('addHypothesis');
    s.addQuestion('p1', 'Q ?');
    check('addQuestion');
    s.answerQuestion('p1', 'q-1', 'R');
    check('answerQuestion');
    s.addSource('p1', 'S2');
    check('addSource');
    s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-2');
    check('linkSource fait');
    s.linkSource('p1', { kind: 'hypothesis', id: 'hyp-1' }, 'src-1');
    check('linkSource hypothèse');
    s.addDecision('p1', 'D');
    check('addDecision');
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    check('justifyDecision');
    s.validateDecision('p1', 'dec-1');
    check('validateDecision');
    s.addDecision('p1', 'D2');
    s.obsoleteDecision('p1', 'dec-2');
    check('obsoleteDecision');
    expect((await rawFile()).formatVersion).toBe(3);
  });
});

describe('lire v1/v2 ne modifie jamais le disque', () => {
  it.each(['v1', 'v2'] as const)(
    'get() sur %s : octets et mtime identiques, aucun fichier ajouté',
    async (make) => {
      const text =
        make === 'v1'
          ? V1_TEXT
          : JSON.stringify(
              { ...JSON.parse(V1_TEXT), formatVersion: 2, sources: [{ id: 'src-1', text: 'S' }] },
              null,
              2,
            );
      await writeFile(join(dir, 'p1.json'), text, { mode: 0o600 });
      const before = await stat(join(dir, 'p1.json'));
      const brief = store().get('p1')!;
      expect(brief.formatVersion).toBe(make === 'v1' ? 1 : 2);
      expect(brief.needs).toEqual([]);
      expect(await fileText()).toBe(text);
      expect((await stat(join(dir, 'p1.json'))).mtimeMs).toBe(before.mtimeMs);
      expect(await readdir(dir)).toEqual(['p1.json']);
    },
  );

  it('une opération ordinaire sur v1 ne crée ni needs ni v3', async () => {
    await writeFile(join(dir, 'p1.json'), V1_TEXT, { mode: 0o600 });
    store().addFact('p1', 'Autre fait');
    const raw = await rawFile();
    expect(raw.formatVersion).toBe(1);
    expect(raw).not.toHaveProperty('needs');
  });
});
