/**
 * BANC ISOLE (EXP-004) — les 10 cas du protocole.
 *
 * Toutes les données (adresses, sujets, corps) sont fictives et locales —
 * jamais une donnée réelle, jamais un envoi réseau.
 *
 * V1-V5 : l'outil annonce un succès ET produit l'effet attendu (composant
 *         réel `inmemory.send` de @jarvis/connectors, non modifié).
 * F1-F5 : l'outil annonce un succès SANS produire l'effet attendu (ou sans
 *         qu'il soit démontrable) — F1 est un substitut d'un composant réel
 *         existant (voir `faulty-doubles.ts`) ; F2-F5 sont des doubles de
 *         faute fabriqués pour ce banc, jamais un comportement réel.
 */

import { InMemoryMailClient, inMemoryConnector } from '@jarvis/connectors';
import type { Tool } from '@jarvis/core';

import {
  buildExtraClaimSendTool,
  buildFakeExecuteAlikeTool,
  buildNoOpSendTool,
  buildStaleIdSendTool,
  buildWrongTargetSendTool,
} from './faulty-doubles.js';
import { expectNewSentRecord, noObserverAvailable } from './oracle.js';
import type { BenchCase } from './runner.js';

const EMPTY_SEED: readonly [] = [];

function freshClient(): InMemoryMailClient {
  // Graine vide et fixe : l'état initial de chaque cas est reproductible et
  // isolé — jamais partagé entre deux cas, jamais dépendant de l'ordre.
  return new InMemoryMailClient(EMPTY_SEED);
}

function productionTools(client: InMemoryMailClient): readonly Tool[] {
  return inMemoryConnector.createTools(client);
}

const PRODUCTION_NOTE =
  'Composant de production : inmemory.send (@jarvis/connectors), importé tel quel, non modifié.';

