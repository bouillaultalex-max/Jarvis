import type { GmailReadInput, ToolExecutionResult, ToolRequest } from '@jarvis/connectors';

import type { ConnectGmailFn, DesktopDeps } from './main.js';
import { runReadFlow } from './main.js';
import { interpretReadRequest, type ReadInterpretation } from './read-intent-parser.js';
import {
  convertReadInterpretationToToolRequest,
  type ReadToolRequestConversionResult,
} from './read-intent-to-tool-request.js';
import {
  requestReadInterpretationAcceptance,
  type InterpretationAcceptanceRefusalReason,
  type InterpretationAcceptanceResult,
  type ReadInterpretationAcceptanceIo,
} from './read-interpretation-acceptance.js';

/**
 * Orchestration isolée VS-02d : compose les trois modules VS-02 déjà
 * validés et `runReadFlow` (VS-01), **sans réimplémenter aucune de leurs
 * étapes** et sans les modifier.
 *
 *   texte libre
 *     → interpretReadRequest()                (VS-02a, inchangé)
 *     → arrêt si ambiguous/unsupported
 *     → requestReadInterpretationAcceptance()  (VS-02c, inchangé)
 *     → arrêt si refus ou erreur d'acceptation
 *     → convertReadInterpretationToToolRequest() (VS-02b, inchangé)
 *     → arrêt si conversion échouée
 *     → runReadFlow(deps, toolRequest.input, …) (VS-01, inchangé)
 *     → restitution structurée du résultat
 *
 * Ce module ne construit et n'importe jamais `ToolRegistry`, `ToolExecutor`,
 * `PermissionManager` ou `ConfirmationService` — ces responsabilités
 * restent exclusivement dans `runReadFlow`. Il ne transmet jamais de nom
 * d'outil : seul `toolRequest.input` (jamais `toolRequest.tool`) est
 * transmis à `runReadFlow`, qui décide lui-même, en dur, d'appeler
 * `gmail.read` — aucune branche de ce module ne peut donc atteindre
 * `gmail.send` ou tout autre outil, quelle que soit l'entrée fournie.
 *
 * Non branché à `dispatch()`/`main.ts` à ce stade — voir
 * `docs/second-readonly-vertical-slice-integration-study.md`.
 */

/**
 * Résultat structuré du flux — union fermée, jamais de succès artificiel :
 * un statut `read_result` signifie uniquement que `runReadFlow` a été
 * appelé et a renvoyé un `ToolExecutionResult`, **quel qu'il soit**
 * (`executed`, `denied`, `error`…) — ce module ne réinterprète jamais ce
 * résultat, il le propage tel quel.
 */
export type ReadNaturalLanguageFlowResult =
  /** L'interprétation est ambiguë — aucune acceptation demandée, aucun outil atteint. */
  | { readonly status: 'ambiguous'; readonly interpretation: ReadInterpretation }
  /** La demande sort du périmètre de `gmail.read` — aucune acceptation demandée, aucun outil atteint. */
  | { readonly status: 'unsupported'; readonly interpretation: ReadInterpretation }
  /** L'utilisateur a explicitement refusé l'interprétation proposée. */
  | {
      readonly status: 'declined';
      readonly interpretation: ReadInterpretation;
      readonly reason: InterpretationAcceptanceRefusalReason;
    }
  /**
   * Aucune réponse affirmative ni négative n'a pu être obtenue (EOF, erreur
   * de lecture, ou interprétation jugée non éligible par l'adaptateur
   * d'acceptation lui-même — cas défensif, normalement inatteignable ici
   * puisque `ambiguous`/`unsupported` sont déjà écartés avant cet appel).
   */
  | {
      readonly status: 'acceptance_error';
      readonly interpretation: ReadInterpretation;
      readonly reason: InterpretationAcceptanceRefusalReason;
    }
  /** La conversion en `ToolRequest` a échoué (cas défensif — voir `read-intent-to-tool-request.ts`). */
  | {
      readonly status: 'conversion_failed';
      readonly interpretation: ReadInterpretation;
      readonly reason: string;
    }
  /** `runReadFlow` a été appelé ; `result` est son `ToolExecutionResult` brut, propagé sans transformation. */
  | {
      readonly status: 'read_result';
      readonly interpretation: ReadInterpretation;
      readonly toolRequest: ToolRequest;
      readonly result: ToolExecutionResult;
    };

