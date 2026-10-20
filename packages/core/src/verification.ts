/**
 * Contrat de vérification de postcondition — ADDITIF. Ce fichier ne modifie
 * ni `ToolExecutor`, ni `ToolExecutionResult`, ni `PermissionManager` : ils
 * restent exactement ce qu'ils sont. `executed` garde son sens actuel («
 * `tool.execute()` s'est résolu sans lever » — rien de plus,
 * `tool-executor.ts`).
 *
 * Objectif : confronter l'effet réellement observable d'une exécution à ce
 * que la demande AUTORISÉE laissait attendre — une postcondition calculée
 * AVANT l'exécution, jamais depuis ce que l'outil déclare en sortie.
 * `ToolExecutor.run()` reste le point de passage unique : jamais contourné,
 * jamais dupliqué, jamais appelé deux fois pour une même demande.
 *
 * Usage strictement opt-in : un appelant qui ne fournit aucun `verifier` à
 * {@link runWithVerification} obtient un comportement identique à un appel
 * direct à `ToolExecutor.run()` (`verification: undefined`).
 *
 * **Portée actuelle** : une capacité de bibliothèque, exercée par ses propres
 * tests (`verification.test.ts` et, côté connecteur,
 * `in-memory-send-verification.test.ts`), et désormais par une première
 * utilisation opt-in applicative : `apps/desktop` (commande de démonstration
 * locale `verify-demo`, `run-verify-demo.ts`). `AgentLoop` et le reste des
 * commandes de `apps/desktop`/`apps/api` n'appellent toujours pas
 * {@link runWithVerification} — ce fichier ne les modifie pas et ne
 * présuppose aucun branchement futur au-delà de `verify-demo`.
 */

import type { ToolExecutionResult, ToolExecutor, ToolRequest } from './tool-executor.js';

export type VerificationVerdict = 'satisfied' | 'contradicted' | 'insufficient_evidence';

export interface VerificationOutcome {
  readonly verdict: VerificationVerdict;
  readonly reason: string;
}

/**
 * Observe et confronte une postcondition pour un type d'outil donné.
 * `TSnapshot` et `TExpected` sont opaques pour `runWithVerification` — seule
 * l'implémentation concrète (propre à un connecteur) leur donne un sens.
 *
 * Trois règles, non vérifiables par le compilateur, mais qui définissent le
 * contrat :
 * - {@link PostconditionVerifier.snapshot} est une lecture **sans effet
 *   métier** — jamais une mutation d'état.
 * - La valeur renvoyée par {@link PostconditionVerifier.snapshot} doit être
 *   **détachée** de l'état mutable observé — jamais une référence vive qui
 *   continuerait de changer après l'appel (ex. un tableau interne retourné
 *   tel quel plutôt qu'une copie). `before` et `after` doivent chacun rester
 *   un instantané figé au moment où `snapshot()` a été appelé,
 *   indépendamment de toute mutation ultérieure du client sous-jacent —
 *   sans quoi la comparaison `before`/`after` perdrait tout son sens.
 * - {@link PostconditionVerifier.expectedFrom} et
 *   {@link PostconditionVerifier.verify} sont des calculs **purs** sur des
 *   instantanés déjà obtenus — aucune E/S, aucune mutation, aucun appel à
 *   `ToolExecutor`.
 */
export interface PostconditionVerifier<TSnapshot, TExpected> {
  snapshot(): TSnapshot | Promise<TSnapshot>;
  /**
   * Calcule la postcondition attendue depuis la demande déjà **capturée**
   * (voir `runWithVerification` : une copie, jamais une référence partagée
   * avec ce qui sera transmis à l'outil) et l'état observé avant exécution.
   */
  expectedFrom(request: ToolRequest, before: TSnapshot): TExpected;
  verify(
    expected: TExpected,
    before: TSnapshot,
    after: TSnapshot,
    technicalResult: ToolExecutionResult,
  ): VerificationOutcome;
}

/**
 * L'exécution a été tentée (quel que soit le statut technique obtenu) ;
 * `technicalResult` et `verification` restent deux champs séparés, jamais
 * l'un dérivé implicitement de l'autre.
 */
