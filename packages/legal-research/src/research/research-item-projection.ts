import { createHash } from 'node:crypto';

import type { LegalCitation, LegalQuestion, LegalResearchItem } from '@jarvis/legal-core';

import type { ResearchResult } from './research-types.js';

/**
 * Projection **pure** d'un `ResearchResult` (et des citations déjà produites
 * pour une question par `projectCitations`, ADR-0020) vers un
 * {@link LegalResearchItem} — LEGAL-RESEARCH-ITEM-01.
 *
 * Ne rappelle ni `SearchPort`, ni `RetrievalPort`, ni le resolver, ni
 * `ToolExecutor`, ni `projectCitations` elle-même : tout vient de `result` et
 * de `citations`, déjà calculées. Aucun réseau, aucun LLM, aucune horloge,
 * aucune mutation de l'entrée ; déterministe et idempotente (deux appels sur
 * les mêmes entrées donnent des valeurs égales).
 *
 * ## Ce que produit cette projection — et ce qu'elle n'affirme pas
 * `topic` est le texte de recherche tel quel (`result.query.text`), jamais
 * reformulé. `summary` est un **inventaire mécanique** des citations fournies
 * (identité de source + version, jamais un jugement) : voir
 * {@link buildMechanicalSummary}. Comme pour `projectCitations` (ADR-0020),
 * rien ici n'affirme qu'une source est *pertinente* pour la question, qu'elle
 * *soutient* une affirmation, ni ce que dit son texte — ces jugements
 * appartiennent à ANALYZE. Les trois notions déjà distinguées par ADR-0020
 * (retrouvée / applicable / éligible) ne sont pas redéfinies ici : cette
 * fonction ne reçoit que des citations déjà éligibles, elle ne recalcule rien.
 *
 * ## Entrées : uniquement ce qui est déjà disponible
 * `citations` ne porte que `sourceId`/`sourceVersion`/`pinpoint`/`contentHash`
 * (jamais un titre de source lisible) : `LegalSource` n'est volontairement pas
 * un paramètre de cette fonction. Le résumé mécanique s'en tient donc à ces
 * champs — jamais une information absente des objets d'entrée.
 *
 * ## Absence de résultat éligible
 * Si `citations` est vide, retourne `undefined` : jamais un item avec
 * `citationIds: []` fabriqué pour tracer une recherche infructueuse.
 */
export function projectResearchItem(
  result: ResearchResult,
  question: Pick<LegalQuestion, 'id'>,
  citations: readonly LegalCitation[],
): LegalResearchItem | undefined {
  if (typeof question?.id !== 'string' || question.id.trim().length === 0) {
    throw new RangeError('projectResearchItem : « question.id » doit être une chaîne non vide.');
  }
  if (citations.length === 0) return undefined;

  const citationIds = [...new Set(citations.map((citation) => citation.id))].sort();
  const byId = new Map(citations.map((citation) => [citation.id, citation] as const));
  const orderedCitations = citationIds.map((id) => byId.get(id)!);

  return {
    id: researchItemId(question.id, result.query.text, result.query.asOf, citationIds),
    topic: result.query.text,
    summary: buildMechanicalSummary(orderedCitations),
    citationIds,
    questionId: question.id,
  };
}

/**
 * Inventaire mécanique et neutre des citations fournies, dans leur ordre déjà
 * canonique (`citationIds` trié). Un seul format, jamais varié : `N
 * citation(s) éligible(s) : <sourceId> (version <sourceVersion>[, <pinpoint>])
 * ; …`. N'utilise que des champs présents sur `LegalCitation` — jamais un
 * `LegalSource.title`/`reference` (non fourni à cette fonction).
 */
function buildMechanicalSummary(citations: readonly LegalCitation[]): string {
  const entries = citations.map((citation) => {
    const pinpointSuffix = citation.pinpoint !== undefined ? `, ${citation.pinpoint}` : '';
    return `${citation.sourceId} (version ${citation.sourceVersion}${pinpointSuffix})`;
  });
  return `${citations.length} citation(s) éligible(s) : ${entries.join(' ; ')}.`;
}

/**
 * Empreinte déterministe (SHA-256, mêmes conventions que `citationId` dans
 * `citation-projection.ts`) de `(questionId, texte de requête, asOf,
 * citationIds triés)`. Rejouer la même recherche pour la même question
 * redonne le même `id`, indépendamment de l'ordre incident des citations.
 */
function researchItemId(
  questionId: string,
  queryText: string,
  asOf: string | undefined,
  sortedCitationIds: readonly string[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([questionId, queryText, asOf ?? null, sortedCitationIds]))
    .digest('hex');
  return `ri-${digest.slice(0, 32)}`;
}
