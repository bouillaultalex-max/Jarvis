import { describe, expect, it } from 'vitest';

import { parseProjectArgs } from './project-args.js';

describe('parseProjectArgs', () => {
  it('parse chaque sous-commande avec la bonne arité', () => {
    expect(parseProjectArgs(['create', 'p1', 'Boutique'])).toEqual({
      op: 'create',
      id: 'p1',
      name: 'Boutique',
    });
    expect(parseProjectArgs(['show', 'p1'])).toEqual({ op: 'show', id: 'p1' });
    expect(parseProjectArgs(['add-fact', 'p1', 'texte'])).toEqual({
      op: 'add-fact',
      id: 'p1',
      text: 'texte',
    });
    expect(parseProjectArgs(['answer-question', 'p1', 'q-1', 'réponse'])).toEqual({
      op: 'answer-question',
      id: 'p1',
      questionId: 'q-1',
      answer: 'réponse',
    });
    expect(parseProjectArgs(['validate-decision', 'p1', 'dec-1'])).toEqual({
      op: 'validate-decision',
      id: 'p1',
      decisionId: 'dec-1',
    });
    expect(parseProjectArgs(['next-question', 'p1'])).toEqual({ op: 'next-question', id: 'p1' });
    expect(parseProjectArgs(['export-markdown', 'p1', '--output', '/tmp/x.md'])).toEqual({
      op: 'export-markdown',
      id: 'p1',
      outputPath: '/tmp/x.md',
    });
    expect(parseProjectArgs(['interview', 'p1'])).toEqual({ op: 'interview', id: 'p1' });
  });

  it('export-markdown exige le drapeau --output', () => {
    expect(() => parseProjectArgs(['export-markdown', 'p1', '/tmp/x.md'])).toThrow(/--output/);
    expect(() => parseProjectArgs(['export-markdown', 'p1'])).toThrow(/--output/);
  });

  it('rejette une sous-commande inconnue avant tout accès disque', () => {
    expect(() => parseProjectArgs(['supprime-tout', 'p1'])).toThrow(/inconnue/);
  });

  it('rejette une arité incorrecte', () => {
    expect(() => parseProjectArgs(['create', 'p1'])).toThrow();
    expect(() => parseProjectArgs(['show'])).toThrow();
    expect(() => parseProjectArgs(['show', 'p1', 'trop'])).toThrow();
    expect(() => parseProjectArgs(['interview'])).toThrow();
    expect(() => parseProjectArgs(['interview', 'p1', 'trop'])).toThrow();
  });

  it('rejette un argument vide', () => {
    expect(() => parseProjectArgs(['create', '', 'Nom'])).toThrow();
  });
});
