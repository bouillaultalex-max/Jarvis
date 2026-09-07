import { buildTextPreview } from '../confirmation/text-preview.js';
import type { ConfirmationInputSummary, ConfirmationSummaryField } from '../confirmation/confirmation-request.js';
import type { GmailSendInput } from './gmail-connector.js';

/**
 * Adaptateur Gmail → read-model de confirmation — M8-B4.
 *
 * Transforme un {@link GmailSendInput} (déjà validé par `gmail.send`) en un
 * {@link ConfirmationInputSummary} affichable, c'est-à-dire le mapping
 * connector-specific que `confirmation-request.ts` (M8-A4) a délibérément
 * laissé hors de son propre périmètre (« le futur adaptateur Gmail devra
 * construire un `ConfirmationInputSummary` à partir d'un `GmailSendInput` »).
 *
 * Séparation stricte — ce module :
 *   - n'importe ni n'appelle `ConfirmationService`, `computeFingerprint`,
 *     `canonicalStringify` ni `buildConfirmationRequest` ;
 *   - ne calcule aucune empreinte, ne décide aucune autorisation, ne crée
 *     aucun ticket ;
 *   - produit uniquement des champs d'affichage. La valeur tronquée d'un
 *     champ (voir `text-preview.ts`) ne doit JAMAIS servir de matériau à un
 *     fingerprint : `confirmAndExecute` lie l'empreinte à l'input validé
 *     complet, jamais à ce résumé.
 *
 * Fonction pure : ne mute jamais `input`, sortie déterministe et gelée
 * (même discipline de gel que `buildConfirmationRequest`).
 */

/**
 * `to` n'est **jamais** tronqué : un destinataire partiellement masqué
 * empêcherait l'utilisateur de vérifier à qui l'email part réellement — le
 * contraire du but d'une confirmation. `subject` et `body` (texte libre,
 * potentiellement long) passent par `buildTextPreview`. `threadId` est un
 * identifiant opaque Gmail (jamais un secret) : affiché intégralement.
 */
export function buildGmailSendConfirmationSummary(input: GmailSendInput): ConfirmationInputSummary {
  const subjectPreview = buildTextPreview(input.subject);
  const bodyPreview = buildTextPreview(input.body);

  const fields: ConfirmationSummaryField[] = [
    freezeField({ key: 'to', label: 'Destinataire', value: input.to }),
    freezeField({
      key: 'subject',
      label: 'Objet',
      value: subjectPreview.value,
      ...(subjectPreview.truncated ? { truncated: true } : {}),
    }),
    freezeField({
      key: 'body',
      label: 'Corps du message',
      value: bodyPreview.value,
      ...(bodyPreview.truncated ? { truncated: true } : {}),
    }),
  ];

  if (input.threadId !== undefined) {
    fields.push(freezeField({ key: 'threadId', label: 'Fil de discussion', value: input.threadId }));
  }

  return Object.freeze({ fields: Object.freeze(fields) });
}

function freezeField(field: ConfirmationSummaryField): ConfirmationSummaryField {
  return Object.freeze({ ...field });
}
