import type {
  RetrievalRequest,
  RetrievalResult,
  VersionTargetRequest,
  VersionTargetResult,
} from './retrieval-types.js';
import type { SearchQuery, SearchReference, SearchResultPage } from './search-types.js';

/**
 * Ports du Research Engine — jalon LEGAL-03A (ADR-0015).
 *
 * Indépendants de tout fournisseur : les implémentations (Légifrance ou
 * autre) **dépendent de ces ports**, jamais l'inverse. Une implémentation
 * exécute ses actions **exclusivement** via `ToolExecutor` (`@jarvis/core`) —
 * jamais de `fetch`, de client HTTP, de `SecretStore` ni de `ConnectorRegistry`
 * (frontières ESLint de `@jarvis/legal-research`).
 */

/**
 * Raisons d'échec d'un port. Reprend fidèlement ce que `ToolExecutor` sait
 * distinguer (`ToolExecutionResult.status`), plus `malformed_response` pour
 * une sortie inexploitable. `ToolFailed.reason` étant une simple chaîne, un
 * échec technique (réseau, HTTP 4xx/5xx) reste `execution_error` : ces cas ne
 * sont pas distinguables tant que l'erreur n'est pas structurée (décision
 * ouverte, ADR-0015).
 */
export type ResearchProviderErrorReason =
  | 'unknown_tool'
  | 'invalid_request'
  | 'denied'
  | 'awaiting_confirmation'
  | 'execution_error'
  | 'malformed_response';

/** Échec d'un `SearchPort`/`RetrievalPort`. Ne contient jamais de secret ni le corps d'une réponse distante. */
export class ResearchProviderError extends Error {
  constructor(
    readonly providerId: string,
    readonly reason: ResearchProviderErrorReason,
    detail: string,
  ) {
    super(`${providerId} : ${detail}`);
    this.name = 'ResearchProviderError';
  }
}

/**
 * Découverte : transforme une requête en une page de références.
 *
 * Une page pagine des **résultats** du fournisseur, non des articles
 * (ADR-0011). L'implémentation ne déduplique pas silencieusement et ne
 * classe pas (pas de ranking propre) : elle expose l'ordre reçu.
 *
 * @throws {ResearchProviderError}
 */
export interface SearchPort {
  readonly providerId: string;
  search(query: SearchQuery): Promise<SearchResultPage>;
}

/**
 * Récupération : transforme une référence en `LegalSource` canonique.
 *
 * @throws {ResearchProviderError}
 */
export interface RetrievalPort {
  readonly providerId: string;
  /** `true` si ce port sait tenter de récupérer cette référence (ex. format d'identifiant reconnu). Pur, sans I/O. */
  canRetrieve(reference: SearchReference): boolean;
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;

  /**
   * Capacité **optionnelle** (ADR-0019) : récupérer directement une **version
   * cible** désignée par une résolution temporelle, sans `SearchReference`.
   * Un port qui n'implémente pas **les deux** méthodes ci-dessous est traité par
   * le moteur comme « cible non récupérable » (`not_retrievable`), sans appel.
   *
   * `true` si ce port sait tenter cette récupération (ex. format d'identifiant
   * reconnu). Pur, sans I/O.
   */
  canRetrieveVersion?(request: VersionTargetRequest): boolean;
  /**
   * Récupère la version demandée. Le moteur vérifie ensuite que la source reçue
   * est **exactement** celle demandée (`source.id`, `authority`, `identifier`).
   *
   * @throws {ResearchProviderError}
   */
  retrieveVersion?(request: VersionTargetRequest): Promise<VersionTargetResult>;
}
