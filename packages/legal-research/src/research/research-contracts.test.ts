import { describe, expect, it } from 'vitest';

import { mapLegifranceArticleToLegalSource } from '../legifrance-source-mapping.js';
import { ResearchProviderError } from './ports.js';
import type { ResearchResult, ResearchBudget } from './research-types.js';
import { referenceKey } from './source-key.js';
import type { SourceVersionRef } from './temporal-types.js';
import { FakeRetrievalPort, FakeSearchPort } from './testing/fakes.js';
import {
  CONTAINER_ARTICLE_IDS,
  DUPLICATED_ACROSS_RESULTS_PAGE,
  EMPTY_PAGE,
  L3121_27_V1_RAW,
  L3121_27_V2_RAW,
  PAGE_WITH_UNUSABLE_ITEM,
  QUERY,
  RAW_SEARCH_EXTRACT_ABROGATED,
  RAW_SEARCH_EXTRACT_WITH_SENTINEL,
  SENTINEL_MS,
  SINGLE_CONTAINER_PAGE,
} from './testing/fixtures.js';

const NOW = () => Date.parse('2026-09-23T18:00:00.000Z');
const DAY_MS = 86_400_000;

describe('SearchResultPage — contrat de découverte', () => {
  it('un résultat CODE_DATE expose plusieurs références, sans texte et sans LegalSource', () => {
    expect(SINGLE_CONTAINER_PAGE.references).toHaveLength(3);
    for (const reference of SINGLE_CONTAINER_PAGE.references) {
      expect(reference).not.toHaveProperty('contentHash');
      expect(reference).not.toHaveProperty('version');
      expect(reference).not.toHaveProperty('identifier');
    }
  });

  it('une référence conserve sa provenance complète (requête, fond, page, position, résultat)', () => {
    const provenance = SINGLE_CONTAINER_PAGE.references[0]!.provenance;
    expect(provenance).toMatchObject({
      providerId: 'legifrance',
      collection: 'CODE_DATE',
      page: 1,
      resultIndex: 0,
      resultId: 'LEGITEXT000006072050_24-05-2019',
    });
    expect(provenance.query).toEqual(QUERY);
  });

  it('les articles non exposés sont comptés à part, jamais confondus avec les références', () => {
    expect(SINGLE_CONTAINER_PAGE.metadata.unexposedArticleCount).toBe(14);
    expect(SINGLE_CONTAINER_PAGE.references).toHaveLength(3);
  });

  it('resultCount (conteneurs) n’est pas le nombre de références (articles)', () => {
    expect(DUPLICATED_ACROSS_RESULTS_PAGE.metadata.resultCount).toBe(3);
    expect(DUPLICATED_ACROSS_RESULTS_PAGE.references).toHaveLength(9);
  });

  it('les mêmes identifiants répétés dans plusieurs résultats se ramènent à 3 clés distinctes', () => {
    const keys = new Set(DUPLICATED_ACROSS_RESULTS_PAGE.references.map(referenceKey));
    expect(keys.size).toBe(CONTAINER_ARTICLE_IDS.length);
  });

  it('un élément sans identifiant exploitable est tracé dans skipped, jamais perdu en silence', () => {
    expect(PAGE_WITH_UNUSABLE_ITEM.skipped).toEqual([
      { reason: 'no_candidate_id', resultIndex: 0, sectionIndex: 1, extractIndex: 0 },
    ]);
    expect(PAGE_WITH_UNUSABLE_ITEM.references).toHaveLength(1);
  });

  it('aucune référence ne fabrique publicationDate ni ne lit dateVersion comme effectiveFrom sans décision', () => {
    for (const reference of SINGLE_CONTAINER_PAGE.references) {
      expect(reference).not.toHaveProperty('publicationDate');
    }
  });
});

describe('FakeSearchPort / FakeRetrievalPort — ports sans réseau', () => {
  it('FakeSearchPort renvoie la page demandée et mémorise les requêtes', async () => {
    const port = new FakeSearchPort({ 1: SINGLE_CONTAINER_PAGE });
    const page = await port.search(QUERY);
    expect(page).toBe(SINGLE_CONTAINER_PAGE);
    expect(port.queries).toEqual([QUERY]);
  });

  it('FakeSearchPort renvoie une page vide pour une page inconnue (fin de résultats)', async () => {
    const page = await new FakeSearchPort({ 1: EMPTY_PAGE }).search({
      ...QUERY,
      page: { number: 9, size: 5 },
    });
    expect(page.references).toEqual([]);
    expect(page.metadata.resultCount).toBe(0);
  });

  it('FakeSearchPort propage une ResearchProviderError typée', async () => {
    const error = new ResearchProviderError('fake', 'denied', 'refusé par la politique.');
    await expect(new FakeSearchPort({}, { failWith: error }).search(QUERY)).rejects.toBe(error);
  });

  it('FakeRetrievalPort ne récupère que ce qu’il connaît et trace les appels', async () => {
    const reference = SINGLE_CONTAINER_PAGE.references[0]!;
    const result = {
      source: mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, { now: NOW }).source,
      versions: [],
      reference,
    };
    const port = new FakeRetrievalPort({ [reference.candidateId]: result });
    expect(port.canRetrieve(reference)).toBe(true);
    expect(port.canRetrieve(SINGLE_CONTAINER_PAGE.references[1]!)).toBe(false);
    await expect(port.retrieve({ reference })).resolves.toBe(result);
    await expect(
      port.retrieve({ reference: SINGLE_CONTAINER_PAGE.references[1]! }),
    ).rejects.toMatchObject({
      reason: 'invalid_request',
    });
    expect(port.retrieved).toEqual([
      reference.candidateId,
      SINGLE_CONTAINER_PAGE.references[1]!.candidateId,
    ]);
  });

  it('un échec de récupération est une ResearchProviderError, pas une valeur silencieuse', async () => {
    const reference = SINGLE_CONTAINER_PAGE.references[0]!;
    const error = new ResearchProviderError('fake', 'execution_error', 'échec technique.');
    await expect(
      new FakeRetrievalPort({ [reference.candidateId]: error }).retrieve({ reference }),
    ).rejects.toBe(error);
  });
});