/**
 * Dépendances injectables — toutes optionnelles, chacune par défaut la
 * fonction réelle du module VS-02/VS-01 correspondant. Permet des tests
 * déterministes (espionner un appel, forcer un résultat) sans jamais
 * réimplémenter la logique de l'étape injectée.
 */
export interface ReadNaturalLanguageFlowDependencies {
  readonly parse?: (request: string) => ReadInterpretation;
  readonly requestAcceptance?: (
    interpretation: ReadInterpretation,
    io: ReadInterpretationAcceptanceIo,
  ) => Promise<InterpretationAcceptanceResult>;
  readonly convertToToolRequest?: (
    interpretation: ReadInterpretation,
  ) => ReadToolRequestConversionResult;
  readonly runRead?: typeof runReadFlow;
}

/**
 * Exécute le flux complet. Ne lève jamais (chaque étape composée est déjà
 * non-levante ; ce module n'ajoute aucune logique susceptible de lever).
 *
 * `connect` n'a **pas** de valeur par défaut ici : `runReadFlow` porte déjà
 * son propre défaut interne (`runOAuthConnect`, non exporté par `main.ts`)
 * — transmettre `undefined` déclenche ce même défaut, sans qu'il soit
 * nécessaire de l'importer ni de le dupliquer ici.
 */
export async function runReadNaturalLanguageFlow(
  naturalLanguageRequest: string,
  deps: DesktopDeps,
  acceptanceIo: ReadInterpretationAcceptanceIo = {},
  write: (line: string) => void = console.log,
  connect?: ConnectGmailFn,
  dependencies: ReadNaturalLanguageFlowDependencies = {},
): Promise<ReadNaturalLanguageFlowResult> {
  const parse = dependencies.parse ?? interpretReadRequest;
  const requestAcceptance = dependencies.requestAcceptance ?? requestReadInterpretationAcceptance;
  const convertToToolRequest =
    dependencies.convertToToolRequest ?? convertReadInterpretationToToolRequest;
  const runRead = dependencies.runRead ?? runReadFlow;

  const interpretation = parse(naturalLanguageRequest);

  if (interpretation.status === 'ambiguous') {
    return { status: 'ambiguous', interpretation };
  }
  if (interpretation.status === 'unsupported') {
    return { status: 'unsupported', interpretation };
  }

  const acceptance = await requestAcceptance(interpretation, acceptanceIo);
  if (!acceptance.accepted) {
    if (acceptance.reason === 'declined') {
      return { status: 'declined', interpretation, reason: acceptance.reason };
    }
    return { status: 'acceptance_error', interpretation, reason: acceptance.reason };
  }

  const conversion = convertToToolRequest(interpretation);
  if (!conversion.ok) {
    return { status: 'conversion_failed', interpretation, reason: conversion.reason };
  }

  // `ToolRequest.input` est typé `unknown` (`@jarvis/core`). L'assertion
  // suivante est sûre car `convertReadInterpretationToToolRequest` garantit
  // à l'exécution (pas seulement au type) que, sur `ok: true`, `input` vaut
  // exactement `{}` ou `{ maxResults: <entier borné> }` — structurellement
  // identique à `GmailReadInput`. Jamais `as any`, jamais `@ts-ignore` :
  // une assertion précise vers un type connu, documentée ici.
  const input = conversion.toolRequest.input as GmailReadInput;

  // Seul `input` est transmis — jamais `conversion.toolRequest.tool` :
  // `runReadFlow` décide lui-même, en dur, d'appeler `gmail.read`
  // (`main.ts:435`). Aucune branche de cette fonction ne peut donc
  // transmettre ni atteindre `gmail.send`.
  const result = await runRead(deps, input, write, connect);

  return { status: 'read_result', interpretation, toolRequest: conversion.toolRequest, result };
}
