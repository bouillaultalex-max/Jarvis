import type {
  SearchProvenance,
  SearchQuery,
  SearchReference,
  SearchResultPage,
} from '../search-types.js';

/**
 * Fixtures LEGAL-03A — formes **observées** en Sandbox PISTE (LEGAL-03.0A),
 * jamais réenregistrées depuis le réseau et sans aucun contenu juridique
 * réel : les textes sont des chaînes factices. Les identifiants et dates
 * sont ceux effectivement observés (articles L1237-1 et L3121-27 du Code du
 * travail), utiles pour prouver des propriétés d'identité et de temporalité.
 */

export const EXECUTED_AT = '2026-09-23T18:00:00.000Z';

export const QUERY: SearchQuery = {
  text: 'préavis démission',
  matchMode: 'all_terms',
  asOf: '2019-05-24',
  page: { number: 1, size: 5 },
};

function provenance(overrides: Partial<SearchProvenance> = {}): SearchProvenance {
  return {
    providerId: 'legifrance',
    collection: 'CODE_DATE',
    query: QUERY,
    executedAt: EXECUTED_AT,
    page: 1,
    resultIndex: 0,
    ...overrides,
  };
}

function reference(
  candidateId: string,
  title: string,
  provenanceOverrides: Partial<SearchProvenance> = {},
): SearchReference {
  return {
    authority: 'legifrance',
    collection: 'CODE_DATE',
    candidateId,
    title,
    legalStatus: 'VIGUEUR',
    dateVersion: '2008-05-01T00:00:00.000Z',
    effectiveFrom: '2008-05-01T00:00:00.000Z',
    containerNature: 'code',
    provenance: provenance(provenanceOverrides),
  };
}

/** Identifiants d'extraits observés dans un même résultat `CODE_DATE` (3 sections, 3 extraits, 14 articles non exposés). */
export const CONTAINER_ARTICLE_IDS = [
  'LEGIARTI000006901174',
  'LEGIARTI000006900916',
  'LEGIARTI000006900954',
] as const;

function containerReferences(resultIndex: number, resultId: string): SearchReference[] {
  return CONTAINER_ARTICLE_IDS.map((id, extractIndex) =>
    reference(id, id === 'LEGIARTI000006901174' ? 'L1237-1' : id, {
      resultIndex,
      resultId,
      sectionIndex: extractIndex,
      extractIndex: 0,
    }),
  );
}

/** (1) Un résultat `CODE_DATE` : 3 sections et 3 extraits observés (répartition 1/1/1 choisie pour la fixture), articles non exposés. */
export const SINGLE_CONTAINER_PAGE: SearchResultPage = {
  references: containerReferences(0, 'LEGITEXT000006072050_24-05-2019'),
  skipped: [],
  metadata: { page: 1, pageSize: 5, resultCount: 1, totalResults: 7, unexposedArticleCount: 14 },
};

/**
 * (2) Les mêmes `LEGIARTI` répétés dans plusieurs résultats — comportement
 * observé **sans** filtre de date (5 résultats, 3 mêmes identifiants chacun).
 */
export const DUPLICATED_ACROSS_RESULTS_PAGE: SearchResultPage = {
  references: [
    ...containerReferences(0, 'LEGITEXT000006072050_29-12-2025'),
    ...containerReferences(1, 'LEGITEXT000006072050_26-10-2025'),
    ...containerReferences(2, 'LEGITEXT000006072050_01-11-2025'),
  ],
  skipped: [],
  metadata: { page: 1, pageSize: 3, resultCount: 3, totalResults: 5143, unexposedArticleCount: 42 },
};

/** (6) Un résultat dont un élément n'a aucun identifiant exploitable : tracé dans `skipped`, jamais ignoré en silence. */
export const PAGE_WITH_UNUSABLE_ITEM: SearchResultPage = {
  references: [
    reference('LEGIARTI000006901174', 'L1237-1', { resultId: 'LEGITEXT000006072050_24-05-2019' }),
  ],
  skipped: [{ reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 1, extractIndex: 0 }],
  metadata: { page: 1, pageSize: 5, resultCount: 1, totalResults: 1 },
};

export const EMPTY_PAGE: SearchResultPage = {
  references: [],
  skipped: [],
  metadata: { page: 1, pageSize: 5, resultCount: 0, totalResults: 0 },
};

// --- Formes brutes de `legifrance.get_article` (sortie du Tool, dates en epoch ms) -----------------

/** Sentinelle « pas de borne connue » (2999-01-01 UTC) — même valeur que `LEGIFRANCE_NO_BOUND_SENTINEL_MS`. */
export const SENTINEL_MS = 32472144000000;

