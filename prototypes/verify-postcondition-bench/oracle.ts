/**
 * BANC ISOLE (EXP-004) — Oracle de postcondition.
 *
 * Principe non négociable de ce banc : la postcondition attendue est
 * calculée AVANT l'exécution, depuis l'entrée déjà autorisée (celle qui a
 * franchi `ToolExecutor`, voir `runner.ts`) et un instantané de l'état
 * initial (`StateSnapshot`). La sortie de l'outil (`ToolExecutionResult`)
 * n'intervient JAMAIS dans ce calcul — elle est une déclaration, confrontée
 * après coup par `verifier.ts`, jamais une source de vérité sur ce qui
 * devait réussir.
 *
 * L'unique canal d'observation indépendant de ce banc est
 * `InMemoryMailClient.listSent()` (@jarvis/connectors) : un enregistrement
 * qui y apparaît prouve uniquement un effet simulé local, jamais une
 * livraison Gmail réelle ni aucun effet externe.
 */

import type { InMemorySentMessage } from '@jarvis/connectors';

/** Instantané de l'état observable, pris via `InMemoryMailClient.listSent()`. */
export interface StateSnapshot {
  readonly sent: readonly InMemorySentMessage[];
}

export function snapshot(client: { listSent(): readonly InMemorySentMessage[] }): StateSnapshot {
  return { sent: client.listSent() };
}

/** Un nouvel envoi correspondant exactement à `to`/`subject`/`body` est attendu. */
export interface ExpectNewSentRecord {
  readonly kind: 'expect_new_sent_record';
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** Aucun nouvel envoi n'est attendu (cas de contrôle négatif). */
export interface ExpectNoNewRecord {
  readonly kind: 'expect_no_new_record';
}

/**
 * Aucun canal d'observation indépendant n'existe pour ce composant — ni
 * `InMemoryMailClient`, ni aucun autre état accessible à ce banc. Verdict
 * obligatoirement `no_evidence`, jamais par défaut mais par construction
 * (voir `faulty-doubles.ts`, double reproduisant `internal.fake_execute`).
 */
export interface NoObserverAvailable {
  readonly kind: 'no_observer_available';
  readonly reason: string;
}

export type Postcondition = ExpectNewSentRecord | ExpectNoNewRecord | NoObserverAvailable;

export function expectNewSentRecord(input: {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}): ExpectNewSentRecord {
  return { kind: 'expect_new_sent_record', to: input.to, subject: input.subject, body: input.body };
}

export function expectNoNewRecord(): ExpectNoNewRecord {
  return { kind: 'expect_no_new_record' };
}

export function noObserverAvailable(reason: string): NoObserverAvailable {
  return { kind: 'no_observer_available', reason };
}
