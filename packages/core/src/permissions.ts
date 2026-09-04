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
 * `rules` associe un nom d'outil à une décision. `default` s'applique à tout
 * outil non listé. Aucun nom d'outil n'est codé en dur : la politique
 * fonctionne avec n'importe quel identifiant (`gmail.send`, `discord.read`…).
 */
export interface PermissionPolicy {
  readonly rules?: Readonly<Record<string, PermissionDecision>>;
  readonly default?: PermissionDecision;
}

/**
 * Politique par défaut sûre : en l'absence de règle explicite, on refuse.
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
  private readonly fallback: PermissionDecision;

  constructor(policy: PermissionPolicy = {}) {
    this.rules = new Map(Object.entries(policy.rules ?? {}));
    this.fallback = policy.default ?? SAFE_DEFAULT_DECISION;
  }

  /** Décision applicable à cet outil (règle explicite sinon politique par défaut). */
  decide(toolName: string): PermissionDecision {
    return this.rules.get(toolName) ?? this.fallback;
  }

  /** Définit ou remplace la règle d'un outil. */
  setRule(toolName: string, decision: PermissionDecision): void {
    this.rules.set(toolName, decision);
  }

  /** Retire la règle explicite d'un outil (il retombe sur la politique par défaut). */
  clearRule(toolName: string): void {
    this.rules.delete(toolName);
  }
}
