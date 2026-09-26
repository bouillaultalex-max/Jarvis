import { createHash } from 'node:crypto';

import {
  validateSource,
  type LegalCitation,
  type LegalQuestion,
  type LegalSource,
} from '@jarvis/legal-core';

import type { ResearchCandidate, ResearchResult } from './research-types.js';
import type { SearchReference } from './search-types.js';
import { identifierKey, sourceKey } from './source-key.js';
import type { VersionCompleteness } from './temporal-types.js';

/**
 * Projection **pure** d'un `ResearchResult` vers des sources et citations **de
 * niveau source** — ADR-0020.
 *
 * Ne rappelle ni `SearchPort`, ni `RetrievalPort`, ni le resolver, ni
 * `ToolExecutor` : tout vient du `ResearchResult` (et de l'`id` de la question).
 * Aucun réseau, aucun LLM, aucune horloge, aucune mutation de l'entrée ;
 * déterministe et idempotente (deux appels donnent des valeurs égales).
 *
 * ## Ce que la projection établit — et ce qu'elle n'établit pas
 * Trois notions restent **distinctes** :
 *   - *retrouvée* : une source a été récupérée ;
 *   - *applicable* : la résolution temporelle l'a désignée pour `query.asOf` ;
 *   - *éligible à la citation* = retrouvée **et** applicable, vérifiée
 *     structurellement (règle ci-dessous).
 * Elle **n'établit pas** la pertinence pour la question, ni qu'une source
 * soutienne une affirmation, ni ce que dit son texte (le texte n'est pas
 * disponible ici) : ces jugements appartiennent à ANALYZE. Aucun classement,
 * aucun score.
 *
 * ## Règle d'éligibilité (déterministe)
 * Un candidat est éligible si et seulement si :
 *   1. il a été hydraté (`retrieval`) ;
 *   2. il porte une `versionResolution` de statut `resolved` (donc `query.asOf`
 *      défini — jamais remplacé par une date implicite) ;
 *   3. il porte un `resolvedRetrieval` ;
 *   4. la source de ce `resolvedRetrieval` est valide (`validateSource`) **et**
 *      cohérente : `source.id` = version résolue, même `authority` et même
 *      `identifier` que la source initialement récupérée et que la référence.
 * `indeterminate`, `none_applicable`, échec de récupération, budget épuisé, cible
 * non récupérable : jamais de citation — l'explication reste dans le
 * `ResearchResult` (`rejections`, `gaps`, `skipped`), que la projection ne
 * reprend pas dans le dossier.
 *
 * ## Incertitude historique
 * `resolved` sur un historique `unknown` reste éligible mais l'incertitude est
 * **conservée** dans `eligibility.historyCompleteness`. La valeur vient de
 * `ResearchCandidate.historyCompleteness` ; absente, elle se lit `unknown`
 * (jamais `complete` par défaut). Dans un groupe dédupliqué, `complete` exige que
 * tous les candidats le déclarent.
 *
 * ## Déduplication
 * Par identité logique `authority` + `identifier` + `version` (`sourceKey`) :
 * plusieurs candidats, sources d'`id` distincts ou `consultedAt` différents
 * donnent **une** source et **une** citation. La source retenue est la plus
 * anciennement consultée (à égalité, l'`id` le plus petit) — indépendante de
 * l'ordre des candidats. Deux empreintes de contenu différentes pour une même
 * identité logique sont une contradiction : aucune citation (`conflicting_source_content`).
 *
 * L'`id` d'une citation est déterministe : empreinte de (question, `asOf`,
 * identité logique). Une même affirmation « cette version est applicable à `asOf`
 * pour cette question » redonne le même `id` (idempotence du rattachement) ; une
 * autre question ou un autre `asOf` en donne un autre.
 *
 * Sortie dans l'ordre de première apparition des candidats. Aucun
 * `LegalResearchItem`, aucun `pinpoint`, aucun `quotedText`.
 */

/** Raison pour laquelle un candidat n'a produit aucune citation. Résumé, pas un journal technique. */
export type CitationIneligibleReason =
  | 'no_retrieval'
  | 'no_version_resolution'
  | 'indeterminate'
  | 'none_applicable'
  | 'no_resolved_retrieval'
  | 'invalid_resolved_retrieval'
  | 'conflicting_source_content';

export interface CitationIneligibleCandidate {
  readonly reference: SearchReference;
  readonly reason: CitationIneligibleReason;
}

export interface CitationProjection {
  /** Une source par identité logique, dans l'ordre de première apparition. */
  readonly sources: readonly LegalSource[];
  /** Une citation de niveau source par identité logique, même ordre. */
  readonly citations: readonly LegalCitation[];
  /** Candidats sans citation, dans l'ordre reçu, chacun avec sa raison. Jamais inséré dans un dossier. */
  readonly ineligible: readonly CitationIneligibleCandidate[];
}

interface EligibleEntry {
  readonly candidate: ResearchCandidate;
  readonly source: LegalSource;
  readonly completeness: VersionCompleteness;
}

