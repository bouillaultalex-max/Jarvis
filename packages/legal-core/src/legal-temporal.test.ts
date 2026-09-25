import { describe, expect, it } from 'vitest';

import { validateLegalFactTemporal, validateLegalTemporalBound } from './legal-temporal.js';

const ok = (value: unknown) => validateLegalFactTemporal(value, 't');

describe('point', () => {
  it.each([
    { kind: 'point', precision: 'day', value: '2025-03-12' },
    { kind: 'point', precision: 'month', value: '2025-03' },
    { kind: 'point', precision: 'year', value: '2025' },
    { kind: 'point', precision: 'day', value: '2024-02-29' },
  ])('accepte %j', (value) => {
    expect(ok(value)).toEqual({ ok: true });
  });

  it.each([
    ['jour inexistant', { kind: 'point', precision: 'day', value: '2025-02-29' }],
    ['mois 13', { kind: 'point', precision: 'month', value: '2025-13' }],
    ['mois 00', { kind: 'point', precision: 'month', value: '2025-00' }],
    ['année 0000', { kind: 'point', precision: 'year', value: '0000' }],
    ['précision day avec un mois', { kind: 'point', precision: 'day', value: '2025-03' }],
    ['précision month avec un jour', { kind: 'point', precision: 'month', value: '2025-03-12' }],
    ['précision year avec un mois', { kind: 'point', precision: 'year', value: '2025-03' }],
    ['heure', { kind: 'point', precision: 'day', value: '2025-03-12T10:00:00Z' }],
    ['décalage', { kind: 'point', precision: 'day', value: '2025-03-12Z' }],
    ['format non ISO', { kind: 'point', precision: 'month', value: 'March 2025' }],
    ['mois sur un chiffre', { kind: 'point', precision: 'month', value: '2025-3' }],
    ['séparateur /', { kind: 'point', precision: 'month', value: '2025/03' }],
    ['année sur deux chiffres', { kind: 'point', precision: 'year', value: '25' }],
    ['année signée', { kind: 'point', precision: 'year', value: '+2025' }],
    ['valeur numérique', { kind: 'point', precision: 'year', value: 2025 }],
    ['précision inconnue', { kind: 'point', precision: 'week', value: '2025' }],
    ['précision absente', { kind: 'point', value: '2025' }],
    ['valeur absente', { kind: 'point', precision: 'year' }],
    ['clé supplémentaire', { kind: 'point', precision: 'year', value: '2025', note: 'x' }],
  ])('rejette : %s', (_label, value) => {
    expect(ok(value).ok).toBe(false);
  });

  it('ne confond jamais les précisions : 2025-03 et 2025-03-01 restent deux valeurs distinctes', () => {
    const month = { kind: 'point', precision: 'month', value: '2025-03' };
    const day = { kind: 'point', precision: 'day', value: '2025-03-01' };
    expect(ok(month).ok).toBe(true);
    expect(ok(day).ok).toBe(true);
    expect(month.value).not.toBe(day.value);
    // Aucune conversion : une valeur de précision mois n'est pas acceptée comme jour.
    expect(ok({ ...month, precision: 'day' }).ok).toBe(false);
  });
});

describe('unknown et absence', () => {
  it('accepte unknown', () => {
    expect(ok({ kind: 'unknown' })).toEqual({ ok: true });
  });

  it('rejette unknown avec une clé supplémentaire (ni estimation ni valeur cachée)', () => {
    expect(ok({ kind: 'unknown', value: '2025' }).ok).toBe(false);
    expect(ok({ kind: 'unknown', estimate: '2025-01' }).ok).toBe(false);
  });

  it('rejette l’absence de temporalité (aucun défaut)', () => {
    expect(ok(undefined).ok).toBe(false);
    expect(ok(null).ok).toBe(false);
    expect(ok('unknown').ok).toBe(false);
    expect(ok([]).ok).toBe(false);
  });

  it('rejette un kind inconnu', () => {
    expect(ok({ kind: 'open' }).ok).toBe(false);
    expect(ok({}).ok).toBe(false);
  });
});