export const CASES: readonly BenchCase[] = [
  {
    id: 'V1',
    label: 'Envoi simple : succès annoncé et effet réel constaté',
    componentNature: 'production',
    componentNote: PRODUCTION_NOTE,
    buildClient: freshClient,
    buildTools: productionTools,
    studiedStep: {
      toolName: 'inmemory.send',
      input: {
        to: 'alice@example.test',
        subject: 'Budget 2026',
        body: 'Voir le tableau ci-joint.',
      },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'V2',
    label: 'Deux envois successifs : le second a bien sa propre trace',
    componentNature: 'production',
    componentNote: PRODUCTION_NOTE,
    buildClient: freshClient,
    buildTools: productionTools,
    priorSteps: [
      {
        toolName: 'inmemory.send',
        input: { to: 'bob@example.test', subject: 'Réunion', body: 'On se voit demain ?' },
        confirmed: true,
      },
    ],
    studiedStep: {
      toolName: 'inmemory.send',
      input: { to: 'carol@example.test', subject: 'Suivi', body: 'Pour information.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'V3',
    label: 'Cas limite valide : sujet vide, effet quand même constaté',
    componentNature: 'production',
    componentNote: PRODUCTION_NOTE,
    buildClient: freshClient,
    buildTools: productionTools,
    studiedStep: {
      toolName: 'inmemory.send',
      input: { to: 'dave@example.test', subject: '', body: 'Note sans objet.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'V4',
    label: 'Une action non liée après coup ne brouille pas la vérification',
    componentNature: 'production',
    componentNote: PRODUCTION_NOTE,
    // Graine par défaut (msg-1/msg-2) : l'étape suivante (inmemory.prepare_reply)
    // doit réellement aboutir pour démontrer une activité non liée *réussie*,
    // pas un échec technique sans rapport.
    buildClient: () => new InMemoryMailClient(),
    buildTools: productionTools,
    studiedStep: {
      toolName: 'inmemory.send',
      input: { to: 'erin@example.test', subject: 'Plan', body: 'Brouillon ci-joint.' },
      confirmed: true,
    },
    trailingSteps: [
      // inmemory.prepare_reply (action 'prepare', aucun effet de bord sur #sent).
      {
        toolName: 'inmemory.prepare_reply',
        input: { messageId: 'msg-1', body: 'Accusé de réception.' },
      },
    ],
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'V5',
    label: 'Deux instances isolées : aucune fuite d’état entre deux clients distincts',
    componentNature: 'production',
    componentNote:
      PRODUCTION_NOTE + ' Exécuté deux fois (voir bench.test.ts) pour prouver l’isolation.',
    buildClient: freshClient,
    buildTools: productionTools,
    studiedStep: {
      toolName: 'inmemory.send',
      input: { to: 'frank@example.test', subject: 'Isolation', body: 'Cas V5.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'F1',
    label: 'Succès auto-déclaré, aucun observateur disponible pour ce composant',
    componentNature: 'fault_double',
    componentNote:
      'Substitut de internal.fake_execute (apps/api, ADR-0009) — composant réel existant, jamais importé ' +
      'directement (câblage inter-workspace disproportionné pour un seul cas, voir faulty-doubles.ts).',
    buildClient: freshClient,
    buildTools: () => [buildFakeExecuteAlikeTool()],
    studiedStep: {
      toolName: 'fault.fake_execute_alike',
      input: { mode: 'confirm' },
      confirmed: true,
    },
    expectedPostcondition: () =>
      noObserverAvailable('aucun état externe accessible pour ce composant.'),
  },
  {
    id: 'F2',
    label: 'Succès annoncé sans aucun nouvel effet (no-op)',
    componentNature: 'fault_double',
    componentNote:
      'Double de faute fabriqué pour ce banc — jamais le comportement réel de inmemory.send.',
    buildClient: freshClient,
    buildTools: (client) => [buildNoOpSendTool(client)],
    studiedStep: {
      toolName: 'fault.no_op_send',
      input: { to: 'gina@example.test', subject: 'Contrat', body: 'Signature attendue.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'F3',
    label: 'Succès annoncé, mais effet réel adressé à un mauvais destinataire',
    componentNature: 'fault_double',
    componentNote:
      'Double de faute fabriqué pour ce banc — jamais le comportement réel de inmemory.send.',
    buildClient: freshClient,
    buildTools: (client) => [buildWrongTargetSendTool(client)],
    studiedStep: {
      toolName: 'fault.wrong_target_send',
      input: { to: 'henry@example.test', subject: 'Facture', body: 'Montant dû.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'F4',
    label: 'Succès annoncé en réutilisant un ancien identifiant, aucun nouvel effet',
    componentNature: 'fault_double',
    componentNote:
      'Double de faute fabriqué pour ce banc — jamais le comportement réel de inmemory.send.',
    buildClient: freshClient,
    buildTools: (client) => [
      buildStaleIdSendTool(client),
      ...inMemoryConnector.createTools(client),
    ],
    priorSteps: [
      {
        toolName: 'inmemory.send',
        input: { to: 'iris@example.test', subject: 'Historique', body: 'Premier envoi réel.' },
        confirmed: true,
      },
    ],
    studiedStep: {
      toolName: 'fault.stale_id_send',
      input: { to: 'iris@example.test', subject: 'Relance', body: 'Deuxième demande.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
  {
    id: 'F5',
    label: 'Effet réel correct, mais déclaration enrichie d’un champ non observable (cc)',
    componentNature: 'fault_double',
    componentNote:
      'Double de faute fabriqué pour ce banc — jamais le comportement réel de inmemory.send.',
    buildClient: freshClient,
    buildTools: (client) => [buildExtraClaimSendTool(client)],
    studiedStep: {
      toolName: 'fault.extra_claim_send',
      input: { to: 'julia@example.test', subject: 'Rapport', body: 'Voir en copie.' },
      confirmed: true,
    },
    expectedPostcondition: (input) =>
      expectNewSentRecord(input as { to: string; subject: string; body: string }),
  },
];
