import { describe, expect, it } from 'vitest';

import type { MemoryEntry, MemoryEntryInput } from './memory-entry.js';
import { InMemoryMemoryStore } from './memory-store.js';
import { DEFAULT_MAX_MEMORY_ENTRIES, LexicalMemorySelector, tokenize } from './memory-selector.js';

function entry(overrides: Partial<MemoryEntryInput> = {}): MemoryEntry {
  const store = new InMemoryMemoryStore();
  return store.add({
    kind: 'fact',
    statement: 'énoncé par défaut',
    provenance: { origin: 'user_stated' },
    ...overrides,
  });
}

describe('tokenize', () => {
  it('minuscule, sépare sur la ponctuation, replie les accents', () => {
    expect(tokenize('Réunion, PROJET-Phoenix !')).toEqual(['reunion', 'projet', 'phoenix']);
  });

  it('écarte les tokens trop courts et les mots-outils', () => {
    expect(tokenize('je te vois avec les enfants')).toEqual(['vois', 'enfants']);
  });

  it('déterministe : même entrée → même sortie', () => {
    const text = 'Le budget du client Acme est validé pour le mardi';
    expect(tokenize(text)).toEqual(tokenize(text));
  });
});

describe('LexicalMemorySelector — validation', () => {
  it('rejette maxEntries non entier ou < 1', () => {
    expect(() => new LexicalMemorySelector({ maxEntries: 0 })).toThrow(/maxEntries/);
    expect(() => new LexicalMemorySelector({ maxEntries: -3 })).toThrow(/maxEntries/);
    expect(() => new LexicalMemorySelector({ maxEntries: 1.5 })).toThrow(/maxEntries/);
  });
});

