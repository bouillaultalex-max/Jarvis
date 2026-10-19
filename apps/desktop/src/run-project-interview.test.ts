import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileProjectBriefStore, MAX_ANSWER_CHARS } from '@jarvis/project-briefs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runProjectInterview } from './run-project-interview.js';

/**
 * Tests de `run-project-interview.ts` — store réel sur répertoire temporaire
 * (jamais `~/.local/share/jarvis/project-briefs`, jamais le projet réel
 * `boutique-asiatique`), IO simulée (`PassThrough`, jamais `process.stdin`).
 * Aucun réseau, aucun LLM — ce parcours n'en appelle aucun.
 */

type FakeTty = PassThrough & { isTTY: boolean };

function fakeTty(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.isTTY = true;
  return stream;
}

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

function sendLine(stdin: PassThrough, line: string): void {
  stdin.write(`${line}\n`);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-project-interview-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function store(): FileProjectBriefStore {
  return new FileProjectBriefStore({ baseDir: dir });
}

describe('runProjectInterview — projet absent ou sans question ouverte', () => {
  it('projet introuvable → message clair, code 1, aucune interface readline ouverte', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const exitCode = await runProjectInterview('absent', { store: store(), input: stdin, output });

    expect(exitCode).toBe(1);
    expect(readText()).toContain('introuvable');
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('aucune question ouverte → message fixe, code 0, aucune interface readline ouverte', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const exitCode = await runProjectInterview('p1', { store: s, input: stdin, output });

    expect(exitCode).toBe(0);
    expect(readText()).toContain('Aucune question ouverte restante');
    expect(stdin.listenerCount('data')).toBe(0);
  });
});

describe('runProjectInterview — réponse confirmée', () => {
  it('réponse puis "y" → enregistrée, question suivante affichée, puis /quit', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q1 = s.addQuestion('p1', 'Première question').questions.at(-1)!;
    const q2 = s.addQuestion('p1', 'Seconde question').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q1.text));
    sendLine(stdin, 'réponse A');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    sendLine(stdin, 'y');
    await vi.waitFor(() => expect(readText()).toContain(q2.text));
    sendLine(stdin, '/quit');

    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(readText()).toContain('Réponse enregistrée.');
    const after = s.get('p1')!;
    expect(after.questions.find((q) => q.id === q1.id)).toMatchObject({
      status: 'resolved',
      answer: 'réponse A',
    });
    expect(after.questions.find((q) => q.id === q2.id)!.status).toBe('open');
  });

  it('accepte "yes" et "oui" (insensible à la casse) comme confirmation', async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addQuestion('p1', 'Question');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain('Question'));
    sendLine(stdin, 'réponse');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    sendLine(stdin, 'OUI');
    await vi.waitFor(() => expect(readText()).toContain('Réponse enregistrée.'));
    sendLine(stdin, '/quit');
    await promise;

    expect(s.get('p1')!.questions[0]!.answer).toBe('réponse');
  });
});

describe('runProjectInterview — réponse abandonnée', () => {
  it('confirmation autre que y/yes/oui → réponse abandonnée, même question réaffichée', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question unique').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, 'réponse jetée');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    sendLine(stdin, 'n');
    await vi.waitFor(() => expect(readText()).toContain('Réponse abandonnée'));
    // La même question (toujours open) est réaffichée — pas « Aucune question ouverte ».
    await vi.waitFor(() => expect(readText().split(q.text).length).toBeGreaterThanOrEqual(3));
    sendLine(stdin, '/quit');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });
});

describe('runProjectInterview — validation locale de la réponse', () => {
  it('réponse vide refusée localement, sans appel au store ; une réponse valide ensuite réussit', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const spy = vi.spyOn(s, 'answerQuestion');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, '   ');
    await vi.waitFor(() => expect(readText()).toContain('Réponse vide refusée'));
    expect(spy).not.toHaveBeenCalled();

    sendLine(stdin, 'réponse correcte');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    sendLine(stdin, 'y');
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    sendLine(stdin, '/quit');
    await promise;
  });

  it('réponse trop longue refusée localement, sans appel au store', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const spy = vi.spyOn(s, 'answerQuestion');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const tooLong = 'x'.repeat(MAX_ANSWER_CHARS + 1);

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, tooLong);
    await vi.waitFor(() => expect(readText()).toContain('Réponse refusée'));
    expect(spy).not.toHaveBeenCalled();
    sendLine(stdin, '/quit');
    await promise;
  });
});

describe('runProjectInterview — passer (en mémoire de session uniquement)', () => {
  it('"/passer" puis "/quit" : aucune mutation ; reprise dans une nouvelle session retrouve la même question en premier', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q1 = s.addQuestion('p1', 'Question 1').questions.at(-1)!;
    const q2 = s.addQuestion('p1', 'Question 2').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q1.text));
    sendLine(stdin, '/passer');
    await vi.waitFor(() => expect(readText()).toContain(q2.text));
    sendLine(stdin, '/quit');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    const after = s.get('p1')!;
    expect(after.questions.every((q) => q.status === 'open')).toBe(true);

    // Nouvelle session (nouvel appel) : le passage précédent est oublié,
    // q1 redevient la première question proposée.
    const stdin2 = fakeTty();
    const { output: output2, readText: readText2 } = collectingOutput();
    const promise2 = runProjectInterview('p1', { store: s, input: stdin2, output: output2 });
    await vi.waitFor(() => expect(readText2()).toContain(q1.text));
    sendLine(stdin2, '/quit');
    await promise2;
  });

  it('toutes les questions restantes passées → message dédié, sans boucler, sans prétendre à une résolution', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question unique').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const exitCode = await (async () => {
      const promise = runProjectInterview('p1', { store: s, input: stdin, output });
      await vi.waitFor(() => expect(readText()).toContain(q.text));
      sendLine(stdin, '/passer');
      return promise;
    })();

    expect(exitCode).toBe(0);
    expect(readText()).toContain('Questions restantes passées pour cette session.');
    // Jamais prétendu résolu : la question reste `open`.
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });
});

