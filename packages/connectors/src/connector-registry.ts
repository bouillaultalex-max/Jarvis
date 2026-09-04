import type { Connector } from './connector.js';
import { UnknownConnectorError } from './errors.js';

/**
 * Registre déterministe de `Connector`, symétrique à `ToolRegistry` côté
 * `@jarvis/core`.
 *
 * Responsabilité unique : conserver et retrouver des connectors par id. Ne
 * contient aucune logique métier spécifique à un provider (Gmail,
 * Calendar, Slack…) et ne prend aucune décision de permission — ça reste
 * le rôle exclusif de `PermissionManager`.
 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  /**
   * Enregistre un connector.
   *
   * @throws {Error} si un connector portant le même id est déjà enregistré.
   */
  register(connector: Connector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(
        `ConnectorRegistry : un connector nommé « ${connector.id} » est déjà enregistré.`,
      );
    }
    this.connectors.set(connector.id, connector);
  }

  /** Indique si un connector de cet id est enregistré. */
  has(id: string): boolean {
    return this.connectors.has(id);
  }

  /**
   * Retourne le connector enregistré sous cet id.
   *
   * @throws {UnknownConnectorError} si aucun connector ne porte cet id.
   */
  get(id: string): Connector {
    const connector = this.connectors.get(id);
    if (connector === undefined) {
      throw new UnknownConnectorError(id);
    }
    return connector;
  }

  /** Liste tous les connectors enregistrés, dans l'ordre d'enregistrement. */
  list(): Connector[] {
    return [...this.connectors.values()];
  }

  /**
   * Capabilities déclarées par un connector (`Connector.capabilities`).
   * Délègue entièrement au connector — n'invente ni ne filtre rien.
   *
   * @throws {UnknownConnectorError} si aucun connector ne porte cet id.
   */
  listCapabilities(id: string): readonly string[] {
    return this.get(id).capabilities;
  }
}
