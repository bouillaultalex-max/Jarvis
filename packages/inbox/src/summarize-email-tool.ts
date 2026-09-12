import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { EmailSummarizer } from './email-summarizer.js';

export interface SummarizeEmailInput {
  readonly email: EmailMessage;
}
export interface SummarizeEmailOutput {
  readonly summary: string;
}

function isEmailMessageShape(value: unknown): value is EmailMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.sender === 'string' &&
    Array.isArray(v.recipients) &&
    typeof v.subject === 'string' &&
    typeof v.body === 'string' &&
    typeof v.receivedAt === 'string'
  );
}

/**
 * Construit un `Tool`, `action: 'read'`, qui résume un `EmailMessage` déjà
 * obtenu (par ex. via `gmail.read`). Aucun effet de bord : n'appelle que le
 * `EmailSummarizer` injecté — aucune connexion Gmail, aucun appel à
 * `GmailApiClient`, aucune écriture.
 */
export function createSummarizeEmailTool(
  summarizer: EmailSummarizer,
): Tool<SummarizeEmailInput, SummarizeEmailOutput> {
  return {
    name: 'email.summarize',
    description: 'Résume un email déjà lu (lecture seule, aucun effet de bord).',
    action: 'read',

    // Attend `{ email: EmailMessage }`. `isEmailMessageShape` exige
    // id/sender/recipients/subject/body/receivedAt ; `threadId` reste
    // optionnel. Ni l'entrée ni l'objet `email` ne rejettent les clés
    // inconnues → pas d'`additionalProperties: false`. Aucun secret : les
    // champs décrits sont ceux, publics, de `EmailMessage` (@jarvis/types).
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            threadId: { type: 'string' },
            sender: { type: 'string' },
            recipients: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body: { type: 'string' },
            receivedAt: { type: 'string', description: 'Date de réception, ISO 8601.' },
          },
          required: ['id', 'sender', 'recipients', 'subject', 'body', 'receivedAt'],
        },
      },
      required: ['email'],
    },

    validateInput(input: unknown): ToolValidationResult<SummarizeEmailInput> {
      if (typeof input !== 'object' || input === null) {
        return invalid('email.summarize : objet attendu.');
      }
      const { email } = input as Record<string, unknown>;
      if (!isEmailMessageShape(email)) {
        return invalid('email.summarize : « email » doit être un EmailMessage valide.');
      }
      return valid({ email });
    },

    async execute(input: SummarizeEmailInput): Promise<SummarizeEmailOutput> {
      const result = await summarizer.summarize(input.email);
      if (result === undefined) {
        throw new Error('email.summarize : le résumé LLM est inexploitable.');
      }
      return { summary: result.summary };
    },
  };
}
