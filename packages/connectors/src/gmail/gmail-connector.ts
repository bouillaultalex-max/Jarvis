import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { Connector } from '../connector.js';
import { GmailApiClient } from './gmail-api-client.js';
import { mapGmailMessageToEmailMessage } from './gmail-message-mapper.js';

/**
 * Connecteur Gmail. Deux `Tool` :
 *
 *   gmail.read          (action: 'read')    — inchangé depuis M5.
 *   gmail.prepare_reply (action: 'prepare') — M7.3, aucun effet de bord.
 *
 * Aucun `gmail.send`, `gmail.modify` ni `gmail.delete` : ces capacités
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

export interface GmailPrepareReplyInput {
  readonly messageId: string;
  readonly body: string;
}
export interface GmailDraftReply {
  readonly to: string;
  readonly subject: string;
  readonly threadId?: string;
  readonly body: string;
}

/**
 * Prépare un brouillon de réponse — **aucun effet de bord** : aucune
 * écriture Gmail, aucun brouillon distant créé, aucun envoi. Le seul appel
 * réseau effectué est une **lecture** (`client.getMessage`, déjà existante,
 * inchangée).
 *
 * `to`, `subject` et `threadId` sont **toujours** dérivés du message Gmail
 * réellement lu — jamais de l'entrée fournie par l'appelant (le modèle).
 * `validateInput` n'accepte que `{ messageId, body }` : toute autre clé
 * présente dans l'entrée brute (ex. un `to` fourni par le modèle) est
 * structurellement ignorée, jamais transmise à `execute`.
 */
function createGmailPrepareReplyTool(client: GmailApiClient): Tool<GmailPrepareReplyInput, GmailDraftReply> {
  return {
    name: 'gmail.prepare_reply',
    description:
      "Prépare un brouillon de réponse à un email Gmail déjà lu, sans l'envoyer (aucun effet de bord).",
    action: 'prepare',

    validateInput(input: unknown): ToolValidationResult<GmailPrepareReplyInput> {
      if (typeof input !== 'object' || input === null) {
        return invalid('gmail.prepare_reply : objet attendu.');
      }
      const { messageId, body } = input as Record<string, unknown>;
      if (typeof messageId !== 'string' || messageId.length === 0) {
        return invalid('gmail.prepare_reply : « messageId » requis.');
      }
      if (typeof body !== 'string' || body.length === 0) {
        return invalid('gmail.prepare_reply : « body » requis.');
      }
      // Aucune autre clé de `input` (ex. « to », « subject », « threadId »)
      // n'est reprise : seules `messageId` et `body` composent la valeur validée.
      return valid({ messageId, body });
    },

    async execute(input: GmailPrepareReplyInput): Promise<GmailDraftReply> {
      const raw = await client.getMessage(input.messageId);
      const original = mapGmailMessageToEmailMessage(raw);
      return {
        to: original.sender,
        subject: `Re: ${original.subject}`,
        threadId: original.threadId,
        body: input.body,
      };
    },
  };
}

export const gmailConnector: Connector<GmailApiClient> = {
  id: 'gmail',
  name: 'Connecteur Gmail (lecture seule + préparation de réponse)',
  capabilities: ['gmail.read', 'gmail.prepare_reply'],

  createTools(client: GmailApiClient): readonly Tool[] {
    return [createGmailReadTool(client), createGmailPrepareReplyTool(client)];
  },
};
