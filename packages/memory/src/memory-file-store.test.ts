import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MemoryEntryInput } from './memory-entry.js';
import { MemoryFileError } from './memory-file-format.js';
import { FileMemoryStore } from './memory-file-store.js';
import { InMemoryMemoryStore } from './memory-store.js';

function input(overrides: Partial<MemoryEntryInput> = {}): MemoryEntryInput {
  return {
    kind: 'fact',
    statement: 'Le projet Phoenix est prioritaire.',
    provenance: { origin: 'llm_proposed', confidence: 0.6 },
    ...overrides,
  };
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-file-memory-store-'));
  filePath = join(dir, 'memory.json');
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('FileMemoryStore — démarrage', () => {
  it('fichier absent → store vide, aucun fichier créé', async () => {
    const store = new FileMemoryStore({ filePath });
    expect(store.list()).toEqual([]);
    expect(store.get('mem-1')).toBeUndefined();
    await expect(readFile(filePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('répertoire parent inexistant → store vide, créé à la 1re écriture', async () => {
    const deep = join(dir, 'a', 'b', 'c', 'memory.json');
    const store = new FileMemoryStore({ filePath: deep });
    expect(store.list()).toEqual([]);
    store.add(input());
    expect(new FileMemoryStore({ filePath: deep }).list()).toHaveLength(1);
  });

  it('fichier vide → MemoryFileError(empty_file), jamais « store vide » silencieux', async () => {
    await writeFile(filePath, '   \n');
    expect(() => new FileMemoryStore({ filePath })).toThrowError(MemoryFileError);
    try {
      new FileMemoryStore({ filePath });
    } catch (e) {
      expect((e as MemoryFileError).reason).toBe('empty_file');
    }
  });

  it('JSON corrompu → MemoryFileError(invalid_json)', async () => {
    await writeFile(filePath, '{ ceci n’est pas du json ');
    try {
      new FileMemoryStore({ filePath });
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as MemoryFileError).reason).toBe('invalid_json');
    }
  });

  it('version inconnue → MemoryFileError(unknown_version)', async () => {
    await writeFile(filePath, JSON.stringify({ version: 2, entries: [] }));
    try {
      new FileMemoryStore({ filePath });
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as MemoryFileError).reason).toBe('unknown_version');
    }
  });

  it('structure invalide dans le fichier → MemoryFileError(invalid_structure)', async () => {
    await writeFile(filePath, JSON.stringify({ version: 1, entries: [{ id: 'x', kind: 'note' }] }));
    try {
      new FileMemoryStore({ filePath });
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as MemoryFileError).reason).toBe('invalid_structure');
    }
  });
});

describe('FileMemoryStore — persistance', () => {
  it('add puis get', () => {
    const store = new FileMemoryStore({ filePath });
    const entry = store.add(input());
    expect(store.get(entry.id)).toEqual(entry);
  });

  it('add puis nouvelle instance → la donnée est toujours là', () => {
    const first = new FileMemoryStore({ filePath });
    const entry = first.add(input({ statement: 'Persistant.' }));

    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get(entry.id)).toMatchObject({ id: entry.id, statement: 'Persistant.' });
    expect(reloaded.list().map((e) => e.statement)).toEqual(['Persistant.']);
  });

  it('le fichier écrit est un JSON valide avec version', async () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input());
    const json = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(json.version).toBe(1);
    expect(json.entries).toHaveLength(1);
  });

  it('plusieurs entrées : ordre d’insertion conservé après redémarrage', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ statement: 'A.' }));
    store.add(input({ statement: 'B.' }));
    store.add(input({ statement: 'C.' }));

    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.list().map((e) => e.statement)).toEqual(['A.', 'B.', 'C.']);
  });

  it('ids stables (mem-1, mem-2…) et compteur repris après redémarrage', () => {
    const store = new FileMemoryStore({ filePath });
    expect(store.add(input()).id).toBe('mem-1');
    expect(store.add(input()).id).toBe('mem-2');

    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get('mem-1')).toBeDefined();
    expect(reloaded.add(input()).id).toBe('mem-3');
  });

  it('createdAt conservé exactement', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ createdAt: '2020-05-06T07:08:09.000Z' }));
    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get('mem-1')!.createdAt).toBe('2020-05-06T07:08:09.000Z');
  });

  it('provenance conservée exactement (origin + confidence + note)', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ provenance: { origin: 'inferred', confidence: 0.37, note: 'msg-42' } }));
    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get('mem-1')!.provenance).toEqual({
      origin: 'inferred',
      confidence: 0.37,
      note: 'msg-42',
    });
  });

  it('subject conservé (et absent quand non fourni)', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ subject: 'projet-x' }));
    store.add(input());
    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get('mem-1')!.subject).toBe('projet-x');
    expect(reloaded.get('mem-2')!.subject).toBeUndefined();
  });
});

