import type { Tool } from '@jarvis/core';

import type { Account } from '../account.js';

/**
 * Read-model UI-agnostic d'une demande de confirmation — ce qu'une future
 * interface (peu importe laquelle : `apps/api`, `apps/desktop`, ou autre)
 * a besoin de savoir pour présenter à l'utilisateur ce qu'il est sur le
 * point d'autoriser, sans jamais lui exposer un payload arbitraire ni un
 * secret.
 *
 * Séparation stricte avec `ConfirmationService` : ce module ne l'importe
 * pas, ne l'appelle pas, ne recalcule aucune empreinte, ne décide aucune
 * autorisation. `buildConfirmationRequest` transforme uniquement des
 * données déjà produites ailleurs (le ticket de `ConfirmationService.create()`,
 * un `Account`, un résumé déjà construit par l'appelant) en un objet
 * d'affichage — jamais l'inverse. Voir `text-preview.ts` pour le rappel
 * explicite : l'aperçu de texte n'alimente jamais un fingerprint.
 *
 * Indépendant de Gmail : le futur adaptateur Gmail devra construire un
 * `ConfirmationInputSummary` à partir d'un `GmailSendInput` (mapping
 * `to`/`subject`/`body` → des `ConfirmationSummaryField` avec des labels
 * humains) — ce mapping est délibérément hors scope ici (M8-A4). Ce
 * module ne connaît que des champs affichables génériques.
 */

/**
 * Sous-modèle de compte destiné à l'affichage — jamais un `Account`
 * complet (qui pourrait un jour porter un champ non prévu pour une UI).
 * Allowlist stricte : seuls ces quatre champs, jamais `status`,
 * `metadata`, `createdAt`/`updatedAt`, et a fortiori jamais un credential
 * (qui ne vit de toute façon jamais sur `Account`, voir account.ts).
 */
export interface ConfirmationAccountView {
  readonly accountId: string;
  readonly provider: string;
  readonly accountIdentifier: string;
  readonly displayName?: string;
}

/**
 * Un champ affichable unique (ex. « Destinataire : a@example.test »).
 * `key`/`label` sont définis par l'appelant (le futur adaptateur
 * connecteur) — ce module ne connaît aucun nom de champ Gmail-specific.
 * `value` est déjà une chaîne prête à afficher (ex. déjà passée par
 * `buildTextPreview` si une troncature était nécessaire).
 */
export interface ConfirmationSummaryField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** `true` si `value` a été tronquée par rapport au contenu original. */
  readonly truncated?: boolean;
}

/**
 * Résumé contrôlé de ce qu'une action va faire — **jamais** `input:
 * unknown` : seuls les champs explicitement choisis par l'appelant pour
 * l'affichage entrent ici. Ce module ne dérive jamais lui-même un résumé
 * à partir d'un payload brut (ça exigerait une connaissance
 * connector-specific qui n'a pas sa place ici) — `buildConfirmationRequest`
 * reçoit ce résumé déjà construit, il ne le fabrique pas.
 */
export interface ConfirmationInputSummary {
  readonly fields: readonly ConfirmationSummaryField[];
}

export interface ConfirmationRequest {
  readonly confirmationId: string;
  readonly toolName: string;
  readonly action: Tool['action'];
  readonly account: ConfirmationAccountView;
  readonly summary: ConfirmationInputSummary;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface BuildConfirmationRequestOptions {
  /** Préservé exactement — jamais régénéré. Vient de `ConfirmationService.create()`. */
  readonly confirmationId: string;
  /**
   * `ConfirmationService.create()` ne renvoie pas `createdAt` (seulement
   * `confirmationId`/`expiresAt`) : c'est à l'appelant, qui connaît déjà
   * l'instant de la demande (sa propre horloge, au moment de l'appel à
   * `create()`), de le fournir ici. Aucun deuxième TTL ni horloge n'est
   * introduit par ce module.
   */
  readonly createdAt: string;
  /** Préservé exactement — jamais recalculé. Vient de `ConfirmationService.create()`. */
  readonly expiresAt: string;
  readonly toolName: string;
  readonly action: Tool['action'];
  readonly account: Account;
  readonly summary: ConfirmationInputSummary;
}

function buildAccountView(account: Account): ConfirmationAccountView {
  const view: ConfirmationAccountView = {
    accountId: account.id,
    provider: account.provider,
    accountIdentifier: account.accountIdentifier,
    ...(account.displayName !== undefined ? { displayName: account.displayName } : {}),
  };
  return Object.freeze(view);
}

function copySummary(summary: ConfirmationInputSummary): ConfirmationInputSummary {
  const fields = summary.fields.map((field) =>
    Object.freeze({
      key: field.key,
      label: field.label,
      value: field.value,
      ...(field.truncated !== undefined ? { truncated: field.truncated } : {}),
    }),
  );
  return Object.freeze({ fields: Object.freeze(fields) });
}

/**
 * Builder pur : aucun effet de bord, ne modifie ni `options.account` ni
 * `options.summary` (copie défensive de chaque champ affichable), ne
 * génère aucun secret, ne recalcule aucune autorisation, ne décide
 * aucune permission, ne crée aucune confirmation (n'appelle jamais
 * `ConfirmationService`). Entrée identique → sortie identique
 * (structurellement égale) à chaque appel.
 *
 * Le résultat est gelé (`Object.freeze`, à chaque niveau : l'objet
 * racine, `account`, `summary`, `summary.fields` et chaque champ) pour
 * qu'un appelant ne puisse pas modifier accidentellement ce read-model
 * après coup — un gel ciblé sur cette forme fixe et peu profonde, pas une
 * infrastructure de deep-freeze générique.
 */
export function buildConfirmationRequest(options: BuildConfirmationRequestOptions): ConfirmationRequest {
  const request: ConfirmationRequest = {
    confirmationId: options.confirmationId,
    toolName: options.toolName,
    action: options.action,
    account: buildAccountView(options.account),
    summary: copySummary(options.summary),
    createdAt: options.createdAt,
    expiresAt: options.expiresAt,
  };
  return Object.freeze(request);
}
