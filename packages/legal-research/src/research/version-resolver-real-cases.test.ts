import { describe, expect, it } from 'vitest';

import {
  mapLegifranceArticleToLegalSource,
  type LegifranceArticleMetadata,
} from '../legifrance-source-mapping.js';
import type { SourceVersionRef, VersionHistory } from './temporal-types.js';
import { resolveVersion } from './version-resolver.js';
import {
  ARTICLE_57_RAW,
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  L36_11_V14_RAW,
} from './testing/fixtures.js';

/**
 * Cas RÉELS observés en Sandbox PISTE (LEGAL-02B.2.1/2.2, LEGAL-03.0A), rejoués
 * sans réseau. Aucun mapping n'est modifié : les versions sont dérivées de
 * `metadata.articleVersions` exactement comme le ferait un futur adaptateur, et
 * la déclaration d'exhaustivité est posée **explicitement par le test** (c'est
 * l'appelant qui la fournit — le resolver ne la déduit jamais).
 */

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');

function refsOf(metadata: LegifranceArticleMetadata): SourceVersionRef[] {
  return metadata.articleVersions.map((version) => ({
    id: version.id,
    ...(version.version !== undefined ? { version: version.version } : {}),
    ...(version.etat !== undefined ? { state: version.etat } : {}),
    ...(version.effectiveFrom !== undefined ? { effectiveFrom: version.effectiveFrom } : {}),
    ...(version.effectiveTo !== undefined ? { effectiveTo: version.effectiveTo } : {}),
  }));
}

describe('cas réel — L3121-27 (2 versions, trou 2008 → 2016)', () => {
  const article = mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, { now: NOW });
  const versions = refsOf(article.metadata);
  const v1 = 'LEGIARTI000006902466';
  const v2 = 'LEGIARTI000033020376';

  it('le trou est bien de 2 910 jours entre les deux versions listées', () => {
    const end = Date.parse(versions[0]!.effectiveTo!);
    const start = Date.parse(versions[1]!.effectiveFrom!);
    expect((start - end) / 86_400_000).toBe(2910);
  });

  describe('historique AVEC preuve de chaînage (déclaré complete par l’appelant)', () => {
    // Preuve côté appelant : v2.versionPrecedente = v1 et v1 n'a pas de précédente (aucune version intermédiaire).
    it('la preuve existe dans les données observées', () => {
      expect(article.metadata.versionPrecedente).toBe(v1);
      expect(
        mapLegifranceArticleToLegalSource(L3121_27_V1_RAW, { now: NOW }).metadata.versionPrecedente,
      ).toBeUndefined();
    });

    const history: VersionHistory = { versions, completeness: 'complete' };

    it('une date dans le trou : none_applicable / gap_between_versions', () => {
      expect(resolveVersion(history, '2012-06-15')).toEqual({
        status: 'none_applicable',
        reason: 'gap_between_versions',
      });
    });

    it('avant la première version : before_first_version', () => {
      expect(resolveVersion(history, '2000-01-01')).toEqual({
        status: 'none_applicable',
        reason: 'before_first_version',
      });
    });

    it('dans chaque version : resolved', () => {
      expect(resolveVersion(history, '2008-06-15')).toMatchObject({
        status: 'resolved',
        version: { id: v1, version: '1.0' },
      });
      expect(resolveVersion(history, '2020-01-01')).toMatchObject({
        status: 'resolved',
        version: { id: v2, version: '2.0' },
      });
    });

    it('sur les bornes réelles (fin de v1, début de v2) : boundary_date — inclusivité non observée', () => {
      expect(resolveVersion(history, '2008-08-22')).toEqual({
        status: 'indeterminate',
        reason: 'boundary_date',
        versionIds: [v1],
      });
      expect(resolveVersion(history, '2016-08-10')).toEqual({
        status: 'indeterminate',
        reason: 'boundary_date',
        versionIds: [v2],
      });
    });
  });

  describe('historique SANS preuve de chaînage (déclaré unknown)', () => {
    const history: VersionHistory = { versions, completeness: 'unknown' };

    it('la MÊME date dans le trou : indeterminate / incomplete_history — jamais none_applicable ni gap', () => {
      const result = resolveVersion(history, '2012-06-15');
      expect(result).toEqual({ status: 'indeterminate', reason: 'incomplete_history' });
      expect(result.status).not.toBe('none_applicable');
    });

    it('avant la première version : également indeterminate (rien ne prouve que v1 est la première)', () => {
      expect(resolveVersion(history, '2000-01-01')).toEqual({
        status: 'indeterminate',
        reason: 'incomplete_history',
      });
    });

    it('les dates couvertes restent résolues', () => {
      expect(resolveVersion(history, '2008-06-15')).toMatchObject({
        status: 'resolved',
        version: { id: v1 },
      });
    });
  });
});

