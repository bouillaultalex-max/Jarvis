import { describe, expect, it } from 'vitest';

import type { MemoryEntry } from './memory-entry.js';
import {
  CURRENT_MEMORY_FILE_VERSION,
  MemoryFileError,
  parseMemoryFile,
  serializeMemoryFile,
} from './memory-file-format.js';

const FP = '/tmp/mem.json';

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem-1',
    kind: 'fact',
    statement: 'Le projet Phoenix est prioritaire.',
    provenance: { origin: 'llm_proposed', confidence: 0.6 },
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('serializeMemoryFile / parseMemoryFile — aller-retour', () => {
  it('enveloppe versionnée { version: 1, entries: [...] }', () => {
    const json = JSON.parse(serializeMemoryFile([entry()]));
    expect(json.version).toBe(CURRENT_MEMORY_FILE_VERSION);
    expect(Array.isArray(json.entries)).toBe(true);
    expect(json.entries).toHaveLength(1);
  });

  it('round-trip : tous les champs (dont optionnels) conservés à l’identique', () => {
    const full = entry({
      id: 'mem-7',
      subject: 'projet-phoenix',
      provenance: { origin: 'user_confirmed' },
      invalidatedAt: '2026-02-01T00:00:00.000Z',
      invalidationReason: 'remplacée',
      supersedesId: 'mem-3',
      supersededById: 'mem-9',
    });
    const parsed = parseMemoryFile(JSON.parse(serializeMemoryFile([full])), FP);
    expect(parsed).toEqual([full]);
  });

  it('déterministe : deux sérialisations identiques', () => {
    const entries = [entry(), entry({ id: 'mem-2', subject: 's', statement: 'X.' })];
    expect(serializeMemoryFile(entries)).toBe(serializeMemoryFile(entries));
  });
});

describe('parseMemoryFile — corruption / version', () => {
  it('racine non-objet → invalid_structure', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(() => parseMemoryFile(bad, FP)).toThrowError(MemoryFileError);
      try {
        parseMemoryFile(bad, FP);
      } catch (e) {
        expect((e as MemoryFileError).reason).toBe('invalid_structure');
      }
    }
  });

  it('version absente ou ≠ 1 → unknown_version (jamais d’interprétation silencieuse)', () => {
    for (const version of [undefined, 0, 2, '1', null]) {
      try {
        parseMemoryFile({ version, entries: [] }, FP);
        throw new Error('devrait lever');
      } catch (e) {
        expect(e).toBeInstanceOf(MemoryFileError);
        expect((e as MemoryFileError).reason).toBe('unknown_version');
      }
    }
  });

  it('entries absent ou non-tableau → invalid_structure', () => {
    for (const entries of [undefined, {}, 'x', 3]) {
      try {
        parseMemoryFile({ version: 1, entries }, FP);
        throw new Error('devrait lever');
      } catch (e) {
        expect((e as MemoryFileError).reason).toBe('invalid_structure');
      }
    }
  });

  it('entrée malformée → invalid_structure', () => {
    const cases: unknown[] = [
      { ...entry(), kind: 'note' },
      { ...entry(), statement: '   ' },
      { ...entry(), id: '' },
      (() => {
        const e = { ...entry() } as Record<string, unknown>;
        delete e.createdAt;
        return e;
      })(),
      { ...entry(), extra: 'clé inconnue' },
      { ...entry(), provenance: { origin: 'magic' } },
      { ...entry(), provenance: { origin: 'llm_proposed', unexpected: 1 } },
      { ...entry(), provenance: { origin: 'user_stated', confidence: 0.5 } },
    ];
    for (const raw of cases) {
      try {
        parseMemoryFile({ version: 1, entries: [raw] }, FP);
        throw new Error(`devrait lever pour ${JSON.stringify(raw)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(MemoryFileError);
        expect((e as MemoryFileError).reason).toBe('invalid_structure');
      }
    }
  });

  it('id dupliqué → duplicate_id', () => {
    try {
      parseMemoryFile({ version: 1, entries: [entry(), entry()] }, FP);
      throw new Error('devrait lever');
    } catch (e) {
      expect((e as MemoryFileError).reason).toBe('duplicate_id');
    }
  });

  it('MemoryFileError porte reason + filePath', () => {
    try {
      parseMemoryFile({ version: 9 }, '/a/b/mem.json');
    } catch (e) {
      expect(e).toBeInstanceOf(MemoryFileError);
      expect((e as MemoryFileError).reason).toBe('unknown_version');
      expect((e as MemoryFileError).filePath).toBe('/a/b/mem.json');
      expect((e as MemoryFileError).name).toBe('MemoryFileError');
    }
  });

  it('fichier v1 vide (0 entrée) → [] valide', () => {
    expect(parseMemoryFile({ version: 1, entries: [] }, FP)).toEqual([]);
  });
});
