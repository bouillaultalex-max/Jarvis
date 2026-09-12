import { describe, expect, it } from 'vitest';

import type { MemoryEntry, MemoryEntryInput } from './memory-entry.js';
import { resolveMemoryLineage } from './memory-lineage.js';
import { InMemoryMemoryStore } from './memory-store.js';

function input(statement: string, overrides: Partial<MemoryEntryInput> = {}): MemoryEntryInput {
  return { kind: 'fact', statement, provenance: { origin: 'user_stated' }, ...overrides };
}

/** Construit une chaîne de N versions via `supersede` et renvoie le store. */
function chainOf(...statements: readonly string[]): InMemoryMemoryStore {
  const store = new InMemoryMemoryStore();
  let last = store.add(input(statements[0]!));
  for (const statement of statements.slice(1)) {
    last = store.supersede(last.id, input(statement));
  }
  return store;
}

describe('resolveMemoryLineage', () => {
  it('entrée isolée (aucun lien) → lignée d’un seul élément', () => {
    const store = new InMemoryMemoryStore();
    const only = store.add(input('Seule version.'));

    expect(resolveMemoryLineage(store.list(), only.id)).toEqual([only]);
  });

  it('id absent des entrées fournies → lève', () => {
    const store = new InMemoryMemoryStore();
    store.add(input('X'));
    expect(() => resolveMemoryLineage(store.list(), 'mem-404')).toThrow(/aucune entrée/);
  });

  it('chaîne de 3 versions → ordre ancien → récent, quel que soit le point d’entrée', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const all = store.list({ includeInvalidated: true });

    const expected = ['v1', 'v2', 'v3'];
    for (const id of ['mem-1', 'mem-2', 'mem-3']) {
      expect(resolveMemoryLineage(all, id).map((e) => e.statement)).toEqual(expected);
    }
  });

  it('inclut les entrées invalidées ; seule la dernière ne l’est pas', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const lineage = resolveMemoryLineage(store.list({ includeInvalidated: true }), 'mem-1');

    expect(lineage.slice(0, -1).every((e) => e.invalidatedAt !== undefined)).toBe(true);
    expect(lineage[lineage.length - 1]!.invalidatedAt).toBeUndefined();
  });

  it('liens amont/aval cohérents dans la chaîne', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const [v1, v2, v3] = resolveMemoryLineage(store.list({ includeInvalidated: true }), 'mem-2');

    expect(v1!.supersedesId).toBeUndefined();
    expect(v1!.supersededById).toBe(v2!.id);
    expect(v2!.supersedesId).toBe(v1!.id);
    expect(v2!.supersededById).toBe(v3!.id);
    expect(v3!.supersedesId).toBe(v2!.id);
    expect(v3!.supersededById).toBeUndefined();
  });

  it('déterministe : deux appels identiques → résultat identique', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const all = store.list({ includeInvalidated: true });
    expect(resolveMemoryLineage(all, 'mem-2')).toEqual(resolveMemoryLineage(all, 'mem-2'));
  });

  it('aucun effet de bord : ni le tableau fourni ni les entrées ne sont mutés', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const all = store.list({ includeInvalidated: true });
    const snapshot = all.map((e) => ({ ...e }));

    resolveMemoryLineage(all, 'mem-1');

    expect(all).toEqual(snapshot);
  });

  it('tableau partiel : la traversée s’arrête au maillon manquant, sans erreur', () => {
    const store = chainOf('v1', 'v2', 'v3');
    const withoutOldest = store.list({ includeInvalidated: true }).filter((e) => e.id !== 'mem-1');

    // Depuis mem-2 : mem-1 est absent → on ne remonte pas, on descend jusqu'à mem-3.
    expect(resolveMemoryLineage(withoutOldest, 'mem-2').map((e) => e.statement)).toEqual([
      'v2',
      'v3',
    ]);
  });

  it('id dupliqué dans les entrées : la première occurrence fait foi', () => {
    const a: MemoryEntry = {
      id: 'dup',
      kind: 'fact',
      statement: 'première',
      provenance: { origin: 'user_stated' },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const b: MemoryEntry = { ...a, statement: 'seconde' };

    expect(resolveMemoryLineage([a, b], 'dup')).toEqual([a]);
  });

  it('protection anti-cycle : des liens mutuels ne bouclent pas', () => {
    const a: MemoryEntry = {
      id: 'a',
      kind: 'fact',
      statement: 'A',
      provenance: { origin: 'user_stated' },
      createdAt: '2026-01-01T00:00:00.000Z',
      supersededById: 'b',
      supersedesId: 'b',
    };
    const b: MemoryEntry = {
      id: 'b',
      kind: 'fact',
      statement: 'B',
      provenance: { origin: 'user_stated' },
      createdAt: '2026-01-02T00:00:00.000Z',
      supersededById: 'a',
      supersedesId: 'a',
    };

    const lineage = resolveMemoryLineage([a, b], 'a');
    // Borné : « b » remonté une fois par le lien amont, jamais revisité ensuite.
    expect(lineage.map((e) => e.id)).toEqual(['b', 'a']);
  });
});