type Outcome =
  | { readonly kind: 'eligible'; readonly entry: EligibleEntry }
  | { readonly kind: 'ineligible'; readonly reason: CitationIneligibleReason };

const ineligible = (reason: CitationIneligibleReason): Outcome => ({ kind: 'ineligible', reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Source du `resolvedRetrieval`, lue défensivement : la donnée est traitée comme non fiable. */
function resolvedSourceOf(candidate: ResearchCandidate): unknown {
  const result: unknown = (candidate.resolvedRetrieval as unknown as Record<string, unknown>)
    ?.result;
  return isRecord(result) ? result.source : undefined;
}

function classify(candidate: ResearchCandidate, asOf: string | undefined): Outcome {
  if (candidate.retrieval === undefined) return ineligible('no_retrieval');
  const resolution = candidate.versionResolution;
  if (resolution === undefined) return ineligible('no_version_resolution');
  if (resolution.status === 'indeterminate') return ineligible('indeterminate');
  if (resolution.status === 'none_applicable') return ineligible('none_applicable');
  if (candidate.resolvedRetrieval === undefined) return ineligible('no_resolved_retrieval');

  const source = resolvedSourceOf(candidate);
  const initial: unknown = candidate.retrieval.source;
  if (
    asOf === undefined ||
    !Number.isFinite(Date.parse(asOf)) ||
    !validateSource(source, 'source').ok ||
    !isRecord(initial)
  ) {
    return ineligible('invalid_resolved_retrieval');
  }

  const resolved = source as LegalSource;
  const initialSource = initial as unknown as LegalSource;
  const coherent =
    resolved.id === resolution.version.id &&
    identifierKey(resolved) === identifierKey(initialSource) &&
    resolved.authority === candidate.reference.authority;
  if (!coherent) return ineligible('invalid_resolved_retrieval');

  return {
    kind: 'eligible',
    entry: {
      candidate,
      source: resolved,
      // Jamais `complete` par défaut : seule une déclaration explicite compte.
      completeness: candidate.historyCompleteness === 'complete' ? 'complete' : 'unknown',
    },
  };
}

function consultedAtMs(source: LegalSource): number {
  return Date.parse(source.consultedAt);
}

/** Source la plus anciennement consultée ; à égalité, `id` le plus petit — indépendant de l'ordre d'entrée. */
function canonicalSource(entries: readonly EligibleEntry[]): LegalSource {
  return entries
    .map((entry) => entry.source)
    .reduce((best, source) => {
      const delta = consultedAtMs(source) - consultedAtMs(best);
      if (delta !== 0) return delta < 0 ? source : best;
      return source.id < best.id ? source : best;
    });
}

function citationId(questionId: string, asOf: string, source: LegalSource): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([questionId, asOf, source.authority, source.identifier, source.version]))
    .digest('hex');
  return `cit-${digest.slice(0, 32)}`;
}

/**
 * @throws {RangeError} si `question.id` est vide (erreur de l'appelant : une
 *   citation doit toujours désigner sa question d'origine).
 */
export function projectCitations(
  result: ResearchResult,
  question: Pick<LegalQuestion, 'id'>,
): CitationProjection {
  if (typeof question?.id !== 'string' || question.id.trim().length === 0) {
    throw new RangeError('projectCitations : « question.id » doit être une chaîne non vide.');
  }
  const asOf = result.query.asOf;

  const outcomes = result.candidates.map((candidate) => classify(candidate, asOf));

  const groups = new Map<string, EligibleEntry[]>();
  for (const outcome of outcomes) {
    if (outcome.kind !== 'eligible') continue;
    const key = sourceKey(outcome.entry.source);
    groups.set(key, [...(groups.get(key) ?? []), outcome.entry]);
  }

  const sources: LegalSource[] = [];
  const citations: LegalCitation[] = [];
  const conflicting = new Set<ResearchCandidate>();

  for (const entries of groups.values()) {
    const hashes = new Set(
      entries.flatMap((e) => (e.source.contentHash ? [e.source.contentHash] : [])),
    );
    if (hashes.size > 1) {
      for (const entry of entries) conflicting.add(entry.candidate);
      continue;
    }

    const source = canonicalSource(entries);
    sources.push(source);
    citations.push({
      id: citationId(question.id, asOf!, source),
      sourceId: source.id,
      sourceVersion: source.version,
      ...(source.contentHash !== undefined ? { contentHash: source.contentHash } : {}),
      consultedAt: source.consultedAt,
      eligibility: {
        questionId: question.id,
        asOf: asOf!,
        resolution: 'resolved',
        historyCompleteness: entries.every((e) => e.completeness === 'complete')
          ? 'complete'
          : 'unknown',
      },
    });
  }

  const skipped: CitationIneligibleCandidate[] = [];
  result.candidates.forEach((candidate, index) => {
    const outcome = outcomes[index]!;
    if (outcome.kind === 'ineligible') {
      skipped.push({ reference: candidate.reference, reason: outcome.reason });
    } else if (conflicting.has(candidate)) {
      skipped.push({ reference: candidate.reference, reason: 'conflicting_source_content' });
    }
  });

  return { sources, citations, ineligible: skipped };
}
