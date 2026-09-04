import type { Tool } from '@jarvis/core';

/**
 * Décrit un service externe (Gmail, Discord, Calendar…) sous forme d'un
 * ensemble de {@link Tool}. Un `Connector` ne prend jamais de décision de
 * permission (ça reste le rôle de `PermissionManager`/`ToolExecutor`) et ne
 * porte lui-même aucun credential.
 *
 * `TClient` est le type du client déjà authentifié attendu par ce
 * connecteur (ex. un client Gmail OAuth, un client bot Discord…). Ce type
 * n'existe que côté connecteur : il n'apparaît jamais dans `LlmMessage`, dans
 * `LlmToolCall`, ni dans l'input/output d'un `Tool` produit par
 * {@link Connector.createTools}. Le connecteur ne construit pas ce client
 * (pas de logique OAuth ici) — il le reçoit par injection.
 */
export interface Connector<TClient = unknown> {
  /** Identifiant stable, ex. `gmail`, `discord`, `calendar`, `inmemory`. */
  readonly id: string;
  /** Nom lisible par un humain. */
  readonly name: string;
  /**
   * Noms des `Tool` que ce connecteur est capable de produire, ex.
   * `['gmail.read', 'gmail.prepare_reply', 'gmail.send']`. Purement
   * déclaratif : ne requiert aucun client et ne construit rien.
   */
  readonly capabilities: readonly string[];
  /**
   * Construit les `Tool` de ce connecteur à partir d'un client déjà
   * authentifié. Chaque capacité correspond à un `Tool` distinct avec son
   * propre `ActionLevel` — un `Tool` de lecture ne peut jamais écrire.
   */
  createTools(client: TClient): readonly Tool[];
}
