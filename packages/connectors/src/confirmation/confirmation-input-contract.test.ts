import { describe, expect, it, vi } from 'vitest';

import {
  captureConfirmationInput,
  UnsupportedConfirmationInputError,
} from './confirmation-input-contract.js';

describe('captureConfirmationInput — payload ordinaire', () => {
  it('conserve un objet JSON ordinaire sans transformation (mêmes valeurs, référence indépendante)', () => {
    const original = {
      to: 'a@example.test',
      subject: 's',
      count: 3,
      tags: ['x', 'y'],
      nested: { ok: true, ratio: 0.5 },
      note: null,
    };

    const captured = captureConfirmationInput(original);

    expect(captured).toEqual(original);
    expect(captured).not.toBe(original);
    expect((captured as { nested: unknown }).nested).not.toBe(original.nested);
  });

  it('gèle récursivement la copie renvoyée', () => {
    const captured = captureConfirmationInput({ a: { b: [1, 2] } }) as {
      a: { b: number[] };
    };
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.a)).toBe(true);
    expect(Object.isFrozen(captured.a.b)).toBe(true);
  });

  it('même référence partagée par deux champs (diamant, pas un cycle) → acceptée', () => {
    const shared = { x: 1 };
    const captured = captureConfirmationInput({ a: shared, b: shared }) as {
      a: { x: number };
      b: { x: number };
    };
    expect(captured).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });
});

describe('captureConfirmationInput — accesseurs et toJSON, jamais invoqués', () => {
  it('rejette un accesseur (get) sans jamais l’invoquer', () => {
    let getterCalls = 0;
    const withGetter: Record<string, unknown> = {};
    Object.defineProperty(withGetter, 'x', {
      get() {
        getterCalls += 1;
        return 'leaked';
      },
      enumerable: true,
    });

    expect(() => captureConfirmationInput(withGetter)).toThrow(UnsupportedConfirmationInputError);
    expect(getterCalls).toBe(0);
  });

  it('rejette un accesseur imbriqué sans jamais l’invoquer', () => {
    let getterCalls = 0;
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, 'secret', {
      get() {
        getterCalls += 1;
        return 'leaked';
      },
      enumerable: true,
    });

    expect(() => captureConfirmationInput({ inner: nested })).toThrow(
      UnsupportedConfirmationInputError,
    );
    expect(getterCalls).toBe(0);
  });

  it('rejette une méthode toJSON sans jamais l’invoquer (valeur fonction rejetée par type)', () => {
    let toJSONCalls = 0;
    const withToJSON = {
      toJSON() {
        toJSONCalls += 1;
        return 'x';
      },
    };

    expect(() => captureConfirmationInput(withToJSON)).toThrow(UnsupportedConfirmationInputError);
    expect(toJSONCalls).toBe(0);
  });

  it('rejette un objet Date (prototype non ordinaire), n’appelle jamais toISOString/toJSON', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const toISOSpy = vi.spyOn(date, 'toISOString');

    expect(() => captureConfirmationInput({ when: date })).toThrow(
      UnsupportedConfirmationInputError,
    );
    expect(toISOSpy).not.toHaveBeenCalled();
  });
});