describe('FileMemoryStore — list / filtres', () => {
  it('respecte kind, subject et includeInvalidated après redémarrage', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ kind: 'fact', subject: 'a', statement: 'F.' }));
    store.add(input({ kind: 'preference', subject: 'a', statement: 'P.' }));
    const stale = store.add(input({ kind: 'preference', subject: 'b', statement: 'Q.' }));
    store.invalidate(stale.id, 'obsolète');

    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.list().map((e) => e.statement)).toEqual(['F.', 'P.']);
    expect(reloaded.list({ includeInvalidated: true }).map((e) => e.statement)).toEqual([
      'F.',
      'P.',
      'Q.',
    ]);
    expect(reloaded.list({ kind: 'preference' }).map((e) => e.statement)).toEqual(['P.']);
    expect(reloaded.list({ subject: 'a' }).map((e) => e.statement)).toEqual(['F.', 'P.']);
  });

  it('list() renvoie un tableau neuf (mutation-safe)', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ statement: 'un' }));
    const first = store.list();
    (first as unknown[]).length = 0;
    expect(store.list().map((e) => e.statement)).toEqual(['un']);
  });
});

describe('FileMemoryStore — invalidate / supersede persistés', () => {
  it('invalidate persiste l’état d’invalidation, l’entrée reste dans le fichier', () => {
    const store = new FileMemoryStore({ filePath });
    const e = store.add(input());
    store.invalidate(e.id, 'corrigé');

    const reloaded = new FileMemoryStore({ filePath });
    const back = reloaded.get(e.id)!;
    expect(back.invalidatedAt).toBeTypeOf('string');
    expect(back.invalidationReason).toBe('corrigé');
    expect(reloaded.list({ includeInvalidated: true })).toHaveLength(1);
  });

  it('invalidate est idempotent (comme InMemoryMemoryStore)', () => {
    const store = new FileMemoryStore({ filePath });
    const e = store.add(input());
    const a = store.invalidate(e.id, 'raison 1');
    const b = store.invalidate(e.id, 'raison 2');
    expect(b).toEqual(a);
    expect(b.invalidationReason).toBe('raison 1');
  });

  it('supersede persiste les liens amont/aval ; rien n’est supprimé', () => {
    const store = new FileMemoryStore({ filePath });
    const v1 = store.add(input({ statement: 'v1' }));
    const v2 = store.supersede(v1.id, input({ statement: 'v2' }));

    const reloaded = new FileMemoryStore({ filePath });
    expect(reloaded.get(v1.id)!.invalidatedAt).toBeTypeOf('string');
    expect(reloaded.get(v1.id)!.supersededById).toBe(v2.id);
    expect(reloaded.get(v2.id)!.supersedesId).toBe(v1.id);
    expect(reloaded.list({ includeInvalidated: true })).toHaveLength(2);
    expect(reloaded.list().map((e) => e.statement)).toEqual(['v2']);
  });

  it('supersede refuse une cible déjà invalidée (contrat MemoryStore)', () => {
    const store = new FileMemoryStore({ filePath });
    const e = store.add(input());
    store.invalidate(e.id);
    expect(() => store.supersede(e.id, input())).toThrow(/déjà invalidée/);
  });
});