describe('Article multi-version réel — chaîne, trou temporel et sentinelle', () => {
  const v1 = mapLegifranceArticleToLegalSource(L3121_27_V1_RAW, { now: NOW });
  const v2 = mapLegifranceArticleToLegalSource(L3121_27_V2_RAW, { now: NOW });

  it('deux versions : id distincts, identifier (cid) commun, version juridique distincte, versionPrecedente liée', () => {
    expect(v2.source.id).not.toBe(v1.source.id);
    expect(v2.source.identifier).toBe(v1.source.identifier);
    expect(v2.metadata.versionPrecedente).toBe(v1.source.id);
    expect(v1.metadata.versionPrecedente).toBeUndefined();
  });

  it('articleVersions conserve l’historique complet (2 versions, ordre chronologique)', () => {
    expect(v2.metadata.articleVersions.map((v) => v.id)).toEqual([v1.source.id, v2.source.id]);
  });

  it('trou temporel : v1 se termine 2 910 jours avant le début de v2 (les bornes ne s’enchaînent pas)', () => {
    const end = Date.parse(v1.source.effectiveTo!);
    const start = Date.parse(v2.source.effectiveFrom);
    expect((start - end) / DAY_MS).toBe(2910);
  });

  it('sentinelle 2999 : la version en vigueur n’a pas d’effectiveTo (jamais 2999-01-01)', () => {
    expect(L3121_27_V2_RAW.dateFin).toBe(SENTINEL_MS);
    expect(v2.source.effectiveTo).toBeUndefined();
  });

  it('les versions génériques se déduisent des métadonnées sans nouveau format (SourceVersionRef)', () => {
    const refs: SourceVersionRef[] = v2.metadata.articleVersions.map((v) => ({
      id: v.id,
      ...(v.version !== undefined ? { version: v.version } : {}),
      ...(v.etat !== undefined ? { state: v.etat } : {}),
      ...(v.effectiveFrom !== undefined ? { effectiveFrom: v.effectiveFrom } : {}),
      ...(v.effectiveTo !== undefined ? { effectiveTo: v.effectiveTo } : {}),
    }));
    expect(refs[0]).toMatchObject({ version: '1.0', state: 'ABROGE' });
    expect(refs[1]).toMatchObject({ version: '2.0', state: 'VIGUEUR' });
    expect(refs[1]!.effectiveTo).toBeUndefined();
  });

  it('extraits de recherche bruts : dates en chaînes, sentinelle textuelle, dateVersion = fin pour une version abrogée', () => {
    expect(RAW_SEARCH_EXTRACT_WITH_SENTINEL.dateFin.startsWith('2999-01-01')).toBe(true);
    expect(RAW_SEARCH_EXTRACT_WITH_SENTINEL.dateVersion).toBe(
      RAW_SEARCH_EXTRACT_WITH_SENTINEL.dateDebut,
    );
    expect(RAW_SEARCH_EXTRACT_ABROGATED.dateVersion).toBe(RAW_SEARCH_EXTRACT_ABROGATED.dateFin);
    expect(RAW_SEARCH_EXTRACT_ABROGATED.dateVersion).not.toBe(
      RAW_SEARCH_EXTRACT_ABROGATED.dateDebut,
    );
  });
});

describe('ResearchResult — la lacune est explicite', () => {
  it('une recherche sans résultat se représente par une lacune, pas par un résultat vide silencieux', () => {
    const budget: ResearchBudget = { maxSearchPages: 1, maxCandidates: 1, maxRetrievedSources: 1 };
    const result: ResearchResult = {
      query: QUERY,
      budget,
      candidates: [],
      rejections: [],
      gaps: [{ kind: 'no_search_result' }],
      skipped: [],
    };
    expect(result.gaps).toEqual([{ kind: 'no_search_result' }]);
  });
});
