import { describe, expect, it } from 'vitest';

import { canonicalStringify, computeFingerprint } from './fingerprint.js';

describe('canonicalStringify', () => {
  it('deux objets aux propriétés dans un ordre différent produisent la même sortie', () => {
    expect(canonicalStringify({ b: 2, a: 1 })).toBe(canonicalStringify({ a: 1, b: 2 }));
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('canonicalise récursivement les objets imbriqués, quel que soit l’ordre à chaque niveau', () => {
    const x = { outer: { z: 1, y: { b: 2, a: 1 } } };
    const y = { outer: { y: { a: 1, b: 2 }, z: 1 } };
    expect(canonicalStringify(x)).toBe(canonicalStringify(y));
  });

  it('ne réordonne JAMAIS les tableaux : [a,b] et [b,a] diffèrent', () => {
    expect(canonicalStringify(['a', 'b'])).not.toBe(canonicalStringify(['b', 'a']));
  });

  it('canonicalise chaque élément d’un tableau sans changer son ordre', () => {
    const x = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
    const y = [{ a: 1, b: 2 }, { c: 3, d: 4 }];
    expect(canonicalStringify(x)).toBe(canonicalStringify(y));
    expect(canonicalStringify(x)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('un tableau imbriqué dans un objet garde son ordre', () => {
    const recipients = { to: ['alice@example.test', 'bob@example.test'] };
    const reordered = { to: ['bob@example.test', 'alice@example.test'] };
    expect(canonicalStringify(recipients)).not.toBe(canonicalStringify(reordered));
  });

  it('omet une propriété dont la valeur est undefined, comme JSON.stringify', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it('un élément de tableau undefined devient null, comme JSON.stringify', () => {
    expect(canonicalStringify([1, undefined, 3])).toBe(JSON.stringify([1, undefined, 3]));
  });

  it('null et les primitives se comportent comme JSON.stringify', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify('x')).toBe('"x"');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(true)).toBe('true');
  });
});

describe('computeFingerprint', () => {
  const base = { toolName: 'gmail.send', action: 'execute' as const, accountId: 'acc-1', input: { to: 'a@x.test' } };

  it('même payload (ordre de propriétés différent dans input) → même empreinte', () => {
    const a = computeFingerprint({ ...base, input: { to: 'a@x.test', subject: 's' } });
    const b = computeFingerprint({ ...base, input: { subject: 's', to: 'a@x.test' } });
    expect(a).toBe(b);
  });

  it('toolName différent → empreinte différente', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, toolName: 'other.tool' });
    expect(a).not.toBe(b);
  });

  it('action différente → empreinte différente', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, action: 'prepare' });
    expect(a).not.toBe(b);
  });

  it('accountId différent → empreinte différente', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, accountId: 'acc-2' });
    expect(a).not.toBe(b);
  });

  it('input différent → empreinte différente', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, input: { to: 'attacker@evil.test' } });
    expect(a).not.toBe(b);
  });

  it('input avec un tableau réordonné → empreinte différente', () => {
    const a = computeFingerprint({ ...base, input: { to: ['a@x.test', 'b@x.test'] } });
    const b = computeFingerprint({ ...base, input: { to: ['b@x.test', 'a@x.test'] } });
    expect(a).not.toBe(b);
  });

  it('produit une sortie hexadécimale SHA-256 (64 caractères)', () => {
    expect(computeFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
