import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_COMPLETED_ENTRIES, InMemoryDeduplicator } from './in-memory-deduplicator.js';

describe('InMemoryDeduplicator — construction', () => {
  it('maxCompletedEntries doit être un entier >= 1', () => {
    expect(() => new InMemoryDeduplicator({ maxCompletedEntries: 0 })).toThrow();
    expect(() => new InMemoryDeduplicator({ maxCompletedEntries: -1 })).toThrow();
  });

  it('expose la valeur par défaut documentée', () => {
    expect(DEFAULT_MAX_COMPLETED_ENTRIES).toBeGreaterThan(0);
  });
});

describe('InMemoryDeduplicator — cycle de vie de base', () => {
  it('proceed puis duplicate pour le même id en cours', () => {
    const dedup = new InMemoryDeduplicator();
    expect(dedup.beginProcessing('a')).toBe('proceed');
    expect(dedup.beginProcessing('a')).toBe('duplicate');
  });

  it("finish('released') libère l'identifiant — une relivraison est retraitée", () => {
    const dedup = new InMemoryDeduplicator();
    dedup.beginProcessing('a');
    dedup.finish('a', 'released');
    expect(dedup.beginProcessing('a')).toBe('proceed');
  });

  it("finish('completed') bloque définitivement l'identifiant", () => {
    const dedup = new InMemoryDeduplicator();
    dedup.beginProcessing('a');
    dedup.finish('a', 'completed');
    expect(dedup.beginProcessing('a')).toBe('duplicate');
  });
});

describe('InMemoryDeduplicator — rétention bornée des « completed »', () => {
  it('completedCount ne dépasse jamais maxCompletedEntries, éviction FIFO', () => {
    const dedup = new InMemoryDeduplicator({ maxCompletedEntries: 3 });
    for (const id of ['a', 'b', 'c', 'd']) {
      dedup.beginProcessing(id);
      dedup.finish(id, 'completed');
    }
    expect(dedup.completedCount).toBe(3);
  });

  it('un identifiant « completed » évincé peut être retraité (pas une déduplication illimitée)', () => {
    const dedup = new InMemoryDeduplicator({ maxCompletedEntries: 2 });
    dedup.beginProcessing('old');
    dedup.finish('old', 'completed');
    // Deux autres « completed » poussent « old » hors de la fenêtre retenue.
    for (const id of ['b', 'c']) {
      dedup.beginProcessing(id);
      dedup.finish(id, 'completed');
    }
    expect(dedup.completedCount).toBe(2);
    // « old » évincé : une relivraison très tardive est retraitée comme neuve.
    expect(dedup.beginProcessing('old')).toBe('proceed');
  });

  it("un identifiant encore « in_flight » n'est jamais évincé, même sous forte pression sur « completed »", () => {
    const dedup = new InMemoryDeduplicator({ maxCompletedEntries: 2 });
    dedup.beginProcessing('still-active');
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      dedup.beginProcessing(id);
      dedup.finish(id, 'completed');
    }
    // Toujours détecté comme doublon : jamais évincé pendant qu'il est en cours.
    expect(dedup.beginProcessing('still-active')).toBe('duplicate');
  });
});