describe('captureConfirmationInput — valeurs refusées explicitement', () => {
  it('BigInt → rejeté', () => {
    expect(() => captureConfirmationInput({ n: 10n })).toThrow(UnsupportedConfirmationInputError);
  });

  it('NaN → rejeté', () => {
    expect(() => captureConfirmationInput({ n: Number.NaN })).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('Infinity / -Infinity → rejetés', () => {
    expect(() => captureConfirmationInput({ n: Number.POSITIVE_INFINITY })).toThrow(
      UnsupportedConfirmationInputError,
    );
    expect(() => captureConfirmationInput({ n: Number.NEGATIVE_INFINITY })).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('fonction → rejetée', () => {
    expect(() => captureConfirmationInput({ f: () => 1 })).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('symbol → rejeté', () => {
    expect(() => captureConfirmationInput({ s: Symbol('x') })).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('tableau creux (trou) → rejeté', () => {
    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    expect(() => captureConfirmationInput(sparse)).toThrow(UnsupportedConfirmationInputError);
  });

  it('référence cyclique (objet qui se contient lui-même) → rejetée', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => captureConfirmationInput(cyclic)).toThrow(UnsupportedConfirmationInputError);
  });

  it('référence cyclique via un tableau → rejetée', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => captureConfirmationInput(arr)).toThrow(UnsupportedConfirmationInputError);
  });

  it('Map/Set (prototype non ordinaire) → rejetés', () => {
    expect(() => captureConfirmationInput(new Map())).toThrow(UnsupportedConfirmationInputError);
    expect(() => captureConfirmationInput(new Set())).toThrow(UnsupportedConfirmationInputError);
  });

  it('instance de classe (prototype non ordinaire) → rejetée', () => {
    class Boxed {
      constructor(public value: number) {}
    }
    expect(() => captureConfirmationInput(new Boxed(1))).toThrow(UnsupportedConfirmationInputError);
  });
});

describe('captureConfirmationInput — undefined (racine, imbriqué, tableau)', () => {
  it('undefined à la racine → rejeté', () => {
    expect(() => captureConfirmationInput(undefined)).toThrow(UnsupportedConfirmationInputError);
  });

  it('undefined imbriqué (propriété d’objet) → rejeté', () => {
    expect(() => captureConfirmationInput({ a: undefined })).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('undefined en élément de tableau → rejeté', () => {
    expect(() => captureConfirmationInput([1, undefined, 3])).toThrow(
      UnsupportedConfirmationInputError,
    );
  });

  it('objet vide et tableau vide restent acceptés (aucun rapport avec undefined)', () => {
    expect(captureConfirmationInput({})).toEqual({});
    expect(captureConfirmationInput([])).toEqual([]);
  });
});

describe('captureConfirmationInput — propriétés particulières', () => {
  it('« __proto__ » comme clé de donnée (JSON.parse-like) est copiée comme un champ ordinaire, sans changer le prototype du résultat, sans perte', () => {
    // Reproduit exactement la forme produite par JSON.parse('{"__proto__":"x"}')
    // (CreateDataProperty : une vraie propriété propre, jamais un set de prototype).
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, '__proto__', {
      value: 'donnee-ordinaire',
      writable: true,
      enumerable: true,
      configurable: true,
    });
    source.other = 1;

    const captured = captureConfirmationInput(source) as Record<string, unknown>;

    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(captured, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(captured, '__proto__')?.value).toBe('donnee-ordinaire');
    expect(captured.other).toBe(1);
  });

  it('objet à prototype null est accepté, sans transformation inattendue, aucun champ perdu', () => {
    const source = Object.create(null) as Record<string, unknown>;
    source.a = 1;
    source.b = 'x';

    const captured = captureConfirmationInput(source) as Record<string, unknown>;

    expect(captured).toEqual({ a: 1, b: 'x' });
    // Normalisation documentée : le résultat a toujours Object.prototype,
    // que l'entrée ait eu Object.prototype ou null — jamais une surprise
    // silencieuse au niveau des champs, seulement du prototype du clone.
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
  });

  it('propriété symbolique sur un objet → rejetée explicitement (jamais silencieusement ignorée)', () => {
    const withSymbol: Record<string, unknown> = { a: 1 };
    (withSymbol as Record<symbol, unknown>)[Symbol('s')] = 'leaked';

    expect(() => captureConfirmationInput(withSymbol)).toThrow(UnsupportedConfirmationInputError);
  });

  it('propriété non énumérable sur un objet → rejetée explicitement (jamais silencieusement ignorée)', () => {
    const withHidden: Record<string, unknown> = { a: 1 };
    Object.defineProperty(withHidden, 'hidden', {
      value: 'leaked',
      enumerable: false,
      writable: true,
      configurable: true,
    });

    expect(() => captureConfirmationInput(withHidden)).toThrow(UnsupportedConfirmationInputError);
  });

  it('propriété symbolique sur un tableau → rejetée explicitement', () => {
    const arr: unknown[] = [1, 2];
    (arr as unknown as Record<symbol, unknown>)[Symbol('s')] = 'leaked';

    expect(() => captureConfirmationInput(arr)).toThrow(UnsupportedConfirmationInputError);
  });

  it('propriété supplémentaire non indicielle sur un tableau → rejetée explicitement (jamais silencieusement ignorée)', () => {
    const arr: unknown[] = [1, 2];
    (arr as unknown as Record<string, unknown>).extra = 'leaked';

    expect(() => captureConfirmationInput(arr)).toThrow(UnsupportedConfirmationInputError);
  });

  it('élément de tableau défini comme accesseur (get) → rejeté sans jamais l’invoquer', () => {
    let getterCalls = 0;
    const arr: unknown[] = [1, 2, 3];
    Object.defineProperty(arr, 1, {
      get() {
        getterCalls += 1;
        return 'leaked';
      },
      enumerable: true,
      configurable: true,
    });

    expect(() => captureConfirmationInput(arr)).toThrow(UnsupportedConfirmationInputError);
    expect(getterCalls).toBe(0);
  });

  it('élément de tableau non énumérable → rejeté explicitement', () => {
    const arr: unknown[] = [1, 2, 3];
    Object.defineProperty(arr, 1, {
      value: 'leaked',
      enumerable: false,
      writable: true,
      configurable: true,
    });

    expect(() => captureConfirmationInput(arr)).toThrow(UnsupportedConfirmationInputError);
  });
});
