import type { ToolExecutionResult } from '@jarvis/core';
import type { ConfirmAndExecuteResult, ConfirmationRequest } from '@jarvis/connectors';

/**
 * Fonctions pures de mapping HTTP (ADR-0008 / ADR-0009) — aucun effet de
 * bord, aucune connaissance de Fastify, de `ConfirmationService` ni de
 * `ToolExecutor`. Chaque message `reason` est une chaîne **fixe et
 * générique** : aucune de ces fonctions ne recopie jamais
 * `toolOutcome.reason` ou le détail d'une exception.
 */

export interface HttpMappingResult {
  readonly code: number;
  readonly body: unknown;
}

const INTERNAL_TOOL_ERROR: HttpMappingResult = {
  code: 500,
  body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
};

const TOOL_DENIED: HttpMappingResult = {
  code: 403,
  body: { status: 'tool_denied', reason: 'Action denied by policy.' },
};

const INVALID_TOOL_INPUT: HttpMappingResult = {
  code: 422,
  body: { status: 'invalid_tool_input', reason: 'Invalid tool input.' },
};

const TOOL_EXECUTION_FAILED: HttpMappingResult = {
  code: 502,
  body: { status: 'tool_execution_failed', reason: 'Tool execution failed.' },
};

const CONFIRMATION_NOT_FOUND: HttpMappingResult = {
  code: 404,
  body: { status: 'confirmation_not_found' },
};

const CONFIRMATION_CONFLICT: HttpMappingResult = {
  code: 409,
  body: { status: 'confirmation_conflict' },
};

const CONFIRMATION_DENIED: HttpMappingResult = {
  code: 200,
  body: { status: 'confirmation_denied' },
};

/**
 * Mapping du dernier `toolOutcome` d'un tour `AgentLoop` non conclu par
 * `stopReason: 'llm_final'` (`tool_blocked`, ou `max_iterations` — non
 * spécifié par ADR-0008/0009, traité ici par la même défense en profondeur
 * que l'absence de `toolOutcome` exploitable, cas structurellement
 * inatteignable tant qu'aucun outil `execute` n'est jamais `allow` par
 * défaut).
 *
 * `confirmation`, si fourni, est le `ConfirmationRequest` déjà construit par
 * l'appelant (jamais construit ici — ce module reste pur, sans connaissance
 * de `ConfirmationService`).
 */
export function mapChatToolBlockedResult(
  last: ToolExecutionResult | undefined,
  confirmation?: ConfirmationRequest,
): HttpMappingResult {
  if (last === undefined) {
    return INTERNAL_TOOL_ERROR;
  }

  switch (last.status) {
    case 'awaiting_confirmation':
      return confirmation === undefined
        ? INTERNAL_TOOL_ERROR
        : { code: 202, body: { status: 'confirmation_required', confirmation } };
    case 'denied':
      return TOOL_DENIED;
    case 'invalid_input':
      return INVALID_TOOL_INPUT;
    case 'unknown_tool':
      return INTERNAL_TOOL_ERROR;
    case 'error':
      return TOOL_EXECUTION_FAILED;
    case 'executed':
      // Structurellement inatteignable ici (AgentLoop ne s'arrête pas sur un
      // dernier outcome 'executed') — défense en profondeur uniquement.
      return INTERNAL_TOOL_ERROR;
    default:
      return INTERNAL_TOOL_ERROR;
  }
}

/**
 * Mapping du résultat de `confirmAndExecute()` pour
 * `POST /chat/confirmations/:confirmationId` — contrat **distinct** de
 * `POST /chat` (ADR-0009 §8) : `200`/`200`/`404`/`409`/`502`/`500`, jamais
 * le tableau à cinq entrées de `mapChatToolBlockedResult`.
 */
export function mapConfirmAndExecuteResult(result: ConfirmAndExecuteResult): HttpMappingResult {
  if (result.status === 'confirmation_failed') {
    return result.failureReason === 'not_found' ? CONFIRMATION_NOT_FOUND : CONFIRMATION_CONFLICT;
  }

  switch (result.status) {
    case 'executed':
      return { code: 200, body: result.output };
    case 'error':
      return TOOL_EXECUTION_FAILED;
    case 'denied':
    case 'invalid_input':
    case 'unknown_tool':
    case 'awaiting_confirmation':
      // Cas résiduels après un verify() réussi (ADR-0009 §10) : incohérence
      // interne — jamais un nouveau refus, une nouvelle erreur de saisie, ou
      // une nouvelle confirmation à obtenir.
      return INTERNAL_TOOL_ERROR;
    default:
      return INTERNAL_TOOL_ERROR;
  }
}

/** Réponse exacte pour `stopReason: 'tool_blocked'` sans `toolOutcome` exploitable (ADR-0009 §2). */
export function mapToolBlockedWithoutOutcome(): HttpMappingResult {
  return INTERNAL_TOOL_ERROR;
}

/** Corps exact pour `approve: false` (ADR-0009 §9). */
export function confirmationDeniedResponse(): HttpMappingResult {
  return CONFIRMATION_DENIED;
}

/** Réponse exacte pour une entrée absente de la table pending d'`apps/api`. */
export function confirmationNotFoundResponse(): HttpMappingResult {
  return CONFIRMATION_NOT_FOUND;
}
