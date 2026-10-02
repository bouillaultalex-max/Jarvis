/**
 * BANC ISOLE — runner deterministe.
 *
 * Fait transiter chaque mission par le **chemin reel** :
 *   ToolRegistry → PermissionManager → ToolExecutor → AgentLoop → LlmProvider
 * exactement comme le ferait une application Jarvis, a une seule difference
 * assumee : `LlmProvider` est `ScriptedLlmProvider` (reponses figees), pas
 * `AnthropicProvider` (reseau reel). Voir `scripted-provider.ts` pour la
 * portee exacte de cette limite.
 */

import {
  AgentLoop,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type LlmResponse,
} from '@jarvis/core';

import {
  buildPermissionPolicy,
  buildRepresentation,
  toolNameFor,
  type RepresentationId,
} from './representations.js';
import { ScriptedLlmProvider } from './scripted-provider.js';
import type { CapabilityKey } from './capabilities.js';
import type { Mission, MissionOutcome, ScriptTurn, Verdict } from './missions.js';

/** Budget d'iterations et modele de reference du banc — constants entre representations. */
export const BENCH_CONFIG = {
  maxIterations: 6,
  /** Non utilise par `ScriptedLlmProvider` — conserve pour le futur essai reel (voir rapport). */
  model: 'claude-sonnet-5',
} as const;

const REFUSAL_STATUSES = new Set(['denied', 'awaiting_confirmation']);

export interface MissionMetrics {
  readonly missionId: string;
  readonly representation: RepresentationId;
  readonly verdict: Verdict;
  readonly reason: string;
  /** Present uniquement si `verdict === 'review_required'` (voir `Mission.evaluate`). */
  readonly review?: { readonly grid: readonly string[]; readonly evidence: string };
  readonly stopReason: MissionOutcome['stopReason'];
  readonly iterations: number;
  readonly toolCallCount: number;
  readonly argumentErrors: number;
  readonly refusalCount: number;
  /** Nombre d'outils tentes APRES un refus dans la meme mission — doit toujours valoir 0. */
  readonly postRefusalToolAttempts: number;
  /** Duree d'execution du banc (plomberie locale) — PAS une latence de modele reel. */
  readonly harnessDurationMs: number;
  /**
   * Noms d'outils reellement recus par `LlmProvider.chat(messages, { tools })`
   * au premier tour — capture directe de ce que `AgentLoop` a transmis au
   * provider sur CE chemin de production, pas une reconstruction separee.
   * Preuve que la representation testee est bien celle qui circule jusqu'au
   * provider.
   */
  readonly transmittedToolNames: readonly string[];
}

function resolveTurn(
  turn: ScriptTurn,
  representation: RepresentationId,
  index: number,
): LlmResponse {
  if (turn.kind === 'final') {
    return { content: turn.content };
  }
  const tool = turn.kind === 'tool_call' ? toolNameFor(representation, turn.capability) : turn.tool;
  return { content: '', toolCall: { id: `turn-${index}`, tool, input: turn.input } };
}

function countPostRefusalAttempts(outcomes: MissionOutcome['toolOutcomes']): number {
  const firstRefusalIndex = outcomes.findIndex((o) => REFUSAL_STATUSES.has(o.status));
  if (firstRefusalIndex === -1) {
    return 0;
  }
  return outcomes.length - firstRefusalIndex - 1;
}

export async function runMission(
  mission: Mission,
  representation: RepresentationId,
): Promise<MissionMetrics> {
  const registry = new ToolRegistry();
  for (const tool of buildRepresentation(representation)) {
    registry.register(tool);
  }
  const permissions = new PermissionManager(buildPermissionPolicy(representation));
  const toolExecutor = new ToolExecutor(registry, permissions);
  const provider = new ScriptedLlmProvider(
    mission.script.map((t, i) => resolveTurn(t, representation, i)),
  );
  const loop = new AgentLoop(provider, {
    toolExecutor,
    maxIterations: mission.maxIterations ?? BENCH_CONFIG.maxIterations,
  });

  const confirmedTools = (mission.confirmedCapabilities ?? []).map((c: CapabilityKey) =>
    toolNameFor(representation, c),
  );

  const started = performance.now();
  const result = await loop.run(mission.prompt, { confirmedTools });
  const harnessDurationMs = performance.now() - started;

  const outcome: MissionOutcome = {
    content: result.content,
    iterations: result.iterations,
    stopReason: result.stopReason,
    toolOutcomes: result.toolOutcomes,
  };
  const evaluation = mission.evaluate(outcome);

  return {
    missionId: mission.id,
    representation,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    review: evaluation.review,
    stopReason: outcome.stopReason,
    iterations: outcome.iterations,
    toolCallCount: outcome.toolOutcomes.length,
    argumentErrors: outcome.toolOutcomes.filter((o) => o.status === 'invalid_input').length,
    refusalCount: outcome.toolOutcomes.filter((o) => REFUSAL_STATUSES.has(o.status)).length,
    postRefusalToolAttempts: countPostRefusalAttempts(outcome.toolOutcomes),
    harnessDurationMs,
    transmittedToolNames: (provider.receivedToolDefinitions[0] ?? []).map((t) => t.name),
  };
}

export async function runMatrix(
  missions: readonly Mission[],
  representations: readonly RepresentationId[],
): Promise<readonly MissionMetrics[]> {
  const results: MissionMetrics[] = [];
  for (const representation of representations) {
    for (const mission of missions) {
      results.push(await runMission(mission, representation));
    }
  }
  return results;
}

export interface RepresentationSummary {
  readonly representation: RepresentationId;
  readonly total: number;
  readonly pass: number;
  readonly reviewRequired: number;
  readonly fail: number;
  readonly notApplicable: number;
  readonly postRefusalViolations: number;
}

function countVerdict(metrics: readonly MissionMetrics[], verdict: Verdict): number {
  return metrics.filter((m) => m.verdict === verdict).length;
}

/**
 * Agrege les metriques par representation, verdict par verdict — ne reduit
 * jamais `review_required` a un succes ou un echec implicite. Les seuils
 * (18/20, ecart <= 2, zero action apres refus) restent ceux, exploratoires,
 * de la veille — cette fonction les rend calculables sur `pass`, elle ne les
 * valide pas comme preuve statistique (voir rapport de mission).
 */
export function summarizeByRepresentation(metrics: readonly MissionMetrics[]): {
  readonly byRepresentation: readonly RepresentationSummary[];
  readonly maxPassGap: number;
} {
  const byRepresentation = Array.from(new Set(metrics.map((m) => m.representation))).map(
    (representation): RepresentationSummary => {
      const subset = metrics.filter((m) => m.representation === representation);
      return {
        representation,
        total: subset.length,
        pass: countVerdict(subset, 'pass'),
        reviewRequired: countVerdict(subset, 'review_required'),
        fail: countVerdict(subset, 'fail'),
        notApplicable: countVerdict(subset, 'not_applicable'),
        postRefusalViolations: subset.reduce((sum, m) => sum + m.postRefusalToolAttempts, 0),
      };
    },
  );
  const passCounts = byRepresentation.map((r) => r.pass);
  const maxPassGap = passCounts.length > 0 ? Math.max(...passCounts) - Math.min(...passCounts) : 0;
  return { byRepresentation, maxPassGap };
}
