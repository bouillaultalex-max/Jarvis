import { describe, expect, it } from 'vitest';

import { mapLegifranceArticleToLegalSource } from '../legifrance-source-mapping.js';
import { referenceKey, sourceKey } from './source-key.js';
import { L3121_27_V1_RAW, L3121_27_V2_RAW } from './testing/fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');

describe('referenceKey — clé avant récupération (authority + candidateId)', () => {
  it('est identique pour la même référence, quelle que soit sa provenance', () => {
    const a = referenceKey({ authority: 'legifrance', candidateId: 'LEGIARTI000006901174' });
    const b = referenceKey({ authority: 'legifrance', candidateId: 'LEGIARTI000006901174' });
    expect(a).toBe(b);
  });

  it('distingue deux versions d’un même article (candidateId différents)', () => {
    const v1 = referenceKey({ authority: 'legifrance', candidateId: 'LEGIARTI000006902466' });
    const v2 = referenceKey({ authority: 'legifrance', candidateId: 'LEGIARTI000033020376' });
    expect(v1).not.toBe(v2);
  });

  it('distingue deux autorités partageant un même candidateId', () => {
    const a = referenceKey({ authority: 'legifrance', candidateId: 'X1' });
    const b = referenceKey({ authority: 'other', candidateId: 'X1' });
    expect(a).not.toBe(b);
  });

  it('ne peut pas être ambigu : aucune paire de valeurs différentes ne produit la même clé', () => {
    const a = referenceKey({ authority: 'other', candidateId: 'a","b' });
    const b = referenceKey({ authority: 'other', candidateId: 'a' });
    expect(a).not.toBe(b);
  });
});

describe('sourceKey — clé après récupération (authority + identifier + version)', () => {
  const v1 = mapLegifranceArticleToLegalSource(L3121_27_V1_RAW, { now: NOW }).source;
  const v2 = mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, { now: NOW }).source;

  it('les deux versions réelles partagent `identifier` (cid) mais ont des `id` et `version` distincts', () => {
    expect(v1.identifier).toBe(v2.identifier);
    expect(v1.id).not.toBe(v2.id);
    expect(v1.version).toBe('1.0');
    expect(v2.version).toBe('2.0');
  });

  it('distingue les deux versions', () => {
    expect(sourceKey(v1)).not.toBe(sourceKey(v2));
  });

  it('une clé fondée sur `identifier` seul fusionnerait à tort les deux versions (pourquoi cid seul est incorrect)', () => {
    const cidOnly = (s: { authority: string; identifier: string }) =>
      JSON.stringify([s.authority, s.identifier]);
    expect(cidOnly(v1)).toBe(cidOnly(v2));
  });

  it('ne dépend pas du contentHash : deux versions au contenu identique ne sont pas fusionnées', () => {
    const sameContentV2 = mapLegifranceArticleToLegalSource(
      { ...L3121_27_V2_RAW, texte: L3121_27_V1_RAW.texte },
      { now: NOW },
    ).source;
    expect(sameContentV2.contentHash).toBe(v1.contentHash);
    expect(sourceKey(sameContentV2)).not.toBe(sourceKey(v1));
  });

  it('est stable pour une même version consultée à deux instants différents', () => {
    const later = mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, {
      now: () => NOW() + 86_400_000,
    }).source;
    expect(later.consultedAt).not.toBe(v2.consultedAt);
    expect(sourceKey(later)).toBe(sourceKey(v2));
  });

  it('la clé avant récupération (id de version) est cohérente avec la clé après (identifier + version)', () => {
    expect(referenceKey({ authority: v2.authority, candidateId: v2.id })).not.toBe(
      referenceKey({ authority: v1.authority, candidateId: v1.id }),
    );
  });
});
