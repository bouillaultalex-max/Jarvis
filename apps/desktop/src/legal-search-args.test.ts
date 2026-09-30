import { describe, expect, it } from 'vitest';

import { parseLegalSearchArgs } from './legal-search-args.js';

describe('parseLegalSearchArgs — nominal', () => {
  it('texte + --asOf valides → LegalSearchInput', () => {
    expect(
      parseLegalSearchArgs(['--asOf', '2026-01-01', 'préavis licenciement économique']),
    ).toEqual({ text: 'préavis licenciement économique', asOf: '2026-01-01' });
  });

  it('accepte --asOf=valeur (forme avec égal)', () => {
    expect(parseLegalSearchArgs(['--asOf=2026-01-01', 'texte'])).toEqual({
      text: 'texte',
      asOf: '2026-01-01',
    });
  });

  it("le texte peut précéder l'option", () => {
    expect(parseLegalSearchArgs(['texte', '--asOf', '2026-01-01'])).toEqual({
      text: 'texte',
      asOf: '2026-01-01',
    });
  });
});

describe('parseLegalSearchArgs — options inconnues, valeurs manquantes, doublons', () => {
  it('option inconnue → rejetée, nommée dans le message', () => {
    expect(() => parseLegalSearchArgs(['--unknown', 'x', 'texte'])).toThrow(
      /option inconnue « --unknown »/,
    );
  });

  it('option ne ressemblant pas à un nom → message générique (jamais un écho de sa valeur)', () => {
    expect(() => parseLegalSearchArgs(['--3=x', 'texte'])).toThrow(/option inconnue \(connue/);
  });

  it('valeur manquante pour --asOf (fin de ligne) → rejetée', () => {
    expect(() => parseLegalSearchArgs(['texte', '--asOf'])).toThrow(/valeur manquante/);
  });

  it('valeur manquante pour --asOf (suivie d’une autre option) → rejetée', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '--asOf', '2026-01-01', 'texte'])).toThrow(
      /valeur manquante/,
    );
  });

  it('--asOf fourni deux fois (doublon ambigu) → rejeté', () => {
    expect(() =>
      parseLegalSearchArgs(['--asOf', '2026-01-01', '--asOf', '2026-02-01', 'texte']),
    ).toThrow(/fournie plusieurs fois/);
  });
});

describe('parseLegalSearchArgs — texte de recherche', () => {
  it('texte manquant (aucun argument positionnel) → rejeté', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '2026-01-01'])).toThrow(
      /texte de recherche manquant/,
    );
  });

  it('plusieurs arguments positionnels → rejetés (un seul texte attendu, entre guillemets)', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '2026-01-01', 'deux', 'mots'])).toThrow(
      /un seul argument texte attendu/,
    );
  });

  it('texte vide (guillemets vides) → rejeté', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '2026-01-01', ''])).toThrow(
      /texte de recherche est vide/,
    );
  });
});

describe('parseLegalSearchArgs — --asOf obligatoire, date calendaire réelle', () => {
  it('--asOf absent → rejeté, jamais silencieusement omis', () => {
    expect(() => parseLegalSearchArgs(['texte'])).toThrow(/requise manquante : --asOf/);
  });

  it('--asOf de forme invalide (pas YYYY-MM-DD) → rejeté', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '01/01/2026', 'texte'])).toThrow(
      /date calendaire réelle/,
    );
    expect(() => parseLegalSearchArgs(['--asOf', '2026-1-1', 'texte'])).toThrow(
      /date calendaire réelle/,
    );
  });

  it('--asOf de forme correcte mais date calendaire impossible (mois 13, 30 février) → rejeté', () => {
    expect(() => parseLegalSearchArgs(['--asOf', '2026-13-01', 'texte'])).toThrow(
      /date calendaire réelle/,
    );
    expect(() => parseLegalSearchArgs(['--asOf', '2026-02-30', 'texte'])).toThrow(
      /date calendaire réelle/,
    );
  });

  it('année bissextile : 2024-02-29 valide, 2026-02-29 invalide (2026 non bissextile)', () => {
    expect(parseLegalSearchArgs(['--asOf', '2024-02-29', 'texte']).asOf).toBe('2024-02-29');
    expect(() => parseLegalSearchArgs(['--asOf', '2026-02-29', 'texte'])).toThrow(
      /date calendaire réelle/,
    );
  });
});
