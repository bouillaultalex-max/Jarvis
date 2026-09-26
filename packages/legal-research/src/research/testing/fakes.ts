import type { RetrievalPort, SearchPort } from '../ports.js';
import { ResearchProviderError } from '../ports.js';
import type {
  RetrievalRequest,
  RetrievalResult,
  VersionTargetRequest,
  VersionTargetResult,
} from '../retrieval-types.js';
import type { SearchQuery, SearchReference, SearchResultPage } from '../search-types.js';

/**
 * Fakes de test des ports — LEGAL-03A. Aucun réseau, aucun `ToolExecutor` :
 * ils servent à éprouver les contrats et, plus tard, l'orchestrateur
 * (LEGAL-03B) sans jamais appeler un fournisseur réel. Volontairement
 * **non exportés** de `index.ts` : outil de test, pas surface publique.
 */

export class FakeSearchPort implements SearchPort {
  readonly providerId: string;
  /** Requêtes reçues, dans l'ordre — permet de vérifier ce que l'appelant a émis. */
  readonly queries: SearchQuery[] = [];
  private readonly failWith: ResearchProviderError | undefined;

  constructor(
    private readonly pagesByNumber: Readonly<Record<number, SearchResultPage>>,
    options: { providerId?: string; failWith?: ResearchProviderError } = {},
  ) {
    this.providerId = options.providerId ?? 'fake';
    this.failWith = options.failWith;
  }

  async search(query: SearchQuery): Promise<SearchResultPage> {
    this.queries.push(query);
    if (this.failWith !== undefined) throw this.failWith;
    const page = this.pagesByNumber[query.page.number];
    if (page === undefined) {
      return {
        references: [],
        skipped: [],
        metadata: { page: query.page.number, pageSize: query.page.size, resultCount: 0 },
      };
    }
    return page;
  }
}

export class FakeRetrievalPort implements RetrievalPort {
  readonly providerId: string;
  /** Identifiants effectivement récupérés, dans l'ordre — permet de vérifier le budget. */
  readonly retrieved: string[] = [];
  /** Identifiants de versions cibles effectivement demandés (`retrieveVersion`), dans l'ordre. */
  readonly retrievedVersions: string[] = [];
  /** Demandes de version cible reçues, telles quelles. */
  readonly versionRequests: VersionTargetRequest[] = [];
  /** Définies **seulement** si `options.versionTargets` est fourni : sinon la capacité optionnelle est absente. */
  canRetrieveVersion?: (request: VersionTargetRequest) => boolean;
  retrieveVersion?: (request: VersionTargetRequest) => Promise<VersionTargetResult>;

  constructor(
    private readonly resultsByCandidateId: Readonly<
      Record<string, RetrievalResult | ResearchProviderError>
    >,
    options: {
      providerId?: string;
      versionTargets?: Readonly<Record<string, VersionTargetResult | ResearchProviderError>>;
    } = {},
  ) {
    this.providerId = options.providerId ?? 'fake';
    const targets = options.versionTargets;
    if (targets !== undefined) {
      this.canRetrieveVersion = (request) => request.targetId in targets;
      this.retrieveVersion = async (request) => {
        this.retrievedVersions.push(request.targetId);
        this.versionRequests.push(request);
        const outcome = targets[request.targetId];
        if (outcome === undefined) {
          throw new ResearchProviderError(
            this.providerId,
            'invalid_request',
            `version non récupérable « ${request.targetId} ».`,
          );
        }
        if (outcome instanceof ResearchProviderError) throw outcome;
        return outcome;
      };
    }
  }

  canRetrieve(reference: SearchReference): boolean {
    return reference.candidateId in this.resultsByCandidateId;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const id = request.reference.candidateId;
    this.retrieved.push(id);
    const outcome = this.resultsByCandidateId[id];
    if (outcome === undefined) {
      throw new ResearchProviderError(
        this.providerId,
        'invalid_request',
        `identifiant non récupérable « ${id} ».`,
      );
    }
    if (outcome instanceof ResearchProviderError) throw outcome;
    return outcome;
  }
}
