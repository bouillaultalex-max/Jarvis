import { describe, expect, it } from 'vitest';

import { MAX_SUMMARY_FIELD_VALUE_CHARS, buildTextPreview } from './text-preview.js';

describe('buildTextPreview', () => {
  it('texte sous la limite : renvoyé tel quel, non tronqué', () => {
    const result = buildTextPreview('bonjour');
    expect(result).toEqual({ value: 'bonjour', truncated: false });
  });

  it('texte exactement à la limite : non tronqué', () => {
    const text = 'x'.repeat(10);
    const result = buildTextPreview(text, 10);
    expect(result).toEqual({ value: text, truncated: false });
  });

  it('texte au-dessus de la limite : tronqué exactement à la limite, indicateur à true', () => {
    const text = 'x'.repeat(11);
    const result = buildTextPreview(text, 10);
    expect(result.value).toBe('x'.repeat(10));
    expect(result.truncated).toBe(true);
  });

  it('utilise MAX_SUMMARY_FIELD_VALUE_CHARS par défaut (convention réutilisée : 500)', () => {
    expect(MAX_SUMMARY_FIELD_VALUE_CHARS).toBe(500);
    const short = buildTextPreview('a'.repeat(500));
    expect(short.truncated).toBe(false);
    const long = buildTextPreview('a'.repeat(501));
    expect(long.truncated).toBe(true);
    expect(Array.from(long.value)).toHaveLength(500);
  });

  it('ne coupe jamais une paire de substituts Unicode (emoji hors plan de base)', () => {
    const emoji = '😀'; // 1 point de code, 2 unités UTF-16
    const text = emoji.repeat(3); // 3 points de code, 6 unités UTF-16
    const result = buildTextPreview(text, 2);

    expect(result.truncated).toBe(true);
    expect(Array.from(result.value)).toHaveLength(2);
    expect(result.value).toBe(emoji.repeat(2));
    // Si la troncature avait coupé en unités UTF-16 plutôt qu'en points de
    // code, on obtiendrait un caractère de substitution invalide/orphelin.
    expect(result.value.length % 2).toBe(0);
  });

  it('longueur mesurée en points de code, pas en unités UTF-16', () => {
    const text = '😀'.repeat(300); // 300 points de code, 600 unités UTF-16 (> 500 si mal mesuré)
    const result = buildTextPreview(text);
    expect(result.truncated).toBe(false);
    expect(result.value).toBe(text);
  });
});
