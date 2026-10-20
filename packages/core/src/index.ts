export type {
  LlmMessage,
  LlmAssistantToolCallMessage,
  LlmToolResultMessage,
  LlmConversationMessage,
  LlmToolDefinition,
  LlmChatOptions,
  LlmProvider,
  LlmResponse,
  LlmToolCall,
} from '@jarvis/llm';

export type {
  Provenance,
  ProvenanceOrigin,
  MemoryKind,
  MemoryEntry,
  MemoryListFilter,
  MemoryStore,
  MemoryQuery,
  MemorySelector,
  LexicalMemorySelectorOptions,
  MemoryCandidate,
  MemoryCandidateValidation,
  MemoryInteraction,
  MemoryExtractionResult,
  MemoryExtractor,
  MemoryExtractionModelCall,
  MemoryPromotionDecision,
  MemoryPromotionPolicy,
  DefaultMemoryPromotionPolicyOptions,
  MemoryPromotionOutcome,
  PromoteMemoryCandidateOptions,
  MemoryPromotionResult,
  MemoryPromoterOptions,
  MemoryConfirmationResult,
  PendingMemoryConfirmation,
} from '@jarvis/memory';
export {
  LexicalMemorySelector,
  resolveMemoryLineage,
  validateMemoryCandidate,
  parseMemoryExtraction,
  createLlmMemoryExtractor,
  buildMemoryExtractionUserPrompt,
  MEMORY_EXTRACTION_INSTRUCTIONS,
  MAX_MEMORY_CANDIDATES,
  createDefaultMemoryPromotionPolicy,
  createConservativeMemoryPromotionPolicy,
  promoteMemoryCandidate,
  MemoryPromoter,
} from '@jarvis/memory';

export * from './tool.js';
export * from './tool-registry.js';
export * from './permissions.js';
export * from './tool-executor.js';
export * from './verification.js';
export * from './agent-loop.js';

/**
 * @deprecated Ancien point d'entrée conservé uniquement pour la compatibilité
 * avec `apps/api`. Le moteur de conversation est désormais {@link AgentLoop},
 * qui reçoit explicitement un {@link LlmProvider}. À retirer lorsque `apps/api`
 * sera migré vers `AgentLoop`.
 */
export class JarvisCore {}
