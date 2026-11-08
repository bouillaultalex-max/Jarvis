import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';

import type { Connector } from '../connector.js';
import { ObsidianReadError } from './obsidian-errors.js';
import { OBSIDIAN_SEARCH_LIMIT, type ObsidianVaultClient } from './obsidian-powershell-client.js';

/**
 * Connecteur Obsidian (ADR-0025, Proposed, et son avenant). Deux `Tool`, tous
 * deux en lecture sur un vault unique configuré :
 *
 *   obsidian.read   (action: 'read') — lit une note par son chemin relatif exact.
 *   obsidian.search (action: 'read') — renvoie au plus cinq chemins de notes,
 *                                      sans ouvrir aucune note.
 *
 * Aucune capacité d'écriture ou de gestion : elles n'existent ni comme
 * `Tool`, ni comme méthode du client.
 */

export interface ObsidianReadInput {
  readonly vault: string;
  readonly path: string;
}

export type ObsidianReadOutput =
  | { readonly status: 'found'; readonly path: string; readonly content: string }
  | { readonly status: 'not_found'; readonly path: string };

export interface ObsidianSearchInput {
  readonly vault: string;
  readonly query: string;
}

export interface ObsidianSearchOutput {
  /** Chemins relatifs de notes « .md », dans l'ordre renvoyé par Obsidian. */
  readonly paths: readonly string[];
  /** Chemins valides renvoyés par Obsidian mais écartés car non Markdown. */
  readonly ignoredNonMarkdown: number;
}

const MAX_PATH_LENGTH = 1024;
const MAX_QUERY_LENGTH = 200;
const WINDOWS_FORBIDDEN = /[<>:"|?*\\]/;
// eslint-disable-next-line no-control-regex -- refus explicite des caractères de contrôle
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Diagnostic exact du lanceur pour une note absente (observé le 2026-11-08).
 * Seule une égalité **stricte** déclenche la vérification d'ambiguïté : un
 * texte qui commence simplement par `Error:` reste du contenu.
 */
export function obsidianNotFoundDiagnostic(path: string): string {
  return `Error: File "${path}" not found.\n`;
}

/**
 * Sortie exacte de `search … format=json` sans résultat (observée le
 * 2026-11-08) : un texte, pas du JSON. Seule l'égalité stricte vaut liste vide.
 */
export const OBSIDIAN_NO_MATCHES_OUTPUT = 'No matches found.\n';

/**
 * Valide un chemin relatif sous la racine du vault, quel que soit son type de
 * fichier. Renvoie un message d'erreur (sans jamais citer la valeur), ou
 * `undefined` si le chemin est acceptable.
 */
export function checkVaultRelativePath(path: string): string | undefined {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return `« path » doit contenir entre 1 et ${MAX_PATH_LENGTH} caractères.`;
  }
  if (CONTROL_CHARS.test(path)) {
    return '« path » contient un caractère de contrôle.';
  }
  if (WINDOWS_FORBIDDEN.test(path)) {
    return '« path » doit être relatif, avec « / » comme séparateur, sans caractère interdit par Windows.';
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return '« path » doit rester sous la racine du vault (segment vide, « . » ou « .. » refusé).';
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return '« path » contient un segment terminé par un point ou une espace.';
    }
    if (RESERVED_DEVICE.test(segment.split('.')[0] ?? '')) {
      return '« path » contient un nom réservé par Windows.';
    }
  }
  return undefined;
}

/** Comme {@link checkVaultRelativePath}, et exige une note « .md ». */
export function checkRelativeNotePath(path: string): string | undefined {
  const error = checkVaultRelativePath(path);
  if (error !== undefined) {
    return error;
  }
  return path.endsWith('.md') ? undefined : '« path » doit désigner une note « .md ».';
}

