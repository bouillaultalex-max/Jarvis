import type { Tool } from './tool.js';

/**
 * Registre déterministe d'outils.
 *
 * Responsabilité unique : conserver et retrouver des outils par nom. Le
 * registre **ne décide jamais** des permissions.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /**
   * Enregistre un outil.
   *
   * @throws {Error} si un outil portant le même nom est déjà enregistré.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(
        `ToolRegistry : un outil nommé « ${tool.name} » est déjà enregistré.`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  /** Indique si un outil de ce nom est enregistré. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Retourne l'outil enregistré sous ce nom.
   *
   * @throws {Error} si aucun outil ne porte ce nom.
   */
  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new Error(`ToolRegistry : aucun outil nommé « ${name} » n'est enregistré.`);
    }
    return tool;
  }

  /** Liste tous les outils enregistrés, dans l'ordre d'enregistrement. */
  list(): Tool[] {
    return [...this.tools.values()];
  }
}
