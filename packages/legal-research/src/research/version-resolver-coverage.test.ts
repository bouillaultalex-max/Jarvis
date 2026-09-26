import { describe, expect, it } from 'vitest';

import { resolveVersion } from './version-resolver.js';
import { A, B, h, v } from './testing/version-resolver-helpers.js';

describe('resolveVersion — versions uniques', () => {
  const open = v('OPEN', '2000-01-01');
  const closed = v('CLOSED', '2000-01-01', '2010-01-01');

  it('version unique ouverte : resolved à l’intérieur, quelle que soit l’exhaustivité', () => {
    expect(resolveVersion(h([open], 'unknown'), '2019-05-24')).toEqual({
      status: 'resolved',
      version: open,
    });
    expect(resolveVersion(h([open], 'complete'), '2019-05-24')).toEqual({
      status: 'resolved',
      version: open,
    });
  });

  it('version unique fermée : resolved à l’intérieur', () => {
    expect(resolveVersion(h([closed]), '2005-06-15')).toEqual({
      status: 'resolved',
      version: closed,
    });
  });

  it('la version renvoyée est l’objet d’entrée lui-même (aucune copie)', () => {
    const result = resolveVersion(h([closed]), '2005-06-15');
    expect(result.status === 'resolved' && result.version === closed).toBe(true);
  });

  it('avant la première version : none_applicable/before_first_version si complete, sinon incomplete_history', () => {
    expect(resolveVersion(h([open], 'complete'), '1990-01-01')).toEqual({
      status: 'none_applicable',
      reason: 'before_first_version',
    });
    expect(resolveVersion(h([open], 'unknown'), '1990-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
  });

  it('après la dernière version : none_applicable/after_last_version si complete, sinon incomplete_history', () => {
    expect(resolveVersion(h([closed], 'complete'), '2020-01-01')).toEqual({
      status: 'none_applicable',
      reason: 'after_last_version',
    });
    expect(resolveVersion(h([closed], 'unknown'), '2020-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
  });
});

describe('resolveVersion — bords (convention conservatrice)', () => {
  const closed = v('CLOSED', '2010-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

  it('exactement sur effectiveFrom : indeterminate / boundary_date', () => {
    expect(resolveVersion(h([closed]), '2010-01-01T00:00:00.000Z')).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['CLOSED'],
    });
  });

  it('exactement sur effectiveTo : indeterminate / boundary_date', () => {
    expect(resolveVersion(h([closed]), '2020-01-01T00:00:00.000Z')).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['CLOSED'],
    });
  });

  it('exactement sur effectiveFrom d’une version ouverte : boundary_date', () => {
    expect(resolveVersion(h([v('OPEN', '2010-01-01')]), '2010-01-01')).toMatchObject({
      reason: 'boundary_date',
    });
  });

  it('from − 1 ms : hors de la version (complete → before_first_version)', () => {
    expect(resolveVersion(h([closed], 'complete'), '2009-12-31T23:59:59.999Z')).toEqual({
      status: 'none_applicable',
      reason: 'before_first_version',
    });
  });

  it('from + 1 ms : dans la version', () => {
    expect(resolveVersion(h([closed]), '2010-01-01T00:00:00.001Z').status).toBe('resolved');
  });

  it('to − 1 ms : dans la version', () => {
    expect(resolveVersion(h([closed]), '2019-12-31T23:59:59.999Z').status).toBe('resolved');
  });

  it('to + 1 ms : hors de la version (complete → after_last_version)', () => {
    expect(resolveVersion(h([closed], 'complete'), '2020-01-01T00:00:00.001Z')).toEqual({
      status: 'none_applicable',
      reason: 'after_last_version',
    });
  });

  it('deux versions adjacentes (to = from suivant) : la date exacte de jonction est boundary_date, avec les deux identifiants', () => {
    expect(resolveVersion(h([A, B]), '2010-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['A', 'B'],
    });
  });

  it('deux versions adjacentes : un jour avant ou après la jonction se résout sans ambiguïté', () => {
    expect(resolveVersion(h([A, B]), '2009-12-31')).toEqual({ status: 'resolved', version: A });
    expect(resolveVersion(h([A, B]), '2010-01-02')).toEqual({ status: 'resolved', version: B });
  });

  it('un bord est indéterminé même quand une autre version couvre strictement la date (boundary_date prime sur ambiguous_overlap)', () => {
    expect(
      resolveVersion(
        h([v('LARGE', '2000-01-01', '2030-01-01'), v('ETROITE', '2010-01-01', '2020-01-01')]),
        '2010-01-01',
      ),
    ).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: ['ETROITE'],
    });
  });
});

