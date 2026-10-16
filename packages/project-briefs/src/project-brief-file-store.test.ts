import { readdirSync, statSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectBriefFileError, ProjectBriefStoreError } from './project-brief-errors.js';
import { FileProjectBriefStore } from './project-brief-file-store.js';
import { acquireProjectBriefLock } from './project-brief-lock.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-project-briefs-store-'));
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

function store(): FileProjectBriefStore {
  return new FileProjectBriefStore({ baseDir: dir });
}

describe('FileProjectBriefStore — validation', () => {
  it('rejette un id invalide avant tout accès disque', () => {
    const s = store();
    expect(() => s.create('id invalide !', 'Nom')).toThrow(ProjectBriefStoreError);
    expect(() => s.get('..')).toThrow(ProjectBriefStoreError);
  });

  it('rejette un nom ou un texte vide ou trop long', () => {
    const s = store();
    expect(() => s.create('p1', '')).toThrow(ProjectBriefStoreError);
    expect(() => s.create('p1', 'x'.repeat(300))).toThrow(ProjectBriefStoreError);
    s.create('p2', 'Projet');
    expect(() => s.addFact('p2', '')).toThrow(ProjectBriefStoreError);
  });

  it('refuse un ajout au-delà de la limite de la catégorie', () => {
    const s = store();
    s.create('p1', 'Projet');
    for (let i = 0; i < 50; i += 1) s.addFact('p1', `fait ${i}`);
    expect(() => s.addFact('p1', 'fait de trop')).toThrow(ProjectBriefStoreError);
  });
});

const isWindows = process.platform === 'win32';

