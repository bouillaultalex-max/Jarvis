import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';

import type { Connector } from '../connector.js';
import type { InMemoryMessage, InMemorySentMessage } from './in-memory-client.js';
import { InMemoryMailClient } from './in-memory-client.js';

/**
 * Connecteur de démonstration/test, entièrement local et fictif.
 *
 * Fournit trois `Tool` distincts, un par niveau d'action, pour valider
 * l'architecture connecteurs sans réseau ni OAuth :
 *
 *   inmemory.read          (read)    — lecture de la boîte de réception
 *   inmemory.prepare_reply (prepare) — brouillon de réponse, aucun envoi
 *   inmemory.send          (execute) — envoi réel (mutation locale)
 *
 * Le client `InMemoryMailClient` est injecté dans {@link createTools} et
 * capturé par fermeture : il n'apparaît jamais comme propriété d'un `Tool`
 * ni dans l'input/output exposé au LLM.
 */

export interface InMemoryReadInput {
  readonly messageId?: string;
}
export interface InMemoryReadOutput {
  readonly messages: readonly InMemoryMessage[];
}

function createInMemoryReadTool(
  client: InMemoryMailClient,
): Tool<InMemoryReadInput, InMemoryReadOutput> {
  return {
    name: 'inmemory.read',
    description: 'Lit la boîte de réception fictive (aucun effet de bord).',
    action: 'read',

    validateInput(input: unknown): ToolValidationResult<InMemoryReadInput> {
      if (input === undefined || input === null) {
        return valid({});
      }
      if (typeof input !== 'object') {
        return invalid('inmemory.read : entrée invalide.');
      }
      const { messageId } = input as Record<string, unknown>;
      if (messageId !== undefined && typeof messageId !== 'string') {
        return invalid('inmemory.read : « messageId » doit être une chaîne.');
      }
      return valid({ messageId });
    },

    async execute(input: InMemoryReadInput): Promise<InMemoryReadOutput> {
      if (input.messageId !== undefined) {
        const message = client.findById(input.messageId);
        return { messages: message ? [message] : [] };
      }
      return { messages: client.listInbox() };
    },
  };
}

export interface InMemoryPrepareReplyInput {
  readonly messageId: string;
  readonly body: string;
}
export interface InMemoryDraftReply {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

function createInMemoryPrepareReplyTool(
  client: InMemoryMailClient,
): Tool<InMemoryPrepareReplyInput, InMemoryDraftReply> {
  return {
    name: 'inmemory.prepare_reply',
    description: "Prépare un brouillon de réponse à un message existant, sans l'envoyer.",
    action: 'prepare',

    validateInput(input: unknown): ToolValidationResult<InMemoryPrepareReplyInput> {
      if (typeof input !== 'object' || input === null) {
        return invalid('inmemory.prepare_reply : objet attendu.');
      }
      const { messageId, body } = input as Record<string, unknown>;
      if (typeof messageId !== 'string' || messageId.length === 0) {
        return invalid('inmemory.prepare_reply : « messageId » requis.');
      }
      if (typeof body !== 'string' || body.length === 0) {
        return invalid('inmemory.prepare_reply : « body » requis.');
      }
      return valid({ messageId, body });
    },

    async execute(input: InMemoryPrepareReplyInput): Promise<InMemoryDraftReply> {
      const original = client.findById(input.messageId);
      if (original === undefined) {
        throw new Error(`inmemory.prepare_reply : message « ${input.messageId} » introuvable.`);
      }
      // Ne modifie AUCUN état du client : seul un brouillon est renvoyé.
      return { to: original.from, subject: `Re: ${original.subject}`, body: input.body };
    },
  };
}

export interface InMemorySendInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}
export type InMemorySendOutput = InMemorySentMessage;

function createInMemorySendTool(
  client: InMemoryMailClient,
): Tool<InMemorySendInput, InMemorySendOutput> {
  return {
    name: 'inmemory.send',
    description: "Envoie réellement un message (mutation de l'état local du connecteur).",
    action: 'execute',

    validateInput(input: unknown): ToolValidationResult<InMemorySendInput> {
      if (typeof input !== 'object' || input === null) {
        return invalid('inmemory.send : objet attendu.');
      }
      const { to, subject, body } = input as Record<string, unknown>;
      if (typeof to !== 'string' || to.length === 0) {
        return invalid('inmemory.send : « to » requis.');
      }
      if (typeof subject !== 'string') {
        return invalid('inmemory.send : « subject » doit être une chaîne.');
      }
      if (typeof body !== 'string') {
        return invalid('inmemory.send : « body » doit être une chaîne.');
      }
      return valid({ to, subject, body });
    },

    async execute(input: InMemorySendInput): Promise<InMemorySendOutput> {
      return client.send(input);
    },
  };
}

export const inMemoryConnector: Connector<InMemoryMailClient> = {
  id: 'inmemory',
  name: 'Connecteur de démonstration en mémoire',
  capabilities: ['inmemory.read', 'inmemory.prepare_reply', 'inmemory.send'],

  createTools(client: InMemoryMailClient): readonly Tool[] {
    return [
      createInMemoryReadTool(client),
      createInMemoryPrepareReplyTool(client),
      createInMemorySendTool(client),
    ];
  },
};
