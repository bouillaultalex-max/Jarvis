import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeLegal,
  isSupportedCanonicalization,
  LEGAL_CANONICALIZATION_VERSION,
} from './legal-canonical.js';
import {
  computeLegalFingerprint,
  legalFingerprintsEqual,
  validateLegalFingerprint,
  verifyLegalFingerprint,
} from './legal-fingerprint.js';

describe('canonicalisation v1', () => {
  it('trie les clés, omet undefined, conserve l’ordre des tableaux', () => {
    expect(canonicalizeLegal({ b: [true, null, 'x'], a: 1, z: undefined })).toBe(
      '{"a":1,"b":[true,null,"x"]}',
    );
  });

  it('est indépendante de l’ordre des clés (objets imbriqués compris)', () => {
    const one = { x: { b: 2, a: 1 }, y: [{ d: 4, c: 3 }] };
    const two = { y: [{ c: 3, d: 4 }], x: { a: 1, b: 2 } };
    expect(canonicalizeLegal(one)).toBe(canonicalizeLegal(two));
  });

  it('l’ordre des tableaux est significatif', () => {
    expect(canonicalizeLegal([1, 2])).not.toBe(canonicalizeLegal([2, 1]));
  });

  it('la version est explicite et supportée', () => {
    expect(LEGAL_CANONICALIZATION_VERSION).toBe(1);
    expect(isSupportedCanonicalization(1)).toBe(true);
    expect(isSupportedCanonicalization(2)).toBe(false);
    expect(isSupportedCanonicalization('1')).toBe(false);
    expect(() => canonicalizeLegal({}, 2)).toThrow(RangeError);
  });

  it.each([
    ['undefined dans un tableau', [undefined]],
    ['undefined seul', undefined],
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['bigint', { a: 1n }],
    ['fonction', { a: () => 1 }],
    ['symbole', { a: Symbol('x') }],
    ['objet non littéral', { a: new Date(0) }],
  ])('refuse %s', (_label, value) => {
    expect(() => canonicalizeLegal(value)).toThrow(TypeError);
  });

  it('refuse une référence circulaire', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalizeLegal(cyclic)).toThrow(TypeError);
  });

  it('accepte deux références au même objet (non circulaire)', () => {
    const shared = { a: 1 };
    expect(canonicalizeLegal({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});

describe('LegalFingerprint', () => {
  it('vecteur d’or : SHA-256 de la forme canonique v1', () => {
    expect(computeLegalFingerprint({ b: [true, null, 'x'], a: 1 })).toEqual({
      algorithm: 'sha256',
      canonicalization: 1,
      value: 'eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1',
    });
    expect(computeLegalFingerprint({ statement: 'é', id: 'f-1' }).value).toBe(
      '1acf78cb1a3dd31bfac8fff549cb5cca7ff36bfc34adb30ae2eb050de6cf3671',
    );
  });

  it('même objet → même empreinte ; ordre des clés sans effet', () => {
    const a = computeLegalFingerprint({ id: '1', statement: 's' });
    const b = computeLegalFingerprint({ statement: 's', id: '1' });
    expect(legalFingerprintsEqual(a, b)).toBe(true);
    expect(a.value).toBe(createHash('sha256').update('{"id":"1","statement":"s"}').digest('hex'));
  });

  it('toute modification change l’empreinte', () => {
    const base = { id: '1', statement: 's', tags: ['a'] };
    const fp = computeLegalFingerprint(base);
    expect(computeLegalFingerprint({ ...base, statement: 't' }).value).not.toBe(fp.value);
    expect(computeLegalFingerprint({ ...base, tags: ['a', 'b'] }).value).not.toBe(fp.value);
    expect(computeLegalFingerprint({ ...base, extra: 1 }).value).not.toBe(fp.value);
  });

  it('verify : vrai sur l’objet d’origine, faux après modification', () => {
    const base = { id: '1', statement: 's' };
    const fp = computeLegalFingerprint(base);
    expect(verifyLegalFingerprint(base, fp)).toBe(true);
    expect(verifyLegalFingerprint({ ...base, statement: 'x' }, fp)).toBe(false);
  });

  it('verify : jamais « vérifié » par défaut (version inconnue, forme invalide, valeur non canonicalisable)', () => {
    const base = { id: '1' };
    const fp = computeLegalFingerprint(base);
    expect(verifyLegalFingerprint(base, { ...fp, canonicalization: 2 })).toBe(false);
    expect(verifyLegalFingerprint(base, { ...fp, algorithm: 'md5' })).toBe(false);
    expect(verifyLegalFingerprint(base, { ...fp, value: 'abc' })).toBe(false);
    expect(verifyLegalFingerprint(base, 'nope')).toBe(false);
    expect(verifyLegalFingerprint({ a: Number.NaN }, fp)).toBe(false);
  });

  it('validateLegalFingerprint : forme stricte', () => {
    const fp = computeLegalFingerprint({});
    expect(validateLegalFingerprint(fp, 'x')).toEqual({ ok: true });
    expect(validateLegalFingerprint({ ...fp, extra: 1 }, 'x').ok).toBe(false);
    expect(validateLegalFingerprint({ ...fp, value: fp.value.toUpperCase() }, 'x').ok).toBe(false);
    expect(validateLegalFingerprint({ ...fp, canonicalization: 99 }, 'x').ok).toBe(false);
    expect(validateLegalFingerprint({ algorithm: 'sha256', canonicalization: 1 }, 'x').ok).toBe(
      false,
    );
    expect(validateLegalFingerprint(null, 'x').ok).toBe(false);
  });
});
