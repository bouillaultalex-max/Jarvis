import { randomUUID } from 'node:crypto';

import {
  ToolExecutor,
  type PermissionManager,
  type ToolExecutionResult,
  type ToolRegistry,
  type ToolRequest,
} from '@jarvis/connectors';

/**
 * Trace structurée EN MÉMOIRE du parcours `verify-demo` — phases et statuts
 * CONTRÔLÉS uniquement (jamais d'input/output/payload/summary/confirmationId
 * ni raison d'exception, jamais de texte libre ni de date personnelle).
 * Aucune persistance, aucun fichier, aucun callback externe : un snapshot
 * (`VerifyDemoTraceRecorder.snapshot`) est une copie détachée, renvoyée dans
 * le résultat du flux — jamais une garantie d'audit durable.
 */

export type TracePhase = 'proposal' | 'confirmation_decision' | 'execution' | 'verification';

/** Statuts réels de `ToolExecutor` (`@jarvis/core`) — déjà un ensemble contrôlé fermé. */
export type ToolCallStatus = ToolExecutionResult['status'];

/** Décision de confirmation — jamais de `confirmationId` ni de ticket. */
export type ConfirmationDecisionStatus = 'approved' | 'declined' | 'failed' | 'error';

/** Verdict de vérification de postcondition, ou échec de sa préparation. */
export type VerificationStatus =
  'satisfied' | 'contradicted' | 'insufficient_evidence' | 'preparation_failed';

export type TraceStatus = ToolCallStatus | ConfirmationDecisionStatus | VerificationStatus;

export interface VerifyDemoTraceEvent {
  readonly sequence: number;
  readonly phase: TracePhase;
  readonly status: TraceStatus;
  /** Présent uniquement pour un appel réel via `ToolExecutor.runTracked`. */
  readonly invocationId?: string;
}

export interface VerifyDemoTrace {
  readonly missionId: string;
  readonly events: readonly VerifyDemoTraceEvent[];
}

/**
 * Enregistreur interne, privé à une invocation de `runVerifyDemo`. `missionId`
 * est un UUID généré par invocation (jamais réutilisé entre deux appels).
 */
export class VerifyDemoTraceRecorder {
  readonly missionId: string;
  private readonly events: VerifyDemoTraceEvent[] = [];

  constructor(missionId: string = randomUUID()) {
    this.missionId = missionId;
  }

  record(phase: TracePhase, status: TraceStatus, invocationId?: string): void {
    const sequence = this.events.length + 1;
    const event: VerifyDemoTraceEvent =
      invocationId === undefined
        ? { sequence, phase, status }
        : { sequence, phase, status, invocationId };
    this.events.push(Object.freeze(event));
  }

  /**
   * Copie détachée : un nouveau tableau et de nouveaux objets à chaque appel.
   * Muter le snapshot renvoyé (ou un snapshot précédent) n'affecte jamais ce
   * recorder ni un autre snapshot déjà pris.
   */
  snapshot(): VerifyDemoTrace {
    return Object.freeze({
      missionId: this.missionId,
      events: Object.freeze(this.events.map((event) => Object.freeze({ ...event }))),
    });
  }
}

/**
 * Sous-type LOCAL de `ToolExecutor` (API publique réelle, inchangée) : seul
 * moyen d'obtenir un `invocationId` réel (`ToolExecutor.runTracked`) pour
 * chaque appel que `proposeConfirmation`/`runWithVerification` font déjà via
 * `executor.run(...)`, SANS jamais appeler `run()` ET `runTracked()` pour la
 * même requête — `run()` délègue à `super.runTracked()` une seule fois et
 * renvoie `result` strictement inchangé. `PermissionManager` et le registre
 * réels restent seuls juges ; ce sous-type ne décide rien et n'ajoute aucun
 * champ au résultat renvoyé à l'appelant.
 */
export class TracingToolExecutor extends ToolExecutor {
  constructor(
    registry: ToolRegistry,
    permissions: PermissionManager,
    private readonly onInvocation: (invocationId: string, result: ToolExecutionResult) => void,
  ) {
    super(registry, permissions);
  }

  override async run(request: ToolRequest): Promise<ToolExecutionResult> {
    const { invocationId, result } = await super.runTracked(request);
    this.onInvocation(invocationId, result);
    return result;
  }
}
