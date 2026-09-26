import { describe, expect, it } from 'vitest';

import { resolveVersion } from './version-resolver.js';
import type { VersionHistory } from './temporal-types.js';
import { A, B, h, v } from './testing/version-resolver-helpers.js';

describe('resolveVersion — asOf', () => {
  it.each([
    ['une chaîne non date', 'hier'],
    ['une chaîne vide', ''],
    ['une date inexistante au calendrier', '2019-02-30'],
    ['un mois invalide', '2019-13-01'],
    ['une date-heure SANS décalage (dépendrait du fuseau de la machine)', '2019-05-24T10:00:00'],
    ['un décalage invalide', '2019-05-24T10:00:00+25:00'],
    ['une heure invalide', '2019-05-24T24:00:00Z'],
    ['une forme non ISO', '24/05/2019'],
  ])('lève RangeError pour %s', (_label, asOf) => {
    expect(() => resolveVersion(h([A]), asOf)).toThrowError(RangeError);
  });

  it('lève RangeError pour une valeur non chaîne, avant toute autre vérification (même avec une liste vide)', () => {
    expect(() => resolveVersion(h([]), undefined as unknown as string)).toThrowError(RangeError);
    expect(() => resolveVersion(h([]), 20190524 as unknown as string)).toThrowError(RangeError);
  });

  it('lève RangeError pour un historique mal formé (versions non tableau, completeness inconnue)', () => {
    expect(() =>
      resolveVersion(
        { versions: 'x', completeness: 'complete' } as unknown as VersionHistory,
        '2019-05-24',
      ),
    ).toThrowError(RangeError);
    expect(() =>
      resolveVersion(
        { versions: [], completeness: 'maybe' } as unknown as VersionHistory,
        '2019-05-24',
      ),
    ).toThrowError(RangeError);
  });

  it('date seule = minuit UTC : identique à la date-heure `T00:00:00Z` (test sur la frontière exacte)', () => {
    const history = h([v('X', '2019-05-24T00:00:00.000Z')]);
    expect(resolveVersion(history, '2019-05-24')).toEqual(
      resolveVersion(history, '2019-05-24T00:00:00Z'),
    );
    expect(resolveVersion(history, '2019-05-24')).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['X'],
    });
  });

  it('une date seule vaut minuit UTC, pas minuit local : 1 ms après minuit UTC est à l’intérieur', () => {
    const history = h([v('X', '2019-05-24T00:00:00.000Z')]);
    expect(resolveVersion(history, '2019-05-24T00:00:00.001Z').status).toBe('resolved');
    expect(resolveVersion(history, '2019-05-23T23:59:59.999Z').status).not.toBe('resolved');
  });

  it.each([
    ['+02:00', '2019-05-24T02:00:00+02:00'],
    ['+0200 (sans deux-points)', '2019-05-24T02:00:00+0200'],
    ['-02:00', '2019-05-23T22:00:00-02:00'],
    ['Z avec millisecondes', '2019-05-24T00:00:00.000Z'],
    ['sans secondes', '2019-05-24T00:00Z'],
  ])('un décalage équivalent à UTC (%s) désigne le même instant', (_label, asOf) => {
    expect(resolveVersion(h([v('X', '2019-05-24')]), asOf)).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['X'],
    });
  });
});

