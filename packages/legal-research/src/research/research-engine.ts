import type { ResearchProviderErrorReason, RetrievalPort, SearchPort } from './ports.js';
import { ResearchProviderError } from './ports.js';
import type {
  ResearchBudget,
  ResearchCandidate,
  ResearchGap,
  ResearchRejection,
  ResearchRejectionReason,
  ResearchResult,
  ResearchSkippedItem,
} from './research-types.js';
import { identifierKey, referenceKey } from './source-key.js';
import type {
  ResolvedRetrieval,
  RetrievalResult,
  VersionTargetRequest,
  VersionTargetResult,
} from './retrieval-types.js';
import type { SearchQuery, SearchReference, SearchResultPage } from './search-types.js';
import type { VersionCompleteness, VersionResolution, VersionResolver } from './temporal-types.js';
import { assembleVersionHistory } from './version-history.js';
import { resolveVersion, versionResolver as defaultVersionResolver } from './version-resolver.js';

/**
 * Orchestrateur borné du Research Engine — jalon LEGAL-03B (ADR-0011,
 * ADR-0013, ADR-0016).
 *
 * Enchaîne, sans jamais dépasser le budget fourni :
 *
 *   SearchPort (pages) → agrégation → déduplication (`referenceKey`,
 *   toutes les occurrences conservées) → références non récupérables
 *   écartées → budget de candidats → RetrievalPort (budget de récupérations)
 *   → résolution de version (transitoire, voir ci-dessous) → `ResearchResult`.
 *
 * ## Résolution de version (raccordement transitoire, ADR-0018)
 * Si `query.asOf` est défini, les candidats **hydratés** sont regroupés par
 * article (`identifierKey`) ; pour chaque groupe l'historique est assemblé
 * (`assembleVersionHistory`, exhaustivité `unknown`) puis `VersionResolver` est
 * appelé **une fois** avec `query.asOf`. La `VersionResolution` est rattachée à
 * chaque candidat du groupe (`versionResolution`) :
 *
 *   - `resolved` / `indeterminate` : rattachée, aucun rejet ;
 *   - `none_applicable` : rattachée + rejet `no_applicable_version` (le candidat
 *     est conservé) — ne peut survenir que sur un historique déclaré `complete`,
 *     ce que ce moteur ne fait jamais par lui-même.
 *
 * ## Récupération de la version résolue (ADR-0019) — un seul saut
 * Pour chaque groupe `resolved`, le moteur obtient la source de la version
 * **résolue** et la rattache à chaque candidat du groupe (`resolvedRetrieval`,
 * mode explicite) sans jamais toucher `retrieval` (source initialement récupérée) :
 *
 *   - `initial`   : la version résolue est celle déjà récupérée par le candidat ;
 *   - `shared`    : elle l'a été pour un autre candidat du groupe (`source.id`) —
 *                   même objet, **aucun appel** ;
 *   - `retrieved` : sinon, **un** appel `RetrievalPort.retrieveVersion` par groupe,
 *                   sur le **même** `maxRetrievedSources` (aucune réservation,
 *                   aucun budget caché), après toutes les récupérations primaires.
 *
 * La source reçue doit être **exactement** la cible (`source.id`, `authority`,
 * `identifier` du groupe) ; sinon `retrieval_failed` / `malformed_response`,
 * jamais de rattachement approximatif. Cible non récupérable (capacité absente ou
 * refusée) → `not_retrievable` ; échec d'appel → `retrieval_failed` ; plus de
 * budget → `over_retrieval_budget` (aucun appel) ; chaque rejet porte
 * `targetVersionId`. Dans tous ces cas `resolvedRetrieval` reste absent et
 * `retrieval` n'est jamais présenté comme la version applicable.
 *
 * Aucun second saut : après la récupération cible, ni nouvel historique, ni
 * nouvel appel au resolver, ni nouvelle cible — même si `versions` du résultat
 * diffère. `indeterminate`, `none_applicable`, `asOf` absent : aucun saut.
 * `query.asOf` illisible pour le resolver : `RangeError` (avant tout appel
 * réseau), jamais converti en état.
 *
 * **Hors périmètre, volontairement** : ranking (l'ordre reçu est conservé),
 * planification de requête, `LegalResearchItem`/`LegalCitation`, contenu,
 * persistance, cache, retry, quotas.
 *
 * Aucun seuil implicite : le budget est obligatoire et validé.
 */

