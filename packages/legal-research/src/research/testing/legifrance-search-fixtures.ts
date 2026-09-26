/**
 * Sorties **brutes** du Tool `legifrance.search` — formes observées en Sandbox
 * (LEGAL-03.0A), sans aucun contenu juridique réel (extraits factices).
 * Dates en chaînes `…T00:00:00.000+0000`, sentinelle textuelle `2999-01-01…`,
 * `titles[0].id` = identifiant du résultat (`<texte>_<date>`).
 */

export function extract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'LEGIARTI000006901174',
    title: 'L1237-1',
    legalStatus: 'VIGUEUR',
    dateVersion: '2008-05-01T00:00:00.000+0000',
    dateDebut: '2008-05-01T00:00:00.000+0000',
    dateFin: '2999-01-01T00:00:00.000+0000',
    type: 'articles',
    values: ['extrait factice'],
    ...overrides,
  };
}

export function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'data_legi',
    nature: 'code',
    origin: 'LEGI',
    etat: 'VIGUEUR',
    text: null,
    date: '1973-01-03T00:00:00.000+0000',
    datePublication: '2999-01-01T00:00:00.000+0000',
    moreArticlesCount: 14,
    moreArticle: true,
    titles: [{ id: 'LEGITEXT000006072050_24-05-2019' }],
    sections: [{ extracts: [extract()] }],
    ...overrides,
  };
}

export function output(
  results: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    totalResultNumber: 7,
    totalArticleResultNumber: 0,
    typePagination: 'DEFAUT',
    results,
    ...overrides,
  };
}

/** Un résultat : 3 sections dont une à 2 extraits, sentinelle, version abrogée avec fin réelle. */
export const NOMINAL_OUTPUT = output([
  result({
    sections: [
      { extracts: [extract()] },
      {
        extracts: [
          extract({ id: 'LEGIARTI000006900916', title: 'L1237-2' }),
          extract({ id: 'LEGIARTI000006900954', title: 'L1237-3' }),
        ],
      },
      {
        extracts: [
          extract({
            id: 'LEGIARTI000006902466',
            title: 'L3121-27',
            legalStatus: 'ABROGE',
            dateVersion: '2008-08-22T00:00:00.000+0000',
            dateDebut: '2008-05-01T00:00:00.000+0000',
            dateFin: '2008-08-22T00:00:00.000+0000',
          }),
        ],
      },
    ],
  }),
]);