export interface VerifiedOutcome {
  readonly kind: 'executed';
  readonly technicalResult: ToolExecutionResult;
  /**
   * `undefined` quand aucun `verifier` n'a été fourni, OU quand le statut
   * technique n'est pas `'executed'` (refusé, en attente de confirmation,
   * entrée invalide, outil inconnu) : absence explicite de vérification,
   * jamais `'satisfied'` par défaut, jamais déduite de l'absence de preuve
   * du contraire.
   */
  readonly verification: VerificationOutcome | undefined;
}

/**
 * La préparation (capture de la demande, instantané initial, calcul de la
 * postcondition) a échoué avant toute exécution. `ToolExecutor.run()` n'a
 * **jamais** été appelé pour ce cas — et aucun `ToolExecutionResult` n'est
 * inventé pour le simuler.
 */
export interface PreparationFailedOutcome {
  readonly kind: 'preparation_failed';
  readonly reason: string;
}

export type RunWithVerificationOutcome = VerifiedOutcome | PreparationFailedOutcome;

const PREPARATION_FAILURE_REASON =
  'échec de la préparation de la vérification (instantané initial ou calcul de la postcondition) — ' +
  'aucun outil exécuté.';
const POST_EXECUTION_FAILURE_REASON =
  'échec de l’observation ou de la vérification après exécution — aucune conclusion fiable possible.';

/**
 * Orchestration AVEC EFFETS (appelle `ToolExecutor.run()`, lit un état
 * externe via `verifier.snapshot()`) — délibérément pas une fonction pure.
 *
 * Ne déclenche jamais, par elle-même, de nouvelle action, de relance ni
 * d'écriture mémoire : son seul effet observable au-delà de l'exécution de
 * l'outil est de renvoyer un verdict. Une exception du vérificateur ne
 * devient jamais un succès ; les messages d'exception bruts ne sont jamais
 * repris tels quels dans un motif de verdict.
 */
export async function runWithVerification<TSnapshot, TExpected>(
  executor: ToolExecutor,
  request: ToolRequest,
  verifier?: PostconditionVerifier<TSnapshot, TExpected>,
): Promise<RunWithVerificationOutcome> {
  if (verifier === undefined) {
    const technicalResult = await executor.run(request);
    return { kind: 'executed', technicalResult, verification: undefined };
  }

  let capturedRequest: ToolRequest;
  let before: TSnapshot;
  let expected: TExpected;
  try {
    // Capture SYNCHRONE, avant le premier point de suspension de cette
    // fonction (`await verifier.snapshot()` juste après). C'est CETTE copie,
    // jamais `request`, qui sera exécutée plus bas : une mutation de
    // `request` (input OU nom d'outil) par l'appelant pendant une
    // préparation suspendue — par exemple un `snapshot()` asynchrone encore
    // en attente — ne peut donc jamais faire exécuter une demande
    // différente de celle utilisée pour calculer la postcondition (voir
    // `verification.test.ts`, « préparation suspendue »). Même discipline
    // que `confirmAndExecute` (`confirmation-flow.ts`) pour `payload.input`.
    capturedRequest = {
      tool: request.tool,
      input: structuredClone(request.input),
      confirmed: request.confirmed,
    };
    before = await verifier.snapshot();
    expected = verifier.expectedFrom(capturedRequest, before);
  } catch {
    // Préparation sans effet métier : aucun appel à `executor.run()` n'a eu
    // lieu avant cette ligne, et aucun n'aura lieu pour cette demande.
    return { kind: 'preparation_failed', reason: PREPARATION_FAILURE_REASON };
  }

  // La demande CAPTURÉE — jamais `request`, qui pourrait avoir été mutée
  // par l'appelant pendant l'attente ci-dessus.
  const technicalResult = await executor.run(capturedRequest);

  if (technicalResult.status !== 'executed') {
    return { kind: 'executed', technicalResult, verification: undefined };
  }

  try {
    const after = await verifier.snapshot();
    const verification = verifier.verify(expected, before, after, technicalResult);
    return { kind: 'executed', technicalResult, verification };
  } catch {
    return {
      kind: 'executed',
      technicalResult,
      verification: { verdict: 'insufficient_evidence', reason: POST_EXECUTION_FAILURE_REASON },
    };
  }
}