export interface ResearchEngineOptions {
  readonly search: SearchPort;
  readonly retrieval: RetrievalPort;
  /** Resolver temporel ; défaut : {@link defaultVersionResolver}. Injectable pour les tests. */
  readonly versionResolver?: VersionResolver;
  /**
   * Point d'extension pour une **future** preuve d'exhaustivité d'historique.
   * Défaut : toujours `unknown` — le moteur ne déduit jamais `complete` de lui-même
   * et n'expose aucune preuve dans ce jalon. Non renseigné en production.
   */
  readonly historyCompleteness?: (retrievals: readonly RetrievalResult[]) => VersionCompleteness;
}

interface Aggregated {
  readonly references: readonly SearchReference[];
  readonly skipped: readonly ResearchSkippedItem[];
  readonly resultCount: number;
  readonly unexposedArticleCount: number;
  /** Résultats du fournisseur non interrogés faute de budget de pages ; `undefined` si non mesurable, `0` si rien ne manque. */
  readonly unfetchedResults: number | undefined;
  readonly truncatedByPages: boolean;
}

function assertInteger(value: unknown, label: string, minimum: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `ResearchEngine : « ${label} » doit être un entier >= ${minimum} (aucun seuil implicite).`,
    );
  }
}

/** Le budget est obligatoire : aucune valeur par défaut n'existe (ADR-0016). */
function assertValidBudget(budget: ResearchBudget): void {
  assertInteger(budget?.maxSearchPages, 'budget.maxSearchPages', 1);
  assertInteger(budget?.maxCandidates, 'budget.maxCandidates', 0);
  assertInteger(budget?.maxRetrievedSources, 'budget.maxRetrievedSources', 0);
}

/**
 * Une page est la dernière si elle est vide, plus courte que demandée (forme
 * observée : la page 2 d'un total de 7 résultats contient 2 résultats pour
 * `pageSize` 5), ou si le total annoncé est atteint.
 */
function isLastPage(page: SearchResultPage, query: SearchQuery, pageNumber: number): boolean {
  const { resultCount, totalResults } = page.metadata;
  if (resultCount === 0 || resultCount < query.page.size) return true;
  return totalResults !== undefined && pageNumber * query.page.size >= totalResults;
}

async function collectPages(
  search: SearchPort,
  query: SearchQuery,
  maxPages: number,
): Promise<Aggregated> {
  const references: SearchReference[] = [];
  const skipped: ResearchSkippedItem[] = [];
  let resultCount = 0;
  let unexposedArticleCount = 0;
  let truncatedByPages = false;
  let unfetchedResults: number | undefined;

  for (let fetched = 0; fetched < maxPages; fetched += 1) {
    const pageNumber = query.page.number + fetched;
    const page = await search.search({
      ...query,
      page: { number: pageNumber, size: query.page.size },
    });

    references.push(...page.references);
    skipped.push(...page.skipped.map((item) => ({ ...item, page: pageNumber })));
    resultCount += page.metadata.resultCount;
    unexposedArticleCount += page.metadata.unexposedArticleCount ?? 0;

    if (isLastPage(page, query, pageNumber)) break;
    if (fetched === maxPages - 1) {
      truncatedByPages = true;
      const { totalResults } = page.metadata;
      unfetchedResults =
        totalResults === undefined
          ? undefined
          : Math.max(0, totalResults - pageNumber * query.page.size);
    }
  }

  return {
    references,
    skipped,
    resultCount,
    unexposedArticleCount,
    unfetchedResults,
    truncatedByPages,
  };
}

