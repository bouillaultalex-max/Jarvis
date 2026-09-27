export type {
  LegifranceMappingErrorReason,
  LegifranceArticleVersionInfo,
  LegifranceArticleMetadata,
  MapLegifranceArticleResult,
  MapLegifranceArticleOptions,
} from './legifrance-source-mapping.js';
export {
  LegifranceMappingError,
  LEGIFRANCE_NO_BOUND_SENTINEL_MS,
  mapLegifranceArticleToLegalSource,
} from './legifrance-source-mapping.js';

export type {
  LegalSourceProvider,
  LegifranceProviderErrorReason,
  LegifranceSourceProviderOptions,
} from './legifrance-source-provider.js';
export { LegifranceProviderError, LegifranceSourceProvider } from './legifrance-source-provider.js';

export type {
  SearchMatchMode,
  SearchField,
  SearchPageRequest,
  SearchQuery,
  SearchProvenance,
  SearchReference,
  SearchSkipReason,
  SearchSkippedItem,
  SearchMetadata,
  SearchResultPage,
} from './research/search-types.js';

export type {
  RetrievalRequest,
  RetrievalResult,
  VersionTargetRequest,
  VersionTargetResult,
  ResolvedRetrieval,
  ResolvedRetrievalMode,
} from './research/retrieval-types.js';

export type {
  EffectivePeriod,
  SourceVersionRef,
  NoApplicableVersionReason,
  VersionCompleteness,
  VersionHistory,
  IndeterminateVersionReason,
  VersionResolution,
  VersionResolver,
} from './research/temporal-types.js';
export { resolveVersion, versionResolver } from './research/version-resolver.js';

export type { ResearchProviderErrorReason, SearchPort, RetrievalPort } from './research/ports.js';
export { ResearchProviderError } from './research/ports.js';

export type {
  ResearchBudget,
  ResearchCandidate,
  ResearchRejectionReason,
  ResearchRejection,
  ResearchGapKind,
  ResearchGap,
  ResearchSkippedItem,
  ResearchResult,
} from './research/research-types.js';

export { referenceKey, sourceKey, identifierKey } from './research/source-key.js';
export { assembleVersionHistory } from './research/version-history.js';

export { computeContentHash, verifyContentHash } from './research/content-hash.js';
export type { ContentIntegrityReason } from './research/retrieved-content.js';
export { ContentIntegrityError, RetrievedContent } from './research/retrieved-content.js';

export type {
  CitationIneligibleReason,
  CitationIneligibleCandidate,
  CitationProjection,
} from './research/citation-projection.js';
export { projectCitations } from './research/citation-projection.js';

export { projectResearchItem } from './research/research-item-projection.js';

export type { ResearchEngineOptions } from './research/research-engine.js';
export { ResearchEngine } from './research/research-engine.js';

export type { ParseLegifranceSearchContext } from './legifrance-search-parser.js';
export {
  parseLegifranceSearchOutput,
  LEGIFRANCE_PROVIDER_ID,
  LEGIFRANCE_SEARCH_COLLECTION,
} from './legifrance-search-parser.js';
export type { LegifranceSearchAdapterOptions } from './legifrance-search-adapter.js';
export { LegifranceSearchAdapter } from './legifrance-search-adapter.js';
export type { LegifranceRetrievalAdapterOptions } from './legifrance-retrieval-adapter.js';
export { LegifranceRetrievalAdapter } from './legifrance-retrieval-adapter.js';