describe('runProjectInterview — Ctrl+C et EOF', () => {
  it('Ctrl+C pendant la saisie de la réponse → aucune écriture, question toujours ouverte', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    stdin.write('\u0003');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('Ctrl+C pendant la confirmation → réponse proposée jamais enregistrée', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, 'réponse jamais confirmée');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    stdin.write('\u0003');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });

  it('fin de stdin (EOF) pendant la saisie → boucle terminée proprement, aucune écriture', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    stdin.end();
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });

  it('fin de stdin (EOF) pendant la confirmation → réponse proposée jamais enregistrée', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, 'réponse jamais confirmée');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    stdin.end();
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });

  it('/quit suivi de lignes déjà en attente dans le même paquet → jamais traitées, même déjà disponibles', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const spy = vi.spyOn(s, 'answerQuestion');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    // Les trois lignes arrivent dans le MÊME paquet — /quit est lu avant
    // que les deux lignes suivantes (déjà disponibles) ne soient jamais
    // redemandées par la boucle.
    stdin.write('/quit\nréponse-fantôme\ny\n');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('Ctrl+C suivi dans le même paquet par une ligne de confirmation déjà disponible → jamais traitée', async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const spy = vi.spyOn(s, 'answerQuestion');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    sendLine(stdin, 'réponse avant interruption');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    // Ctrl+C et la ligne de confirmation « y » dans le même paquet : la
    // ligne, bien que déjà parsée par readline, ne doit jamais être
    // transformée en confirmation après l'interruption.
    stdin.write('\u0003y\n');
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(s.get('p1')!.questions[0]!.status).toBe('open');
  });
});

describe('runProjectInterview — nettoyage sélectif des écouteurs', () => {
  it("préserve un écouteur 'data' externe déjà présent sur l'entrée, retire seulement celui ajouté par cette interface", async () => {
    const s = store();
    s.create('p1', 'Projet');
    s.addQuestion('p1', 'Question');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const external = (): void => {};
    stdin.on('data', external);
    expect(stdin.listenerCount('data')).toBe(1);

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain('Question'));
    sendLine(stdin, '/quit');
    await promise;

    expect(stdin.listeners('data')).toEqual([external]);
  });
});

describe('runProjectInterview — erreur de stockage (verrou détenu)', () => {
  it("'locked' → message contrôlé, code 1, un seul appel à answerQuestion (aucun retry automatique)", async () => {
    const s = store();
    s.create('p1', 'Projet');
    const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
    const spy = vi.spyOn(s, 'answerQuestion');
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    const promise = runProjectInterview('p1', { store: s, input: stdin, output });
    await vi.waitFor(() => expect(readText()).toContain(q.text));
    // Simule une autre commande déjà en cours sur ce fichier.
    await writeFile(join(dir, 'p1.json.lock'), '');
    sendLine(stdin, 'réponse');
    await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));
    sendLine(stdin, 'y');
    const exitCode = await promise;

    expect(exitCode).toBe(1);
    expect(readText()).toContain('Erreur de stockage');
    expect(readText()).toContain('locked');
    expect(spy).toHaveBeenCalledTimes(1);
    await rm(join(dir, 'p1.json.lock'));
  });
});

describe('runProjectInterview — résolution concurrente entre affichage et confirmation', () => {
  it(
    'already_answered pendant la confirmation → réponse initiale (du process concurrent) ' +
      'conservée, aucune révision supplémentaire, réponse abandonnée jamais resoumise',
    async () => {
      const s = store();
      s.create('p1', 'Projet');
      const q = s.addQuestion('p1', 'Question').questions.at(-1)!;
      const stdin = fakeTty();
      const { output, readText } = collectingOutput();

      const promise = runProjectInterview('p1', { store: s, input: stdin, output });
      await vi.waitFor(() => expect(readText()).toContain(q.text));
      sendLine(stdin, 'réponse de cette session');
      await vi.waitFor(() => expect(readText()).toContain('Enregistrer ?'));

      // Un autre process (autre instance de store, même répertoire) résout
      // la question en premier, entre l'affichage et la confirmation.
      const concurrentStore = new FileProjectBriefStore({ baseDir: dir });
      const resolvedByOther = concurrentStore.answerQuestion(
        'p1',
        q.id,
        'réponse du process concurrent',
      );

      sendLine(stdin, 'y');
      await vi.waitFor(() => expect(readText()).toContain('Conflit'));
      sendLine(stdin, '/quit');
      const exitCode = await promise;

      expect(exitCode).toBe(0);
      const final = s.get('p1')!;
      expect(final.questions[0]!.answer).toBe('réponse du process concurrent');
      expect(final.revision).toBe(resolvedByOther.revision);
    },
  );
});
