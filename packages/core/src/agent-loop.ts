import type { LlmMessage, LlmProvider } from '@jarvis/llm';

import type { ToolExecutionResult, ToolExecutor } from './tool-executor.js';

/** Raison pour laquelle un tour de conversation s'est terminé. */
export type AgentStopReason =
  /** Le modèle a produit une réponse finale (aucune demande d'outil). */
  | 'llm_final'
  /** Un outil demandé n'a pas pu être exécuté (refus, confirmation, erreur…). */
  | 'tool_blocked'
  /** La limite d'itérations a été atteinte. */
  | 'max_iterations';

/** Résultat structuré d'un tour de conversation. */
export interface AgentResult {
  /** Texte de la dernière réponse du modèle. */
  readonly content: string;
  /** Nombre d'appels au modèle réalisés durant ce tour. */
  readonly iterations: number;
  /** Pourquoi le tour s'est arrêté. */
  readonly stopReason: AgentStopReason;
  /**
   * Résultats des outils sollicités durant ce tour, dans l'ordre. Vide si le
   * modèle n'a demandé aucun outil.
   */
  readonly toolOutcomes: readonly ToolExecutionResult[];
}

export interface AgentLoopOptions {
  /** Passerelle d'exécution d'outils. Absente → aucun outil ne peut être exécuté. */
  readonly toolExecutor?: ToolExecutor;
  /** Nombre maximum d'appels au modèle par tour (défaut : 5, minimum : 1). */
  readonly maxIterations?: number;
}

export interface AgentRunOptions {
  /**
   * Noms d'outils pour lesquels une confirmation utilisateur a déjà été
   * accordée pour ce tour. Un outil classé `require_confirmation` ne s'exécute
   * que si son nom figure ici.
   */
  readonly confirmedTools?: readonly string[];
}

const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Moteur d'orchestration d'un tour de conversation.
 *
 *   message utilisateur
 *      → LLM
 *      → (demande d'outil ?) → ToolExecutor → PermissionManager → outil
 *      → résultat transmis au LLM
 *      → réponse finale
 *
 * `AgentLoop` ne connaît que les interfaces {@link LlmProvider} et
 * {@link ToolExecutor}. Il n'appelle **jamais** `tool.execute()` directement :
 * tout passe par le {@link ToolExecutor}. La boucle est bornée par
 * `maxIterations` — aucun tour ne peut être infini.
 */
export class AgentLoop {
  private readonly llm: LlmProvider;
  private readonly toolExecutor: ToolExecutor | undefined;
  private readonly maxIterations: number;

  constructor(llm: LlmProvider, options: AgentLoopOptions = {}) {
    this.llm = llm;
    this.toolExecutor = options.toolExecutor;

    const max = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('AgentLoop : « maxIterations » doit être un entier >= 1.');
    }
    this.maxIterations = max;
  }

  /**
   * Comportement historique conservé : renvoie le texte de la réponse finale.
   *
   * @throws {Error} si `message` est vide ou uniquement composé d'espaces.
   */
  async process(message: string): Promise<string> {
    return (await this.run(message)).content;
  }

  /**
   * Exécute un tour complet et renvoie un résultat structuré.
   *
   * @throws {Error} si `message` est vide ou uniquement composé d'espaces.
   */
  async run(message: string, options: AgentRunOptions = {}): Promise<AgentResult> {
    if (message.trim().length === 0) {
      throw new Error('AgentLoop.run : le message utilisateur est vide.');
    }

    const confirmed = new Set(options.confirmedTools ?? []);
    const messages: LlmMessage[] = [{ role: 'user', content: message }];
    const toolOutcomes: ToolExecutionResult[] = [];

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const response = await this.llm.chat(messages);
      const call = response.toolCall;

      if (call === undefined || this.toolExecutor === undefined) {
        return {
          content: response.content,
          iterations: iteration,
          stopReason: 'llm_final',
          toolOutcomes,
        };
      }

      const outcome = await this.toolExecutor.run({
        tool: call.tool,
        input: call.input,
        confirmed: confirmed.has(call.tool),
      });
      toolOutcomes.push(outcome);

      if (outcome.status !== 'executed') {
        return {
          content: response.content,
          iterations: iteration,
          stopReason: 'tool_blocked',
          toolOutcomes,
        };
      }

      // Outil exécuté : on transmet le résultat au modèle pour la suite du tour.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: formatToolResult(call.tool, outcome.output) });

      if (iteration === this.maxIterations) {
        return {
          content: response.content,
          iterations: iteration,
          stopReason: 'max_iterations',
          toolOutcomes,
        };
      }
    }

    /* c8 ignore next 3 -- inatteignable : la boucle retourne toujours */
    throw new Error('AgentLoop.run : état inattendu (boucle non terminée).');
  }
}

/**
 * Formatage minimal d'un résultat d'outil réinjecté dans la conversation.
 *
 * NB : tant que le contrat `LlmProvider` reste `chat(messages)`, le résultat est
 * transmis en texte. Un vrai bloc `tool_result` structuré suivra avec le
 * tool-use Anthropic.
 */
function formatToolResult(tool: string, output: unknown): string {
  return `Résultat de l'outil « ${tool} » : ${JSON.stringify(output)}`;
}
