import type { ToolExecutionResult, ToolExecutor, ToolRequest } from '@jarvis/core';

import type { Account } from '../account.js';
import {
  captureConfirmationInput,
  UnsupportedConfirmationInputError,
} from './confirmation-input-contract.js';
import type { ConfirmationInputSummary, ConfirmationRequest } from './confirmation-request.js';
import { buildConfirmationRequest } from './confirmation-request.js';
import type {
  ConfirmationFailureReason,
  ConfirmationPayload,
  ConfirmationService,
} from './confirmation-service.js';
import { describeConfirmationFailure } from './confirmation-service.js';

/**
 * Orchestration générique reliant `ToolExecutor` (`@jarvis/core`),
 * `ConfirmationService` (M8-A3) et `buildConfirmationRequest` (M8-A4) — M8-A5.
 *
 * Ce module ne modifie et ne remplace aucun des trois : il compose leurs API
 * publiques existantes, dans un ordre précis (voir {@link confirmAndExecute}).
 * Totalement indépendant de tout provider (Gmail ou autre) : aucune
 * connaissance de la forme d'un `input` particulier, uniquement du contrat
 * générique `Tool`/`ToolExecutionResult`.
 *
 * Ne décide jamais d'autorisation — `PermissionManager` (invoqué à
 * l'intérieur de `ToolExecutor.run()`) reste seul juge, y compris pour le
 * second appel effectué après une confirmation vérifiée avec succès :
 * `ConfirmationService` prouve une intégrité, jamais une autorisation.
 */

export interface ProposeConfirmationOptions {
  readonly executor: ToolExecutor;
  readonly confirmationService: ConfirmationService;
  /** Requête initiale — une proposition n'est, par nature, pas encore confirmée. */
  readonly request: ToolRequest;
  /** Compte au nom duquel l'action serait exécutée ; lie le futur ticket à ce compte précis. */
  readonly account: Account;
  /**
   * Résumé d'affichage déjà construit par l'appelant. Ce module ne dérive
   * jamais lui-même un résumé à partir d'un `input` arbitraire — cela
   * exigerait une connaissance connector-specific qui n'a pas sa place ici
   * (voir `confirmation-request.ts`).
   */
  readonly summary: ConfirmationInputSummary;
  /**
   * Horloge injectable, utilisée uniquement pour dater `createdAt` du
   * `ConfirmationRequest` (purement informatif). Indépendante de l'horloge
   * interne de `ConfirmationService` (TTL/expiration) — aucun nouveau
   * système de temps n'est introduit, celui-ci ne fait que dater un affichage.
   * Défaut : `Date.now`.
   */
  readonly now?: () => number;
}

export interface ProposeConfirmationResult {
  /** Résultat brut de `ToolExecutor.run()` — jamais réinterprété. */
  readonly result: ToolExecutionResult;
  /** Présent uniquement si `result.status === 'awaiting_confirmation'` et que `input` respecte le contrat de confirmation. */
  readonly confirmationRequest?: ConfirmationRequest;
  /**
   * Présent uniquement si `result.status === 'awaiting_confirmation'` mais
   * que `result.input` viole le contrat strict du protocole de confirmation
   * (`confirmation-input-contract.ts` — ex. un `Tool.validateInput()` mal
   * écrit qui laisserait passer un `BigInt`, un accesseur…). Dans ce cas,
   * **aucun ticket n'est créé** (`ConfirmationService.create()` a levé avant
   * toute écriture) : `confirmationRequest` reste `undefined`, `result`
   * reste exactement celui de `ToolExecutor` (`awaiting_confirmation`,
   * contrat de `@jarvis/core` inchangé).
   */
  readonly rejectedInput?: UnsupportedConfirmationInputError;
}

/**
 * Propose une action : exécute `ToolExecutor.run(request)` et, seulement si
 * `PermissionManager` exige une confirmation, crée un ticket
 * (`ConfirmationService.create()`) puis construit un `ConfirmationRequest`
 * prêt à afficher (`buildConfirmationRequest`).
 *
 * Le payload lié au ticket est **exactement** `{ toolName, action, input }`
 * tel que renvoyé par `ToolExecutor` dans le statut `awaiting_confirmation`
 * — l'entrée déjà validée par le `Tool`, jamais l'entrée brute reconstruite
 * — complété du seul `accountId` fourni ici. C'est ce même triplet qui devra
 * être représenté à l'identique pour que {@link confirmAndExecute} réussisse.
 */