describe('FileProjectBriefStore — sécurité', () => {
  it.each(['..', '../p1', '../../etc/passwd', 'a/b', 'a\\b', '.', '', 'a'.repeat(65)])(
    'refuse un identifiant de traversée de chemin ou hors motif : %j',
    (id) => {
      const s = store();
      expect(() => s.create(id, 'Nom')).toThrow(ProjectBriefStoreError);
      expect(() => s.get(id)).toThrow(ProjectBriefStoreError);
      // Aucun fichier n'a pu être créé où que ce soit : la validation précède
      // tout accès disque, donc aucune écriture hors `dir` n'est tentée.
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it.skipIf(isWindows)(
    'répertoire (créé par le store, pas préexistant) et fichier final en mode privé (0700/0600) sous WSL',
    async () => {
      // `dir` (le tmpdir du test) existe déjà avant ce store, avec son propre
      // mode (`mkdtemp`) — le sous-répertoire `briefs/` ci-dessous, lui,
      // n'existe pas encore : son mode est donc entièrement dû à ce store.
      const nestedBaseDir = join(dir, 'briefs');
      const s = new FileProjectBriefStore({ baseDir: nestedBaseDir });
      s.create('p1', 'Projet');
      expect(statSync(nestedBaseDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(nestedBaseDir, 'p1.json')).mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(isWindows)('verrou créé en mode privé (0600) sous WSL', () => {
    const release = acquireProjectBriefLock(join(dir, 'p1.json'));
    expect(statSync(join(dir, 'p1.json.lock')).mode & 0o777).toBe(0o600);
    release();
  });

  it.skipIf(isWindows || isRoot)(
    "un échec d'écriture ne supprime que le temporaire de CETTE opération, jamais le fichier existant ni un autre temporaire",
    async () => {
      const s = store();
      s.create('p1', 'Projet');
      const before = await readFile(join(dir, 'p1.json'), 'utf-8');
      // Simule le temporaire d'une AUTRE opération déjà en cours, avec un
      // suffixe différent du pid courant — ne doit jamais être touché.
      const foreignTemp = join(dir, 'p1.json.999999-deadbeef0000.tmp');
      await writeFile(foreignTemp, 'contenu étranger');

      await chmod(dir, 0o500); // crée le temporaire impossible → écriture refusée
      expect(() => s.addFact('p1', 'pendant la panne')).toThrow();
      await chmod(dir, 0o700);

      expect(await readFile(join(dir, 'p1.json'), 'utf-8')).toBe(before);
      expect(await readFile(foreignTemp, 'utf-8')).toBe('contenu étranger');
      await rm(foreignTemp);
    },
  );
});

describe('FileProjectBriefStore — création', () => {
  it('fichier absent → get() renvoie undefined, aucune erreur, aucun fichier créé', async () => {
    const s = store();
    expect(s.get('absent')).toBeUndefined();
    await expect(readFile(join(dir, 'absent.json'))).rejects.toThrow();
  });

  it('create ne remplace jamais un projet existant', () => {
    const s = store();
    s.create('p1', 'Boutique');
    expect(() => s.create('p1', 'Autre nom')).toThrow(ProjectBriefStoreError);
    expect(s.get('p1')!.name).toBe('Boutique');
  });
});

describe('FileProjectBriefStore — opérations et transitions', () => {
  it('addFact/addHypothesis/addQuestion/addDecision donnent des ids stables, jamais des index', () => {
    const s = store();
    s.create('p1', 'Projet');
    const f1 = s.addFact('p1', 'fait A').facts.at(-1)!;
    const f2 = s.addFact('p1', 'fait B').facts.at(-1)!;
    expect(f1.id).toBe('fact-1');
    expect(f2.id).toBe('fact-2');

    const q1 = s.addQuestion('p1', 'question A').questions.at(-1)!;
    expect(q1.id).toBe('q-1');

    // Valider par id reste correct même si l'ordre du tableau changeait.
    const d1 = s.addDecision('p1', 'décision A').decisions.at(-1)!;
    const validated = s.validateDecision('p1', d1.id);
    expect(validated.decisions.find((d) => d.id === d1.id)!.status).toBe('validated');
  });

  it('not_found sur un projet absent', () => {
    const s = store();
    expect(() => s.addFact('inexistant', 'x')).toThrow(ProjectBriefStoreError);
  });

  it('unknown_question / unknown_decision sur un id inconnu', () => {
    const s = store();
    s.create('p1', 'Projet');
    expect(() => s.answerQuestion('p1', 'q-999', 'réponse')).toThrow(ProjectBriefStoreError);
    expect(() => s.validateDecision('p1', 'dec-999')).toThrow(ProjectBriefStoreError);
  });

  it('une décision validée peut devenir obsolète ; une décision obsolète ne peut plus être validée', () => {
    const s = store();
    s.create('p1', 'Projet');
    const dec = s.addDecision('p1', 'décision').decisions.at(-1)!;
    s.validateDecision('p1', dec.id);
    const obsoleted = s.obsoleteDecision('p1', dec.id);
    expect(obsoleted.decisions.find((d) => d.id === dec.id)!.status).toBe('obsolete');
    expect(() => s.validateDecision('p1', dec.id)).toThrow(ProjectBriefStoreError);
  });

  it('répondre à une question ne promeut jamais la réponse en fait ni en décision validée', () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'question').questions.at(-1)!;
    const after = s.answerQuestion('p1', q.id, 'réponse X');
    expect(after.questions.find((x) => x.id === q.id)).toEqual({
      id: q.id,
      text: q.text,
      status: 'resolved',
      answer: 'réponse X',
    });
    expect(after.facts).toHaveLength(0);
    expect(after.decisions).toHaveLength(0);
  });

  it('révision et updatedAt avancent à chaque mutation', () => {
    const s = store();
    const created = s.create('p1', 'Projet');
    expect(created.revision).toBe(1);
    const after = s.addFact('p1', 'fait');
    expect(after.revision).toBe(2);
    expect(after.updatedAt >= created.updatedAt).toBe(true);
  });
});

describe('FileProjectBriefStore — persistance', () => {
  it('survit à une réouverture (nouvelle instance du store sur le même répertoire)', () => {
    const first = store();
    first.create('p1', 'Projet');
    first.addFact('p1', 'fait durable');

    const reopened = new FileProjectBriefStore({ baseDir: dir });
    expect(reopened.get('p1')!.facts.map((f) => f.text)).toEqual(['fait durable']);
  });

  it.skipIf(isRoot)(
    'panne d’écriture (répertoire en lecture seule) → mutation annulée, fichier existant intact',
    async () => {
      const s = store();
      s.create('p1', 'Projet');
      const before = await readFile(join(dir, 'p1.json'), 'utf-8');

      await chmod(dir, 0o500);
      expect(() => s.addFact('p1', 'pendant la panne')).toThrow();
      await chmod(dir, 0o700);

      expect(await readFile(join(dir, 'p1.json'), 'utf-8')).toBe(before);
    },
  );

  it('fichier corrompu : JSON invalide, fichier vide et version inconnue sont détectés, jamais confondus avec une absence', async () => {
    await writeFile(join(dir, 'vide.json'), '');
    await writeFile(join(dir, 'mauvais-json.json'), '{not json');
    await writeFile(
      join(dir, 'version-inconnue.json'),
      JSON.stringify({
        id: 'x',
        name: 'x',
        formatVersion: 999,
        revision: 1,
        facts: [],
        hypotheses: [],
        decisions: [],
        questions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const s = store();
    expect(() => s.get('vide')).toThrow(ProjectBriefFileError);
    expect(() => s.get('mauvais-json')).toThrow(ProjectBriefFileError);
    expect(() => s.get('version-inconnue')).toThrow(ProjectBriefFileError);
  });
});

describe('FileProjectBriefStore — concurrence', () => {
  it("un verrou déjà détenu (autre process en cours) fait échouer l'opération sans perte silencieuse", async () => {
    const s = store();
    s.create('p1', 'Projet');
    // Simule une autre commande déjà en cours : le fichier de verrou existe déjà.
    await writeFile(join(dir, 'p1.json.lock'), '');

    expect(() => s.addFact('p1', 'devrait être refusé')).toThrow(ProjectBriefStoreError);
    // Rien n'a changé : ni le fichier de données, ni une écriture partielle.
    const reopened = new FileProjectBriefStore({ baseDir: dir });
    expect(reopened.get('p1')!.facts).toHaveLength(0);

    await rm(join(dir, 'p1.json.lock'));
    expect(reopened.addFact('p1', 'accepté une fois le verrou libéré').facts).toHaveLength(1);
  });

  it('deux instances de store sur le même répertoire (modèle de deux process) ne perdent aucune écriture', () => {
    const storeA = store();
    const storeB = new FileProjectBriefStore({ baseDir: dir });
    storeA.create('p1', 'Projet');
    storeA.addFact('p1', 'écrit par A');
    storeB.addFact('p1', 'écrit par B');
    expect(storeA.get('p1')!.facts.map((f) => f.text)).toEqual(['écrit par A', 'écrit par B']);
  });
});