/** (3) Article multi-version L3121-27 : version 1.0, abrogée. `cid` = `id` de cette première version. */
export const L3121_27_V1_RAW = {
  id: 'LEGIARTI000006902466',
  cid: 'LEGIARTI000006902466',
  nature: 'Article',
  num: 'L3121-27',
  texte: 'Texte factice version 1.',
  versionArticle: '1.0',
  etat: 'ABROGE',
  dateDebut: Date.UTC(2008, 4, 1),
  dateFin: Date.UTC(2008, 7, 22),
  versionPrecedente: null,
  isMultipleVersions: true,
  articleVersions: [
    {
      id: 'LEGIARTI000006902466',
      etat: 'ABROGE',
      version: '1.0',
      dateDebut: Date.UTC(2008, 4, 1),
      dateFin: Date.UTC(2008, 7, 22),
    },
    {
      id: 'LEGIARTI000033020376',
      etat: 'VIGUEUR',
      version: '2.0',
      dateDebut: Date.UTC(2016, 7, 10),
      dateFin: SENTINEL_MS,
    },
  ],
};

/** (3)(4)(5) Version 2.0, en vigueur : `id` distinct, `cid` inchangé, `dateFin` = sentinelle, trou de 2 910 jours après v1. */
export const L3121_27_V2_RAW = {
  id: 'LEGIARTI000033020376',
  cid: 'LEGIARTI000006902466',
  nature: 'Article',
  num: 'L3121-27',
  texte: 'Texte factice version 2.',
  versionArticle: '2.0',
  etat: 'VIGUEUR',
  dateDebut: Date.UTC(2016, 7, 10),
  dateFin: SENTINEL_MS,
  versionPrecedente: 'LEGIARTI000006902466',
  isMultipleVersions: true,
  articleVersions: L3121_27_V1_RAW.articleVersions,
};

/** (5) Extrait de recherche brut observé : dates en **chaînes**, sentinelle textuelle (forme différente de `getArticle`). */
export const RAW_SEARCH_EXTRACT_WITH_SENTINEL = {
  id: 'LEGIARTI000033020376',
  title: 'L3121-27',
  legalStatus: 'VIGUEUR',
  dateVersion: '2016-08-10T00:00:00.000+0000',
  dateDebut: '2016-08-10T00:00:00.000+0000',
  dateFin: '2999-01-01T00:00:00.000+0000',
  type: 'articles',
};

/** Extrait d'une version abrogée : ici `dateVersion` vaut la **fin** de validité, pas le début (observé). */
export const RAW_SEARCH_EXTRACT_ABROGATED = {
  id: 'LEGIARTI000006902466',
  title: 'L3121-27',
  legalStatus: 'ABROGE',
  dateVersion: '2008-08-22T00:00:00.000+0000',
  dateDebut: '2008-05-01T00:00:00.000+0000',
  dateFin: '2008-08-22T00:00:00.000+0000',
  type: 'articles',
};

// --- Échantillons réels supplémentaires pour le VersionResolver ------------------------------------
// Valeurs reprises des échantillons observés en Sandbox (LEGAL-02B.2.1/02B.2.2, voir les fixtures de
// `legifrance-source-mapping.test.ts`) ; textes factices.

/**
 * Article L36-11 demandé en **version 14.0** (MODIFIE). Son `articleVersions` est **incomplet** : il ne liste que
 * les versions 1.0 et 20.0, et **pas** la version demandée (14.0) ni les versions 2 à 19. Un « trou » entre les deux
 * versions listées n'est donc pas une preuve d'absence de version.
 */
export const L36_11_V14_RAW = {
  id: 'LEGIARTI000033219357',
  cid: 'LEGIARTI000006465863',
  nature: 'Article',
  num: 'L36-11',
  texte: 'Texte factice L36-11 version 14.',
  versionArticle: '14.0',
  etat: 'MODIFIE',
  dateDebut: 1475971200000,
  dateFin: 1543104000000,
  versionPrecedente: 'LEGIARTI000032470399',
  isMultipleVersions: true,
  articleVersions: [
    {
      id: 'LEGIARTI000006465863',
      etat: 'MODIFIE',
      version: '1.0',
      dateDebut: 838425600000,
      dateFin: 996278400000,
    },
    {
      id: 'LEGIARTI000049571362',
      etat: 'VIGUEUR',
      version: '20.0',
      dateDebut: 1716422400000,
      dateFin: SENTINEL_MS,
    },
  ],
};

/** Article 57 : version unique, ouverte (`versionPrecedente` null). */
export const ARTICLE_57_RAW = {
  id: 'LEGIARTI000006528277',
  cid: 'LEGIARTI000006528277',
  nature: 'Article',
  num: '57',
  texte: 'Contenu bref factice.',
  versionArticle: '1.0',
  etat: 'VIGUEUR',
  dateDebut: 269568000000,
  dateFin: SENTINEL_MS,
  versionPrecedente: null,
  isMultipleVersions: false,
  articleVersions: [
    {
      id: 'LEGIARTI000006528277',
      etat: 'VIGUEUR',
      version: '1.0',
      dateDebut: 269568000000,
      dateFin: SENTINEL_MS,
    },
  ],
};
