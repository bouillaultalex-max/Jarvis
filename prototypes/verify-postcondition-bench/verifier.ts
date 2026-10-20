/**
 * BANC ISOLE (EXP-004) — Vérificateur indépendant.
 *
 * Confronte une `Postcondition` (calculée avant exécution, voir `oracle.ts`)
 * à ce qui a réellement été observé (`before`/`after`) et à la déclaration
 * technique de l'outil (`ToolExecutionResult`). Trois verdicts, jamais
 * réduits l'un à l'autre :
 *
 * - `pass`          : postcondition observable satisfaite.
 * - `contradicted`  : une observation SUFFISANTE contredit la postcondition
 *                     (un fait positif et complet, pas une simple absence).
 * - `no_evidence`   : observation absente ou insuffisante pour conclure —
 *                     jamais un succès implicite, jamais un échec implicite.
 *
 * Ce vérificateur est un mécanisme EXPÉRIMENTAL créé pour ce banc. Il ne
 * modifie, n'étend ni ne remplace aucun mécanisme réel de JARVIS — aucun
 * n'existe aujourd'hui (voir `docs/verified-result-boundaries.md`).
 */

import type { InMemorySentMessage } from '@jarvis/connectors';
import type { ToolExecutionResult } from '@jarvis/core';

import type { Postcondition, StateSnapshot } from './oracle.js';

export type VerifiedVerdict = 'pass' | 'contradicted' | 'no_evidence';

export interface VerificationResult {
  readonly verdict: VerifiedVerdict;
  readonly reason: string;
}

/** Champs réellement observables d'un envoi simulé — jamais plus que ça. */
const OBSERVABLE_SENT_FIELDS: readonly (keyof InMemorySentMessage)[] = [
  'id',
  'to',
  'subject',
  'body',
];

/**
 * Confronte la déclaration de l'outil (`declaredOutput`) à l'enregistrement
 * réellement observé qui correspond à la postcondition. Toute clé déclarée
 * absente du modèle observable (ex. `cc`) est **sans contrepartie
 * vérifiable** — elle ne démontre ni succès ni contradiction à elle seule :
 * verdict `no_evidence`, jamais `contradicted` sur cette seule base. Une
 * divergence sur un champ réellement observable (`to`/`subject`/`body`/`id`)
 * reste, elle, une contradiction positive.
 */
function compareDeclarationToObservedRecord(
  declaredOutput: unknown,
  observed: InMemorySentMessage,
): VerificationResult {
  if (typeof declaredOutput !== 'object' || declaredOutput === null) {
    return {
      verdict: 'no_evidence',
      reason:
        'la déclaration de l’outil n’est pas structurée : rien à confronter au-delà de l’enregistrement trouvé.',
    };
  }
  const declared = declaredOutput as Record<string, unknown>;
  const observedRecord = observed as unknown as Record<string, unknown>;
  const unverifiableKeys: string[] = [];

  for (const key of Object.keys(declared)) {
    if ((OBSERVABLE_SENT_FIELDS as readonly string[]).includes(key)) {
      if (declared[key] !== observedRecord[key]) {
        return {
          verdict: 'contradicted',
          reason:
            `champ déclaré « ${key} » = ${JSON.stringify(declared[key])}, ` +
            `divergent de l’état observé (${JSON.stringify(observedRecord[key])}).`,
        };
      }
    } else {
      unverifiableKeys.push(key);
    }
  }

  if (unverifiableKeys.length > 0) {
    return {
      verdict: 'no_evidence',
      reason:
        `champ(s) déclaré(s) hors du modèle observable (${unverifiableKeys.join(', ')}) : ` +
        'aucune contrepartie vérifiable — absence de preuve, jamais traitée comme une contradiction.',
    };
  }

  return {
    verdict: 'pass',
    reason: `déclaration entièrement corroborée par l’état observé (id=${observed.id}).`,
  };
}

export function verify(
  postcondition: Postcondition,
  before: StateSnapshot,
  after: StateSnapshot,
  technicalResult: ToolExecutionResult,
): VerificationResult {
  if (postcondition.kind === 'no_observer_available') {
    return {
      verdict: 'no_evidence',
      reason: `aucun observateur approprié n’existe pour ce composant : ${postcondition.reason}`,
    };
  }

  if (technicalResult.status !== 'executed') {
    return {
      verdict: 'no_evidence',
      reason:
        `aucune déclaration de succès à confronter (statut technique « ${technicalResult.status} », ` +
        'ni exécuté ni donc "annoncé réussi").',
    };
  }

  // Jamais de suppression ni de réordonnancement dans InMemoryMailClient#send
  // (append-only, voir in-memory-client.ts) : tout ce qui a été ajouté depuis
  // `before` est exactement `after.sent.slice(before.sent.length)`, quel que
  // soit le nombre d'étapes intercalées (voir `runner.ts`, trailingSteps).
  const newRecords = after.sent.slice(before.sent.length);

  if (postcondition.kind === 'expect_no_new_record') {
    if (newRecords.length === 0) {
      return {
        verdict: 'pass',
        reason: 'aucun nouvel enregistrement, conforme à la postcondition.',
      };
    }
    return {
      verdict: 'contradicted',
      reason: `la postcondition n’attendait aucun nouvel envoi ; ${newRecords.length} observé(s).`,
    };
  }

  // postcondition.kind === 'expect_new_sent_record'
  const match = newRecords.find(
    (r) =>
      r.to === postcondition.to &&
      r.subject === postcondition.subject &&
      r.body === postcondition.body,
  );

  if (match === undefined) {
    if (newRecords.length === 0) {
      return {
        verdict: 'contradicted',
        reason:
          'la postcondition attendait un nouvel envoi correspondant à la demande autorisée ; ' +
          'aucun nouvel enregistrement n’est apparu dans l’état observable (listSent(), complet, non partiel).',
      };
    }
    return {
      verdict: 'contradicted',
      reason:
        `${newRecords.length} nouvel(aux) enregistrement(s) observé(s), mais aucun ne correspond à ` +
        `la demande autorisée (to=${JSON.stringify(postcondition.to)}) — effet réel divergent de la déclaration.`,
    };
  }

  return compareDeclarationToObservedRecord(technicalResult.output, match);
}