describe('resolveVersion — données inexploitables', () => {
  it('liste vide : indeterminate / insufficient_version_data, même déclarée complète (jamais none_applicable)', () => {
    expect(resolveVersion(h([], 'complete'), '2019-05-24')).toEqual({
      status: 'indeterminate',
      reason: 'insufficient_version_data',
    });
    expect(resolveVersion(h([], 'unknown'), '2019-05-24')).toEqual({
      status: 'indeterminate',
      reason: 'insufficient_version_data',
    });
  });

  it('effectiveFrom absent : insufficient_version_data, avec l’identifiant concerné', () => {
    expect(
      resolveVersion(h([A, v('SANS-DEBUT', undefined, '2020-01-01')], 'complete'), '2005-01-01'),
    ).toEqual({
      status: 'indeterminate',
      reason: 'insufficient_version_data',
      versionIds: ['SANS-DEBUT'],
    });
  });

  it('effectiveFrom illisible : insufficient_version_data', () => {
    expect(resolveVersion(h([v('X', 'n/a')]), '2019-05-24')).toMatchObject({
      reason: 'insufficient_version_data',
      versionIds: ['X'],
    });
  });

  it('effectiveTo présent mais illisible : insufficient_version_data (jamais traité comme un intervalle ouvert)', () => {
    expect(resolveVersion(h([v('X', '2000-01-01', 'bientôt')]), '2019-05-24')).toMatchObject({
      reason: 'insufficient_version_data',
      versionIds: ['X'],
    });
  });

  it('identifiant absent ou vide : insufficient_version_data', () => {
    expect(resolveVersion(h([v('', '2000-01-01')]), '2019-05-24')).toMatchObject({
      reason: 'insufficient_version_data',
    });
  });

  it.each([
    ['effectiveTo égal à effectiveFrom', '2010-01-01', '2010-01-01'],
    ['effectiveTo antérieur à effectiveFrom', '2010-01-01', '2000-01-01'],
  ])('%s : invalid_interval', (_label, from, to) => {
    expect(resolveVersion(h([v('X', from, to)]), '2019-05-24')).toEqual({
      status: 'indeterminate',
      reason: 'invalid_interval',
      versionIds: ['X'],
    });
  });

  it('un seul défaut, même sur une version sans rapport avec asOf, rend l’historique inexploitable (on ne résout pas dessus)', () => {
    expect(
      resolveVersion(h([B, v('CASSEE', '2001-01-01', '2000-01-01')]), '2015-01-01'),
    ).toMatchObject({ reason: 'invalid_interval' });
  });

  it('priorité : données illisibles avant intervalle invalide', () => {
    expect(
      resolveVersion(
        h([v('ILLISIBLE', 'n/a'), v('INVALIDE', '2010-01-01', '2000-01-01')]),
        '2019-05-24',
      ),
    ).toMatchObject({
      reason: 'insufficient_version_data',
      versionIds: ['ILLISIBLE'],
    });
  });
});

describe('resolveVersion — identifiants dupliqués', () => {
  it('mêmes données : dédupliqués, comme une seule version', () => {
    expect(resolveVersion(h([B, { ...B }]), '2015-01-01')).toEqual({
      status: 'resolved',
      version: B,
    });
  });

  it('mêmes données sous deux écritures du même instant : dédupliqués', () => {
    const copy = v('B', '2010-01-01T00:00:00.000Z');
    expect(resolveVersion(h([B, copy]), '2015-01-01').status).toBe('resolved');
  });

  it('un doublon ne fabrique pas un faux chevauchement', () => {
    expect(resolveVersion(h([A, { ...A }, B]), '2005-01-01')).toEqual({
      status: 'resolved',
      version: A,
    });
  });

  it('données contradictoires pour un même id (bornes différentes) : indeterminate / insufficient_version_data', () => {
    expect(
      resolveVersion(
        h([v('X', '2000-01-01', '2010-01-01'), v('X', '2000-01-01', '2012-01-01')]),
        '2005-01-01',
      ),
    ).toEqual({
      status: 'indeterminate',
      reason: 'insufficient_version_data',
      versionIds: ['X'],
    });
  });

  it('données contradictoires sur `version` ou sur `state` : également un conflit', () => {
    expect(
      resolveVersion(
        h([
          v('X', '2000-01-01', '2010-01-01', { version: '1.0' }),
          v('X', '2000-01-01', '2010-01-01', { version: '2.0' }),
        ]),
        '2005-01-01',
      ),
    ).toMatchObject({ reason: 'insufficient_version_data' });
    expect(
      resolveVersion(
        h([
          v('X', '2000-01-01', '2010-01-01', { state: 'VIGUEUR' }),
          v('X', '2000-01-01', '2010-01-01', { state: 'ABROGE' }),
        ]),
        '2005-01-01',
      ),
    ).toMatchObject({ reason: 'insufficient_version_data' });
  });
});