describe('interval', () => {
  const interval = (start: unknown, end: unknown) => ({ kind: 'interval', start, end });

  it('accepte des bornes de précisions différentes', () => {
    expect(
      ok(
        interval(
          { precision: 'day', value: '2025-03-12' },
          { precision: 'month', value: '2025-06' },
        ),
      ),
    ).toEqual({ ok: true });
  });

  it('accepte 2019 → 2024 (année / année)', () => {
    expect(
      ok(interval({ precision: 'year', value: '2019' }, { precision: 'year', value: '2024' })),
    ).toEqual({ ok: true });
  });

  it('règle du possible : un début de précision plus grossière peut précéder une fin plus fine', () => {
    // début quelque part en mars, fin le 10 mars : possible (début entre le 1er et le 10).
    expect(
      ok(
        interval(
          { precision: 'month', value: '2025-03' },
          { precision: 'day', value: '2025-03-10' },
        ),
      ),
    ).toEqual({ ok: true });
    // début le 20 mars, fin quelque part en mars : possible (fin après le 20).
    expect(
      ok(
        interval(
          { precision: 'day', value: '2025-03-20' },
          { precision: 'month', value: '2025-03' },
        ),
      ),
    ).toEqual({ ok: true });
    expect(
      ok(interval({ precision: 'year', value: '2025' }, { precision: 'day', value: '2025-03-10' })),
    ).toEqual({ ok: true });
  });

  it('admet l’égalité des bornes (start <= end)', () => {
    expect(
      ok(
        interval(
          { precision: 'day', value: '2025-03-12' },
          { precision: 'day', value: '2025-03-12' },
        ),
      ),
    ).toEqual({ ok: true });
    expect(
      ok(interval({ precision: 'year', value: '2024' }, { precision: 'year', value: '2024' })),
    ).toEqual({ ok: true });
  });

  it.each([
    [
      'mois inversés',
      interval({ precision: 'month', value: '2025-06' }, { precision: 'month', value: '2025-03' }),
    ],
    [
      'années inversées',
      interval({ precision: 'year', value: '2025' }, { precision: 'year', value: '2019' }),
    ],
    [
      'jours inversés',
      interval(
        { precision: 'day', value: '2025-03-12' },
        { precision: 'day', value: '2025-03-10' },
      ),
    ],
    [
      'mois après un jour antérieur',
      interval({ precision: 'month', value: '2025-04' }, { precision: 'day', value: '2025-03-31' }),
    ],
    [
      'année après un mois antérieur',
      interval({ precision: 'year', value: '2026' }, { precision: 'month', value: '2025-12' }),
    ],
  ])('rejette un intervalle impossible : %s', (_label, value) => {
    const result = ok(value);
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('impossible') });
  });

  it('interdit l’intervalle ouvert', () => {
    expect(ok(interval({ precision: 'year', value: '2019' }, null)).ok).toBe(false);
    expect(ok(interval({ precision: 'year', value: '2019' }, undefined)).ok).toBe(false);
    expect(ok({ kind: 'interval', start: { precision: 'year', value: '2019' } }).ok).toBe(false);
    expect(ok({ kind: 'interval', end: { precision: 'year', value: '2019' } }).ok).toBe(false);
  });

  it('valide chaque borne indépendamment (précision incohérente, jour invalide)', () => {
    expect(
      ok(interval({ precision: 'day', value: '2025-03' }, { precision: 'year', value: '2026' })).ok,
    ).toBe(false);
    expect(
      ok(interval({ precision: 'year', value: '2025' }, { precision: 'day', value: '2026-02-30' }))
        .ok,
    ).toBe(false);
  });

  it('clés fermées sur l’intervalle et sur les bornes', () => {
    const start = { precision: 'year', value: '2019' };
    const end = { precision: 'year', value: '2024' };
    expect(ok({ kind: 'interval', start, end, extra: 1 }).ok).toBe(false);
    expect(ok(interval({ ...start, extra: 1 }, end)).ok).toBe(false);
    expect(ok({ kind: 'interval', precision: 'year', start, end }).ok).toBe(false);
  });
});

describe('validateLegalTemporalBound', () => {
  it('valide une borne isolée', () => {
    expect(validateLegalTemporalBound({ precision: 'month', value: '2025-06' }, 'b')).toEqual({
      ok: true,
    });
    expect(validateLegalTemporalBound({ precision: 'month', value: '2025-6' }, 'b').ok).toBe(false);
    expect(validateLegalTemporalBound(null, 'b').ok).toBe(false);
  });
});
