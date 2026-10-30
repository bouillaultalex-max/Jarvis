// Données fictives pour la démonstration Inbox. Aucun message réel, aucune
// boîte mail connectée. Les catégories sont posées à la main ici : il n'y a
// pas de classification réelle derrière ce fichier.

export const DEMO_CATEGORIES = ['Action requise', 'Support client', 'Finance', 'Information'];

export const DEMO_MESSAGES = [
  {
    id: 'demo-1',
    from: 'Camille Faure',
    fromEmail: 'camille.faure@exemple-cabinet.fr',
    subject: 'Relance — pièces manquantes pour le dossier Lefort',
    preview: 'Il nous manque encore deux pièces pour clôturer le dossier avant vendredi…',
    body:
      "Bonjour,\n\nAvant de clôturer le dossier Lefort, il nous manque encore l'attestation " +
      "d'assurance et le justificatif de domicile à jour. Pourriez-vous me les transmettre " +
      'avant vendredi 17h ? Le dossier ne pourra pas avancer sans ces deux pièces.\n\n' +
      "Merci d'avance,\nCamille",
    date: '2026-10-28T09:14:00',
    category: 'Action requise',
  },
  {
    id: 'demo-2',
    from: 'Support Nuage Fibre',
    fromEmail: 'support@nuage-fibre.exemple',
    subject: 'Votre ticket #48213 a été mis à jour',
    preview: 'Notre technicien passe entre 14h et 16h ce jeudi pour vérifier la connexion…',
    body:
      'Bonjour,\n\nSuite à votre signalement de coupures répétées, un technicien passera ' +
      "ce jeudi entre 14h et 16h pour vérifier l'installation. Merci de rester joignable sur " +
      "ce créneau.\n\nL'équipe support",
    date: '2026-10-28T11:02:00',
    category: 'Support client',
  },
  {
    id: 'demo-3',
    from: 'Comptabilité — Atelier Lumen',
    fromEmail: 'compta@atelier-lumen.exemple',
    subject: 'Facture F-2026-0917 — échéance le 5 novembre',
    preview: 'Veuillez trouver ci-joint la facture F-2026-0917, à régler avant le 5 novembre…',
    body:
      "Bonjour,\n\nVeuillez trouver ci-joint la facture F-2026-0917 d'un montant de 640 €, " +
      'à régler avant le 5 novembre 2026. Merci de nous indiquer la référence de paiement ' +
      'une fois le virement effectué.\n\nCordialement',
    date: '2026-10-27T16:45:00',
    category: 'Finance',
  },
  {
    id: 'demo-4',
    from: 'Newsletter Veille Juridique',
    fromEmail: 'newsletter@veille-juridique.exemple',
    subject: 'Cette semaine : trois décisions à connaître',
    preview: 'Au sommaire : jurisprudence sur les clauses de non-concurrence, nouveau décret…',
    body:
      'Au sommaire de cette semaine :\n' +
      '- Jurisprudence récente sur les clauses de non-concurrence\n' +
      '- Nouveau décret sur les délais de notification\n' +
      '- Agenda des formations du mois prochain\n\nBonne lecture.',
    date: '2026-10-27T07:30:00',
    category: 'Information',
  },
  {
    id: 'demo-5',
    from: 'Hôtel Belrive',
    fromEmail: 'reservations@hotel-belrive.exemple',
    subject: 'Confirmation de réservation — 12 au 14 novembre',
    preview: 'Votre réservation pour 2 nuits est confirmée. Arrivée possible à partir de 15h…',
    body:
      'Bonjour,\n\nVotre réservation du 12 au 14 novembre (2 nuits, chambre double) est ' +
      "confirmée. L'arrivée est possible à partir de 15h, le départ avant 11h.\n\n" +
      'Au plaisir de vous accueillir,\nHôtel Belrive',
    date: '2026-10-26T18:20:00',
    category: 'Information',
  },
  {
    id: 'demo-6',
    from: 'Thomas Reynaud',
    fromEmail: 't.reynaud@exemple-partenaire.fr',
    subject: 'Dispo pour un point cette semaine ?',
    preview: "Je voudrais qu'on cale 20 minutes avant la fin de semaine pour le point budget…",
    body:
      "Salut,\n\nTu aurais 20 minutes avant la fin de semaine pour qu'on fasse le point sur " +
      'le budget du trimestre ? Je suis dispo mercredi ou jeudi après-midi.\n\nÀ bientôt,\nThomas',
    date: '2026-10-26T08:55:00',
    category: 'Action requise',
  },
];

// Étapes d'une mission de démonstration : purement locales, aucun appel
// réseau ni LLM réel derrière ces libellés.
export function buildDemoMissionSteps() {
  return [
    {
      id: 'fetch',
      title: 'Récupération simulée des messages',
      status: 'ok',
      result: `${DEMO_MESSAGES.length} messages fictifs chargés depuis des données locales (data.js).`,
    },
    {
      id: 'classify',
      title: 'Classification simulée',
      status: 'ok',
      result: `Répartition en ${DEMO_CATEGORIES.length} catégories fixées à l'avance — aucune classification réelle.`,
    },
    {
      id: 'summarize',
      title: 'Résumé simulé',
      status: 'ok',
      result:
        'Aperçus affichés tels que rédigés dans les données de démonstration, sans appel à un modèle de langage.',
    },
  ];
}

export const DEMO_SOURCES = [
  'Jeu de données fictif local — apps/command-center/data.js',
  'Aucune boîte mail réelle, aucun compte connecté, aucune donnée personnelle.',
];
