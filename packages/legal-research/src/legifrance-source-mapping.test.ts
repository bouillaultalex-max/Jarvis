import { describe, expect, it } from 'vitest';

import {
  LEGIFRANCE_NO_BOUND_SENTINEL_MS,
  LegifranceMappingError,
  mapLegifranceArticleToLegalSource,
} from './legifrance-source-mapping.js';

/** Article versionné — mêmes valeurs que celles réellement observées en sandbox PISTE (LEGAL-02B.2.1/.2). */
const VERSIONED_ARTICLE = {
  id: 'LEGIARTI000033219357',
  cid: 'LEGIARTI000006465863',
  idTexte: null,
  cidTexte: null,
  type: 'AUTONOME',
  nature: 'Article',
  num: 'L36-11',
  texte: "L'Autorité de régulation des communications électroniques et des postes…",
  versionArticle: '14.0',
  etat: 'MODIFIE',
  dateDebut: 1475971200000,
  dateFin: 1543104000000,
  versionPrecedente: 'LEGIARTI000032470399',
  isMultipleVersions: true,
  sectionParentTitre: 'Section 1 : Autorité de régulation des communications électroniques',
  fullSectionsTitre: 'Partie législative, LIVRE II : Les communications électroniques',
  articleVersions: [
    {
      id: 'LEGIARTI000006465863',
      etat: 'MODIFIE',
      version: '1.0',
      dateDebut: 838425600000,
      dateFin: 996278400000,
      numero: null,
      ordre: null,
    },
    {
      id: 'LEGIARTI000049571362',
      etat: 'VIGUEUR',
      version: '20.0',
      dateDebut: 1716422400000,
      dateFin: LEGIFRANCE_NO_BOUND_SENTINEL_MS,
      numero: null,
      ordre: null,
    },
  ],
  lienModifications: [],
  lienCitations: [
    {
      textCid: 'JORFTEXT000000512205',
      textTitle: 'Loi n° 86-1067',
      linkType: 'CITATION',
      linkOrientation: 'source',
      articleNum: '26',
      articleId: 'LEGIARTI000006420293',
      natureText: 'LOI',
      parentCid: null,
      numTexte: '86-1067',
      datePubli: 528508800000,
      dateDebut: 601084800000,
    },
  ],
};

/** Article non versionné — mêmes valeurs que celles réellement observées en sandbox PISTE (LEGAL-02B.2.2, second article). */
const NON_VERSIONED_ARTICLE = {
  id: 'LEGIARTI000006528277',
  cid: 'LEGIARTI000006528277',
  idTexte: null,
  cidTexte: null,
  type: 'AUTONOME',
  nature: 'Article',
  num: '57',
  texte: 'Contenu bref.',
  versionArticle: '1.0',
  etat: 'VIGUEUR',
  dateDebut: 269568000000,
  dateFin: LEGIFRANCE_NO_BOUND_SENTINEL_MS,
  versionPrecedente: null,
  isMultipleVersions: false,
  sectionParentTitre: null,
  fullSectionsTitre: null,
  articleVersions: [
    {
      id: 'LEGIARTI000006528277',
      etat: 'VIGUEUR',
      version: '1.0',
      dateDebut: 269568000000,
      dateFin: LEGIFRANCE_NO_BOUND_SENTINEL_MS,
      numero: null,
      ordre: null,
    },
  ],
  lienModifications: [],
  lienCitations: [],
};

describe('mapLegifranceArticleToLegalSource — article versionné (1)', () => {
  it('mappe id/cid/version/contenu correctement', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);

    expect(source.id).toBe('LEGIARTI000033219357');
    expect(source.identifier).toBe('LEGIARTI000006465863');
    expect(source.version).toBe('14.0');
  });

  it('3/4. convertit dateDebut/dateFin (epoch ms) en ISO 8601', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);

    expect(source.effectiveFrom).toBe(new Date(1475971200000).toISOString());
    expect(source.effectiveTo).toBe(new Date(1543104000000).toISOString());
    expect(source.effectiveFrom).toBe('2016-10-09T00:00:00.000Z');
    expect(source.effectiveTo).toBe('2018-11-25T00:00:00.000Z');
  });

  it('6. mappe nature "Article" vers sourceType "code_article"', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(source.sourceType).toBe('code_article');
  });

  it('7. construit reference par composition (fullSectionsTitre + num)', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(source.reference).toBe(
      'Partie législative, LIVRE II : Les communications électroniques, art. L36-11',
    );
  });

  it('10. calcule contentHash à partir du texte réel (SHA-256 hex, 64 caractères)', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('n’invente jamais publicationDate', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(source.publicationDate).toBeUndefined();
  });

  it('dérive authority/reliability, jamais lues depuis l’API', () => {
    const { source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(source.authority).toBe('legifrance');
    expect(source.reliability).toBe('primary_institutional');
  });

  it('11. conserve articleVersions (métadonnée, hors LegalSource) avec dates converties', () => {
    const { metadata } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);

    expect(metadata.articleVersions).toHaveLength(2);
    expect(metadata.articleVersions[0]).toEqual({
      id: 'LEGIARTI000006465863',
      etat: 'MODIFIE',
      version: '1.0',
      effectiveFrom: '1996-07-27T00:00:00.000Z',
      effectiveTo: '2001-07-28T00:00:00.000Z',
    });
    // La dernière version (en vigueur) : sentinelle → effectiveTo absent, jamais 2999-01-01.
    expect(metadata.articleVersions[1]!.effectiveTo).toBeUndefined();
  });

  it('conserve versionPrecedente en métadonnée, jamais sur LegalSource', () => {
    const { metadata, source } = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    expect(metadata.versionPrecedente).toBe('LEGIARTI000032470399');
    expect('versionPrecedente' in source).toBe(false);
  });

  it('14. lienCitations n’est jamais lu : sa présence ou son absence n’a aucun effet sur le mapping', () => {
    const withCitations = mapLegifranceArticleToLegalSource(VERSIONED_ARTICLE);
    const withoutCitations: Record<string, unknown> = { ...VERSIONED_ARTICLE };
    delete withoutCitations.lienCitations;
    const withoutCitationsResult = mapLegifranceArticleToLegalSource(withoutCitations);

    expect(withCitations).toEqual(withoutCitationsResult);
    // Aucune trace de lienCitations, sous quelque forme que ce soit, dans le résultat.
    expect(JSON.stringify(withCitations)).not.toContain('JORFTEXT000000512205');
  });
});

