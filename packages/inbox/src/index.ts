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
export { MAX_BODY_EXCERPT_CHARS, buildSummaryPrompt, LlmProviderEmailSummarizer } from './email-summarizer.js';

export type { SummarizeEmailInput, SummarizeEmailOutput } from './summarize-email-tool.js';
export { createSummarizeEmailTool } from './summarize-email-tool.js';

export type { AttentionSummary } from './triage.js';
export { summarizeEmailsNeedingAttention } from './triage.js';
