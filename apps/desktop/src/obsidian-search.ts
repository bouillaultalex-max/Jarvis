import {
  OBSIDIAN_READ_ERROR_MESSAGES,
  obsidianConnector,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type ObsidianSearchInput,
  type ToolExecutionResult,
} from '@jarvis/connectors';

import { parseObsidianOptions, type ObsidianReadDeps } from './obsidian-read.js';

/**
 * Sous-commande `obsidian-search` (ADR-0025, avenant `obsidian.search`) :
 *
 *   obsidian-search --vault <identifiant> --query <texte>
 *
 * Même composition et mêmes dépendances que `obsidian-read` (vault configuré,
 * contrôle de sa racine, lanceur PowerShell) : `obsidianConnector.createTools()`
 * → `ToolRegistry` → `PermissionManager` → `ToolExecutor`. Aucune dépendance
 * Gmail. Renvoie au plus cinq chemins de notes, sans ouvrir aucune note.
 */

export function parseObsidianSearchArgs(argv: readonly string[]): ObsidianSearchInput {
  const { vault, query } = parseObsidianOptions('obsidian-search', ['vault', 'query'], argv);
  return { vault, query };
}

export async function runObsidianSearchFlow(
  input: ObsidianSearchInput,
  deps: ObsidianReadDeps,
): Promise<ToolExecutionResult> {
  const registry = new ToolRegistry();
  for (const tool of obsidianConnector.createTools(deps.client)) {
    registry.register(tool);
  }
  const permissionManager =
    deps.permissionManager ?? new PermissionManager({ rules: { 'obsidian.search': 'allow' } });
  const executor = new ToolExecutor(registry, permissionManager);
  return executor.run({ tool: 'obsidian.search', input });
}

const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(OBSIDIAN_READ_ERROR_MESSAGES),
);

/**
 * Lignes d'affichage. Succès : un chemin Markdown par ligne, dans l'ordre
 * d'Obsidian ; puis, le cas échéant, le nombre de résultats non Markdown
 * écartés (ligne qui ne se termine jamais par « .md »). Échec : message JARVIS
 * fixe, jamais la sortie brute du lanceur.
 */
export function describeObsidianSearchResult(result: ToolExecutionResult): readonly string[] {
  switch (result.status) {
    case 'executed': {
      const output = result.output as {
        readonly paths?: unknown;
        readonly ignoredNonMarkdown?: unknown;
      };
      const paths = Array.isArray(output?.paths)
        ? output.paths.filter((path): path is string => typeof path === 'string')
        : [];
      const ignored =
        typeof output?.ignoredNonMarkdown === 'number' ? output.ignoredNonMarkdown : 0;
      const lines = paths.length > 0 ? [...paths] : ['Aucune note trouvée.'];
      if (ignored > 0) {
        lines.push(`(${ignored} résultat(s) non Markdown ignoré(s).)`);
      }
      return lines;
    }
    case 'invalid_input':
      return [`Recherche Obsidian refusée : ${result.reason}`];
    case 'denied':
      return ['Recherche Obsidian refusée par la politique de permissions.'];
    case 'error':
      return [
        KNOWN_ERROR_MESSAGES.has(result.reason)
          ? `Recherche Obsidian échouée : ${result.reason}`
          : 'Recherche Obsidian échouée.',
      ];
    default:
      return [`Recherche Obsidian échouée (${result.status}).`];
  }
}

/** `0` pour une recherche réussie, avec ou sans résultat ; `1` sinon. */
export function obsidianSearchExitCode(result: ToolExecutionResult): number {
  return result.status === 'executed' ? 0 : 1;
}
