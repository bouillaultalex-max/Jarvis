/**
 * Vérificateur de postcondition pour `inmemory.send` — implémentation
 * CONCRÈTE du contrat générique additif `@jarvis/core`
 * (`PostconditionVerifier`), propre à ce connecteur de démonstration.
 *
 * Compare UNIQUEMENT la demande autorisée à l'état observable avant/après
 * (`InMemoryMailClient.listSent()`) — jamais à ce que l'outil déclare en
 * sortie, jamais à `ToolExecutionResult.output`. Trois hypothèses, posées
 * explicitement, sont nécessaires pour conclure à une contradiction :
 *
 * 1. **Complétude** — `listSent()` renvoie TOUJOURS l'intégralité des
 *    envois simulés, jamais un sous-ensemble ni une vue paginée. L'absence
 *    d'un enregistrement correspondant est donc une preuve suffisante
 *    d'absence, pas une simple incertitude.
 * 2. **Observation immédiate** — aucune latence, aucun effet asynchrone :
 *    l'état lu juste après `ToolExecutor.run()` est déjà final, jamais
 *    partiel (contrairement à un envoi réseau réel, qui pourrait rebondir
 *    de façon asynchrone).
 * 3. **Append-only** — `InMemoryMailClient#send` n'écrase ni ne réordonne
 *    jamais un enregistrement existant (voir `in-memory-client.ts`) : tout
 *    ce qui apparaît entre deux instantanés est, sans ambiguïté, un nouvel
 *    effet, jamais un artefact de réordonnancement.
 *
 * Ces trois hypothèses ne tiennent QUE pour ce store simulé et local.
 * **Un enregistrement observé ici prouve uniquement un effet simulé local
 * — jamais une livraison externe réelle** : aucun réseau, aucun fournisseur
 * de messagerie n'est impliqué par ce vérificateur.
 *
 * Conséquence directe de ces hypothèses : `verify()` ne renvoie jamais
 * lui-même `'insufficient_evidence'` — avec un store complet et observé
 * immédiatement, la comparaison conclut toujours `'satisfied'` ou
 * `'contradicted'`. `'insufficient_evidence'` ne peut provenir que de
 * l'orchestration (`@jarvis/core`, `runWithVerification`), en cas d'échec
 * de l'instantané ou d'exception du vérificateur — jamais de ce fichier.
 */

import type {
  PostconditionVerifier,
  ToolExecutionResult,
  ToolRequest,
  VerificationOutcome,
} from '@jarvis/core';

import type { InMemoryMailClient, InMemorySentMessage } from './in-memory-client.js';

export interface InMemorySendSnapshot {
  readonly sent: readonly InMemorySentMessage[];
}

export interface ExpectedSentRecord {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * Lecture défensive et non-levante de la demande : un champ manquant ou mal
 * typé devient une chaîne vide plutôt qu'une exception — la postcondition
 * reste alors simplement « non satisfiable », jamais une erreur de
 * préparation. La validation réelle de l'entrée appartient à
 * `Tool.validateInput` (`inmemory.send`), jamais à ce vérificateur.
 */
function readSendInput(input: unknown): ExpectedSentRecord {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    to: typeof record.to === 'string' ? record.to : '',
    subject: typeof record.subject === 'string' ? record.subject : '',
    body: typeof record.body === 'string' ? record.body : '',
  };
}

export function createInMemorySendVerifier(
  client: InMemoryMailClient,
): PostconditionVerifier<InMemorySendSnapshot, ExpectedSentRecord> {
  return {
    snapshot(): InMemorySendSnapshot {
      // `listSent()` copie le tableau mais pas les enregistrements qu'il
      // contient : sans cette copie champ-à-champ, une mutation ultérieure
      // d'une référence déjà renvoyée (par `send()` ou `listSent()`)
      // modifierait un instantané déjà capturé.
      return { sent: client.listSent().map((record) => ({ ...record })) };
    },

    expectedFrom(request: ToolRequest): ExpectedSentRecord {
      return readSendInput(request.input);
    },

    verify(
      expected: ExpectedSentRecord,
      before: InMemorySendSnapshot,
      after: InMemorySendSnapshot,
      _technicalResult: ToolExecutionResult,
    ): VerificationOutcome {
      // Hypothèse 3 (append-only) : tout ce qui a été ajouté depuis
      // `before` est exactement ce suffixe, quel que soit le nombre
      // d'étapes intercalées entre les deux instantanés.
      const newRecords = after.sent.slice(before.sent.length);
      const match = newRecords.find(
        (record) =>
          record.to === expected.to &&
          record.subject === expected.subject &&
          record.body === expected.body,
      );

      if (match !== undefined) {
        return {
          verdict: 'satisfied',
          reason: `un enregistrement correspondant à la demande autorisée a été observé (id=${match.id}).`,
        };
      }

      if (newRecords.length === 0) {
        return {
          verdict: 'contradicted',
          reason:
            'aucun nouvel enregistrement observé depuis l’instantané précédent, alors que la ' +
            'demande autorisée attendait un nouvel envoi (hypothèse de complétude du store).',
        };
      }

      return {
        verdict: 'contradicted',
        reason:
          `${newRecords.length} nouvel(aux) enregistrement(s) observé(s) depuis l’instantané ` +
          `précédent, mais aucun ne correspond à la demande autorisée (to=${JSON.stringify(expected.to)}).`,
      };
    },
  };
}