describe('FileMemoryStore — validation / erreurs', () => {
  it('add rejette une entrée invalide, sans rien écrire', async () => {
    const store = new FileMemoryStore({ filePath });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => store.add(input({ kind: 'note' as any }))).toThrow(/kind/);
    expect(() => store.add(input({ statement: '   ' }))).toThrow(/statement/);
    expect(() =>
      store.add(input({ provenance: { origin: 'user_stated', confidence: 0.5 } })),
    ).toThrow(/confidence/);
    expect(store.list()).toEqual([]);
    await expect(readFile(filePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('FileMemoryStore — écritures successives & déterminisme', () => {
  it('deux écritures successives : aucune perte d’entrée', () => {
    const store = new FileMemoryStore({ filePath });
    store.add(input({ statement: 'a' }));
    store.add(input({ statement: 'b' }));
    expect(new FileMemoryStore({ filePath }).list()).toHaveLength(2);
  });

  it('déterministe : même séquence (createdAt injectés) → même contenu de fichier', async () => {
    const run = async (fp: string) => {
      const s = new FileMemoryStore({ filePath: fp });
      s.add(input({ subject: 's', statement: 'a', createdAt: '2026-01-01T00:00:00.000Z' }));
      s.add(input({ kind: 'preference', statement: 'b', createdAt: '2026-01-02T00:00:00.000Z' }));
      s.add(input({ statement: 'c', createdAt: '2026-01-03T00:00:00.000Z' }));
      return readFile(fp, 'utf-8');
    };
    const [f1, f2] = await Promise.all([run(join(dir, 'a.json')), run(join(dir, 'b.json'))]);
    expect(f1).toBe(f2);
    // Structure attendue : version, ordre, ids stables.
    const parsed = JSON.parse(f1);
    expect(parsed.version).toBe(1);
    expect(parsed.entries.map((e: { id: string }) => e.id)).toEqual(['mem-1', 'mem-2', 'mem-3']);
  });

  it('parité avec InMemoryMemoryStore : mêmes list() pour la même séquence', () => {
    const seq = (store: FileMemoryStore | InMemoryMemoryStore) => {
      const a = store.add(input({ subject: 's', statement: 'A.' }));
      store.add(input({ kind: 'preference', statement: 'B.' }));
      const c = store.add(input({ statement: 'C.' }));
      store.invalidate(a.id, 'r');
      store.supersede(c.id, input({ statement: 'C2.' }));
      return {
        list: store.list().map((e) => e.statement),
        all: store.list({ includeInvalidated: true }).map((e) => ({
          s: e.statement,
          inv: e.invalidatedAt !== undefined,
        })),
        pref: store.list({ kind: 'preference' }).map((e) => e.statement),
      };
    };
    expect(seq(new FileMemoryStore({ filePath }))).toEqual(seq(new InMemoryMemoryStore()));
  });
});

describe('FileMemoryStore — résilience', () => {
  it.skipIf(isRoot)(
    'écriture impossible (dossier en lecture seule) → mutation annulée, fichier existant intact',
    async () => {
      const store = new FileMemoryStore({ filePath });
      store.add(input({ statement: 'avant' })); // 1re écriture OK
      const before = await readFile(filePath, 'utf-8');

      await chmod(dir, 0o500); // plus de création de fichier dans le dossier
      expect(() => store.add(input({ statement: 'pendant la panne' }))).toThrow();
      await chmod(dir, 0o700);

      // État mémoire restauré…
      expect(store.list().map((e) => e.statement)).toEqual(['avant']);
      // …et fichier sur disque inchangé.
      expect(await readFile(filePath, 'utf-8')).toBe(before);
      expect(new FileMemoryStore({ filePath }).list().map((e) => e.statement)).toEqual(['avant']);
    },
  );
});