interface Deduplicated {
  readonly key: string;
  readonly reference: SearchReference;
  readonly sightings: SearchReference['provenance'][];
}

/** Première occurrence = référence du candidat ; toutes les occurrences (première incluse) = `sightings`, dans l'ordre reçu. */
function deduplicate(references: readonly SearchReference[]): Deduplicated[] {
  const byKey = new Map<string, Deduplicated>();
  for (const reference of references) {
    const key = referenceKey(reference);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { key, reference, sightings: [reference.provenance] });
    } else {
      existing.sightings.push(reference.provenance);
    }
  }
  return [...byKey.values()];
}

/**
 * Rattache la résolution de version aux candidats **hydratés**, un appel au
 * resolver par article (`identifierKey`). Pur : n'effectue aucun appel réseau,
 * ne modifie ni les candidats ni les `RetrievalResult` d'entrée (nouveaux objets).
 * Les candidats sans récupération (échec, budget) ne participent à aucun groupe
 * et ne reçoivent aucune résolution.
 */
function attachVersionResolutions(
  candidates: readonly ResearchCandidate[],
  asOf: string,
  resolver: VersionResolver,
  completenessOf: (retrievals: readonly RetrievalResult[]) => VersionCompleteness,
): { candidates: ResearchCandidate[]; rejections: ResearchRejection[] } {
  const groups = new Map<string, RetrievalResult[]>();
  for (const candidate of candidates) {
    if (candidate.retrieval === undefined) continue;
    const key = identifierKey(candidate.retrieval.source);
    groups.set(key, [...(groups.get(key) ?? []), candidate.retrieval]);
  }

  const resolutions = new Map<
    string,
    { resolution: VersionResolution; completeness: VersionCompleteness }
  >();
  for (const [key, retrievals] of groups) {
    const completeness = completenessOf(retrievals);
    resolutions.set(key, {
      resolution: resolver.resolve(assembleVersionHistory(retrievals, completeness), asOf),
      completeness,
    });
  }

  const rejections: ResearchRejection[] = [];
  const attached = candidates.map((candidate): ResearchCandidate => {
    if (candidate.retrieval === undefined) return candidate;
    const { resolution: versionResolution, completeness: historyCompleteness } = resolutions.get(
      identifierKey(candidate.retrieval.source),
    )!;
    if (versionResolution.status === 'none_applicable') {
      rejections.push({ reference: candidate.reference, reason: 'no_applicable_version' });
    }
    return { ...candidate, versionResolution, historyCompleteness };
  });
  return { candidates: attached, rejections };
}

type ResolvedResolution = Extract<VersionResolution, { readonly status: 'resolved' }>;

type VersionTargetPort = RetrievalPort &
  Required<Pick<RetrievalPort, 'canRetrieveVersion' | 'retrieveVersion'>>;

function supportsVersionTarget(port: RetrievalPort): port is VersionTargetPort {
  return port.canRetrieveVersion !== undefined && port.retrieveVersion !== undefined;
}

/** La source reçue est exactement la version demandée, du bon article et de la bonne autorité. */
function isRequestedVersion(result: VersionTargetResult, request: VersionTargetRequest): boolean {
  return (
    result.source.id === request.targetId &&
    result.source.authority === request.authority &&
    result.source.identifier === request.identifier
  );
}

/**
 * Obtient la source de la version **résolue** de chaque groupe (ADR-0019), un seul
 * saut au plus par groupe, dans l'ordre de première apparition. Ne rappelle jamais
 * le resolver et n'exploite jamais `versions` d'un résultat cible. Pur vis-à-vis de
 * ses entrées : renvoie de nouveaux candidats, ne modifie ni candidats ni résultats.
 * `remainingBudget` = récupérations encore permises sur `maxRetrievedSources`.
 */
