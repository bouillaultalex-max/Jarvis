import { LEGIFRANCE_NO_BOUND_SENTINEL_MS } from './legifrance-source-mapping.js';
import { isLegifranceArticleId } from './legifrance-identifiers.js';
import { ResearchProviderError } from './research/ports.js';
import type {
  SearchMetadata,
  SearchQuery,
  SearchReference,
  SearchResultPage,
  SearchSkippedItem,
} from './research/search-types.js';

/**
 * Parseur pur de la sortie du Tool `legifrance.search` — jalon LEGAL-03B
 * (ADR-0012, ADR-0017). Aucune I/O, aucune horloge : tout est fourni par le
 * contexte, ce qui le rend testable sans réseau.
 *
 * Fondé exclusivement sur la forme **observée** en Sandbox (LEGAL-03.0A) pour
 * le fond `CODE_DATE` :
 *
 *   results[] → { titles[0].id, nature, moreArticlesCount, sections[] }
 *   sections[] → { extracts[] }
 *   extracts[] → { id, title, legalStatus, dateVersion, dateDebut, dateFin, values }
 *
 * Cette règle n'est **pas** généralisée aux autres fonds : leur forme n'a pas
 * été observée. `provenance.resultId` = `titles[0].id` (décision D1). Un
 * résultat sans `titles[0].id` est tracé `malformed_item` (au niveau du
 * résultat), mais ses extraits exploitables restent lus : l'absence
 * d'identifiant de **conteneur** n'est pas l'absence d'**articles**. Leur
 * `provenance.resultId` est alors absent — jamais remplacé par un index ni par
 * un autre champ.
 */

export const LEGIFRANCE_PROVIDER_ID = 'legifrance';
export const LEGIFRANCE_SEARCH_COLLECTION = 'CODE_DATE';

export interface ParseLegifranceSearchContext {
  /** Requête telle qu'émise — conservée dans la provenance. */
  readonly query: SearchQuery;
  /** Instant d'exécution (ISO 8601), fourni par l'appelant. */
  readonly executedAt: string;
}

type PlainObject = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Convertit une date de recherche (chaîne, ex. `2016-08-10T00:00:00.000+0000`)
 * en ISO 8601. Le décalage `+0000` (sans deux-points, forme observée) est
 * normalisé avant l'analyse. Toute valeur non interprétable donne `undefined` :
 * aucune date n'est jamais inventée.
 */
function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * `dateFin` égale à la sentinelle (2999-01-01 UTC, « pas de borne connue »)
 * ⇒ `effectiveTo` absent. Jamais propagée comme une date métier.
 */
function toEffectiveTo(value: unknown): string | undefined {
  const iso = toIso(value);
  if (iso === undefined) return undefined;
  return Date.parse(iso) === LEGIFRANCE_NO_BOUND_SENTINEL_MS ? undefined : iso;
}

function readResultId(result: PlainObject): string | undefined {
  const titles = result.titles;
  if (!Array.isArray(titles) || !isPlainObject(titles[0])) return undefined;
  return optionalNonEmptyString(titles[0].id);
}

function readExcerpt(extract: PlainObject): string | undefined {
  if (!Array.isArray(extract.values)) return undefined;
  const parts = extract.values.filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' … ') : undefined;
}

function buildReference(
  extract: PlainObject & { readonly id: string },
  result: PlainObject,
  positions: {
    resultIndex: number;
    sectionIndex: number;
    extractIndex: number;
    resultId: string | undefined;
  },
  context: ParseLegifranceSearchContext,
): SearchReference {
  const title = optionalNonEmptyString(extract.title);
  const legalStatus = optionalNonEmptyString(extract.legalStatus);
  const dateVersion = toIso(extract.dateVersion);
  const effectiveFrom = toIso(extract.dateDebut);
  const effectiveTo = toEffectiveTo(extract.dateFin);
  const excerpt = readExcerpt(extract);
  const containerNature = optionalNonEmptyString(result.nature);

  return {
    authority: 'legifrance',
    collection: LEGIFRANCE_SEARCH_COLLECTION,
    candidateId: extract.id,
    ...(title !== undefined ? { title } : {}),
    ...(legalStatus !== undefined ? { legalStatus } : {}),
    ...(dateVersion !== undefined ? { dateVersion } : {}),
    ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
    ...(effectiveTo !== undefined ? { effectiveTo } : {}),
    ...(excerpt !== undefined ? { excerpt } : {}),
    ...(containerNature !== undefined ? { containerNature } : {}),
    provenance: {
      providerId: LEGIFRANCE_PROVIDER_ID,
      collection: LEGIFRANCE_SEARCH_COLLECTION,
      query: context.query,
      executedAt: context.executedAt,
      page: context.query.page.number,
      resultIndex: positions.resultIndex,
      ...(positions.resultId !== undefined ? { resultId: positions.resultId } : {}),
      sectionIndex: positions.sectionIndex,
      extractIndex: positions.extractIndex,
    },
  };
}