describe('cas réel — L36-11 (articleVersions INCOMPLET : 2 versions listées sur ~20, la version demandée absente)', () => {
  const article = mapLegifranceArticleToLegalSource(L36_11_V14_RAW, { now: NOW });
  const listed = refsOf(article.metadata);
  const v14 = 'LEGIARTI000033219357';
  const v1 = 'LEGIARTI000006465863';
  const v20 = 'LEGIARTI000049571362';

  it('constat : articleVersions ne contient que v1.0 et v20.0 — pas la version récupérée (v14.0)', () => {
    expect(listed.map((version) => version.id)).toEqual([v1, v20]);
    expect(listed.some((version) => version.id === article.source.id)).toBe(false);
    expect(article.source.id).toBe(v14);
    expect(article.source.version).toBe('14.0');
  });

  describe('articleVersions seules', () => {
    const history: VersionHistory = { versions: listed, completeness: 'unknown' };

    it('asOf en 2017 : NE conclut PAS à un trou ni à none_applicable — indeterminate / incomplete_history', () => {
      const result = resolveVersion(history, '2017-03-01');
      expect(result).toEqual({ status: 'indeterminate', reason: 'incomplete_history' });
      expect(result.status).not.toBe('none_applicable');
    });

    it('le « trou » entre 2001 et 2024 n’est jamais présenté comme réel', () => {
      for (const asOf of ['2005-01-01', '2010-06-01', '2017-03-01', '2023-12-31']) {
        expect(resolveVersion(history, asOf)).toEqual({
          status: 'indeterminate',
          reason: 'incomplete_history',
        });
      }
    });

    it('les versions listées se résolvent hors du « trou »', () => {
      expect(resolveVersion(history, '1998-01-01')).toMatchObject({
        status: 'resolved',
        version: { id: v1 },
      });
      expect(resolveVersion(history, '2024-06-01')).toMatchObject({
        status: 'resolved',
        version: { id: v20 },
      });
    });
  });

  describe('avec l’ajout EXPLICITE de la v14 récupérée (ce que devra transporter un futur adaptateur)', () => {
    const v14Ref: SourceVersionRef = {
      id: article.source.id,
      version: article.source.version,
      state: 'MODIFIE',
      effectiveFrom: article.source.effectiveFrom,
      ...(article.source.effectiveTo !== undefined
        ? { effectiveTo: article.source.effectiveTo }
        : {}),
    };
    const history: VersionHistory = { versions: [...listed, v14Ref], completeness: 'unknown' };

    it('asOf en 2017 : résolu vers v14', () => {
      expect(resolveVersion(history, '2017-03-01')).toMatchObject({
        status: 'resolved',
        version: { id: v14, version: '14.0' },
      });
    });

    it('la v14 ne comble pas le reste de l’historique : hors des trois versions, toujours incomplete_history', () => {
      expect(resolveVersion(history, '2010-01-01')).toEqual({
        status: 'indeterminate',
        reason: 'incomplete_history',
      });
      expect(resolveVersion(history, '2020-01-01')).toEqual({
        status: 'indeterminate',
        reason: 'incomplete_history',
      });
    });

    it('sur la fin réelle de la v14 : boundary_date', () => {
      expect(resolveVersion(history, '2018-11-25')).toEqual({
        status: 'indeterminate',
        reason: 'boundary_date',
        versionIds: [v14],
      });
    });

    it('l’ordre d’entrée est sans effet', () => {
      const reversed: VersionHistory = {
        versions: [...history.versions].reverse(),
        completeness: 'unknown',
      };
      expect(resolveVersion(reversed, '2017-03-01')).toEqual(resolveVersion(history, '2017-03-01'));
    });
  });
});

describe('cas réel — article 57 (version unique ouverte)', () => {
  const article = mapLegifranceArticleToLegalSource(ARTICLE_57_RAW, { now: NOW });
  const versions = refsOf(article.metadata);
  const id = 'LEGIARTI000006528277';

  it('la sentinelle a été traduite en effectiveTo absent avant d’arriver au resolver', () => {
    expect(versions).toHaveLength(1);
    expect(versions[0]).not.toHaveProperty('effectiveTo');
  });

  it('résolu à toute date postérieure au début, quelle que soit l’exhaustivité', () => {
    for (const completeness of ['complete', 'unknown'] as const) {
      expect(resolveVersion({ versions, completeness }, '2026-01-01')).toMatchObject({
        status: 'resolved',
        version: { id },
      });
    }
  });

  it('avant le début : before_first_version si complete, incomplete_history sinon', () => {
    expect(resolveVersion({ versions, completeness: 'complete' }, '1970-01-01')).toEqual({
      status: 'none_applicable',
      reason: 'before_first_version',
    });
    expect(resolveVersion({ versions, completeness: 'unknown' }, '1970-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
  });

  it('exactement sur le début : boundary_date', () => {
    expect(
      resolveVersion({ versions, completeness: 'complete' }, versions[0]!.effectiveFrom!),
    ).toEqual({
      status: 'indeterminate',
      reason: 'boundary_date',
      versionIds: [id],
    });
  });
});