async function attachResolvedRetrievals(
  candidates: readonly ResearchCandidate[],
  port: RetrievalPort,
  remainingBudget: number,
): Promise<{ candidates: ResearchCandidate[]; rejections: ResearchRejection[] }> {
  const groups = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    if (candidate.retrieval === undefined || candidate.versionResolution?.status !== 'resolved') {
      return;
    }
    const key = identifierKey(candidate.retrieval.source);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const obtained = new Map<number, ResolvedRetrieval>();
  const rejections: ResearchRejection[] = [];
  let remaining = remainingBudget;

  for (const indices of groups.values()) {
    const members = indices.map((index) => ({ index, candidate: candidates[index]! }));
    const { source: groupSource } = members[0]!.candidate.retrieval!;
    const resolution = members[0]!.candidate.versionResolution as ResolvedResolution;
    const request: VersionTargetRequest = {
      targetId: resolution.version.id,
      authority: groupSource.authority,
      identifier: groupSource.identifier,
    };

    const alreadyRetrieved = members
      .map((member) => member.candidate.retrieval!)
      .find((retrieval) => retrieval.source.id === request.targetId);
    if (alreadyRetrieved !== undefined) {
      for (const { index, candidate } of members) {
        const own = candidate.retrieval!;
        obtained.set(
          index,
          own.source.id === request.targetId
            ? { mode: 'initial', result: own }
            : { mode: 'shared', result: alreadyRetrieved },
        );
      }
      continue;
    }

    const reject = (
      reason: ResearchRejectionReason,
      errorReason?: ResearchProviderErrorReason,
    ): void => {
      for (const { candidate } of members) {
        rejections.push({
          reference: candidate.reference,
          reason,
          ...(errorReason !== undefined ? { errorReason } : {}),
          targetVersionId: request.targetId,
        });
      }
    };

    if (!supportsVersionTarget(port) || !port.canRetrieveVersion(request)) {
      reject('not_retrievable');
      continue;
    }
    if (remaining <= 0) {
      reject('over_retrieval_budget');
      continue;
    }
    remaining -= 1;

    let result: VersionTargetResult;
    try {
      result = await port.retrieveVersion(request);
    } catch (error) {
      if (!(error instanceof ResearchProviderError)) throw error;
      reject('retrieval_failed', error.reason);
      continue;
    }
    if (!isRequestedVersion(result, request)) {
      reject('retrieval_failed', 'malformed_response');
      continue;
    }
    for (const { index } of members) obtained.set(index, { mode: 'retrieved', result });
  }

  return {
    candidates: candidates.map((candidate, index) => {
      const resolvedRetrieval = obtained.get(index);
      return resolvedRetrieval === undefined ? candidate : { ...candidate, resolvedRetrieval };
    }),
    rejections,
  };
}

const ALWAYS_UNKNOWN = (): VersionCompleteness => 'unknown';

export class ResearchEngine {
  private readonly search: SearchPort;
  private readonly retrieval: RetrievalPort;
  private readonly versionResolver: VersionResolver;
  private readonly historyCompleteness: (
    retrievals: readonly RetrievalResult[],
  ) => VersionCompleteness;

  constructor(options: ResearchEngineOptions) {
    this.search = options.search;
    this.retrieval = options.retrieval;
    this.versionResolver = options.versionResolver ?? defaultVersionResolver;
    this.historyCompleteness = options.historyCompleteness ?? ALWAYS_UNKNOWN;
  }