describe('resolveVersion — trous', () => {
  const before = v('AVANT', '2000-01-01', '2005-01-01');
  const after = v('APRES', '2010-01-01');

  it('trou avec historique complete : none_applicable / gap_between_versions', () => {
    expect(resolveVersion(h([before, after], 'complete'), '2007-06-01')).toEqual({
      status: 'none_applicable',
      reason: 'gap_between_versions',
    });
  });

  it('MÊME trou avec historique unknown : indeterminate / incomplete_history — jamais none_applicable', () => {
    const result = resolveVersion(h([before, after], 'unknown'), '2007-06-01');
    expect(result).toEqual({ status: 'indeterminate', reason: 'incomplete_history' });
    expect(result.status).not.toBe('none_applicable');
  });

  it('ordre d’entrée inversé : même diagnostic de trou', () => {
    expect(resolveVersion(h([after, before], 'complete'), '2007-06-01')).toEqual({
      status: 'none_applicable',
      reason: 'gap_between_versions',
    });
  });

  it('les dates couvertes de part et d’autre du trou se résolvent normalement, quelle que soit l’exhaustivité', () => {
    expect(resolveVersion(h([before, after], 'unknown'), '2003-01-01')).toEqual({
      status: 'resolved',
      version: before,
    });
    expect(resolveVersion(h([before, after], 'unknown'), '2015-01-01')).toEqual({
      status: 'resolved',
      version: after,
    });
  });
});

describe('resolveVersion — chevauchements', () => {
  it('deux versions fermées qui se chevauchent : ambiguous_overlap avec les deux identifiants (triés)', () => {
    expect(
      resolveVersion(
        h([v('B', '2005-01-01', '2015-01-01'), v('A', '2000-01-01', '2010-01-01')]),
        '2007-01-01',
      ),
    ).toEqual({
      status: 'indeterminate',
      reason: 'ambiguous_overlap',
      versionIds: ['A', 'B'],
    });
  });

  it('hors de la zone de chevauchement, chaque version se résout seule', () => {
    const versions = [v('A', '2000-01-01', '2010-01-01'), v('B', '2005-01-01', '2015-01-01')];
    expect(resolveVersion(h(versions), '2003-01-01')).toMatchObject({
      status: 'resolved',
      version: { id: 'A' },
    });
    expect(resolveVersion(h(versions), '2012-01-01')).toMatchObject({
      status: 'resolved',
      version: { id: 'B' },
    });
  });

  it('version ouverte + version fermée qui se chevauchent : ambiguous_overlap', () => {
    expect(
      resolveVersion(
        h([v('OUVERTE', '2000-01-01'), v('FERMEE', '2005-01-01', '2015-01-01')]),
        '2007-01-01',
      ),
    ).toEqual({
      status: 'indeterminate',
      reason: 'ambiguous_overlap',
      versionIds: ['FERMEE', 'OUVERTE'],
    });
  });

  it('trois versions en chevauchement : ambiguous_overlap avec les trois identifiants', () => {
    const versions = [
      v('C', '2004-01-01', '2020-01-01'),
      v('A', '2000-01-01', '2010-01-01'),
      v('B', '2002-01-01', '2012-01-01'),
    ];
    expect(resolveVersion(h(versions), '2006-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'ambiguous_overlap',
      versionIds: ['A', 'B', 'C'],
    });
  });

  it('jamais de choix selon l’état ni le numéro de version', () => {
    const versions = [
      v('X', '2000-01-01', '2020-01-01', { state: 'VIGUEUR', version: '2.0' }),
      v('Y', '2000-01-01', '2020-01-01', { state: 'ABROGE', version: '1.0' }),
    ];
    expect(resolveVersion(h(versions), '2010-01-01')).toMatchObject({
      reason: 'ambiguous_overlap',
    });
  });

  it('version ouverte suivie d’une autre : ambiguë quand les deux couvrent, sinon la règle générale s’applique', () => {
    const versions = [v('OUVERTE', '2000-01-01'), v('SUIVANTE', '2010-01-01', '2020-01-01')];
    expect(resolveVersion(h(versions), '2005-01-01')).toMatchObject({
      status: 'resolved',
      version: { id: 'OUVERTE' },
    });
    expect(resolveVersion(h(versions), '2015-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'ambiguous_overlap',
      versionIds: ['OUVERTE', 'SUIVANTE'],
    });
    expect(resolveVersion(h(versions), '2010-01-01')).toMatchObject({
      reason: 'boundary_date',
      versionIds: ['SUIVANTE'],
    });
  });
});