describe('LexicalMemorySelector — sélection', () => {
  const selector = new LexicalMemorySelector();

  it('requête sans token significatif → aucune sélection', () => {
    const candidates = [entry({ statement: 'Le projet Phoenix démarre lundi.' })];
    expect(selector.select({ text: 'ok ?' }, candidates)).toEqual([]);
  });

  it('aucune correspondance → aucune sélection', () => {
    const candidates = [
      entry({ statement: 'Le chat dort sur le canapé.' }),
      entry({ statement: 'La voiture est rouge.' }),
    ];
    expect(selector.select({ text: 'Quel est le budget du projet ?' }, candidates)).toEqual([]);
  });

  it('correspondance par statement', () => {
    const hit = entry({ statement: 'Le projet Phoenix est prioritaire ce trimestre.' });
    const miss = entry({ statement: 'Le déjeuner est à midi.' });
    expect(selector.select({ text: 'Où en est le projet Phoenix ?' }, [miss, hit])).toEqual([hit]);
  });

  it('correspondance par subject', () => {
    const hit = entry({
      statement: 'Répondre sous 24 h.',
      subject: 'client-acme',
    });
    const miss = entry({ statement: 'Acheter du café.' });
    expect(selector.select({ text: 'Comment gérer le client Acme ?' }, [miss, hit])).toEqual([hit]);
  });

  it('un token sur le subject pèse deux fois un token sur le statement', () => {
    const bySubject = entry({ statement: 'Note interne rédigée hier.', subject: 'phoenix' });
    const byStatement = entry({ statement: 'On en reparle bientôt, Phoenix.' });
    // "phoenix" : score 2 via le subject de bySubject, score 1 via le statement
    // de byStatement → bySubject d'abord.
    expect(selector.select({ text: 'phoenix' }, [byStatement, bySubject])).toEqual([
      bySubject,
      byStatement,
    ]);
  });

  it('plus de tokens communs → meilleur rang', () => {
    const two = entry({ statement: 'Le client Acme veut une démo.' });
    const one = entry({ statement: 'Le client part en vacances.' });
    expect(selector.select({ text: 'Prépare la démo pour le client Acme.' }, [one, two])).toEqual([
      two,
      one,
    ]);
  });

  it('égalité de score → ordre d’origine (index dans candidates) conservé', () => {
    const a = entry({ statement: 'Le client Acme préfère le mardi.' });
    const b = entry({ statement: 'Le client Acme évite le vendredi.' });
    const c = entry({ statement: 'Le client Acme paie en euros.' });
    // "client acme" touche les trois de la même façon → ordre inchangé.
    expect(selector.select({ text: 'Parle-moi du client Acme.' }, [a, b, c])).toEqual([a, b, c]);
    expect(selector.select({ text: 'Parle-moi du client Acme.' }, [c, b, a])).toEqual([c, b, a]);
  });

  it('ni kind ni provenance n’influencent le score', () => {
    const stated = entry({
      kind: 'fact',
      statement: 'Le projet Phoenix est lancé.',
      provenance: { origin: 'user_stated' },
    });
    const proposed = entry({
      kind: 'learning',
      statement: 'Le projet Phoenix est lancé.',
      provenance: { origin: 'llm_proposed', confidence: 0.9 },
    });
    // Scores égaux → ordre = index ; l'origine « fiable » ne remonte pas.
    expect(selector.select({ text: 'projet Phoenix' }, [proposed, stated])).toEqual([
      proposed,
      stated,
    ]);
  });

  it('respecte la limite par défaut (DEFAULT_MAX_MEMORY_ENTRIES)', () => {
    const candidates = Array.from({ length: DEFAULT_MAX_MEMORY_ENTRIES + 5 }, (_unused, i) =>
      entry({ statement: `Le client Acme a le besoin numéro ${i}.` }),
    );
    expect(selector.select({ text: 'client Acme' }, candidates)).toHaveLength(
      DEFAULT_MAX_MEMORY_ENTRIES,
    );
  });

  it('respecte une limite personnalisée', () => {
    const limited = new LexicalMemorySelector({ maxEntries: 2 });
    const candidates = Array.from({ length: 6 }, (_unused, i) =>
      entry({ statement: `Le client Acme a le besoin numéro ${i}.` }),
    );
    expect(limited.select({ text: 'client Acme' }, candidates)).toHaveLength(2);
  });

  it('ne mute ni candidates ni les entrées', () => {
    const candidates = [
      entry({ statement: 'Le projet Phoenix avance.' }),
      entry({ statement: 'Le projet Phoenix recrute.' }),
    ];
    const snapshot = candidates.map((e) => ({ ...e }));
    selector.select({ text: 'projet Phoenix' }, candidates);
    expect(candidates).toEqual(snapshot);
  });

  it('déterministe : 50 exécutions identiques → résultats strictement identiques', () => {
    const candidates = [
      entry({ statement: 'Le client Acme veut une démo mardi.' }),
      entry({ statement: 'Le client Acme a un budget serré.' }),
      entry({ statement: 'Le client Beta attend un devis.' }),
    ];
    const first = selector.select({ text: 'Où en est le client Acme ?' }, candidates);
    for (let i = 0; i < 50; i += 1) {
      expect(selector.select({ text: 'Où en est le client Acme ?' }, candidates)).toEqual(first);
    }
  });

  it('candidates vide → aucun résultat', () => {
    expect(selector.select({ text: 'projet Phoenix' }, [])).toEqual([]);
  });

  it('renvoie les MemoryEntry d’origine (mêmes références), provenance et confidence intactes', () => {
    const relevant = entry({
      subject: 'phoenix',
      statement: 'Le projet Phoenix est prioritaire.',
      provenance: { origin: 'llm_proposed', confidence: 0.2 },
    });
    const provenanceSnapshot = { ...relevant.provenance };

    const result = selector.select({ text: 'point sur le projet Phoenix' }, [relevant]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(relevant); // même référence, pas une copie
    expect(result[0]!.provenance).toEqual(provenanceSnapshot); // origin + confidence inchangés
  });

  it('plusieurs kinds : le score ne dépend jamais du kind', () => {
    const asFact = entry({ kind: 'fact', statement: 'Phoenix est prioritaire.' });
    const asPreference = entry({ kind: 'preference', statement: 'Phoenix est prioritaire.' });
    const q = { text: 'priorité de Phoenix' };
    // Même statement, kinds différents → même appartenance au résultat.
    expect(selector.select(q, [asFact]).length).toBe(selector.select(q, [asPreference]).length);
  });
});
