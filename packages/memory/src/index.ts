/**
 * `@jarvis/memory` — fondation de la mémoire contrôlée de JARVIS.
 *
 * Package **feuille** : aucune dépendance `@jarvis/*` ni tierce (uniquement
 * des built-ins Node pour {@link FileMemoryStore}). Fournit une abstraction
 * simple et testable pour retenir des informations en distinguant leur
 * provenance ; il ne construit aucune base vectorielle, n'introduit aucune
 * base de données. La persistance se limite à un fichier JSON local versionné.
 */
export type { ProvenanceOrigin, Provenance, ProvenanceValidation } from './provenance.js';
export { PROVENANCE_ORIGINS, validateProvenance } from './provenance.js';

export type { MemoryKind, MemoryEntry, MemoryEntryInput } from './memory-entry.js';
export { MEMORY_KINDS } from './memory-entry.js';

export type { MemoryStore, MemoryListFilter } from './memory-store.js';
export { InMemoryMemoryStore } from './memory-store.js';

export type { FileMemoryStoreOptions } from './memory-file-store.js';
export { FileMemoryStore } from './memory-file-store.js';
export type { MemoryFileErrorReason } from './memory-file-format.js';
export {
  CURRENT_MEMORY_FILE_VERSION,
  MemoryFileError,
  parseMemoryFile,
  serializeMemoryFile,
} from './memory-file-format.js';

export { resolveMemoryLineage } from './memory-lineage.js';

export type { MemoryCandidate, MemoryCandidateValidation } from './memory-candidate.js';
export { validateMemoryCandidate } from './memory-candidate.js';

export type {
  MemoryPromotionDecision,
  MemoryPromotionPolicy,
  DefaultMemoryPromotionPolicyOptions,
  MemoryPromotionOutcome,
  PromoteMemoryCandidateOptions,
} from './memory-promotion.js';
export {
  createDefaultMemoryPromotionPolicy,
  createConservativeMemoryPromotionPolicy,
  promoteMemoryCandidate,
  DEFAULT_INSTRUCTION_LIKE_PATTERNS,
  DEFAULT_SENSITIVE_PATTERNS,
} from './memory-promotion.js';

export type {
  MemoryPromotionResult,
  MemoryPromoterOptions,
  MemoryConfirmationResult,
  PendingMemoryConfirmation,
} from './memory-promoter.js';
export { MemoryPromoter } from './memory-promoter.js';

export type {
  MemoryInteraction,
  MemoryExtractionResult,
  MemoryExtractor,
  MemoryExtractionModelCall,
} from './memory-extraction.js';
export {
  MAX_MEMORY_CANDIDATES,
  MAX_INTERACTION_EXCERPT_CHARS,
  MEMORY_EXTRACTION_INSTRUCTIONS,
  buildMemoryExtractionUserPrompt,
  parseMemoryExtraction,
  createLlmMemoryExtractor,
} from './memory-extraction.js';

export type {
  MemoryQuery,
  MemorySelector,
  LexicalMemorySelectorOptions,
} from './memory-selector.js';
export { LexicalMemorySelector, DEFAULT_MAX_MEMORY_ENTRIES } from './memory-selector.js';
