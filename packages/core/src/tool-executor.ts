import type { ActionLevel, Tool } from './tool.js';
import type { PermissionDecision, PermissionManager } from './permissions.js';
import type { ToolRegistry } from './tool-registry.js';

/** Demande d'exécution d'un outil. */
export interface ToolRequest {
  /** Nom de l'outil à exécuter. */
  readonly tool: string;
  /** Entrée non fiable, validée par l'outil avant toute exécution. */
  readonly input: unknown;
  /**
   * `true` lorsqu'une confirmation utilisateur a déjà été obtenue pour une
   * action classée `require_confirmation`.
   */
  readonly confirmed?: boolean;
}

/** L'outil a été exécuté. */
export interface ToolExecuted<TOutput> {
  readonly status: 'executed';
  readonly decision: Extract<PermissionDecision, 'allow' | 'require_confirmation'>;
  readonly output: TOutput;
}

/** L'outil n'existe pas dans le registre. */
export interface ToolUnknown {
  readonly status: 'unknown_tool';
  readonly reason: string;
}

/** L'entrée fournie est invalide ; l'outil n'a pas été exécuté. */
export interface ToolInvalidInput {
  readonly status: 'invalid_input';
  readonly reason: string;
}

/**
 * L'outil a été exécuté mais a échoué techniquement (exception dans
 * `execute`). Distinct d'un refus de permission.
 */
export interface ToolFailed {
  readonly status: 'error';
  readonly reason: string;
}

/** La politique de permissions interdit l'action ; l'outil n'a pas été exécuté. */
export interface ToolDenied {
  readonly status: 'denied';
  readonly decision: Extract<PermissionDecision, 'deny'>;
  readonly reason: string;
}

/**
 * L'action nécessite une confirmation ; l'outil n'a pas été exécuté.
 * Rejouer la même requête avec `confirmed: true` pour l'exécuter.
 */
export interface ToolAwaitingConfirmation {
  readonly status: 'awaiting_confirmation';
  readonly decision: Extract<PermissionDecision, 'require_confirmation'>;
  readonly toolName: string;
  readonly action: ActionLevel;
  readonly input: unknown;
  readonly reason: string;
}

export type ToolExecutionResult<TOutput = unknown> =
  | ToolExecuted<TOutput>
  | ToolUnknown
  | ToolInvalidInput
  | ToolFailed
  | ToolDenied
  | ToolAwaitingConfirmation;

/**
 * Point de passage **unique** pour exécuter un outil.
 *
 *   requête → registre → validation → PermissionManager → allow / deny / confirm
 *
 * - `allow`                → exécution
 * - `deny`                 → aucune exécution
 * - `require_confirmation` → aucune exécution tant que `confirmed !== true`
 *
 * Le registre ne décide pas des permissions ; l'outil non plus.
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: PermissionManager,
  ) {}

  /**
   * Liste, **en lecture seule**, les outils enregistrés — pour qu'un
   * orchestrateur (ex. `AgentLoop`) puisse construire les définitions à
   * présenter au LLM. Renvoie une **copie** (celle produite par
   * `ToolRegistry.list`) : muter le tableau retourné n'affecte pas le
   * registre, qui reste privé et non mutable via cette API.
   */
  listTools(): readonly Tool[] {
    return this.registry.list();
  }

  async run(request: ToolRequest): Promise<ToolExecutionResult> {
    if (!this.registry.has(request.tool)) {
      return {
        status: 'unknown_tool',
        reason: `Outil inconnu : « ${request.tool} ».`,
      };
    }

    const tool = this.registry.get(request.tool);

    const validation = tool.validateInput(request.input);
    if (!validation.ok) {
      return { status: 'invalid_input', reason: validation.error };
    }

    const decision = this.permissions.decide(tool.name, tool.action);

    if (decision === 'deny') {
      return {
        status: 'denied',
        decision,
        reason: `Action « ${tool.name} » refusée par la politique de permissions.`,
      };
    }

    if (decision === 'require_confirmation' && request.confirmed !== true) {
      return {
        status: 'awaiting_confirmation',
        decision,
        toolName: tool.name,
        action: tool.action,
        input: validation.value,
        reason: `L'action « ${tool.name} » nécessite une confirmation explicite avant exécution.`,
      };
    }

    try {
      const output = await tool.execute(validation.value);
      return { status: 'executed', decision, output };
    } catch (err) {
      // Erreur *technique* de l'outil — jamais confondue avec un refus de permission.
      return {
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
