import type { ToolExecutionResult, ToolExecutor } from '@jarvis/core';

import type { EmailReplyDraft } from './email-reply-planner.js';

/**
 * Orchestration fine : transforme une {@link EmailReplyDraft} en un brouillon
 * de réponse Gmail, **exclusivement** via `ToolExecutor` et **uniquement** via
 * `gmail.prepare_reply`.
 *
 * Invariants (mêmes garanties que `fetchEmailsViaTool`) :
 *   - passe **strictement** par `ToolExecutor` — jamais d'appel direct à un
 *     `Tool` ni à un client Gmail ;
 *   - ne transmet que `{ messageId, body: draft.body }` — **jamais** `rationale`,
 *     `usedMemoryIds`, `unresolved`, `subject`, ni aucune autre métadonnée
 *     interne du brouillon ;
 *   - n'appelle **jamais** `gmail.send` : aucun envoi, aucun effet de bord réel.
 *
 * `to` / `subject` / `threadId` du brouillon final sont ceux dérivés par
 * `gmail.prepare_reply` du message réellement lu — jamais fournis ici.
 */

/** Nom du seul `Tool` utilisé. */
export const PREPARE_REPLY_TOOL_NAME = 'gmail.prepare_reply';

/**
 * Brouillon de réponse tel que renvoyé par `gmail.prepare_reply`. Forme
 * dupliquée localement (et non importée de `@jarvis/connectors`, dépendance de
 * test uniquement) — garde de forme runtime, comme pour `{ messages }` dans
 * `fetch-emails.ts`.
 */
export interface PreparedReply {
  readonly to: string;
  readonly subject: string;
  readonly threadId?: string;
  readonly body: string;
}

export interface PrepareReplyFromDraftOptions {
  /** Identifiant de l'email Gmail auquel répondre. */
  readonly messageId: string;
  /** Brouillon produit par {@link EmailReplyPlanner}. Seul `body` est transmis. */
  readonly draft: EmailReplyDraft;
}

/**
 * Levée lorsque la préparation n'a **pas** abouti à une exécution (`deny`,
 * `awaiting_confirmation`, outil inconnu, entrée invalide, erreur technique…).
 * Porte le résultat d'origine pour diagnostic — sans jamais contenir de
 * credential.
 */
export class PrepareReplyBlockedError extends Error {
  constructor(public readonly outcome: ToolExecutionResult) {
    super(
      `prepareReplyFromDraft : préparation bloquée pour « ${PREPARE_REPLY_TOOL_NAME} » ` +
        `(statut « ${outcome.status} »).`,
    );
    this.name = 'PrepareReplyBlockedError';
  }
}

function isPreparedReplyShape(value: unknown): value is PreparedReply {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.to === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.body === 'string' &&
    (v.threadId === undefined || typeof v.threadId === 'string')
  );
}

/**
 * @throws {Error} si `messageId` ou `draft.body` est vide (avant tout appel).
 * @throws {PrepareReplyBlockedError} si `gmail.prepare_reply` n'a pas été exécuté.
 * @throws {Error} si l'outil a été exécuté mais n'a pas renvoyé la forme
 *   attendue d'un brouillon.
 */
export async function prepareReplyFromDraft(
  executor: ToolExecutor,
  options: PrepareReplyFromDraftOptions,
): Promise<PreparedReply> {
  const { messageId } = options;
  const body = options.draft.body;

  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new Error('prepareReplyFromDraft : « messageId » requis.');
  }
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('prepareReplyFromDraft : « draft.body » requis.');
  }

  // Entrée volontairement réduite à ces deux clés : aucune métadonnée interne
  // du brouillon ne quitte cette fonction.
  const result = await executor.run({
    tool: PREPARE_REPLY_TOOL_NAME,
    input: { messageId, body },
  });

  if (result.status !== 'executed') {
    throw new PrepareReplyBlockedError(result);
  }
  if (!isPreparedReplyShape(result.output)) {
    throw new Error(
      `prepareReplyFromDraft : « ${PREPARE_REPLY_TOOL_NAME} » n'a pas renvoyé la forme attendue ` +
        "d'un brouillon { to, subject, body }.",
    );
  }
  return result.output;
}