/**
 * Transforme la sortie (`unknown`) du Tool `legifrance.search` en
 * {@link SearchResultPage}.
 *
 * - **Ne crée aucune `LegalSource`**, n'hydrate rien et **ne déduplique pas** :
 *   les références respectent l'ordre reçu, doublons compris.
 * - `datePublication` et le champ `date` d'un résultat (date du code) ne sont
 *   jamais repris. `dateVersion` reste `dateVersion` : il n'est jamais lu
 *   comme `effectiveFrom`.
 * - Un élément inexploitable est tracé dans `skipped` (`malformed_item` ou
 *   `no_candidate_id`), jamais ignoré en silence.
 *
 * @throws {ResearchProviderError} `malformed_response` si la racine n'a pas la
 *   forme attendue (objet avec `results` tableau).
 */
export function parseLegifranceSearchOutput(
  raw: unknown,
  context: ParseLegifranceSearchContext,
): SearchResultPage {
  if (!isPlainObject(raw) || !Array.isArray(raw.results)) {
    throw new ResearchProviderError(
      LEGIFRANCE_PROVIDER_ID,
      'malformed_response',
      'sortie de legifrance.search : objet avec « results » (tableau) attendu.',
    );
  }

  const references: SearchReference[] = [];
  const skipped: SearchSkippedItem[] = [];
  let unexposedArticleCount = 0;
  let hasUnexposedCount = false;

  raw.results.forEach((result: unknown, resultIndex: number) => {
    if (!isPlainObject(result)) {
      skipped.push({ reason: 'malformed_item', resultIndex });
      return;
    }

    const moreArticlesCount = finiteNumber(result.moreArticlesCount);
    if (moreArticlesCount !== undefined) {
      unexposedArticleCount += moreArticlesCount;
      hasUnexposedCount = true;
    }

    // Un défaut au niveau du résultat (pas de titles[0].id, ou sections illisibles) est tracé UNE fois ;
    // il n'entraîne pas la perte des extraits exploitables du conteneur.
    const resultId = readResultId(result);
    const sections = Array.isArray(result.sections) ? result.sections : undefined;
    if (resultId === undefined || sections === undefined) {
      skipped.push({ reason: 'malformed_item', resultIndex });
    }
    if (sections === undefined) return;

    sections.forEach((section: unknown, sectionIndex: number) => {
      if (!isPlainObject(section) || !Array.isArray(section.extracts)) {
        skipped.push({ reason: 'malformed_item', resultIndex, sectionIndex });
        return;
      }
      section.extracts.forEach((extract: unknown, extractIndex: number) => {
        if (!isPlainObject(extract)) {
          skipped.push({ reason: 'malformed_item', resultIndex, sectionIndex, extractIndex });
          return;
        }
        if (!isLegifranceArticleId(extract.id)) {
          skipped.push({ reason: 'no_candidate_id', resultIndex, sectionIndex, extractIndex });
          return;
        }
        references.push(
          buildReference(
            { ...extract, id: extract.id },
            result,
            { resultIndex, sectionIndex, extractIndex, resultId },
            context,
          ),
        );
      });
    });
  });

  const totalResults = finiteNumber(raw.totalResultNumber);
  const metadata: SearchMetadata = {
    page: context.query.page.number,
    pageSize: context.query.page.size,
    resultCount: raw.results.length,
    ...(totalResults !== undefined ? { totalResults } : {}),
    ...(hasUnexposedCount ? { unexposedArticleCount } : {}),
  };

  return { references, skipped, metadata };
}
