import type { ResearchProviderErrorReason } from './ports.js';
import type { ResolvedRetrieval, RetrievalResult } from './retrieval-types.js';
import type {
  SearchProvenance,
  SearchQuery,
  SearchReference,
  SearchSkippedItem,
} from './search-types.js';
import type { VersionCompleteness, VersionResolution } from './temporal-types.js';

/**
 * Types du résultat d'une recherche — jalon LEGAL-03A (ADR-0013, ADR-0016).
 *
 * Décrivent ce qu'un futur orchestrateur devra produire ; aucun orchestrateur
 * n'existe encore (LEGAL-03B). Un `ResearchResult` **ne contient ni argument
 * ni conclusion** : il s'arrête avant l'étape ANALYZE.
 */

/**
 * Budget d'une recherche : empêche `Search → centaines de résultats →
 * centaines de getArticle`. **Aucune valeur par défaut n'est fixée ici** :
 * choisir des seuils sans mesure serait arbitraire (ADR-0016). Un budget est
 * toujours fourni explicitement par l'appelant.
 */
export interface ResearchBudget {
  /** Nombre maximal de pages de recherche interrogées. */
  readonly maxSearchPages: number;
  /** Nombre maximal de candidats (références dédupliquées) conservés. */
  readonly maxCandidates: number;
  /** Nombre maximal de récupérations (`RetrievalPort.retrieve`) effectuées. */
  readonly maxRetrievedSources: number;
}

/**
 * Candidat retenu après déduplication par `referenceKey` (ADR-0013).
 * `sightings` conserve **toutes** les occurrences (première incluse) pour
 * pouvoir expliquer pourquoi le candidat a été retenu.
 */
export interface ResearchCandidate {
  readonly reference: SearchReference;
  readonly sightings: readonly SearchProvenance[];
  /**
   * Source **initialement récupérée** pour ce candidat. Présent seulement si le
   * candidat a été hydraté (dans la limite du budget). Jamais remplacée par la
   * version résolue : voir `resolvedRetrieval`.
   */
  readonly retrieval?: RetrievalResult;
  /**
   * Résolution de version de l'article de ce candidat à `query.asOf` (transitoire,
   * jamais persistée). Présente seulement si le candidat a été hydraté **et**
   * que `query.asOf` est défini ; **identique pour tous les candidats d'un même
   * article** (même `authority` + `identifier`). Si `resolved.version.id` diffère
   * de `retrieval.source.id`, la version résolue est celle de `resolvedRetrieval`
   * (jamais `retrieval`), quand elle a pu être obtenue.
   */
  readonly versionResolution?: VersionResolution;
  /**
   * Exhaustivité **déclarée** de l'historique sur lequel `versionResolution` a été
   * calculée (ADR-0020). Consigne ce que le moteur a réellement fourni au resolver
   * — `unknown` tant qu'aucune preuve d'exhaustivité n'existe (toujours le cas en
   * production). Présente si et seulement si `versionResolution` l'est ; identique
   * pour tous les candidats d'un même article. Un `resolved` sur `unknown` reste
   * une résolution « au mieux » ; absente, elle se lit `unknown`, jamais `complete`.
   */
  readonly historyCompleteness?: VersionCompleteness;
  /**
   * Source correspondant à la version **résolue** (ADR-0019), avec son mode
   * d'obtention explicite (`initial` | `shared` | `retrieved`). Présente si et
   * seulement si `versionResolution.status === 'resolved'` **et** que la source
   * de cette version est disponible. Absente sinon : `indeterminate`,
   * `none_applicable`, `asOf` absent, échec de la récupération cible, budget
   * épuisé (un rejet l'explique alors). Sur un historique `unknown`, « résolue »
   * reste « au mieux » : ce champ n'est pas une preuve d'exhaustivité.
   * Provenance transitoire, jamais persistée.
   */
  readonly resolvedRetrieval?: ResolvedRetrieval;
}

/** Raisons pour lesquelles une référence n'est pas devenue une source récupérée. */
export type ResearchRejectionReason =
  | 'duplicate_reference'
  | 'not_retrievable'
  | 'over_candidate_budget'
  | 'over_retrieval_budget'
  | 'retrieval_failed'
  | 'no_applicable_version';

/** Référence écartée, avec sa raison — jamais silencieusement. */
export interface ResearchRejection {
  readonly reference: SearchReference;
  readonly reason: ResearchRejectionReason;
  /** Présent pour `retrieval_failed`. */
  readonly errorReason?: ResearchProviderErrorReason;
  /**
   * Présent quand le rejet concerne la récupération d'une **version cible**
   * (ADR-0019) : identité de la version résolue visée. Absent pour un rejet de
   * récupération primaire ou de résolution. `reference` reste celle du candidat.
   */
  readonly targetVersionId?: string;
}

/**
 * Lacune de recherche : ce que la recherche n'a **pas** pu établir. Alimente
 * la règle de doute (`LEGAL_SPECIFICATION.md` §4) : une lacune n'est jamais
 * omise ni transformée en conclusion.
 */
export type ResearchGapKind =
  'no_search_result' | 'unexposed_articles' | 'budget_truncated' | 'no_applicable_version';

export interface ResearchGap {
  readonly kind: ResearchGapKind;
  /** Ampleur, si mesurable — dans l'unité de la lacune (voir `budget`). */
  readonly count?: number;
  /**
   * Pour `budget_truncated` : la borne du budget qui a coupé la recherche.
   * `count` est alors exprimé dans son unité — résultats non interrogés
   * (`maxSearchPages`), candidats non retenus (`maxCandidates`) ou
   * candidats non récupérés (`maxRetrievedSources`).
   */
  readonly budget?: keyof ResearchBudget;
}

/** Élément de recherche écarté par le `SearchPort`, avec la page d'où il provient. */
export interface ResearchSkippedItem extends SearchSkippedItem {
  readonly page: number;
}

export interface ResearchResult {
  readonly query: SearchQuery;
  readonly budget: ResearchBudget;
  readonly candidates: readonly ResearchCandidate[];
  readonly rejections: readonly ResearchRejection[];
  readonly gaps: readonly ResearchGap[];
  /** Éléments de recherche inexploitables : jamais perdus en silence (ne sont pas des références, donc pas des rejets). */
  readonly skipped: readonly ResearchSkippedItem[];
}
