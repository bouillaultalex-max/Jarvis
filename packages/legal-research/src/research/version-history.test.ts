import { describe, expect, it } from 'vitest';

import { resolveVersion } from './version-resolver.js';
import { assembleVersionHistory } from './version-history.js';
import { identifierKey, sourceKey } from './source-key.js';
import {
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  L36_11_V14_RAW,
  SENTINEL_MS,
} from './testing/fixtures.js';
import { deepFreeze, retrievalOf } from './testing/version-resolver-helpers.js';

const V1 = 'LEGIARTI000006902466';
const V2 = 'LEGIARTI000033020376';
const L36_V1 = 'LEGIARTI000006465863';
const L36_V14 = 'LEGIARTI000033219357';
const L36_V20 = 'LEGIARTI000049571362';

/** Seconde récupération du même article L36-11 : la version 20.0 (en vigueur), avec le même `articleVersions` partiel. */
const L36_11_V20_RAW = {
  ...L36_11_V14_RAW,
  id: L36_V20,
  versionArticle: '20.0',
  etat: 'VIGUEUR',
  dateDebut: 1716422400000,
  dateFin: SENTINEL_MS,
  versionPrecedente: 'LEGIARTI000049571361',
};

describe('assembleVersionHistory — version récupérée et articleVersions', () => {
  it('version récupérée déjà dans articleVersions : fusionnée avec son entrée, le state de la liste est conservé, aucun doublon', () => {
    const { versions, completeness } = assembleVersionHistory([retrievalOf(L3121_27_V2_RAW)]);

    expect(completeness).toBe('unknown');
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.id === V2)).toEqual({
      id: V2,
      version: '2.0',
      state: 'VIGUEUR',
      effectiveFrom: '2016-08-10T00:00:00.000Z',
    });
    expect(versions.find((v) => v.id === V1)).toMatchObject({ version: '1.0', state: 'ABROGE' });
  });

  it('fusion compatible : le state (absent de la version reconstruite depuis source) comble le champ manquant', () => {
    const merged = assembleVersionHistory([retrievalOf(L3121_27_V2_RAW)]).versions.find(
      (v) => v.id === V2,
    )!;
    expect(merged.state).toBe('VIGUEUR');
    expect(merged.effectiveFrom).toBe('2016-08-10T00:00:00.000Z');
  });

  it('L36-11 : la version récupérée (14.0), ABSENTE de articleVersions, entre dans l’historique avec son intervalle', () => {
    const { versions } = assembleVersionHistory([retrievalOf(L36_11_V14_RAW)]);

    expect(versions.map((v) => v.id).sort()).toEqual([L36_V1, L36_V14, L36_V20].sort());
    expect(versions.find((v) => v.id === L36_V14)).toEqual({
      id: L36_V14,
      version: '14.0',
      effectiveFrom: '2016-10-09T00:00:00.000Z',
      effectiveTo: '2018-11-25T00:00:00.000Z',
    });
  });

  it('L36-11 : l’historique assemblé permet de résoudre 2017 vers la v14, mais reste incomplet ailleurs (unknown)', () => {
    const history = assembleVersionHistory([retrievalOf(L36_11_V14_RAW)]);
    expect(resolveVersion(history, '2017-03-01')).toMatchObject({
      status: 'resolved',
      version: { id: L36_V14 },
    });
    expect(resolveVersion(history, '2010-01-01')).toEqual({
      status: 'indeterminate',
      reason: 'incomplete_history',
    });
  });

  it('un effectiveTo présent d’un seul côté est conservé (comblé), sans contradiction', () => {
    const raw = {
      ...L3121_27_V2_RAW,
      dateFin: SENTINEL_MS, // source : pas de borne de fin
      articleVersions: [
        L3121_27_V1_RAW.articleVersions[0]!,
        { ...L3121_27_V1_RAW.articleVersions[1]!, dateFin: Date.UTC(2030, 0, 1) }, // liste : fin connue
      ],
    };
    const merged = assembleVersionHistory([retrievalOf(raw)]).versions.find((v) => v.id === V2)!;
    expect(merged.effectiveTo).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('assembleVersionHistory — doublons et contradictions', () => {
  it('doublons identiques (même article récupéré deux fois) : un seul exemplaire de chaque version', () => {
    const single = assembleVersionHistory([retrievalOf(L3121_27_V2_RAW)]);
    const twice = assembleVersionHistory([
      retrievalOf(L3121_27_V2_RAW),
      retrievalOf(L3121_27_V2_RAW),
    ]);
    expect(twice).toEqual(single);
  });

  it.each([
    ['effectiveFrom', { dateDebut: Date.UTC(2016, 7, 11) }],
    ['effectiveTo', { dateFin: Date.UTC(2019, 0, 1) }],
  ])(
    'conflit sur %s (présent des deux côtés, valeurs différentes) : les deux entrées sont transmises, sans écrasement',
    (_field, override) => {
      const raw = {
        ...L3121_27_V2_RAW,
        ...override,
        articleVersions: [
          L3121_27_V1_RAW.articleVersions[0]!,
          { ...L3121_27_V1_RAW.articleVersions[1]!, dateFin: Date.UTC(2020, 0, 1) },
        ],
      };
      const history = assembleVersionHistory([retrievalOf(raw)]);

      expect(history.versions.filter((v) => v.id === V2)).toHaveLength(2);
      // Le resolver — et non l'assembleur — signale la contradiction.
      expect(resolveVersion(history, '2018-01-01')).toEqual({
        status: 'indeterminate',
        reason: 'insufficient_version_data',
        versionIds: [V2],
      });
    },
  );

  it('conflit sur version ou state : transmis, jamais fusionné', () => {
    const raw = { ...L3121_27_V2_RAW, versionArticle: '9.9' };
    const versions = assembleVersionHistory([retrievalOf(raw)]).versions.filter((v) => v.id === V2);
    expect(versions.map((v) => v.version).sort()).toEqual(['2.0', '9.9']);
  });

  it('entrées sans date : transmises telles quelles (l’assembleur ne valide aucune date) ; le resolver les refuse ensuite', () => {
    const retrieval = { ...retrievalOf(L3121_27_V2_RAW), versions: [{ id: 'SANS-DATE' }] };
    const history = assembleVersionHistory([retrieval]);
    expect(history.versions).toContainEqual({ id: 'SANS-DATE' });
    expect(resolveVersion(history, '2018-01-01')).toMatchObject({
      reason: 'insufficient_version_data',
      versionIds: ['SANS-DATE'],
    });
  });
});

describe('assembleVersionHistory — plusieurs récupérations, groupement', () => {
  it('deux RetrievalResult du même identifier (v14 et v20 de L36-11) : un seul historique fusionné', () => {
    const history = assembleVersionHistory([
      retrievalOf(L36_11_V14_RAW),
      retrievalOf(L36_11_V20_RAW),
    ]);

    expect(history.versions.map((v) => v.id).sort()).toEqual([L36_V1, L36_V14, L36_V20].sort());
    expect(history.versions.find((v) => v.id === L36_V20)).toMatchObject({
      state: 'VIGUEUR',
      version: '20.0',
    });
    expect(resolveVersion(history, '2017-03-01')).toMatchObject({
      status: 'resolved',
      version: { id: L36_V14 },
    });
    expect(resolveVersion(history, '2025-01-01')).toMatchObject({
      status: 'resolved',
      version: { id: L36_V20 },
    });
  });

  it('identifiers différents : refusés (le regroupement est fait par l’appelant)', () => {
    expect(() =>
      assembleVersionHistory([retrievalOf(L36_11_V14_RAW), retrievalOf(L3121_27_V2_RAW)]),
    ).toThrowError(RangeError);
  });

  it('aucun résultat : historique vide, unknown', () => {
    expect(assembleVersionHistory([])).toEqual({ versions: [], completeness: 'unknown' });
  });

  it('previousVersionId n’est jamais suivi : une version précédente non listée n’ajoute aucune entrée', () => {
    const history = assembleVersionHistory([retrievalOf(L36_11_V14_RAW)]);
    expect(history.versions.map((v) => v.id)).not.toContain('LEGIARTI000032470399');
  });
});

describe('assembleVersionHistory — exhaustivité', () => {
  it('unknown par défaut, même si la liste semble cohérente (chaînage v2 → v1 présent)', () => {
    expect(retrievalOf(L3121_27_V2_RAW).previousVersionId).toBe(V1);
    expect(assembleVersionHistory([retrievalOf(L3121_27_V2_RAW)]).completeness).toBe('unknown');
  });

  it('complete uniquement quand il est explicitement fourni (test / future preuve)', () => {
    const history = assembleVersionHistory([retrievalOf(L3121_27_V2_RAW)], 'complete');
    expect(history.completeness).toBe('complete');
    expect(resolveVersion(history, '2012-06-15')).toEqual({
      status: 'none_applicable',
      reason: 'gap_between_versions',
    });
  });
});

describe('assembleVersionHistory — pureté', () => {
  const retrievals = [retrievalOf(L36_11_V14_RAW), retrievalOf(L36_11_V20_RAW)];

  it('le résultat ne dépend pas de l’ordre des RetrievalResult ni de celui des versions', () => {
    const reference = assembleVersionHistory(retrievals);
    expect(assembleVersionHistory([...retrievals].reverse())).toEqual(reference);
    const shuffled = retrievals.map((r) => ({ ...r, versions: [...r.versions].reverse() }));
    expect(assembleVersionHistory(shuffled)).toEqual(reference);
    expect(assembleVersionHistory([...shuffled].reverse())).toEqual(reference);
  });

  it('aucune mutation des entrées (structure profondément gelée)', () => {
    const frozen = deepFreeze(retrievals.map((r) => structuredClone(r)));
    const snapshot = JSON.stringify(frozen);
    expect(() => assembleVersionHistory(frozen)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it('les entrées produites sont de nouveaux objets (jamais les objets d’entrée)', () => {
    const input = retrievals[0]!;
    const { versions } = assembleVersionHistory([input]);
    for (const version of versions) {
      expect(input.versions.includes(version)).toBe(false);
    }
  });

  it('deux appels identiques donnent le même résultat', () => {
    expect(assembleVersionHistory(retrievals)).toEqual(assembleVersionHistory(retrievals));
  });
});

describe('identifierKey — clé de groupement d’un article', () => {
  const v1 = retrievalOf(L3121_27_V1_RAW).source;
  const v2 = retrievalOf(L3121_27_V2_RAW).source;

  it('identique pour deux versions d’un même article, distincte de sourceKey (qui les distingue)', () => {
    expect(identifierKey(v1)).toBe(identifierKey(v2));
    expect(sourceKey(v1)).not.toBe(sourceKey(v2));
  });

  it('distingue deux articles et deux autorités', () => {
    expect(identifierKey(v2)).not.toBe(identifierKey(retrievalOf(L36_11_V14_RAW).source));
    expect(identifierKey({ authority: 'legifrance', identifier: 'X' })).not.toBe(
      identifierKey({ authority: 'other', identifier: 'X' }),
    );
  });

  it('n’est pas ambiguë : aucune paire de valeurs différentes ne produit la même clé', () => {
    expect(identifierKey({ authority: 'other', identifier: 'a","b' })).not.toBe(
      identifierKey({ authority: 'other', identifier: 'a' }),
    );
  });
});
