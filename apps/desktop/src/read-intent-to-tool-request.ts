import type { ToolRequest } from '@jarvis/connectors';

import type { ReadInterpretation } from './read-intent-parser.js';

/**
 * Convertit, de façon **pure et déterministe**, une {@link ReadInterpretation}
 * déjà `understood` en un {@link ToolRequest} `gmail.read` — sous-étape de
 * VS-02 (`docs/second-readonly-vertical-slice.md`, section 5.5,
 * « Transformation contrôlée en `ToolRequest` »).
 *
 * Garanties structurelles :
 *   - synchrone, sans effet de bord, sans I/O, sans réseau, sans LLM ;
 *   - n'importe et n'appelle jamais `ToolExecutor`, `PermissionManager` ni
 *     `ConfirmationService` — produit uniquement la structure d'appel,
 *     jamais son exécution ni sa permission ;
 *   - refuse toute interprétation dont `status !== 'understood'`, l'absence
 *     de `proposedRead`, tout outil différent de `'gmail.read'`, et toute
 *     clé d'entrée non explicitement autorisée — ne fait **jamais**
 *     confiance à la forme déclarée par le type, revalide toujours à
 *     l'exécution (l'interprétation d'origine pourrait être construite à la
 *     main, notamment dans un test, sans passer par
 *     {@link interpretReadRequest}) ;
 *   - n'ajoute jamais de champ `authorized`/`confirmed`/`execute`/`ticket`/
 *     `permission`/`confirmation`/`verified` — le {@link ToolRequest}
 *     produit ne porte que `tool`/`input`, jamais `confirmed` (laissé
 *     entièrement à la charge d'un appelant futur, hors de ce module).
 *
 * Ce module réalise **uniquement** la transformation (5.5) — il ne réalise
 * pas l'« acceptation explicite » (5.4), volontairement laissée pour une
 * étape ultérieure (aucun branchement CLI à ce stade) : il traite
 * `status === 'understood'` comme la seule condition d'entrée disponible
 * pour l'instant.
 */

/** Seule clé d'entrée que `gmail.read` accepte réellement (`GmailReadInput`). */
const ALLOWED_INPUT_KEYS: ReadonlySet<string> = new Set(['maxResults']);

/**
 * Borne haute locale, **dupliquée intentionnellement** depuis
 * `MAX_ALLOWED_RESULTS` (`packages/connectors/src/gmail/gmail-connector.ts`,
 * non exportée) — même choix, et même justification, que dans
 * `read-intent-parser.ts` : évite de convertir avec confiance un nombre
 * manifestement hors de portée. La validation faisant autorité reste
 * exclusivement `gmail.read.validateInput()`, jamais remplacée ici.
 */
const MAX_ALLOWED_RESULTS = 50;

/** Nom du seul outil que ce module accepte de convertir. */
const ALLOWED_TOOL_NAME = 'gmail.read';

/** Réussite : un `ToolRequest` contrôlé, prêt à être soumis — jamais exécuté ici. */
export interface ReadToolRequestConversionSuccess {
  readonly ok: true;
  readonly toolRequest: ToolRequest;
}

/** Échec : aucune conversion effectuée, raison lisible, jamais de `ToolRequest` partiel. */
export interface ReadToolRequestConversionFailure {
  readonly ok: false;
  readonly reason: string;
}

export type ReadToolRequestConversionResult =
  ReadToolRequestConversionSuccess | ReadToolRequestConversionFailure;

function failure(reason: string): ReadToolRequestConversionFailure {
  return { ok: false, reason };
}

/**
 * Valide, sans jamais faire confiance au type déclaré, la forme exacte de
 * `proposedRead.input` : uniquement `maxResults`, absent ou entier positif
 * borné. Toute autre clé, tout type incorrect, ou tout nombre hors bornes
 * fait échouer la conversion — jamais une valeur silencieusement corrigée
 * ou ignorée.
 */
function validateProposedInput(input: unknown): { readonly maxResults?: number } | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;

  const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return undefined;
  }

  const { maxResults } = record;
  if (maxResults === undefined) {
    return {};
  }
  if (
    typeof maxResults !== 'number' ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_ALLOWED_RESULTS
  ) {
    return undefined;
  }
  return { maxResults };
}

/**
 * Convertit une {@link ReadInterpretation} en {@link ToolRequest} contrôlé.
 * Ne lève jamais. Ne conserve que ce que `gmail.read` accepte réellement.
 */
export function convertReadInterpretationToToolRequest(
  interpretation: ReadInterpretation,
): ReadToolRequestConversionResult {
  if (interpretation.status !== 'understood') {
    return failure(
      `Interprétation non acceptable pour conversion : statut « ${interpretation.status} », pas « understood ».`,
    );
  }

  const { proposedRead } = interpretation;
  if (proposedRead === undefined) {
    return failure('Interprétation « understood » sans proposedRead : conversion refusée.');
  }

  if (proposedRead.tool !== ALLOWED_TOOL_NAME) {
    return failure(
      `Outil proposé « ${String(proposedRead.tool)} » différent du seul outil accepté (« ${ALLOWED_TOOL_NAME} »).`,
    );
  }

  const validatedInput = validateProposedInput(proposedRead.input);
  if (validatedInput === undefined) {
    return failure(
      'Entrée proposée invalide : clé inattendue, type incorrect, ou maxResults nul/hors bornes.',
    );
  }

  return {
    ok: true,
    toolRequest: { tool: ALLOWED_TOOL_NAME, input: validatedInput },
  };
}
