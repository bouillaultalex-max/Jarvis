import { describe, expect, it } from 'vitest';

import { LEGIFRANCE_NO_BOUND_SENTINEL_MS } from './legifrance-source-mapping.js';
import { parseLegifranceSearchOutput } from './legifrance-search-parser.js';
import { ResearchProviderError } from './research/ports.js';
import type { SearchQuery } from './research/search-types.js';
import {
  extract,
  NOMINAL_OUTPUT,
  output,
  result,
} from './research/testing/legifrance-search-fixtures.js';

const QUERY: SearchQuery = {
  text: 'préavis démission',
  matchMode: 'all_terms',
  asOf: '2019-05-24',
  page: { number: 2, size: 5 },
};
const CONTEXT = { query: QUERY, executedAt: '2026-09-23T18:00:00.000Z' };

describe('parseLegifranceSearchOutput — réponse nominale', () => {
  const page = parseLegifranceSearchOutput(NOMINAL_OUTPUT, CONTEXT);

  it('parcourt results → sections → extracts et produit une référence par extrait exploitable, dans l’ordre reçu', () => {
    expect(page.references.map((r) => r.candidateId)).toEqual([
      'LEGIARTI000006901174',
      'LEGIARTI000006900916',
      'LEGIARTI000006900954',
      'LEGIARTI000006902466',
    ]);
    expect(page.skipped).toEqual([]);
  });

  it('plusieurs sections et plusieurs extraits : la position de chaque extrait est conservée', () => {
    expect(
      page.references.map((r) => [r.provenance.sectionIndex, r.provenance.extractIndex]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it('conserve la provenance : fournisseur, fond, requête, instant, page demandée, position et resultId = titles[0].id', () => {
    expect(page.references[0]!.provenance).toEqual({
      providerId: 'legifrance',
      collection: 'CODE_DATE',
      query: QUERY,
      executedAt: '2026-09-23T18:00:00.000Z',
      page: 2,
      resultIndex: 0,
      resultId: 'LEGITEXT000006072050_24-05-2019',
      sectionIndex: 0,
      extractIndex: 0,
    });
  });

  it('reprend les informations observées utiles : titre, état, extrait, nature du conteneur', () => {
    expect(page.references[0]).toMatchObject({
      authority: 'legifrance',
      collection: 'CODE_DATE',
      title: 'L1237-1',
      legalStatus: 'VIGUEUR',
      excerpt: 'extrait factice',
      containerNature: 'code',
    });
  });

  it('convertit les dates en ISO 8601 ; dateVersion et effectiveFrom restent deux champs distincts', () => {
    const abrogated = page.references[3]!;
    expect(abrogated.dateVersion).toBe('2008-08-22T00:00:00.000Z');
    expect(abrogated.effectiveFrom).toBe('2008-05-01T00:00:00.000Z');
    expect(abrogated.effectiveTo).toBe('2008-08-22T00:00:00.000Z');
    expect(abrogated.dateVersion).not.toBe(abrogated.effectiveFrom);
  });

  it('sentinelle 2999-01-01 : effectiveTo absent, jamais une date (même valeur que la sentinelle epoch de getArticle)', () => {
    expect(new Date(LEGIFRANCE_NO_BOUND_SENTINEL_MS).toISOString().startsWith('2999-01-01')).toBe(
      true,
    );
    expect(page.references[0]).not.toHaveProperty('effectiveTo');
  });

  it('ne crée ni LegalSource, ni texte, ni identifier/version/contentHash ; ignore datePublication et parentTextId', () => {
    for (const reference of page.references) {
      for (const forbidden of [
        'source',
        'text',
        'identifier',
        'version',
        'contentHash',
        'publicationDate',
        'parentTextId',
      ]) {
        expect(reference).not.toHaveProperty(forbidden);
      }
    }
  });
});

describe('parseLegifranceSearchOutput — métadonnées et pagination', () => {
  it('resultCount compte les résultats (conteneurs), pas les références ; total et articles non exposés sont repris', () => {
    const page = parseLegifranceSearchOutput(
      output(
        [
          result({ moreArticlesCount: 5 }),
          result({ moreArticlesCount: 6, titles: [{ id: 'LEGITEXT000006072665_24-05-2019' }] }),
        ],
        {
          totalResultNumber: 7,
        },
      ),
      CONTEXT,
    );
    expect(page.metadata).toEqual({
      page: 2,
      pageSize: 5,
      resultCount: 2,
      totalResults: 7,
      unexposedArticleCount: 11,
    });
    expect(page.references).toHaveLength(2);
  });

  it('total absent ou mal typé : totalResults omis ; aucun moreArticlesCount : unexposedArticleCount omis', () => {
    const page = parseLegifranceSearchOutput(
      output([result({ moreArticlesCount: undefined })], { totalResultNumber: 'x' }),
      CONTEXT,
    );
    expect(page.metadata).toEqual({ page: 2, pageSize: 5, resultCount: 1 });
  });

  it('aucun résultat : page vide, sans référence ni élément écarté', () => {
    const page = parseLegifranceSearchOutput(output([], { totalResultNumber: 0 }), CONTEXT);
    expect(page).toEqual({
      references: [],
      skipped: [],
      metadata: { page: 2, pageSize: 5, resultCount: 0, totalResults: 0 },
    });
  });

  it('les mêmes LEGIARTI répétés dans plusieurs résultats ne sont PAS dédupliqués par le parseur', () => {
    const page = parseLegifranceSearchOutput(
      output([result(), result({ titles: [{ id: 'LEGITEXT000006072050_26-10-2025' }] })]),
      CONTEXT,
    );
    expect(page.references.map((r) => r.candidateId)).toEqual([
      'LEGIARTI000006901174',
      'LEGIARTI000006901174',
    ]);
    expect(page.references.map((r) => r.provenance.resultId)).toEqual([
      'LEGITEXT000006072050_24-05-2019',
      'LEGITEXT000006072050_26-10-2025',
    ]);
  });
});

describe('parseLegifranceSearchOutput — éléments inexploitables (jamais ignorés en silence)', () => {
  it('cas 1 — résultat valide avec titles[0].id : comportement inchangé (resultId = titles[0].id, aucun élément écarté)', () => {
    const page = parseLegifranceSearchOutput(output([result()]), CONTEXT);
    expect(page.skipped).toEqual([]);
    expect(page.references).toHaveLength(1);
    expect(page.references[0]!.provenance.resultId).toBe('LEGITEXT000006072050_24-05-2019');
  });

  it('cas 2 — résultat sans titles[0].id mais extraits exploitables : le résultat est tracé malformed_item, les extraits sont CONSERVÉS', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({
          titles: [],
          sections: [
            { extracts: [extract(), extract({ id: 'LEGIARTI000006900916', title: 'L1237-2' })] },
          ],
        }),
      ]),
      CONTEXT,
    );

    expect(page.references.map((r) => r.candidateId)).toEqual([
      'LEGIARTI000006901174',
      'LEGIARTI000006900916',
    ]);
    expect(page.skipped).toEqual([{ reason: 'malformed_item', resultIndex: 0 }]);
    // Positions conservées ; aucun identifiant de résultat n'est inventé.
    expect(
      page.references.map((r) => [
        r.provenance.resultIndex,
        r.provenance.sectionIndex,
        r.provenance.extractIndex,
      ]),
    ).toEqual([
      [0, 0, 0],
      [0, 0, 1],
    ]);
  });

  it('cas 2 — jamais d’identifiant de résultat inventé : ni index, ni autre champ (id, title), ni identifiant d’extrait', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({ titles: undefined, id: 'AUTRE-ID', title: 'AUTRE-TITRE' }),
        result({ titles: [{ id: '' }] }),
        result({ titles: [{}] }),
        result({ titles: 'x' }),
      ]),
      CONTEXT,
    );

    expect(page.references).toHaveLength(4);
    for (const reference of page.references) {
      expect(reference.provenance).not.toHaveProperty('resultId');
      expect(JSON.stringify(reference.provenance)).not.toContain('AUTRE-');
    }
    expect(page.skipped).toEqual(
      [0, 1, 2, 3].map((resultIndex) => ({ reason: 'malformed_item', resultIndex })),
    );
  });

  it('cas 2 — un résultat sans titles[0].id n’altère pas la lecture des autres résultats', () => {
    const page = parseLegifranceSearchOutput(output([result({ titles: [] }), result()]), CONTEXT);

    expect(page.references.map((r) => r.provenance.resultIndex)).toEqual([0, 1]);
    expect(page.references.map((r) => r.provenance.resultId)).toEqual([
      undefined,
      'LEGITEXT000006072050_24-05-2019',
    ]);
    expect(page.skipped).toEqual([{ reason: 'malformed_item', resultIndex: 0 }]);
  });

  it('cas 3 — extrait sans identifiant LEGIARTI exploitable : no_candidate_id, y compris dans un résultat sans titles[0].id', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({
          titles: [],
          sections: [{ extracts: [extract({ id: 'LEGISCTA000006189234' }), extract()] }],
        }),
      ]),
      CONTEXT,
    );

    expect(page.references.map((r) => r.candidateId)).toEqual(['LEGIARTI000006901174']);
    expect(page.skipped).toEqual([
      { reason: 'malformed_item', resultIndex: 0 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 0 },
    ]);
  });

  it('cas 4 — résultat sans titles[0].id ET sans extrait exploitable : aucune référence, tout est tracé (résultat + extraits), rien n’est perdu en silence', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({
          titles: [],
          sections: [{ extracts: [extract({ id: undefined }), extract({ id: 'LEGIARTI12' })] }],
        }),
      ]),
      CONTEXT,
    );

    expect(page.references).toEqual([]);
    expect(page.skipped).toEqual([
      { reason: 'malformed_item', resultIndex: 0 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 0 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 1 },
    ]);
    expect(page.metadata.resultCount).toBe(1);
  });

  it('cas 4 — sans titles[0].id ET sans sections lisibles : un seul malformed_item pour le résultat (pas de doublon)', () => {
    const page = parseLegifranceSearchOutput(
      output([result({ titles: [], sections: undefined })]),
      CONTEXT,
    );

    expect(page.references).toEqual([]);
    expect(page.skipped).toEqual([{ reason: 'malformed_item', resultIndex: 0 }]);
  });

  it('un résultat sans titles[0].id compte toujours dans resultCount et dans les articles non exposés (moreArticlesCount)', () => {
    const page = parseLegifranceSearchOutput(
      output([result({ titles: [], moreArticlesCount: 9 })]),
      CONTEXT,
    );
    expect(page.metadata).toMatchObject({ resultCount: 1, unexposedArticleCount: 9 });
  });

  it('élément de results, section ou extrait mal typé : malformed_item avec sa position', () => {
    const page = parseLegifranceSearchOutput(
      output([
        'pas un objet',
        result({ sections: 'x' }),
        result({ sections: [42, { extracts: 'x' }, { extracts: [null, 'y'] }] }),
      ]),
      CONTEXT,
    );
    expect(page.skipped).toEqual([
      { reason: 'malformed_item', resultIndex: 0 },
      { reason: 'malformed_item', resultIndex: 1 },
      { reason: 'malformed_item', resultIndex: 2, sectionIndex: 0 },
      { reason: 'malformed_item', resultIndex: 2, sectionIndex: 1 },
      { reason: 'malformed_item', resultIndex: 2, sectionIndex: 2, extractIndex: 0 },
      { reason: 'malformed_item', resultIndex: 2, sectionIndex: 2, extractIndex: 1 },
    ]);
  });

  it('extrait sans identifiant LEGIARTI exploitable : tracé no_candidate_id, les autres extraits restent lus', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({
          sections: [
            {
              extracts: [
                extract({ id: undefined }),
                extract({ id: 'LEGISCTA000006189234' }),
                extract({ id: 'LEGIARTI12' }),
                extract(),
              ],
            },
          ],
        }),
      ]),
      CONTEXT,
    );
    expect(page.references.map((r) => r.candidateId)).toEqual(['LEGIARTI000006901174']);
    expect(page.skipped).toEqual([
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 0 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 1 },
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 0, extractIndex: 2 },
    ]);
  });

  it('une date non interprétable est omise, jamais inventée ; une valeur d’extrait vide donne aucun excerpt', () => {
    const page = parseLegifranceSearchOutput(
      output([
        result({
          sections: [
            {
              extracts: [extract({ dateVersion: 'hier', dateDebut: 7, dateFin: null, values: [] })],
            },
          ],
        }),
      ]),
      CONTEXT,
    );
    const reference = page.references[0]!;
    for (const field of ['dateVersion', 'effectiveFrom', 'effectiveTo', 'excerpt'])
      expect(reference).not.toHaveProperty(field);
  });
});

describe('parseLegifranceSearchOutput — sortie inexploitable', () => {
  it.each([
    ['une valeur non objet', 'x'],
    ['null', null],
    ['un tableau', []],
    ['sans results', { totalResultNumber: 1 }],
    ['avec results non tableau', { results: {} }],
  ])('%s : ResearchProviderError malformed_response', (_label, raw) => {
    try {
      parseLegifranceSearchOutput(raw, CONTEXT);
      expect.unreachable('devait lever');
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchProviderError);
      expect((error as ResearchProviderError).reason).toBe('malformed_response');
    }
  });
});
