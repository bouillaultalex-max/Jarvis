import { describe, expect, it, vi } from 'vitest';

import { resolveVersion, versionResolver } from './version-resolver.js';
import { A, B, deepFreeze, h, v } from './testing/version-resolver-helpers.js';

describe('resolveVersion — déterminisme et pureté', () => {
  const versions = [
    v('C', '2010-01-01', '2020-01-01'),
    v('A', '2000-01-01', '2005-01-01'),
    v('B', '2003-01-01'),
    v('D', '2030-01-01'),
  ];
  const permutations = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [1, 3, 0, 2],
    [2, 0, 3, 1],
    [1, 0, 3, 2],
  ];
  const asOfs = [
    '1999-01-01',
    '2001-01-01',
    '2004-01-01',
    '2005-01-01',
    '2007-01-01',
    '2012-01-01',
    '2020-01-01',
    '2025-01-01',
    '2035-01-01',
  ];

  it('le résultat ne dépend pas de l’ordre d’entrée (permutations × dates × exhaustivité)', () => {
    for (const completeness of ['complete', 'unknown'] as const) {
      for (const asOf of asOfs) {
        const reference = resolveVersion(h(versions, completeness), asOf);
        for (const order of permutations) {
          expect(
            resolveVersion(
              h(
                order.map((i) => versions[i]!),
                completeness,
              ),
              asOf,
            ),
          ).toEqual(reference);
        }
      }
    }
  });

  it('l’entrée n’est pas mutée (structure profondément gelée : aucune écriture, aucun tri en place)', () => {
    const frozen = deepFreeze(
      h(
        versions.map((version) => ({ ...version })),
        'complete',
      ),
    );
    const snapshot = JSON.stringify(frozen);
    for (const asOf of asOfs) expect(() => resolveVersion(frozen, asOf)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it('deux appels identiques donnent le même résultat', () => {
    for (const asOf of asOfs) {
      expect(resolveVersion(h(versions, 'complete'), asOf)).toEqual(
        resolveVersion(h(versions, 'complete'), asOf),
      );
    }
  });

  it('le résultat ne dépend pas de l’heure courante (horloge simulée à deux instants très différents)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('1999-01-01T00:00:00Z'));
      const first = resolveVersion(h(versions, 'complete'), '2007-01-01');
      vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
      const second = resolveVersion(h(versions, 'complete'), '2007-01-01');
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne lit jamais l’horloge : Date.now n’est pas appelé pendant une résolution', () => {
    const spy = vi.spyOn(Date, 'now');
    try {
      for (const asOf of asOfs) resolveVersion(h(versions, 'complete'), asOf);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('versionResolver.resolve est exactement resolveVersion', () => {
    expect(versionResolver.resolve(h([A, B]), '2005-01-01')).toEqual(
      resolveVersion(h([A, B]), '2005-01-01'),
    );
  });
});

describe('resolveVersion — champs ignorés', () => {
  it('state ABROGE mais intervalle couvrant : résolu par l’intervalle seul', () => {
    const abrogated = v('X', '2000-01-01', '2020-01-01', { state: 'ABROGE' });
    expect(resolveVersion(h([abrogated]), '2010-01-01')).toEqual({
      status: 'resolved',
      version: abrogated,
    });
  });

  it('state VIGUEUR mais intervalle ne couvrant pas : non résolu', () => {
    const inForce = v('X', '2000-01-01', '2005-01-01', { state: 'VIGUEUR' });
    expect(resolveVersion(h([inForce], 'complete'), '2010-01-01')).toEqual({
      status: 'none_applicable',
      reason: 'after_last_version',
    });
  });

  it('un `state` d’un vocabulaire inconnu ne change rien', () => {
    expect(
      resolveVersion(
        h([v('X', '2000-01-01', '2020-01-01', { state: 'VIGUEUR_DIFF' })]),
        '2010-01-01',
      ).status,
    ).toBe('resolved');
  });

  it('dateVersion, consultedAt et publicationDate (même présents sur l’objet) n’influencent jamais la résolution', () => {
    const misleading = v('X', '2000-01-01', '2005-01-01', {
      dateVersion: '2010-01-01',
      consultedAt: '2010-01-01T00:00:00Z',
      publicationDate: '2010-01-01',
    });
    expect(resolveVersion(h([misleading], 'complete'), '2010-06-01')).toEqual({
      status: 'none_applicable',
      reason: 'after_last_version',
    });
    expect(resolveVersion(h([misleading], 'complete'), '2003-06-01').status).toBe('resolved');
  });

  it('effectiveTo absent = ouvert ; une date 2999-01-01 fournie reste une date ordinaire (jamais une sentinelle)', () => {
    expect(resolveVersion(h([v('OUVERTE', '2000-01-01')], 'complete'), '3500-01-01').status).toBe(
      'resolved',
    );
    expect(
      resolveVersion(
        h([v('BORNEE', '2000-01-01', '2999-01-01T00:00:00.000Z')], 'complete'),
        '3500-01-01',
      ),
    ).toEqual({
      status: 'none_applicable',
      reason: 'after_last_version',
    });
  });
});
