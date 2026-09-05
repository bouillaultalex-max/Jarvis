import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { Connector } from '../connector.js';
import { GmailApiClient, type GmailSendMessageInput, type GmailSendMessageResult } from './gmail-api-client.js';
import { mapGmailMessageToEmailMessage } from './gmail-message-mapper.js';

/**
 * Connecteur Gmail. Trois `Tool` :
 *
 *   gmail.read          (action: 'read')    — inchangé depuis M5.
 *   gmail.prepare_reply (action: 'prepare') — M7.3, aucun effet de bord.
 *   gmail.send          (action: 'execute') — M8-A6, effet de bord réel.
 *
 * Aucun `gmail.modify` ni `gmail.delete` : ces capacités n'existent pas —
 * ni comme `Tool`, ni comme méthode sur `GmailApiClient`.
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

/**
 * Entrée/sortie identiques à celles de `GmailApiClient.sendMessage` :
 * aucune transformation n'a lieu entre le `Tool` et le client (contrairement
 * à `gmail.read`/`gmail.prepare_reply`, qui passent par
 * `mapGmailMessageToEmailMessage`) — les alias évitent de dupliquer les
 * mêmes champs sous un second nom de type.
 */
export type GmailSendInput = GmailSendMessageInput;
export type GmailSendOutput = GmailSendMessageResult;

/** Seules clés acceptées en entrée — toute autre clé fait échouer la validation (jamais ignorée en silence). */
const ALLOWED_SEND_INPUT_KEYS = new Set(['to', 'subject', 'body', 'threadId']);

/**
 * Envoie réellement un email — **seule** capacité `execute` de ce
 * connecteur : effet de bord réel et irréversible côté Gmail. Contrairement
 * à `gmail.prepare_reply`, une clé inconnue dans l'entrée brute fait
 * **échouer** la validation plutôt que d'être silencieusement ignorée : un
 * envoi réel ne doit jamais accepter tacitement un champ non prévu par ce
 * contrat.
 */
function createGmailSendTool(client: GmailApiClient): Tool<GmailSendInput, GmailSendOutput> {
  return {
    name: 'gmail.send',
    description: 'Envoie réellement un email via Gmail (action irréversible, effet de bord réel).',
    action: 'execute',

    validateInput(input: unknown): ToolValidationResult<GmailSendInput> {
      if (typeof input !== 'object' || input === null) {
        return invalid('gmail.send : objet attendu.');
      }
      const record = input as Record<string, unknown>;

      const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_SEND_INPUT_KEYS.has(key));
      if (unknownKeys.length > 0) {
        return invalid(`gmail.send : propriété(s) inconnue(s) : ${unknownKeys.join(', ')}.`);
      }

      const { to, subject, body, threadId } = record;
      if (typeof to !== 'string' || to.length === 0) {
        return invalid('gmail.send : « to » requis.');
      }
      if (typeof subject !== 'string') {
        return invalid('gmail.send : « subject » doit être une chaîne.');
      }
      if (typeof body !== 'string') {
        return invalid('gmail.send : « body » doit être une chaîne.');
      }
      if (threadId !== undefined && typeof threadId !== 'string') {
        return invalid('gmail.send : « threadId » doit être une chaîne.');
      }

      return valid({ to, subject, body, ...(threadId !== undefined ? { threadId } : {}) });
    },

    async execute(input: GmailSendInput): Promise<GmailSendOutput> {
      return client.sendMessage(input);
    },
  };
}

export const gmailConnector: Connector<GmailApiClient> = {
  id: 'gmail',
  name: 'Connecteur Gmail (lecture, préparation de réponse et envoi)',
  capabilities: ['gmail.read', 'gmail.prepare_reply', 'gmail.send'],

  createTools(client: GmailApiClient): readonly Tool[] {
    return [createGmailReadTool(client), createGmailPrepareReplyTool(client), createGmailSendTool(client)];
  },
};
