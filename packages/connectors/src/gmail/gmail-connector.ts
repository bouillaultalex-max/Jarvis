import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { Connector } from '../connector.js';
import { GmailApiClient } from './gmail-api-client.js';
import { mapGmailMessageToEmailMessage } from './gmail-message-mapper.js';

/**
 * Connecteur Gmail — **lecture seule** pour ce jalon (M5). Ne fournit qu'un
 * seul `Tool`, `gmail.read` (`action: 'read'`). Aucun `gmail.send`,
 * `gmail.modify`, `gmail.delete` ni `gmail.prepare_reply` : ces capacités
 * n'existent pas — ni comme `Tool`, ni comme méthode sur `GmailApiClient`.
 */

export interface GmailReadInput {
  readonly maxResults?: number;
}
export interface GmailReadOutput {
  readonly messages: readonly EmailMessage[];
}

const DEFAULT_MAX_RESULTS = 10;
const MAX_ALLOWED_RESULTS = 50;

function createGmailReadTool(client: GmailApiClient): Tool<GmailReadInput, GmailReadOutput> {
  return {
    name: 'gmail.read',
    description: 'Lit les emails récents de la boîte de réception Gmail (lecture seule, aucun effet de bord).',
    action: 'read',

    validateInput(input: unknown): ToolValidationResult<GmailReadInput> {
      if (input === undefined || input === null) {
        return valid({});
      }
      if (typeof input !== 'object') {
        return invalid('gmail.read : entrée invalide.');
      }
      const { maxResults } = input as Record<string, unknown>;
      if (maxResults !== undefined) {
        if (
          typeof maxResults !== 'number' ||
          !Number.isInteger(maxResults) ||
          maxResults < 1 ||
          maxResults > MAX_ALLOWED_RESULTS
        ) {
          return invalid(`gmail.read : « maxResults » doit être un entier entre 1 et ${MAX_ALLOWED_RESULTS}.`);
        }
      }
      return valid({ maxResults });
    },

    async execute(input: GmailReadInput): Promise<GmailReadOutput> {
      const ids = await client.listMessageIds({ maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS });
      const messages: EmailMessage[] = [];
      for (const id of ids) {
        const raw = await client.getMessage(id);
        messages.push(mapGmailMessageToEmailMessage(raw));
      }
      return { messages };
    },
  };
}

export const gmailConnector: Connector<GmailApiClient> = {
  id: 'gmail',
  name: 'Connecteur Gmail (lecture seule)',
  capabilities: ['gmail.read'],

  createTools(client: GmailApiClient): readonly Tool[] {
    return [createGmailReadTool(client)];
  },
};
