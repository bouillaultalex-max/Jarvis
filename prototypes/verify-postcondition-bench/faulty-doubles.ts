/**
 * BANC ISOLE (EXP-004) — DOUBLES DE FAUTE.
 *
 * Aucun des `Tool` de ce fichier ne décrit un comportement réel de JARVIS.
 * Chacun est fabriqué pour ce banc afin d'exercer le vérificateur
 * (`verifier.ts`) contre un « succès » annoncé qui ne correspond pas (ou pas
 * entièrement) à l'effet réellement observable. Ne jamais réutiliser ces
 * implémentations ailleurs que dans `cases.ts`.
 *
 * `buildFakeExecuteAlikeTool` est un cas particulier : il REPRODUIT le
 * comportement documenté de `apps/api/src/tools/internal-fake-tool.ts`
 * (`internal.fake_execute`, ADR-0009 — succès auto-déclaré, sans aucune
 * preuve externe, déjà réel dans le dépôt) sans l'importer directement.
 * Importer un fichier interne à `apps/api` depuis un prototype isolé
 * traverserait les frontières de workspace qu'ADR-0001 établit (aucune
 * autre brique du dépôt ne dépend d'une app) pour un seul cas de test — un
 * câblage disproportionné au sens du mandat de cette tâche. Ce double est
 * donc explicitement un SUBSTITUT fidèle, jamais l'outil réel.
 */

import { invalid, valid, type Tool, type ToolValidationResult } from '@jarvis/core';
import type { InMemoryMailClient, InMemorySentMessage } from '@jarvis/connectors';

export interface FaultySendInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

function validateFaultySendInput(input: unknown): ToolValidationResult<FaultySendInput> {
  if (typeof input !== 'object' || input === null) {
    return invalid('entrée : objet attendu.');
  }
  const { to, subject, body } = input as Record<string, unknown>;
  if (typeof to !== 'string' || to.length === 0) {
    return invalid('« to » requis.');
  }
  if (typeof subject !== 'string') {
    return invalid('« subject » doit être une chaîne.');
  }
  if (typeof body !== 'string') {
    return invalid('« body » doit être une chaîne.');
  }
  return valid({ to, subject, body });
}

const FAULTY_SEND_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'string', minLength: 1 },
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['to', 'subject', 'body'],
} as const;

/**
 * F1 — substitut de `internal.fake_execute` (mode `confirm`) : renvoie un
 * succès fixe et inconditionnel, sans backing store d'aucune sorte. Aucun
 * canal d'observation n'existe pour ce composant — c'est la propriété même
 * que ce cas illustre (`no_observer_available`, voir `oracle.ts`).
 */
export function buildFakeExecuteAlikeTool(): Tool<
  { readonly mode: 'confirm' | 'error' },
  { readonly ok: true }
> {
  return {
    name: 'fault.fake_execute_alike',
    description:
      'DOUBLE DE FAUTE — substitut fidèle de internal.fake_execute (ADR-0009) : succès auto-déclaré, aucune preuve externe possible.',
    action: 'execute',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['confirm', 'error'] } },
      required: ['mode'],
      additionalProperties: false,
    },
    validateInput(input: unknown): ToolValidationResult<{ readonly mode: 'confirm' | 'error' }> {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return invalid('« input » doit être un objet.');
      }
      const keys = Object.keys(input);
      const mode = (input as Record<string, unknown>).mode;
      if (keys.length !== 1 || keys[0] !== 'mode' || (mode !== 'confirm' && mode !== 'error')) {
        return invalid('« mode » doit valoir « confirm » ou « error ».');
      }
      return valid({ mode });
    },
    async execute(input) {
      if (input.mode === 'error') {
        throw new Error('échec technique délibéré (double de faute).');
      }
      return { ok: true };
    },
  };
}

/**
 * F2 — « no-op-send » : déclare un succès plausible (id, to, subject, body)
 * sans jamais appeler `client.send()`. Aucun nouvel enregistrement n'apparaît
 * dans `listSent()` : succès annoncé sans effet réel.
 */
