import type { ToolExecutionResult, ToolExecutor } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

/**
 * Lecture d'emails, volontairement **générique** : ce module ne connaît ni
 * Gmail, ni Outlook, ni aucun fournisseur. Il fonctionne avec n'importe quel
 * `Tool` déjà enregistré dont la sortie a la forme `{ messages: EmailMessage[] }`
 * (ex. `gmail.read`) — c'est le `ToolRegistry`/`ToolExecutor` fourni par
 * l'appelant qui détermine quel fournisseur est réellement branché.
 */

export interface FetchEmailsOptions {
  /** Nom du Tool de lecture à invoquer, ex. `'gmail.read'`. */
  readonly toolName: string;
  /** Entrée transmise telle quelle au Tool (ex. `{ maxResults: 10 }`). */
  readonly input?: unknown;
}

/**
 * Levée lorsque la lecture n'a **pas** abouti à une exécution (`deny`,
 * `awaiting_confirmation`, outil inconnu, entrée invalide, erreur
 * technique…). Porte le statut d'origine pour un diagnostic précis, sans
 * jamais contenir de credential (`ToolExecutionResult` n'en porte aucun).
 */
export class EmailFetchBlockedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly outcome: ToolExecutionResult,
  ) {
    super(`fetchEmailsViaTool : lecture bloquée pour « ${toolName} » (statut « ${outcome.status} »).`);
    this.name = 'EmailFetchBlockedError';
  }
}

function isEmailBatchShape(value: unknown): value is { messages: readonly EmailMessage[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).messages)
  );
}

/**
 * Récupère des emails via un Tool de lecture déjà enregistré, **strictement**
 * en passant par `ToolExecutor` — jamais d'appel direct à `tool.execute()` :
 * mêmes invariants de sécurité que partout ailleurs dans JARVIS (un outil
 * refusé, en attente de confirmation, inconnu ou en erreur ne renvoie
 * jamais un email).
 *
 * @throws {EmailFetchBlockedError} si la lecture n'a pas été exécutée.
 * @throws {Error} si l'outil a été exécuté mais n'a pas renvoyé la forme
 *   attendue `{ messages: EmailMessage[] }`.
 */
export async function fetchEmailsViaTool(
  executor: ToolExecutor,
  options: FetchEmailsOptions,
): Promise<readonly EmailMessage[]> {
  const result = await executor.run({ tool: options.toolName, input: options.input });

  if (result.status !== 'executed') {
    throw new EmailFetchBlockedError(options.toolName, result);
  }

  if (!isEmailBatchShape(result.output)) {
    throw new Error(
      `fetchEmailsViaTool : l'outil « ${options.toolName} » n'a pas renvoyé la forme attendue ` +
        '{ messages: EmailMessage[] }.',
    );
  }

  return result.output.messages;
}
