export type {
  LegalJurisdiction,
  LegalCaseStatus,
  LegalQuestion,
  LegalSourceType,
  LegalSourceAuthority,
  LegalSourceReliability,
  LegalSource,
  LegalCitation,
  LegalHistoryCompleteness,
  LegalCitationEligibility,
  LegalResearchItem,
  LegalArgument,
  LegalAnalysisNote,
  LegalConfidenceLevel,
  LegalConclusion,
  LegalDeadline,
  LegalActionType,
  LegalReadAction,
  LegalPrepareAction,
  LegalExecuteAction,
  LegalAction,
  LegalCase,
} from './legal-case.js';
export {
  LEGAL_JURISDICTIONS,
  LEGAL_CASE_STATUSES,
  LEGAL_SOURCE_TYPES,
  LEGAL_SOURCE_AUTHORITIES,
  LEGAL_SOURCE_RELIABILITIES,
  LEGAL_HISTORY_COMPLETENESSES,
} from './legal-case.js';

// --- Format v2 (legacy, gelé) ---------------------------------------------------------------
export type {
  LegalFactV2,
  LegalCaseFactsV2,
  LegalDocumentV2,
  LegalEvidenceV2,
  LegalCaseV2,
} from './legal-case-v2.js';
export { validateLegalCaseV2 } from './legal-case-v2-validation.js';
export {
  LEGACY_LEGAL_CASE_FILE_VERSION,
  parseLegacyLegalCaseFile,
} from './legal-case-file-format-v2.js';

// --- Primitives, canonicalisation, empreintes -------------------------------------------------
export type { LegalInstant, LegalOpaqueId } from './legal-primitives.js';
export {
  isLegalInstant,
  isLegalOpaqueId,
  validateLegalInstant,
  validateLegalOpaqueId,
} from './legal-primitives.js';
export {
  LEGAL_CANONICALIZATION_VERSION,
  canonicalizeLegal,
  isSupportedCanonicalization,
} from './legal-canonical.js';
export type { LegalFingerprint } from './legal-fingerprint.js';
export {
  computeLegalFingerprint,
  legalFingerprintsEqual,
  validateLegalFingerprint,
  verifyLegalFingerprint,
} from './legal-fingerprint.js';

// --- Temporalité --------------------------------------------------------------------------------
export type {
  LegalTemporalPrecision,
  LegalTemporalBound,
  LegalTemporalPoint,
  LegalTemporalInterval,
  LegalTemporalUnknown,
  LegalFactTemporal,
  LegalTemporal,
} from './legal-temporal.js';
export {
  LEGAL_TEMPORAL_PRECISIONS,
  validateLegalFactTemporal,
  validateLegalTemporalBound,
} from './legal-temporal.js';

// --- Références d'entrée, provenance -------------------------------------------------------------
export type { LegalDocumentLocation } from './legal-document-location.js';
export { validateLegalDocumentLocation } from './legal-document-location.js';
export type { LegalInputReference, LegalInputReferenceKind } from './legal-input-reference.js';
export {
  SUBSTANTIAL_INPUT_REFERENCE_KINDS,
  isSubstantialInputReference,
  validateLegalInputReference,
  validateLegalInputReferences,
} from './legal-input-reference.js';
export type {
  LegalProvenanceOrigin,
  LegalHumanProvenance,
  LegalToolProvenance,
  LegalDeterministicProvenance,
  LegalLlmProvenance,
  LegalFactProvenance,
  LegalProvenance,
  LegalNonLlmProvenance,
  LegalAuthoritativeProvenance,
} from './legal-provenance.js';
export { LEGAL_PROVENANCE_ORIGINS, validateLegalProvenance } from './legal-provenance.js';

// --- Document, pièce, fait --------------------------------------------------------------------------
export type { LegalDocument, LegalDocumentKind } from './legal-document.js';
export { LEGAL_DOCUMENT_KINDS, validateLegalDocument } from './legal-document.js';
export type {
  LegalEvidence,
  LegalDocumentaryEvidence,
  LegalNonDocumentaryEvidence,
  LegalEvidenceProvenance,
} from './legal-evidence.js';
export { validateLegalEvidence } from './legal-evidence.js';
export type { LegalFact } from './legal-fact.js';
export { validateLegalFact } from './legal-fact.js';

// --- Relations, validations, conflits, résolutions, règles -------------------------------------------
export type {
  LegalFactCorrectionKind,
  LegalFactQuestionRelation,
  LegalFactCorrectionRelation,
  LegalRelation,
} from './legal-relation.js';
export { LEGAL_FACT_CORRECTION_KINDS, validateLegalRelation } from './legal-relation.js';
export type { LegalFactValidation, LegalFactValidationDecision } from './legal-fact-validation.js';
export {
  LEGAL_FACT_VALIDATION_DECISIONS,
  validateLegalFactValidation,
} from './legal-fact-validation.js';
export type { LegalFactConflict, LegalFactConflictMember } from './legal-conflict.js';
export { validateLegalFactConflict } from './legal-conflict.js';
export type {
  LegalResolutionOutcome,
  LegalResolutionProposal,
  LegalFactResolution,
} from './legal-resolution.js';
export {
  LEGAL_RESOLUTION_OUTCOMES,
  validateLegalFactResolution,
  validateLegalResolutionProposal,
  validateOutcomePartition,
  validateOutcomeShape,
} from './legal-resolution.js';
export type {
  LegalRuleScope,
  LegalRuleInput,
  LegalRuleResult,
  LegalRuleDefinition,
  LegalRuleRegistry,
  LegalRuleExecution,
  BuildLegalRuleExecutionInput,
} from './legal-rule.js';
export {
  buildLegalRuleExecution,
  createLegalRuleRegistry,
  evaluateLegalRule,
  validateLegalRuleExecution,
} from './legal-rule.js';

// --- État épistémique dérivé ---------------------------------------------------------------------------
export type {
  LegalFactEpistemicState,
  LegalFactEpistemicRule,
  LegalFactEpistemicDerivation,
  LegalFactStateContext,
} from './legal-fact-state.js';
export { deriveFactEpistemicDerivation, deriveFactEpistemicState } from './legal-fact-state.js';

// --- Dossier v3 ------------------------------------------------------------------------------------------
export type { CreateLegalCaseInput } from './legal-case-factory.js';
export { createLegalCase } from './legal-case-factory.js';

export type { LegalCaseValidation } from './legal-case-validation.js';
export { LEGAL_CASE_V3_KEYS, validateLegalCaseV3 } from './legal-case-validation.js';

export { validateSource, validateSourceList } from './legal-source-validation.js';

export { validateCitation, validateCitationList } from './legal-citation-validation.js';

export type {
  AttachSourcesAndCitationsInput,
  AttachSourcesAndCitationsOptions,
} from './legal-case-citations.js';
export { attachSourcesAndCitations } from './legal-case-citations.js';

export type { AttachResearchItemsOptions } from './legal-case-research-items.js';
export { attachResearchItems } from './legal-case-research-items.js';

export type {
  LegalCaseAppendOnlyList,
  LegalCaseAdditions,
  AppendToLegalCaseOptions,
} from './legal-case-append-only.js';
export {
  LEGAL_CASE_APPEND_ONLY_LISTS,
  appendToLegalCase,
  assertAppendOnly,
  checkAppendOnly,
} from './legal-case-append-only.js';

export type { LegalCaseFileErrorReason } from './legal-case-file-format.js';
export {
  CURRENT_LEGAL_CASE_FILE_VERSION,
  LegalCaseFileError,
  parseLegalCaseFile,
  serializeLegalCaseFile,
} from './legal-case-file-format.js';
