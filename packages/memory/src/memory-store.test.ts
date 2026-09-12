import { describe, expect, it } from 'vitest';

import type { MemoryEntryInput } from './memory-entry.js';
import { InMemoryMemoryStore } from './memory-store.js';

function input(overrides: Partial<MemoryEntryInput> = {}): MemoryEntryInput {
  return {
    kind: 'fact',
    statement: 'Alexandre travaille comme Product Builder.',
    provenance: { origin: 'user_stated' },
    ...overrides,
  };
}

describe('InMemoryMemoryStore — add / get', () => {
  it('add renvoie une entrée avec id, createdAt et la provenance fournie', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input({ provenance: { origin: 'inferred', confidence: 0.4 } }));

    expect(entry.id).toMatch(/^mem-\d+$/);
    expect(typeof entry.createdAt).toBe('string');
    expect(entry.provenance).toEqual({ origin: 'inferred', confidence: 0.4 });
    expect(entry.invalidatedAt).toBeUndefined();
    expect(store.get(entry.id)).toEqual(entry);
  });

  it('createdAt fourni est conservé tel quel (déterminisme des tests)', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input({ createdAt: '2026-01-02T03:04:05.000Z' }));
    expect(entry.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('ids distincts et croissants', () => {
    const store = new InMemoryMemoryStore();
    expect(store.add(input()).id).toBe('mem-1');
    expect(store.add(input()).id).toBe('mem-2');
  });

  it('get renvoie undefined pour un id inconnu', () => {
    expect(new InMemoryMemoryStore().get('mem-404')).toBeUndefined();
  });

  it('rejette un statement vide', () => {
    const store = new InMemoryMemoryStore();
    expect(() => store.add(input({ statement: '   ' }))).toThrow(/statement/);
  });

  it('rejette une provenance invalide (règle « pas d’invention » appliquée au stockage)', () => {
    const store = new InMemoryMemoryStore();
    expect(() =>
      store.add(input({ provenance: { origin: 'user_stated', confidence: 0.9 } })),
    ).toThrow(/confidence/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => store.add(input({ provenance: { origin: 'nope' } as any }))).toThrow(/origin/);
  });

  it('rejette un kind inconnu', () => {
    const store = new InMemoryMemoryStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => store.add(input({ kind: 'note' as any }))).toThrow(/kind/);
  });
});

describe('InMemoryMemoryStore — list', () => {
  it('exclut les entrées invalidées par défaut, les inclut sur demande', () => {
    const store = new InMemoryMemoryStore();
    const a = store.add(input({ statement: 'A' }));
    store.add(input({ statement: 'B' }));
    store.invalidate(a.id, 'obsolète');

    expect(store.list().map((e) => e.statement)).toEqual(['B']);
    expect(store.list({ includeInvalidated: true }).map((e) => e.statement)).toEqual(['A', 'B']);
  });

  it('filtre par kind et par subject', () => {
    const store = new InMemoryMemoryStore();
    store.add(input({ kind: 'fact', subject: 'boss@corp.example', statement: 'F' }));
    store.add(input({ kind: 'preference', subject: 'boss@corp.example', statement: 'P' }));
    store.add(input({ kind: 'preference', subject: 'news@corp.example', statement: 'Q' }));

    expect(store.list({ kind: 'preference' }).map((e) => e.statement)).toEqual(['P', 'Q']);
    expect(store.list({ subject: 'boss@corp.example' }).map((e) => e.statement)).toEqual([
      'F',
      'P',
    ]);
    expect(
      store.list({ kind: 'preference', subject: 'boss@corp.example' }).map((e) => e.statement),
    ).toEqual(['P']);
  });

  it('préserve l’ordre d’insertion et renvoie un tableau neuf (non mutable)', () => {
    const store = new InMemoryMemoryStore();
    store.add(input({ statement: 'un' }));
    store.add(input({ statement: 'deux' }));

    const first = store.list();
    (first as unknown[]).length = 0;
    expect(store.list().map((e) => e.statement)).toEqual(['un', 'deux']);
  });

  it('ne résout jamais silencieusement une contradiction : deux faits opposés coexistent', () => {
    const store = new InMemoryMemoryStore();
    store.add(input({ subject: 'projet-x', statement: 'Le projet X est prioritaire.' }));
    store.add(input({ subject: 'projet-x', statement: "Le projet X n'est pas prioritaire." }));

    const kept = store.list({ subject: 'projet-x' });
    expect(kept).toHaveLength(2);
  });
});