/** Normalisation de comparaison Windows : séparateurs, séparateur final, casse. */
function normalizeWindowsPath(path: string): string {
  let normalized = path.replace(/\//g, '\\');
  while (normalized.length > 3 && normalized.endsWith('\\')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

const ABSOLUTE_WINDOWS_PATH = /^[A-Za-z]:\\/;

/** Vérifie que le vault vu par Obsidian est bien la racine configurée. */
async function assertVaultMatchesRoot(client: ObsidianVaultClient): Promise<void> {
  const raw = await client.vaultPath();
  const reported = raw.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(reported) || !ABSOLUTE_WINDOWS_PATH.test(reported.replace(/\//g, '\\'))) {
    throw new ObsidianReadError('vault_check_failed');
  }
  if (normalizeWindowsPath(reported) !== normalizeWindowsPath(client.vaultRoot)) {
    throw new ObsidianReadError('vault_mismatch');
  }
}

async function readNote(
  client: ObsidianVaultClient,
  input: ObsidianReadInput,
): Promise<ObsidianReadOutput> {
  await assertVaultMatchesRoot(client);

  if ((await client.inspectNote(input.path)) === 'absent') {
    return { status: 'not_found', path: input.path };
  }

  const content = await client.readNote(input.path);
  if (content !== obsidianNotFoundDiagnostic(input.path)) {
    return { status: 'found', path: input.path, content };
  }

  // Diagnostic exact « introuvable » alors que le fichier existait : on
  // vérifie de nouveau, sans jamais trancher sur le seul texte.
  if ((await client.inspectNote(input.path)) === 'absent') {
    return { status: 'not_found', path: input.path };
  }
  throw new ObsidianReadError('ambiguous_not_found');
}

/**
 * Interprète la sortie brute de `search … format=json` :
 * `No matches found.\n` (exact) ou `[]` → liste vide ; sinon un tableau JSON
 * d'au plus {@link OBSIDIAN_SEARCH_LIMIT} chaînes, toutes des chemins valides
 * et distincts, **validés avant tout filtrage** ; les chemins non Markdown
 * sont ensuite écartés et comptés. Toute autre forme est une erreur.
 */
export function parseObsidianSearchOutput(raw: string): ObsidianSearchOutput {
  if (raw === OBSIDIAN_NO_MATCHES_OUTPUT) {
    return { paths: [], ignoredNonMarkdown: 0 };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ObsidianReadError('search_output_invalid');
  }
  if (!Array.isArray(data) || data.length > OBSIDIAN_SEARCH_LIMIT) {
    throw new ObsidianReadError('search_output_invalid');
  }
  const seen = new Set<string>();
  for (const entry of data as readonly unknown[]) {
    if (
      typeof entry !== 'string' ||
      checkVaultRelativePath(entry) !== undefined ||
      seen.has(entry)
    ) {
      throw new ObsidianReadError('search_output_invalid');
    }
    seen.add(entry);
  }
  const all = data as readonly string[];
  const paths = all.filter((path) => path.endsWith('.md'));
  return { paths, ignoredNonMarkdown: all.length - paths.length };
}

/** Contrôles communs : objet, clés autorisées, vault configuré. */
function validateVaultRecord(
  toolName: string,
  input: unknown,
  field: 'path' | 'query',
  vaultId: string,
): { readonly record: Record<string, unknown> } | { readonly error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: `${toolName} : entrée invalide.` };
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'vault' && key !== field)) {
    return { error: `${toolName} : seules les clés « vault » et « ${field} » sont acceptées.` };
  }
  if (typeof record['vault'] !== 'string' || record['vault'] !== vaultId) {
    return { error: `${toolName} : « vault » ne correspond pas au vault configuré.` };
  }
  return { record };
}

/** Seuls des messages fixes sortent de ces Tools. */
function fixedError(err: unknown): ObsidianReadError {
  return err instanceof ObsidianReadError ? err : new ObsidianReadError('process_failed');
}

function createObsidianReadTool(
  client: ObsidianVaultClient,
): Tool<ObsidianReadInput, ObsidianReadOutput> {
  return {
    name: 'obsidian.read',
    description:
      'Lit une note Markdown d’un vault Obsidian configuré, par son chemin relatif exact (lecture seule).',
    action: 'read',

    // Les deux champs sont requis ; toute autre clé est rejetée par
    // `validateInput` → `additionalProperties: false`.
    inputSchema: {
      type: 'object',
      properties: {
        vault: { type: 'string', minLength: 1, description: 'Identifiant du vault configuré.' },
        path: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_PATH_LENGTH,
          description: 'Chemin relatif exact de la note « .md », séparateur « / ».',
        },
      },
      required: ['vault', 'path'],
      additionalProperties: false,
    },

    validateInput(input: unknown): ToolValidationResult<ObsidianReadInput> {
      const checked = validateVaultRecord('obsidian.read', input, 'path', client.vaultId);
      if ('error' in checked) {
        return invalid(checked.error);
      }
      const { vault, path } = checked.record as { vault: string; path: unknown };
      if (typeof path !== 'string') {
        return invalid('obsidian.read : « path » doit être une chaîne.');
      }
      const pathError = checkRelativeNotePath(path);
      if (pathError !== undefined) {
        return invalid(`obsidian.read : ${pathError}`);
      }
      return valid({ vault, path });
    },

    async execute(input: ObsidianReadInput): Promise<ObsidianReadOutput> {
      try {
        return await readNote(client, input);
      } catch (err) {
        throw fixedError(err);
      }
    },
  };
}

function createObsidianSearchTool(
  client: ObsidianVaultClient,
): Tool<ObsidianSearchInput, ObsidianSearchOutput> {
  return {
    name: 'obsidian.search',
    description: `Recherche un texte dans un vault Obsidian configuré et renvoie au plus ${OBSIDIAN_SEARCH_LIMIT} chemins de notes, sans ouvrir aucune note (lecture seule).`,
    action: 'read',

    // Les deux champs sont requis ; toute autre clé est rejetée par
    // `validateInput` → `additionalProperties: false`.
    inputSchema: {
      type: 'object',
      properties: {
        vault: { type: 'string', minLength: 1, description: 'Identifiant du vault configuré.' },
        query: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_QUERY_LENGTH,
          description: 'Texte recherché (une ligne).',
        },
      },
      required: ['vault', 'query'],
      additionalProperties: false,
    },

    validateInput(input: unknown): ToolValidationResult<ObsidianSearchInput> {
      const checked = validateVaultRecord('obsidian.search', input, 'query', client.vaultId);
      if ('error' in checked) {
        return invalid(checked.error);
      }
      const { vault, query } = checked.record as { vault: string; query: unknown };
      if (
        typeof query !== 'string' ||
        query.trim() === '' ||
        query.length > MAX_QUERY_LENGTH ||
        CONTROL_CHARS.test(query)
      ) {
        return invalid(
          `obsidian.search : « query » doit être un texte d’une ligne, non vide, d’au plus ${MAX_QUERY_LENGTH} caractères.`,
        );
      }
      return valid({ vault, query });
    },

    async execute(input: ObsidianSearchInput): Promise<ObsidianSearchOutput> {
      try {
        await assertVaultMatchesRoot(client);
        return parseObsidianSearchOutput(await client.searchNotes(input.query));
      } catch (err) {
        throw fixedError(err);
      }
    },
  };
}

export const obsidianConnector: Connector<ObsidianVaultClient> = {
  id: 'obsidian',
  name: 'Obsidian',
  capabilities: ['obsidian.read', 'obsidian.search'],
  createTools(client: ObsidianVaultClient): readonly Tool[] {
    return [createObsidianReadTool(client), createObsidianSearchTool(client)];
  },
};