describe('mapLegifranceArticleToLegalSource — article non versionné (2)', () => {
  it('2/8. id === cid quand l’article n’a jamais été modifié', () => {
    const { source } = mapLegifranceArticleToLegalSource(NON_VERSIONED_ARTICLE);
    expect(source.id).toBe('LEGIARTI000006528277');
    expect(source.identifier).toBe('LEGIARTI000006528277');
  });

  it('9. versionArticle = "1.0"', () => {
    const { source } = mapLegifranceArticleToLegalSource(NON_VERSIONED_ARTICLE);
    expect(source.version).toBe('1.0');
  });

  it('5. dateFin sentinelle (32472144000000) ⇒ effectiveTo absent, jamais converti en 2999-01-01', () => {
    const { source } = mapLegifranceArticleToLegalSource(NON_VERSIONED_ARTICLE);

    expect(source.effectiveTo).toBeUndefined();
    expect(JSON.stringify(source)).not.toContain('2999-01-01');
  });

  it('12. sectionParentTitre/fullSectionsTitre/num tous absents ⇒ reference absent, title = id', () => {
    const { source } = mapLegifranceArticleToLegalSource({ ...NON_VERSIONED_ARTICLE, num: null });
    expect(source.reference).toBeUndefined();
    expect(source.title).toBe('LEGIARTI000006528277');
  });

  it('12. versionPrecedente null ⇒ absent des métadonnées (pas null)', () => {
    const { metadata } = mapLegifranceArticleToLegalSource(NON_VERSIONED_ARTICLE);
    expect('versionPrecedente' in metadata).toBe(false);
  });

  it('12. articleVersions absent/mal typé ⇒ liste vide, ne fait jamais échouer le mapping', () => {
    const { metadata } = mapLegifranceArticleToLegalSource({
      ...NON_VERSIONED_ARTICLE,
      articleVersions: 'not-an-array',
    });
    expect(metadata.articleVersions).toEqual([]);
  });
});

describe('mapLegifranceArticleToLegalSource — sentinelle temporelle (test explicite requis)', () => {
  it('32472144000000 ne devient JAMAIS "2999-01-01" dans effectiveTo', () => {
    const { source } = mapLegifranceArticleToLegalSource({
      ...NON_VERSIONED_ARTICLE,
      dateFin: LEGIFRANCE_NO_BOUND_SENTINEL_MS,
    });

    expect(source.effectiveTo).not.toBe('2999-01-01');
    expect(source.effectiveTo).not.toBe('2999-01-01T00:00:00.000Z');
    expect(source.effectiveTo).toBeUndefined();
  });

  it('une dateFin réelle proche mais distincte de la sentinelle EST convertie normalement', () => {
    const { source } = mapLegifranceArticleToLegalSource({
      ...NON_VERSIONED_ARTICLE,
      dateFin: LEGIFRANCE_NO_BOUND_SENTINEL_MS - 1,
    });

    expect(source.effectiveTo).toBe(new Date(LEGIFRANCE_NO_BOUND_SENTINEL_MS - 1).toISOString());
  });
});

describe('mapLegifranceArticleToLegalSource — refus propre d’une réponse invalide (13)', () => {
  it.each([null, undefined, 'not-an-object', 42, []])(
    'rejette une racine non-objet (%j)',
    (value) => {
      expect(() => mapLegifranceArticleToLegalSource(value)).toThrowError(LegifranceMappingError);
    },
  );

  it.each(['id', 'cid', 'nature', 'versionArticle', 'texte'])(
    'rejette une réponse sans « %s »',
    (field) => {
      const broken = { ...NON_VERSIONED_ARTICLE } as Record<string, unknown>;
      delete broken[field];
      expect(() => mapLegifranceArticleToLegalSource(broken)).toThrowError(LegifranceMappingError);
    },
  );

  it('rejette dateDebut manquant ou mal typé', () => {
    expect(() =>
      mapLegifranceArticleToLegalSource({ ...NON_VERSIONED_ARTICLE, dateDebut: 'pas-un-nombre' }),
    ).toThrowError(LegifranceMappingError);
  });

  it('rejette une nature inconnue (table de correspondance volontairement incomplète)', () => {
    expect(() =>
      mapLegifranceArticleToLegalSource({ ...NON_VERSIONED_ARTICLE, nature: 'Décret' }),
    ).toThrowError(LegifranceMappingError);
  });

  it('les erreurs de mapping ne contiennent jamais le contenu de l’article', () => {
    try {
      mapLegifranceArticleToLegalSource({ ...NON_VERSIONED_ARTICLE, id: undefined });
      expect.unreachable('devait lever');
    } catch (error) {
      expect((error as Error).message).not.toContain(NON_VERSIONED_ARTICLE.texte);
    }
  });
});
