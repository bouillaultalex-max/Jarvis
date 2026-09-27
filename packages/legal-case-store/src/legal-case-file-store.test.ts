import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLegalCase, LegalCaseFileError, type LegalCase } from '@jarvis/legal-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileLegalCaseStore, LegalCaseStoreError } from './legal-case-file-store.js';

/**
 * `FileLegalCaseStore` — un fichier JSON par dossier, sous `baseDir`
 * (`<baseDir>/<id>.json`). Conventions de test inspirées de
 * `memory-file-store.test.ts` (`FileMemoryStore`, `@jarvis/memory`), adaptées
 * à un store adressé par identifiant plutôt qu'à un unique fichier
 * multi-entrées.
 */

function sampleCase(overrides: Partial<LegalCase> = {}): LegalCase {
  return {
    ...createLegalCase({
      title: 'Dossier de test',
      id: 'case-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    ...overrides,
  };
}

function caseWithSource(id: string): LegalCase {
  return {
    ...sampleCase({ id }),
    sources: [
      {
        id: 'src-1',
        sourceType: 'legislative_text',
        authority: 'legifrance',
        title: 'Code civil — art. 1103',
        identifier: 'LEGIARTI000006436298',
        effectiveFrom: '2016-10-01T00:00:00.000Z',
        consultedAt: '2026-01-01T00:00:00.000Z',
        version: '2016-10-01',
        reliability: 'primary_institutional',
        contentHash: 'a'.repeat(64),
      },
    ],
  };
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-legal-case-store-'));
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('FileLegalCaseStore — lecture', () => {
  it('dossier absent → undefined, aucun fichier créé', async () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    expect(store.load('inconnu')).toBeUndefined();
    await expect(readFile(join(dir, 'inconnu.json'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('répertoire inexistant → undefined à la lecture (comme un dossier absent), rien créé', async () => {
    const missingBaseDir = join(dir, 'ne-existe-pas');
    const store = new FileLegalCaseStore({ baseDir: missingBaseDir });
    expect(store.load('case-1')).toBeUndefined();
    await expect(readdir(missingBaseDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fichier vide → LegalCaseStoreError(empty_file), jamais confondu avec une absence', async () => {
    await writeFile(join(dir, 'case-1.json'), '   \n');
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('case-1');
      throw new Error('devrait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(LegalCaseStoreError);
      expect((e as LegalCaseStoreError).reason).toBe('empty_file');
    }
  });

  it('JSON corrompu → LegalCaseStoreError(invalid_json)', async () => {
    await writeFile(join(dir, 'case-1.json'), '{ ceci n’est pas du json ');
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('case-1');
      throw new Error('devrait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(LegalCaseStoreError);
      expect((e as LegalCaseStoreError).reason).toBe('invalid_json');
    }
  });

  it('format legacy v2 → LegalCaseFileError(legacy_version), aucune migration silencieuse', async () => {
    await writeFile(
      join(dir, 'case-1.json'),
      JSON.stringify({ version: 2, case: { id: 'case-1' } }),
    );
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('case-1');
      throw new Error('devrait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(LegalCaseFileError);
      expect((e as LegalCaseFileError).reason).toBe('legacy_version');
    }
  });

  it('version inconnue → LegalCaseFileError(unknown_version)', async () => {
    await writeFile(
      join(dir, 'case-1.json'),
      JSON.stringify({ version: 99, case: { id: 'case-1' } }),
    );
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('case-1');
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as LegalCaseFileError).reason).toBe('unknown_version');
    }
  });

  it('dossier invalide (échoue validateLegalCaseV3) → LegalCaseFileError(invalid_case)', async () => {
    await writeFile(
      join(dir, 'case-1.json'),
      JSON.stringify({ version: 3, case: { id: 'case-1' } }),
    );
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('case-1');
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as LegalCaseFileError).reason).toBe('invalid_case');
    }
  });

  it('identifiant non sûr (traversée de répertoire) → refusé avant tout accès disque', () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    try {
      store.load('../evasion');
      throw new Error('devrait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(LegalCaseStoreError);
      expect((e as LegalCaseStoreError).reason).toBe('invalid_id');
    }
    expect(() => store.load('a/b')).toThrow(LegalCaseStoreError);
  });
});

describe('FileLegalCaseStore — écriture puis lecture', () => {
  it('save puis load : égalité structurelle', () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    const legalCase = sampleCase();
    store.save(legalCase);
    expect(store.load(legalCase.id)).toEqual(legalCase);
  });

  it('save puis nouvelle instance : la donnée est toujours là', () => {
    const legalCase = sampleCase({ id: 'case-2', title: 'Persistant' });
    new FileLegalCaseStore({ baseDir: dir }).save(legalCase);

    const reloaded = new FileLegalCaseStore({ baseDir: dir }).load('case-2');
    expect(reloaded).toEqual(legalCase);
  });

  it('un fichier JSON par dossier : deux dossiers distincts, deux fichiers distincts', async () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    store.save(sampleCase({ id: 'case-a' }));
    store.save(sampleCase({ id: 'case-b' }));

    expect((await readdir(dir)).sort()).toEqual(['case-a.json', 'case-b.json']);
    expect(store.load('case-a')?.id).toBe('case-a');
    expect(store.load('case-b')?.id).toBe('case-b');
  });

  it('save écrase un dossier existant de même id (dernière écriture gagne)', () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    store.save(sampleCase({ id: 'case-1', title: 'v1' }));
    store.save(sampleCase({ id: 'case-1', title: 'v2' }));
    expect(store.load('case-1')?.title).toBe('v2');
  });

  it('répertoire parent inexistant → créé à la 1re écriture', async () => {
    const nested = join(dir, 'a', 'b', 'c');
    const store = new FileLegalCaseStore({ baseDir: nested });
    store.save(sampleCase());
    expect(new FileLegalCaseStore({ baseDir: nested }).load('case-1')).toBeDefined();
  });

  it('save rejette un dossier invalide (LegalCaseFileError), sans rien écrire', () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    const invalid = { ...sampleCase(), title: '' } as LegalCase;
    expect(() => store.save(invalid)).toThrow(LegalCaseFileError);
    expect(store.load('case-1')).toBeUndefined();
  });

  it('save rejette un identifiant non sûr (LegalCaseStoreError), sans rien écrire', () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    expect(() => store.save(sampleCase({ id: '../evasion' }))).toThrow(LegalCaseStoreError);
  });
});

