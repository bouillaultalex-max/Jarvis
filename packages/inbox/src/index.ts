export type { ClassifiedEmail } from './classified-email.js';

export type { AttentionPolicy } from './attention.js';
export { needsAttention, filterEmailsNeedingAttention } from './attention.js';

export type { FetchEmailsOptions } from './fetch-emails.js';
export { fetchEmailsViaTool, EmailFetchBlockedError } from './fetch-emails.js';

export { classifyEmails } from './classify-emails.js';

export { fetchAndClassifyEmails } from './pipeline.js';

export type { UserRuleRequest } from './feedback.js';
export { recordFeedbackForEmail, applyUserRule } from './feedback.js';

export type { EmailSummary, EmailSummarizer } from './email-summarizer.js';
export {
  MAX_BODY_EXCERPT_CHARS,
  buildSummaryPrompt,
  LlmProviderEmailSummarizer,
} from './email-summarizer.js';

export type { SummarizeEmailInput, SummarizeEmailOutput } from './summarize-email-tool.js';
export { createSummarizeEmailTool } from './summarize-email-tool.js';

export type { AttentionSummary } from './triage.js';
export { summarizeEmailsNeedingAttention } from './triage.js';

export type {
  EmailClaimBasis,
  AnalyzedItem,
  EmailAnalysisSignal,
  EmailUrgency,
  EmailAnalysis,
  EmailAnalysisInput,
  EmailAnalysisResult,
  EmailAnalyzer,
  EmailAnalysisModelCall,
} from './email-analysis.js';
export {
  EMAIL_CLAIM_BASES,
  EMAIL_ANALYSIS_INSTRUCTIONS,
  MAX_ANALYSIS_EMAIL_BODY_CHARS,
  MAX_ANALYSIS_CONTEXT_MESSAGES,
  MAX_ANALYSIS_CONTEXT_BODY_CHARS,
  MAX_ANALYSIS_LIST_ITEMS,
  MAX_ANALYSIS_TEXT_CHARS,
  buildEmailAnalysisUserPrompt,
  parseEmailAnalysis,
  createLlmEmailAnalyzer,
} from './email-analysis.js';

export type {
  EmailReplyConstraints,
  EmailReplyPlanInput,
  EmailReplyDraft,
  EmailReplyDraftResult,
  EmailReplyPlanner,
  EmailReplyPlanModelCall,
} from './email-reply-planner.js';
export {
  EMAIL_REPLY_PLANNER_INSTRUCTIONS,
  MAX_PLANNER_MEMORY_ENTRIES,
  MAX_PLANNER_CONTEXT_MESSAGES,
  MAX_PLANNER_EMAIL_BODY_CHARS,
  MAX_PLANNER_CONTEXT_BODY_CHARS,
  MAX_DRAFT_BODY_CHARS,
  MAX_DRAFT_TEXT_CHARS,
  MAX_DRAFT_LIST_ITEMS,
  buildEmailReplyPlannerUserPrompt,
  parseEmailReplyDraft,
  createLlmEmailReplyPlanner,
} from './email-reply-planner.js';

export type { PreparedReply, PrepareReplyFromDraftOptions } from './prepare-reply-from-draft.js';
export {
  PREPARE_REPLY_TOOL_NAME,
  PrepareReplyBlockedError,
  prepareReplyFromDraft,
} from './prepare-reply-from-draft.js';

export type {
  EmailAnalysisFailure,
  EmailReplyDraftFailure,
  EmailStyleConstraintsProvider,
  EmailReplyWorkflowOptions,
  EmailReplyWorkflowInput,
  EmailReplyWorkflowResult,
} from './email-reply-workflow.js';
export {
  EmailReplyWorkflow,
  MAX_MEMORY_QUERY_BODY_CHARS,
  buildMemoryQuery,
  mergeConstraints,
} from './email-reply-workflow.js';
