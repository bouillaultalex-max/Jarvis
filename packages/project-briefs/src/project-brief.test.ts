import { describe, expect, it } from 'vitest';

import {
  MAX_ID_CHARS,
  isBoundedNonEmptyText,
  isValidProjectId,
  nextStableId,
  type TextItem,
} from './project-brief.js';

describe('isValidProjectId', () => {
  it('accepte lettres, chiffres, "-" et "_"', () => {
    expect(isValidProjectId('boutique-asiatique_1')).toBe(true);
  });

  it('refuse vide, trop long, ou caractères hors motif', () => {
    expect(isValidProjectId('')).toBe(false);
    expect(isValidProjectId('x'.repeat(MAX_ID_CHARS + 1))).toBe(false);
    expect(isValidProjectId('id invalide')).toBe(false);
    expect(isValidProjectId('../traversal')).toBe(false);
  });
});

describe('isBoundedNonEmptyText', () => {
  it('refuse vide, espaces seuls, ou dépassement de borne', () => {
    expect(isBoundedNonEmptyText('', 10)).toBe(false);
    expect(isBoundedNonEmptyText('   ', 10)).toBe(false);
    expect(isBoundedNonEmptyText('x'.repeat(11), 10)).toBe(false);
  });

  it('accepte un texte non vide dans la borne', () => {
    expect(isBoundedNonEmptyText('ok', 10)).toBe(true);
  });
});

describe('nextStableId', () => {
  it('démarre à 1 sur une liste vide', () => {
    expect(nextStableId([], 'fact')).toBe('fact-1');
  });

  it('reprend après le plus grand suffixe existant, pas après la longueur de la liste', () => {
    const items: TextItem[] = [
      { id: 'fact-1', text: 'a' },
      { id: 'fact-5', text: 'b' },
    ];
    expect(nextStableId(items, 'fact')).toBe('fact-6');
  });
});
