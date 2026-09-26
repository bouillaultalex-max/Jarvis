import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { computeContentHash, verifyContentHash } from './content-hash.js';

/** Contrat normatif du hash (ADR-0021) : SHA-256 des octets UTF-8 du texte exactement tel que reçu. */
describe('computeContentHash / verifyContentHash', () => {
  it('13. déterministe : vecteur SHA-256 connu, hexadécimal minuscule de 64 caractères', () => {
    // SHA-256("abc") — vecteur de référence FIPS 180-2.
    expect(computeContentHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(computeContentHash('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentHash('abc')).toBe(computeContentHash('abc'));
  });

  it('14. même texte exact → même hash', () => {
    const text = 'Le contrat de travail à durée déterminée ne peut être rompu avant terme…';
    expect(computeContentHash(text)).toBe(computeContentHash(`${text}`));
    expect(verifyContentHash(text, computeContentHash(text))).toBe(true);
  });

  it('15. une différence d’un seul caractère → hash différent', () => {
    expect(computeContentHash('Article L1237-1')).not.toBe(computeContentHash('Article L1237-2'));
    expect(computeContentHash('abc')).not.toBe(computeContentHash('abd'));
    expect(computeContentHash('abc')).not.toBe(computeContentHash('abc.'));
    expect(computeContentHash('abc')).not.toBe(computeContentHash('Abc'));
  });

  it('D4 : aucune normalisation — espaces, fins de ligne et Unicode comptent', () => {
    expect(computeContentHash(' abc')).not.toBe(computeContentHash('abc')); // pas de trim (début)
    expect(computeContentHash('abc ')).not.toBe(computeContentHash('abc')); // pas de trim (fin)
    expect(computeContentHash('a  b')).not.toBe(computeContentHash('a b')); // espaces internes
    expect(computeContentHash('a\r\nb')).not.toBe(computeContentHash('a\nb')); // fins de ligne
    expect(computeContentHash('a\tb')).not.toBe(computeContentHash('a b')); // tabulation
    // « é » composé (U+00E9) vs décomposé (e + U+0301) : deux hash, pas de NFC.
    expect(computeContentHash('é')).not.toBe(computeContentHash('é'));
  });

  it('D4 : le hash est celui des octets UTF-8 du texte brut (calcul indépendant)', () => {
    const text = 'Légifrance — « article » ≥ 1\n';
    const expected = createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex');
    expect(computeContentHash(text)).toBe(expected);
  });

  it('verifyContentHash : strict, sensible à la casse, faux si le hash attendu diffère', () => {
    const hash = computeContentHash('abc');
    expect(verifyContentHash('abc', hash)).toBe(true);
    expect(verifyContentHash('abd', hash)).toBe(false);
    expect(verifyContentHash('abc', hash.toUpperCase())).toBe(false);
    expect(verifyContentHash('abc', '')).toBe(false);
  });
});
