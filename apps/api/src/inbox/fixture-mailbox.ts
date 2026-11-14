import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { InboxMailbox } from './inbox-routes.js';

/**
 * Boîte fictive du centre de commandement : messages synthétiques, écrits
 * ici, au format `EmailMessage` du dépôt. Aucun compte, aucun secret, aucun
 * réseau. Seul le contenu des messages est inventé — leur classement est
 * calculé par le pipeline Inbox, jamais écrit à la main.
 */

export const FIXTURE_READ_TOOL_NAME = 'inbox-fixture.read';

const ME = 'moi@exemple.test';

function message(
  id: string,
  sender: string,
  subject: string,
  body: string,
  receivedAt: string,
): EmailMessage {
  return { id, threadId: `fil-${id}`, sender, recipients: [ME], subject, body, receivedAt };
}

const FIXTURE_MESSAGES: readonly EmailMessage[] = [
  message(
    'fictif-01',
    'camille.faure@cabinet.exemple',
    'Relance — pièces manquantes pour le dossier Lefort',
    "Il nous manque l'attestation d'assurance et le justificatif de domicile avant vendredi 17h.",
    '2026-11-10T09:14:00.000Z',
  ),
  message(
    'fictif-02',
    'support@nuage-fibre.exemple',
    'Votre ticket #48213 a été mis à jour',
    'Un technicien passera jeudi entre 14h et 16h pour vérifier la connexion.',
    '2026-11-10T08:02:00.000Z',
  ),
  message(
    'fictif-03',
    'compta@atelier-lumen.exemple',
    'Facture F-2026-0917 — échéance le 20 novembre',
    'Facture de 640 € à régler avant le 20 novembre 2026.',
    '2026-11-09T16:45:00.000Z',
  ),
  message(
    'fictif-04',
    'newsletter@veille-juridique.exemple',
    'Cette semaine : trois décisions à connaître',
    'Au sommaire : clauses de non-concurrence, délais de notification, agenda des formations.',
    '2026-11-09T07:30:00.000Z',
  ),
  message(
    'fictif-05',
    'reservations@hotel-belrive.exemple',
    'Confirmation de réservation — 12 au 14 décembre',
    'Votre réservation pour 2 nuits est confirmée. Arrivée à partir de 15h.',
    '2026-11-08T18:20:00.000Z',
  ),
  message(
    'fictif-06',
    't.reynaud@partenaire.exemple',
    'Dispo pour un point cette semaine ?',
    'Tu aurais 20 minutes avant la fin de semaine pour le point budget ?',
    '2026-11-08T08:55:00.000Z',
  ),
  message(
    'fictif-07',
    'rh@atelier-lumen.exemple',
    'Entretien annuel — créneaux proposés',
    'Merci de choisir un créneau parmi mardi 10h, mercredi 14h ou jeudi 9h.',
    '2026-11-07T11:10:00.000Z',
  ),
  message(
    'fictif-08',
    'no-reply@transport.exemple',
    'Votre billet pour Lyon',
    'Départ le 18 novembre à 7h42, voiture 6, place 34.',
    '2026-11-07T06:05:00.000Z',
  ),
  message(
    'fictif-09',
    'promo@boutique.exemple',
    '-30 % sur toute la collection',
    "Offre valable jusqu'à dimanche minuit.",
    '2026-11-06T19:00:00.000Z',
  ),
  message(
    'fictif-10',
    'syndic@residence.exemple',
    "Convocation à l'assemblée générale",
    "L'assemblée générale se tiendra le 2 décembre à 18h30, salle commune.",
    '2026-11-06T10:25:00.000Z',
  ),
  message(
    'fictif-11',
    'ines.marchand@client.exemple',
    'Retour sur la maquette',
    'Deux remarques sur la page d’accueil, détail en pièce jointe.',
    '2026-11-05T15:40:00.000Z',
  ),
  message(
    'fictif-12',
    'banque@etablissement.exemple',
    'Votre relevé mensuel est disponible',
    'Le relevé du mois d’octobre est consultable dans votre espace.',
    '2026-11-05T05:00:00.000Z',
  ),
];

export interface FixtureReadInput {
  readonly maxResults: number;
}

/**
 * Outil de lecture fictif (`action: 'read'`) : renvoie les `maxResults`
 * premiers messages synthétiques. Sa seule méthode est une lecture en
 * mémoire — aucune écriture, aucun envoi, aucun état modifié.
 */
export function createFixtureReadTool(
  messages: readonly EmailMessage[] = FIXTURE_MESSAGES,
): Tool<FixtureReadInput, { readonly messages: readonly EmailMessage[] }> {
  return {
    name: FIXTURE_READ_TOOL_NAME,
    description:
      'Lit la boîte fictive du centre de commandement (lecture seule, données synthétiques).',
    action: 'read',
    inputSchema: {
      type: 'object',
      properties: { maxResults: { type: 'integer', minimum: 1 } },
      required: ['maxResults'],
    },

    validateInput(input: unknown): ToolValidationResult<FixtureReadInput> {
      const maxResults = (input as { maxResults?: unknown } | null)?.maxResults;
      if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1) {
        return invalid(`${FIXTURE_READ_TOOL_NAME} : « maxResults » doit être un entier positif.`);
      }
      return valid({ maxResults });
    },

    async execute(input: FixtureReadInput) {
      return { messages: messages.slice(0, input.maxResults) };
    },
  };
}

export const fixtureMailbox: InboxMailbox = {
  id: 'fixture',
  label: 'Boîte fictive',
  kind: 'fixture',
  readTool: createFixtureReadTool(),
};