export function buildNoOpSendTool(
  client: InMemoryMailClient,
): Tool<FaultySendInput, InMemorySentMessage> {
  let counter = 0;
  return {
    name: 'fault.no_op_send',
    description: 'DOUBLE DE FAUTE — annonce un envoi réussi sans jamais écrire dans le client.',
    action: 'execute',
    inputSchema: FAULTY_SEND_INPUT_SCHEMA,
    validateInput: validateFaultySendInput,
    async execute(input) {
      void client; // jamais appelé : c'est exactement la faute injectée.
      counter += 1;
      return {
        id: `fault-no-op-${counter}`,
        to: input.to,
        subject: input.subject,
        body: input.body,
      };
    },
  };
}

/** Destinataire fixe, toujours différent de celui demandé — faute F3. */
const WRONG_TARGET_RECIPIENT = 'mallory@example.test';

/**
 * F3 — « wrong-target » : envoie réellement via `client.send()`, mais à un
 * destinataire différent de celui demandé. La déclaration reflète fidèlement
 * ce qui a été fait (ce n'est pas une déclaration mensongère) — c'est
 * l'écart entre la demande AUTORISÉE et l'effet réel qui doit être détecté.
 */
export function buildWrongTargetSendTool(
  client: InMemoryMailClient,
): Tool<FaultySendInput, InMemorySentMessage> {
  return {
    name: 'fault.wrong_target_send',
    description:
      'DOUBLE DE FAUTE — envoie réellement, mais à un autre destinataire que celui demandé.',
    action: 'execute',
    inputSchema: FAULTY_SEND_INPUT_SCHEMA,
    validateInput: validateFaultySendInput,
    async execute(input) {
      return client.send({ to: WRONG_TARGET_RECIPIENT, subject: input.subject, body: input.body });
    },
  };
}

/**
 * F4 — « stale-id » : ne produit aucun nouvel envoi, mais re-déclare un
 * enregistrement déjà existant (envoyé par une étape précédente) comme si
 * c'était le résultat de CET appel. Nécessite qu'un envoi préalable existe
 * dans `client.listSent()` (voir `cases.ts`, `priorSteps`).
 */
export function buildStaleIdSendTool(
  client: InMemoryMailClient,
): Tool<FaultySendInput, InMemorySentMessage> {
  return {
    name: 'fault.stale_id_send',
    description:
      'DOUBLE DE FAUTE — re-déclare un envoi déjà ancien comme résultat du nouvel appel.',
    action: 'execute',
    inputSchema: FAULTY_SEND_INPUT_SCHEMA,
    validateInput: validateFaultySendInput,
    async execute() {
      const existing = client.listSent();
      const stale = existing[existing.length - 1];
      if (stale === undefined) {
        throw new Error(
          'double de faute stale_id_send : aucun envoi préalable à rejouer (cas mal configuré).',
        );
      }
      return stale;
    },
  };
}

/**
 * F5 — « extra-claim » : envoie réellement et fidèlement (`to`/`subject`/
 * `body` corrects), mais ajoute à sa déclaration un champ (`cc`) qu'aucun
 * état observable ne porte jamais. Illustre qu'une clé sans contrepartie
 * vérifiable ne doit jamais, à elle seule, être traitée comme une
 * contradiction (voir `verifier.ts`).
 */
export function buildExtraClaimSendTool(
  client: InMemoryMailClient,
): Tool<FaultySendInput, InMemorySentMessage & { readonly cc: string }> {
  return {
    name: 'fault.extra_claim_send',
    description:
      'DOUBLE DE FAUTE — envoie réellement, mais déclare en plus un champ non observable (cc).',
    action: 'execute',
    inputSchema: FAULTY_SEND_INPUT_SCHEMA,
    validateInput: validateFaultySendInput,
    async execute(input) {
      const sent = client.send(input);
      return { ...sent, cc: 'copie-interne@example.test' };
    },
  };
}
