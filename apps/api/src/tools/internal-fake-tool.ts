import { invalid, valid, type Tool, type ToolValidationResult } from '@jarvis/core';

/**
 * Outil factice interne à `apps/api` (ADR-0009) — sert uniquement à valider
 * le protocole de confirmation HTTP d'ADR-0008 de bout en bout, sans jamais
 * dépendre d'un connecteur réel ni produire d'effet de bord.
 *
 * Ne jamais réutiliser ce nom ni cette implémentation pour un outil de
 * production : préfixe `internal.` délibérément non ambigu.
 */

export const INTERNAL_FAKE_EXECUTE_TOOL_NAME = 'internal.fake_execute';

export type InternalFakeExecuteMode = 'confirm' | 'error';

export interface InternalFakeExecuteInput {
  readonly mode: InternalFakeExecuteMode;
}

export interface InternalFakeExecuteOutput {
  readonly ok: true;
  readonly mode: InternalFakeExecuteMode;
}

const VALID_MODES: ReadonlySet<string> = new Set(['confirm', 'error']);

/**
 * `validateInput` reste volontairement trivial, local et structurellement
 * incapable de lever (aucun `JSON.parse`, aucune I/O, aucune récursion) —
 * condition explicite d'ADR-0009 §1/§4, tant que la précondition ADR-0006
 * (absence de `try`/`catch` autour de `validateInput` dans
 * `ToolExecutor.run()`) reste ouverte.
 */
function validateInput(input: unknown): ToolValidationResult<InternalFakeExecuteInput> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('« input » doit être un objet.');
  }

  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'mode') {
    return invalid('« input » doit contenir exactement la clé « mode ».');
  }

  const mode = (input as Record<string, unknown>).mode;
  if (typeof mode !== 'string' || !VALID_MODES.has(mode)) {
    return invalid('« mode » doit valoir « confirm » ou « error ».');
  }

  return valid({ mode: mode as InternalFakeExecuteMode });
}

/**
 * Aucun réseau, aucun système de fichiers, aucune ressource externe.
 * `mode: 'error'` lève délibérément pour exercer la branche `error` de
 * `ToolExecutor.run()` (déjà protégée par un `try`/`catch` côté core) ;
 * tout autre mode valide renvoie une sortie fixe et non sensible.
 */
async function execute(input: InternalFakeExecuteInput): Promise<InternalFakeExecuteOutput> {
  if (input.mode === 'error') {
    throw new Error('Erreur de test interne délibérée (outil factice).');
  }
  return { ok: true, mode: input.mode };
}

export const internalFakeExecuteTool: Tool<InternalFakeExecuteInput, InternalFakeExecuteOutput> = {
  name: INTERNAL_FAKE_EXECUTE_TOOL_NAME,
  description:
    "Outil factice interne, sans effet de bord, réservé à la validation du protocole de confirmation HTTP d'apps/api (ADR-0009). Ne jamais exposer en dehors de ce périmètre.",
  action: 'execute',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['confirm', 'error'] },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  validateInput,
  execute,
};
