import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_LINKS_PER_ITEM } from './project-brief.js';
import { ProjectBriefStoreError } from './project-brief-errors.js';
import { FileProjectBriefStore } from './project-brief-file-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-project-briefs-links-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function store(): FileProjectBriefStore {
  return new FileProjectBriefStore({ baseDir: dir });
}

async function rawFile(id = 'p1'): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf-8'));
}

/** Fixture v1 **synthétique** écrite telle quelle — aucune donnée réelle. */
const V1_TEXT = JSON.stringify(
  {
    id: 'p1',
    name: 'Projet fictif',
    formatVersion: 1,
    revision: 11,
    facts: [1, 2, 3, 4, 5].map((n) => ({ id: `fact-${n}`, text: `Fait fictif ${n}` })),
    hypotheses: [],
    decisions: [],
    questions: [{ id: 'q-1', text: 'Question fictive ?', status: 'open' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  null,
  2,
);

async function writeV1(): Promise<void> {
  await writeFile(join(dir, 'p1.json'), V1_TEXT, { mode: 0o600 });
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProjectBriefStoreError) return err.reason;
    throw err;
  }
  return undefined;
}

/** Refus attendu, et fichier strictement inchangé (contenu, donc révision et dates). */
async function expectRefusedWithoutWrite(fn: () => unknown, reason: string): Promise<void> {
  const before = await readFile(join(dir, 'p1.json'), 'utf-8');
  expect(reasonOf(fn)).toBe(reason);
  expect(await readFile(join(dir, 'p1.json'), 'utf-8')).toBe(before);
}

describe('compatibilité v1 → v2', () => {
  it('lire un fichier v1 ne l’écrit jamais', async () => {
    await writeV1();
    const before = await stat(join(dir, 'p1.json'));
    const brief = store().get('p1');
    expect(brief?.formatVersion).toBe(1);
    expect(brief?.facts.every((f) => f.sourceIds === undefined)).toBe(true);
    expect(await readFile(join(dir, 'p1.json'), 'utf-8')).toBe(V1_TEXT);
    expect((await stat(join(dir, 'p1.json'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('une mutation du modèle historique conserve v1 (aucune clé v2 écrite)', async () => {
    await writeV1();
    const s = store();
    s.addFact('p1', 'Fait ajouté');
    s.addDecision('p1', 'Décision');
    s.answerQuestion('p1', 'q-1', 'Réponse');
    const raw = await rawFile();
    expect(raw.formatVersion).toBe(1);
    expect(raw).not.toHaveProperty('sources');
    expect(raw.revision).toBe(14);
  });

  it('une fiche créée reste v1 tant qu’aucune notion v2 n’est utilisée', async () => {
    store().create('p1', 'Projet');
    expect((await rawFile()).formatVersion).toBe(1);
  });

  it('ajouter une source passe en v2 ; v2 ne redescend jamais en v1', async () => {
    await writeV1();
    const s = store();
    s.addSource('p1', 'Échange oral fictif');
    expect((await rawFile()).formatVersion).toBe(2);
    s.addFact('p1', 'Fait historique après passage en v2');
    const raw = await rawFile();
    expect(raw.formatVersion).toBe(2);
    expect(raw.sources).toEqual([{ id: 'src-1', text: 'Échange oral fictif' }]);
  });

  it('justifier une décision sur une fiche v1 la passe aussi en v2', async () => {
    await writeV1();
    const s = store();
    s.addDecision('p1', 'Décision');
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    expect((await rawFile()).formatVersion).toBe(2);
  });

  it('valider une décision sur une fiche v1 la passe aussi en v2', async () => {
    await writeV1();
    const s = store();
    s.addDecision('p1', 'Décision');
    s.validateDecision('p1', 'dec-1');
    expect((await rawFile()).formatVersion).toBe(2);
  });
});

describe('date de validation (validatedAt)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withDecisions(): FileProjectBriefStore {
    const s = store();
    s.create('p1', 'Projet');
    s.addDecision('p1', 'Une décision');
    s.addDecision('p1', 'Une autre');
    return s;
  }

  it('valider pose la date exacte de l’horloge, persistée et relue', () => {
    const s = withDecisions();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:34:56.789Z'));
    s.validateDecision('p1', 'dec-1');
    vi.useRealTimers();
    expect(store().get('p1')!.decisions[0]!.validatedAt).toBe('2026-10-21T12:34:56.789Z');
    expect(store().get('p1')!.decisions[1]!.validatedAt).toBeUndefined();
  });

  it('revalider une décision validée est refusé sans écriture ; la date ne change pas', async () => {
    const s = withDecisions();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    s.validateDecision('p1', 'dec-1');
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    await expectRefusedWithoutWrite(() => s.validateDecision('p1', 'dec-1'), 'invalid_transition');
    vi.useRealTimers();
    expect(store().get('p1')!.decisions[0]!.validatedAt).toBe('2026-10-21T12:00:00.000Z');
  });

  it('valider une décision obsolète est refusé sans écriture ; aucune date posée', async () => {
    const s = withDecisions();
    s.obsoleteDecision('p1', 'dec-1');
    await expectRefusedWithoutWrite(() => s.validateDecision('p1', 'dec-1'), 'invalid_transition');
    expect(store().get('p1')!.decisions[0]!.validatedAt).toBeUndefined();
  });

  it('proposed → obsolete ne crée aucune date ; validated → obsolete la conserve', () => {
    const s = withDecisions();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    s.validateDecision('p1', 'dec-2');
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    s.obsoleteDecision('p1', 'dec-1');
    s.obsoleteDecision('p1', 'dec-2');
    vi.useRealTimers();
    const [d1, d2] = store().get('p1')!.decisions;
    expect(d1!.status).toBe('obsolete');
    expect(d1!.validatedAt).toBeUndefined();
    expect(d2!.status).toBe('obsolete');
    expect(d2!.validatedAt).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('liens et justifications — persistance et garanties', () => {
  function seeded(): FileProjectBriefStore {
    const s = store();
    s.create('p1', 'Projet');
    s.addFact('p1', 'Un fait');
    s.addHypothesis('p1', 'Une hypothèse');
    s.addSource('p1', 'Source A');
    s.addDecision('p1', 'Une décision');
    return s;
  }

  it('liens persistés et relus par une nouvelle instance ; révision +1 par mutation', () => {
    const s = seeded();
    const r0 = s.get('p1')!.revision;
    s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-1');
    s.linkSource('p1', { kind: 'hypothesis', id: 'hyp-1' }, 'src-1');
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    s.justifyDecision('p1', 'dec-1', { kind: 'hypothesis', id: 'hyp-1' });
    const reread = store().get('p1')!;
    expect(reread.revision).toBe(r0 + 4);
    expect(reread.facts[0]!.sourceIds).toEqual(['src-1']);
    expect(reread.hypotheses[0]!.sourceIds).toEqual(['src-1']);
    expect(reread.decisions[0]!.basis).toEqual([
      { kind: 'fact', id: 'fact-1' },
      { kind: 'hypothesis', id: 'hyp-1' },
    ]);
  });

  it('justifier ne change jamais le statut ; valider conserve la justification', () => {
    const s = seeded();
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    expect(s.get('p1')!.decisions[0]!.status).toBe('proposed');
    s.validateDecision('p1', 'dec-1');
    expect(s.get('p1')!.decisions[0]!.basis).toEqual([{ kind: 'fact', id: 'fact-1' }]);
  });

  it('références inconnues → refus sans écriture', async () => {
    const s = seeded();
    await expectRefusedWithoutWrite(
      () => s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-9'),
      'unknown_source',
    );
    await expectRefusedWithoutWrite(
      () => s.linkSource('p1', { kind: 'fact', id: 'fact-9' }, 'src-1'),
      'unknown_item',
    );
    // `fact-1` existe, mais pas comme hypothèse.
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-1', { kind: 'hypothesis', id: 'fact-1' }),
      'unknown_item',
    );
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-9', { kind: 'fact', id: 'fact-1' }),
      'unknown_decision',
    );
  });

  it('doublons → already_linked, sans écriture', async () => {
    const s = seeded();
    s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-1');
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    await expectRefusedWithoutWrite(
      () => s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-1'),
      'already_linked',
    );
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' }),
      'already_linked',
    );
  });

  it('justification verrouillée après validation ou obsolescence, sans écriture', async () => {
    const s = seeded();
    s.addDecision('p1', 'Autre décision');
    s.validateDecision('p1', 'dec-1');
    s.obsoleteDecision('p1', 'dec-2');
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' }),
      'invalid_transition',
    );
    await expectRefusedWithoutWrite(
      () => s.justifyDecision('p1', 'dec-2', { kind: 'fact', id: 'fact-1' }),
      'invalid_transition',
    );
  });

  it('les sources d’un fait restent enrichissables après validation d’une décision qui s’y appuie', () => {
    const s = seeded();
    s.justifyDecision('p1', 'dec-1', { kind: 'fact', id: 'fact-1' });
    s.validateDecision('p1', 'dec-1');
    s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, 'src-1');
    expect(s.get('p1')!.facts[0]!.sourceIds).toEqual(['src-1']);
  });

  it('bornes : liens par élément et texte de source', async () => {
    const s = seeded();
    for (let i = 2; i <= MAX_LINKS_PER_ITEM + 1; i += 1) s.addSource('p1', `Source ${i}`);
    for (let i = 1; i <= MAX_LINKS_PER_ITEM; i += 1) {
      s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, `src-${i}`);
    }
    await expectRefusedWithoutWrite(
      () => s.linkSource('p1', { kind: 'fact', id: 'fact-1' }, `src-${MAX_LINKS_PER_ITEM + 1}`),
      'invalid_input',
    );
    await expectRefusedWithoutWrite(() => s.addSource('p1', '   '), 'invalid_input');
  });

  it('projet absent → not_found', () => {
    expect(reasonOf(() => store().addSource('absent', 'x'))).toBe('not_found');
  });

  it('répondre à une question ne crée jamais de fait ni de lien', () => {
    const s = seeded();
    s.addQuestion('p1', 'Une question ?');
    s.answerQuestion('p1', 'q-1', 'Une réponse');
    const brief = s.get('p1')!;
    expect(brief.facts).toHaveLength(1);
    expect(brief.facts[0]!.sourceIds).toBeUndefined();
  });
});