describe('InMemoryMemoryStore — invalidate', () => {
  it('pose invalidatedAt + raison sans supprimer l’entrée', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input());
    const invalidated = store.invalidate(entry.id, 'corrigé par l’utilisateur');

    expect(invalidated.invalidatedAt).toBeTypeOf('string');
    expect(invalidated.invalidationReason).toBe('corrigé par l’utilisateur');
    expect(store.get(entry.id)?.invalidatedAt).toBeTypeOf('string');
  });

  it('est idempotent : la seconde invalidation renvoie l’entrée inchangée', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input());
    const first = store.invalidate(entry.id, 'raison 1');
    const second = store.invalidate(entry.id, 'raison 2');

    expect(second).toEqual(first);
    expect(second.invalidationReason).toBe('raison 1');
  });

  it('lève si l’id est inconnu', () => {
    expect(() => new InMemoryMemoryStore().invalidate('mem-404')).toThrow(/aucune entrée/);
  });
});

describe('InMemoryMemoryStore — supersede', () => {
  it('ajoute la remplaçante (liée via supersedesId) et invalide l’ancienne', () => {
    const store = new InMemoryMemoryStore();
    const old = store.add(
      input({
        statement: 'Réunion le lundi.',
        provenance: { origin: 'email_extracted', confidence: 0.6 },
      }),
    );
    const fresh = store.supersede(
      old.id,
      input({ statement: 'Réunion déplacée au mardi.', provenance: { origin: 'user_confirmed' } }),
    );

    expect(fresh.supersedesId).toBe(old.id);
    expect(store.get(old.id)?.invalidatedAt).toBeTypeOf('string');
    expect(store.get(old.id)?.invalidationReason).toContain(fresh.id);
    expect(store.list().map((e) => e.statement)).toEqual(['Réunion déplacée au mardi.']);
    expect(store.list({ includeInvalidated: true })).toHaveLength(2);
  });

  it('pose le lien aval supersededById sur l’ancienne, sans perte de traçabilité', () => {
    const store = new InMemoryMemoryStore();
    const v1 = store.add(input({ statement: 'v1' }));
    const v2 = store.supersede(v1.id, input({ statement: 'v2' }));
    const v3 = store.supersede(v2.id, input({ statement: 'v3' }));

    expect(store.get(v1.id)?.supersededById).toBe(v2.id);
    expect(store.get(v2.id)?.supersededById).toBe(v3.id);
    expect(store.get(v3.id)?.supersededById).toBeUndefined();
    // Aucune entrée n’a disparu.
    expect(store.list({ includeInvalidated: true }).map((e) => e.statement)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('invalidate seul ne pose pas de supersededById', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input());
    store.invalidate(entry.id, 'périmé');
    expect(store.get(entry.id)?.supersededById).toBeUndefined();
  });

  it('lève si la cible n’existe pas', () => {
    expect(() => new InMemoryMemoryStore().supersede('mem-404', input())).toThrow(/aucune entrée/);
  });

  it('lève si la cible est déjà invalidée', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input());
    store.invalidate(entry.id);
    expect(() => store.supersede(entry.id, input())).toThrow(/déjà invalidée/);
  });

  it('valide l’entrée remplaçante avec les mêmes règles que add', () => {
    const store = new InMemoryMemoryStore();
    const entry = store.add(input());
    expect(() =>
      store.supersede(entry.id, input({ provenance: { origin: 'user_stated', confidence: 0.5 } })),
    ).toThrow(/confidence/);
    // La cible reste intacte : l’échec de validation n’a rien invalidé.
    expect(store.get(entry.id)?.invalidatedAt).toBeUndefined();
  });
});