describe('FileLegalCaseStore — aucun contenu textuel juridique persisté', () => {
  it('le fichier écrit ne contient ni "content" ni le texte brut de la source', async () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    const legalCase = caseWithSource('case-1');
    store.save(legalCase);

    const raw = await readFile(join(dir, 'case-1.json'), 'utf-8');
    expect(raw).not.toContain('"content"');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed.case.sources[0]).sort()).toEqual(
      [
        'authority',
        'consultedAt',
        'contentHash',
        'effectiveFrom',
        'id',
        'identifier',
        'reliability',
        'sourceType',
        'title',
        'version',
      ].sort(),
    );
  });
});

describe('FileLegalCaseStore — écriture atomique / résilience', () => {
  it('deux écritures successives : aucune perte, aucun fichier temporaire résiduel', async () => {
    const store = new FileLegalCaseStore({ baseDir: dir });
    store.save(sampleCase({ id: 'case-a' }));
    store.save(sampleCase({ id: 'case-b' }));

    const files = await readdir(dir);
    expect(files.sort()).toEqual(['case-a.json', 'case-b.json']);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it.skipIf(isRoot)(
    'écriture impossible (dossier en lecture seule) → dossier existant intact, rien écrit, aucun temporaire résiduel',
    async () => {
      const store = new FileLegalCaseStore({ baseDir: dir });
      store.save(sampleCase({ id: 'case-1', title: 'avant' }));
      const before = await readFile(join(dir, 'case-1.json'), 'utf-8');

      await chmod(dir, 0o500); // plus de création de fichier dans le dossier
      expect(() => store.save(sampleCase({ id: 'case-1', title: 'pendant la panne' }))).toThrow();
      await chmod(dir, 0o700);

      expect(await readFile(join(dir, 'case-1.json'), 'utf-8')).toBe(before);
      expect(new FileLegalCaseStore({ baseDir: dir }).load('case-1')?.title).toBe('avant');
      expect((await readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(false);
    },
  );
});
