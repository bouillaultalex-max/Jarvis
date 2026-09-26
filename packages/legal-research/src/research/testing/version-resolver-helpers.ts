import { mapLegifranceArticleToLegalSource } from '../../legifrance-source-mapping.js';
import type { RetrievalResult, VersionTargetResult } from '../retrieval-types.js';
import type { SourceVersionRef, VersionCompleteness, VersionHistory } from '../temporal-types.js';
import { SINGLE_CONTAINER_PAGE } from './fixtures.js';

/** Aides partagées des tests du resolver (`version-resolver-*.test.ts`) — aucune logique de production. */

/** Version de test : `to` omis = intervalle ouvert. */
export function v(
  id: string,
  from?: string,
  to?: string,
  extra: Record<string, unknown> = {},
): SourceVersionRef {
  return {
    id,
    ...(from !== undefined ? { effectiveFrom: from } : {}),
    ...(to !== undefined ? { effectiveTo: to } : {}),
    ...extra,
  };
}

export function h(
  versions: readonly SourceVersionRef[],
  completeness: VersionCompleteness = 'unknown',
): VersionHistory {
  return { versions, completeness };
}

export const A = v('A', '2000-01-01', '2010-01-01');
export const B = v('B', '2010-01-01');

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * `RetrievalResult` réaliste, obtenu par le **vrai mapping** d'une sortie brute de `getArticle`
 * (mêmes conversions que `LegifranceRetrievalAdapter`) : `source` = version récupérée,
 * `versions` = `articleVersions` (avec `state`), aucune preuve d'exhaustivité.
 */
export function retrievalOf(raw: Record<string, unknown>): RetrievalResult {
  const { source, metadata, content } = mapLegifranceArticleToLegalSource(raw, {
    now: () => Date.parse('2026-09-23T18:00:00.000Z'),
  });
  return {
    source,
    content,
    versions: metadata.articleVersions.map((version) => ({
      id: version.id,
      ...(version.version !== undefined ? { version: version.version } : {}),
      ...(version.etat !== undefined ? { state: version.etat } : {}),
      ...(version.effectiveFrom !== undefined ? { effectiveFrom: version.effectiveFrom } : {}),
      ...(version.effectiveTo !== undefined ? { effectiveTo: version.effectiveTo } : {}),
    })),
    ...(metadata.versionPrecedente !== undefined
      ? { previousVersionId: metadata.versionPrecedente }
      : {}),
    reference: { ...SINGLE_CONTAINER_PAGE.references[0]!, candidateId: source.id },
  };
}

/** Résultat de récupération de version cible correspondant à un `RetrievalResult` (mêmes données, sans `reference`). */
export function targetOf(retrieval: RetrievalResult): VersionTargetResult {
  return {
    source: retrieval.source,
    versions: retrieval.versions,
    ...(retrieval.content !== undefined ? { content: retrieval.content } : {}),
    ...(retrieval.previousVersionId !== undefined
      ? { previousVersionId: retrieval.previousVersionId }
      : {}),
  };
}