export async function proposeConfirmation(
  options: ProposeConfirmationOptions,
): Promise<ProposeConfirmationResult> {
  const { executor, confirmationService, request, account, summary } = options;
  const now = options.now ?? Date.now;

  const result = await executor.run(request);

  if (result.status !== 'awaiting_confirmation') {
    return { result };
  }

  const payload: ConfirmationPayload = {
    toolName: result.toolName,
    action: result.action,
    accountId: account.id,
    input: result.input,
  };

  let ticket;
  try {
    ticket = await confirmationService.create(payload);
  } catch (err) {
    if (err instanceof UnsupportedConfirmationInputError) {
      return { result, rejectedInput: err };
    }
    throw err;
  }

  const confirmationRequest = buildConfirmationRequest({
    confirmationId: ticket.confirmationId,
    createdAt: new Date(now()).toISOString(),
    expiresAt: ticket.expiresAt,
    toolName: result.toolName,
    action: result.action,
    account,
    summary,
  });

  return { result, confirmationRequest };
}

/**
 * Échec de confirmation — statut distinct de tous ceux de
 * `ToolExecutionResult` : jamais confondu avec `denied`, `executed` ou
 * `awaiting_confirmation`.
 */
export interface ConfirmationFailed {
  readonly status: 'confirmation_failed';
  /** Catégorie structurée (diagnostic interne) — voir `ConfirmationFailureReason`. */
  readonly failureReason: ConfirmationFailureReason;
  /** Message générique, jamais le détail de la cause (voir `describeConfirmationFailure`). */
  readonly reason: string;
}

export type ConfirmAndExecuteResult = ToolExecutionResult | ConfirmationFailed;

export interface ConfirmAndExecuteOptions {
  readonly executor: ToolExecutor;
  readonly confirmationService: ConfirmationService;
  readonly confirmationId: string;
  /**
   * Payload exact à exécuter — reconstruit par l'appelant avec les mêmes
   * `toolName`/`action`/`accountId`/`input` que ceux proposés. Ce module ne
   * le devine ni ne le complète jamais : toute divergence, même minime,
   * échoue à `verify()` (voir `computeFingerprint`).
   */
  readonly payload: ConfirmationPayload;
}

/**
 * Vérifie un ticket puis, seulement en cas de succès, exécute réellement
 * l'action via `ToolExecutor.run({ ..., confirmed: true })`.
 *
 * Ordre strict, jamais inversé : un `verify()` en échec ne déclenche
 * **aucun** appel à `ToolExecutor.run()`. Un ticket ne constitue jamais une
 * autorisation en soi — seulement une preuve d'intégrité vérifiée avant de
 * redemander la décision réelle à `PermissionManager` (via `ToolExecutor`,
 * qui peut toujours refuser malgré un ticket valide, ex. politique changée
 * entre-temps).
 *
 * `verifiedToolName`/`verifiedInput` sont des captures de `payload.toolName`/
 * `payload.input` prises de façon strictement synchrone, avant le seul point
 * de suspension de cette fonction (`await confirmationService.verify(...)`).
 * `payload.toolName` est un primitif (copié par valeur, immunisé de fait) ;
 * `payload.input` est capturé par {@link captureConfirmationInput} (contrat
 * strict, `confirmation-input-contract.ts` — même mécanisme que celui
 * utilisé en interne par `ConfirmationService.create()`/`verify()`). Ceci
 * garantit que l'outil et la valeur fingerprintés par `verify()` et ceux
 * réellement transmis à `executor.run()` sont **toujours** les mêmes —
 * même si l'appelant conservait une référence à `payload` et le mutait
 * (outil ou entrée) entre l'appel à `confirmAndExecute` et sa résolution
 * (fenêtre théorique : aucun appelant actuel — `apps/api`, `apps/desktop` —
 * ne conserve une telle référence mutable après l'appel).
 *
 * Si `payload.input` viole le contrat (accesseur, `BigInt`, cycle…), cette
 * capture échoue **avant** tout appel à `confirmationService.verify()` —
 * aucun ticket n'est donc jamais consulté ni consommé pour une tentative de
 * forme invalide ; le ticket original reste utilisable avec un payload
 * conforme. Le résultat est `confirmation_failed`/`payload_mismatch` —
 * même statut public que toute autre divergence de payload, aucune
 * information supplémentaire n'est exposée.
 */
export async function confirmAndExecute(
  options: ConfirmAndExecuteOptions,
): Promise<ConfirmAndExecuteResult> {
  const { executor, confirmationService, confirmationId, payload } = options;

  let verifiedToolName: string;
  let verifiedInput: unknown;
  try {
    verifiedToolName = payload.toolName;
    verifiedInput = captureConfirmationInput(payload.input);
  } catch (err) {
    if (!(err instanceof UnsupportedConfirmationInputError)) {
      throw err;
    }
    return {
      status: 'confirmation_failed',
      failureReason: 'payload_mismatch',
      reason: describeConfirmationFailure('payload_mismatch'),
    };
  }

  const verification = await confirmationService.verify(confirmationId, payload);
  if (!verification.ok) {
    return {
      status: 'confirmation_failed',
      failureReason: verification.reason,
      reason: describeConfirmationFailure(verification.reason),
    };
  }

  return executor.run({ tool: verifiedToolName, input: verifiedInput, confirmed: true });
}
