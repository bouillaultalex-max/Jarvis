import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';

import type { Connector } from '../connector.js';
import { ObsidianReadError } from './obsidian-errors.js';
import type { ObsidianVaultClient } from './obsidian-powershell-client.js';

/**
 * Connecteur Obsidian (ADR-0025, Proposed). Un seul `Tool` :
 *
 *   obsidian.read (action: 'read') — lit une note d'un vault unique configuré.
 *
 * Aucune capacité d'écriture, de recherche ou de gestion : elles n'existent
 * ni comme `Tool`, ni comme méthode du client.
 */

export interface ObsidianReadInput {
  readonly vault: string;
  readonly path: string;
}

export type ObsidianReadOutput =
  | { readonly status: 'found'; readonly path: string; readonly content: string }
  | { readonly status: 'not_found'; readonly path: string };

const MAX_PATH_LENGTH = 1024;
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
 * Valide un chemin relatif de note. Renvoie un message d'erreur (sans jamais
 * citer la valeur), ou `undefined` si le chemin est acceptable.
 */
export function checkRelativeNotePath(path: string): string | undefined {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return `« path » doit contenir entre 1 et ${MAX_PATH_LENGTH} caractères.`;
  }
  if (CONTROL_CHARS.test(path)) {
    return '« path » contient un caractère de contrôle.';
  }
  if (WINDOWS_FORBIDDEN.test(path)) {
    return '« path » doit être relatif, avec « / » comme séparateur, sans caractère interdit par Windows.';
  }
  if (!path.endsWith('.md')) {
    return '« path » doit désigner une note « .md ».';
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
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return invalid('obsidian.read : entrée invalide.');
      }
      const record = input as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== 'vault' && key !== 'path')) {
        return invalid('obsidian.read : seules les clés « vault » et « path » sont acceptées.');
      }
      const { vault, path } = record;
      if (typeof vault !== 'string' || vault !== client.vaultId) {
        return invalid('obsidian.read : « vault » ne correspond pas au vault configuré.');
      }
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
        // Seuls des messages fixes sortent de ce Tool.
        throw err instanceof ObsidianReadError ? err : new ObsidianReadError('process_failed');
      }
    },
  };
}

export const obsidianConnector: Connector<ObsidianVaultClient> = {
  id: 'obsidian',
  name: 'Obsidian',
  capabilities: ['obsidian.read'],
  createTools(client: ObsidianVaultClient): readonly Tool[] {
    return [createObsidianReadTool(client)];
  },
};
