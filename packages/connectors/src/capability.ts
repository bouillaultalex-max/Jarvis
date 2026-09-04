import type { Tool } from '@jarvis/core';

/**
 * Description déclarative de ce qu'un connector sait faire.
 *
 * Une `Capability` documente une action possible — elle ne décide jamais
 * si cette action est autorisée. `action` n'est qu'une information
 * descriptive recopiée de `Tool.action` : ce module ne l'interprète pas et
 * ne l'utilise pour aucun choix d'autorisation. Seul `PermissionManager`
 * (côté `@jarvis/core`), à partir de ce même `ActionLevel`, décide si
 * l'action peut s'exécuter :
 *
 *   Capability → Connector/Tool → ActionLevel → PermissionManager → ToolExecutor
 *
 * Ceci n'est PAS un second système de permissions.
 */
export interface Capability {
  /** Identifiant de la capability — identique au nom du `Tool` correspondant. */
  readonly id: string;
  /** Connector qui déclare cette capability. */
  readonly connectorId: string;
  /** Recopié de `Tool.action` — jamais une échelle parallèle. */
  readonly action: Tool['action'];
  readonly description: string;
}

/**
 * Dérive les `Capability` d'un connector à partir des `Tool` qu'il produit.
 * Fonction pure, indépendante de tout provider : n'importe quel connector
 * (Gmail, Calendar, Slack, GitHub…) peut l'utiliser pour déclarer ses
 * capabilities sans logique dupliquée.
 */
export function describeCapabilities(connectorId: string, tools: readonly Tool[]): Capability[] {
  return tools.map((tool) => ({
    id: tool.name,
    connectorId,
    action: tool.action,
    description: tool.description,
  }));
}
