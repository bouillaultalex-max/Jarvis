export type { ClassifiedEmail } from './classified-email.js';

export type { FetchEmailsOptions } from './fetch-emails.js';
export { fetchEmailsViaTool, EmailFetchBlockedError } from './fetch-emails.js';

export { classifyEmails } from './classify-emails.js';

export { fetchAndClassifyEmails } from './pipeline.js';

export type { UserRuleRequest } from './feedback.js';
export { recordFeedbackForEmail, applyUserRule } from './feedback.js';
