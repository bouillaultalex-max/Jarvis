import type { ActionLevel } from './tool.js';

/**
 * Décision de permission pour une action d'outil.
 *
 * - `allow`                : l'action peut être exécutée.
 * - `deny`                 : l'action ne doit jamais être exécutée.
 * - `require_confirmation` : l'action nécessite une confirmation explicite
 *                            avant toute exécution.
 */
export type PermissionDecision = 'allow' | 'deny' | 'require_confirmation';

/**
 * Politique de permissions.
 *
 * Résolution, du plus spécifique au plus général :
 *   1. `rules[toolName]`            — règle explicite pour cet outil
 *   2. `actionDefaults[actionLevel]` — défaut pour ce niveau d'action
 *   3. `default`                    — défaut global de la politique
 *   4. `SAFE_DEFAULT_DECISION`      — filet de sécurité (`deny`)
 *
 * Aucun nom d'outil n'est codé en dur : la politique fonctionne avec n'importe
 * quel identifiant (`gmail.send`, `discord.read`, `calendar.create`…).
 */
export interface PermissionPolicy {
  readonly rules?: Readonly<Record<string, PermissionDecision>>;
  readonly actionDefaults?: Readonly<Partial<Record<ActionLevel, PermissionDecision>>>;
  readonly default?: PermissionDecision;
}

/**
 * Politique par défaut sûre : en l'absence de toute règle, on refuse.
 * Jamais « allow everything ».
 */
export const SAFE_DEFAULT_DECISION: PermissionDecision = 'deny';

/**
 * Décide, de façon centralisée, si une action d'outil est autorisée.
 *
 * Ni le registre ni les outils ne prennent cette décision.
 */
export class PermissionManager {
  private readonly rules: Map<string, PermissionDecision>;
  private readonly actionDefaults: Map<ActionLevel, PermissionDecision>;
  private readonly fallback: PermissionDecision;

  constructor(policy: PermissionPolicy = {}) {
    this.rules = new Map(Object.entries(policy.rules ?? {}));
    this.actionDefaults = new Map(
      Object.entries(policy.actionDefaults ?? {}) as ReadonlyArray<
        [ActionLevel, PermissionDecision]
      >,
    );
    this.fallback = policy.default ?? SAFE_DEFAULT_DECISION;
  }

  /**
   * Décision applicable à `(toolName, action)`.
   *
   * Règle explicite de l'outil → défaut du niveau d'action → défaut global →
   * `deny`.
   */
  decide(toolName: string, action: ActionLevel): PermissionDecision {
    return this.rules.get(toolName) ?? this.actionDefaults.get(action) ?? this.fallback;
  }

  /** Définit ou remplace la règle explicite d'un outil. */
  setRule(toolName: string, decision: PermissionDecision): void {
    this.rules.set(toolName, decision);
  }

  /** Retire la règle explicite d'un outil (il retombe sur la résolution par défaut). */
  clearRule(toolName: string): void {
    this.rules.delete(toolName);
  }
}