  /**
   * @throws {RangeError} si le budget ou la pagination de la requête est invalide,
   *   ou si `query.asOf` est défini mais illisible pour le resolver (vérifié
   *   **avant** tout appel réseau ; jamais converti en état juridique).
   * @throws {ResearchProviderError} si `SearchPort.search` échoue : une recherche
   *   qui échoue n'est pas un résultat vide, l'erreur reste visible.
   *
   * Un échec de `RetrievalPort.retrieve` n'interrompt pas la recherche : il
   * devient un `ResearchRejection` `retrieval_failed` (et consomme du budget,
   * puisqu'il est un appel). Toute autre exception est propagée.
   */
  async research(query: SearchQuery, budget: ResearchBudget): Promise<ResearchResult> {
    assertValidBudget(budget);
    assertInteger(query.page.number, 'query.page.number', 1);
    assertInteger(query.page.size, 'query.page.size', 1);
    // Validation d'`asOf` selon la règle du resolver (une liste vide est un cas valide qui ne résout rien) :
    // lève `RangeError` avant de dépenser le moindre appel réseau. N'est pas une résolution.
    if (query.asOf !== undefined)
      resolveVersion({ versions: [], completeness: 'unknown' }, query.asOf);

    const rejections: ResearchRejection[] = [];
    const gaps: ResearchGap[] = [];

    const aggregated = await collectPages(this.search, query, budget.maxSearchPages);
    if (aggregated.resultCount === 0) gaps.push({ kind: 'no_search_result' });
    if (aggregated.unexposedArticleCount > 0) {
      gaps.push({ kind: 'unexposed_articles', count: aggregated.unexposedArticleCount });
    }
    if (aggregated.truncatedByPages) {
      gaps.push({
        kind: 'budget_truncated',
        budget: 'maxSearchPages',
        ...(aggregated.unfetchedResults !== undefined
          ? { count: aggregated.unfetchedResults }
          : {}),
      });
    }

    // Références que le port ne saura pas récupérer : écartées avant de consommer du budget.
    const retrievable: Deduplicated[] = [];
    for (const entry of deduplicate(aggregated.references)) {
      if (this.retrieval.canRetrieve(entry.reference)) retrievable.push(entry);
      else rejections.push({ reference: entry.reference, reason: 'not_retrievable' });
    }

    const kept = retrievable.slice(0, budget.maxCandidates);
    for (const dropped of retrievable.slice(budget.maxCandidates)) {
      rejections.push({ reference: dropped.reference, reason: 'over_candidate_budget' });
    }
    if (retrievable.length > kept.length) {
      gaps.push({
        kind: 'budget_truncated',
        budget: 'maxCandidates',
        count: retrievable.length - kept.length,
      });
    }

    const candidates: ResearchCandidate[] = [];
    let attempts = 0;
    for (const entry of kept) {
      const base = { reference: entry.reference, sightings: entry.sightings };
      if (attempts >= budget.maxRetrievedSources) {
        rejections.push({ reference: entry.reference, reason: 'over_retrieval_budget' });
        candidates.push(base);
        continue;
      }
      attempts += 1;
      try {
        const retrieval = await this.retrieval.retrieve({ reference: entry.reference });
        candidates.push({ ...base, retrieval });
      } catch (error) {
        if (!(error instanceof ResearchProviderError)) throw error;
        const errorReason: ResearchProviderErrorReason = error.reason;
        rejections.push({ reference: entry.reference, reason: 'retrieval_failed', errorReason });
        candidates.push(base);
      }
    }
    if (kept.length > attempts) {
      gaps.push({
        kind: 'budget_truncated',
        budget: 'maxRetrievedSources',
        count: kept.length - attempts,
      });
    }

    const resolved =
      query.asOf === undefined
        ? { candidates, rejections: [] as ResearchRejection[] }
        : attachVersionResolutions(
            candidates,
            query.asOf,
            this.versionResolver,
            this.historyCompleteness,
          );

    // Un seul saut, sur le même budget : ce qui reste après les récupérations primaires (aucune réservation).
    const targeted = await attachResolvedRetrievals(
      resolved.candidates,
      this.retrieval,
      budget.maxRetrievedSources - attempts,
    );

    return {
      query,
      budget,
      candidates: targeted.candidates,
      rejections: [...rejections, ...resolved.rejections, ...targeted.rejections],
      gaps,
      skipped: aggregated.skipped,
    };
  }
}
