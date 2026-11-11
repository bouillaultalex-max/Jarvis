import { describe, test, expect } from 'vitest';

import {
  MAX_BATCH_SIZE,
  describeMailboxOption,
  parseBatchSize,
  toMailboxList,
  toRunView,
} from './inbox-run.js';

const COMPLETED = {
  runId: '11111111-2222-3333-4444-555555555555',
  status: 'completed',
  mailbox: { id: 'fixture', label: 'Boîte fictive', kind: 'fixture' },
  source: { tool: 'inbox-fixture.read', requested: 2, returned: 2 },
  steps: [
    { id: 'read', status: 'executed', detail: '2 message(s) lu(s).' },
    { id: 'classify', status: 'executed', detail: 'Moteur de classification.' },
    { id: 'llm_classification', status: 'not_enabled', detail: 'Aucun LLM configuré.' },
    { id: 'summary', status: 'not_enabled', detail: 'Aucun LLM configuré.' },
  ],
  items: [
    {
      id: 'a',
      sender: 'a@exemple.test',
      subject: 'Sujet A',
      receivedAt: '2026-11-10T09:14:00.000Z',
      label: 'uncertain',
      source: 'default',
      reason: 'Classement par défaut.',
    },
    {
      id: 'b',
      sender: 'b@exemple.test',
      subject: 'Sujet B',
      receivedAt: '2026-11-09T09:14:00.000Z',
      label: 'important',
      source: 'llm',
      reason: 'Raison LLM.',
      summary: 'Résumé B.',
    },
  ],
};

describe('parseBatchSize', () => {
  test.each([
    ['1', 1],
    ['10', 10],
    [' 5 ', 5],
    [7, 7],
  ])('accepte %j', (raw, expected) => {
    expect(parseBatchSize(raw)).toBe(expected);
  });

  test.each(['0', '11', '2.5', '-3', 'abc', '', null, undefined, '1e1'])('refuse %j', (raw) => {
    expect(parseBatchSize(raw)).toBeNull();
  });

  test('la borne affichée est 10', () => {
    expect(MAX_BATCH_SIZE).toBe(10);
  });
});

describe('describeMailboxOption', () => {
  test('la boîte fictive est affichée « Boîte fictive »', () => {
    expect(describeMailboxOption({ id: 'fixture', label: 'Boîte fictive', kind: 'fixture' })).toBe(
      'Boîte fictive',
    );
  });

  test('une boîte fictive au nom neutre reçoit la mention « fictive »', () => {
    expect(describeMailboxOption({ id: 'x', label: 'Essai', kind: 'fixture' })).toBe(
      'Essai (fictive)',
    );
  });
});

describe('toMailboxList', () => {
  test('liste reçue', () => {
    const view = toMailboxList(200, { mailboxes: [COMPLETED.mailbox], maxBatchSize: 10 });
    expect(view).toEqual({ kind: 'mailboxes', mailboxes: [COMPLETED.mailbox] });
  });

  test.each([
    [0, null, 'Centre de commandement injoignable.'],
    [502, { error: 'API Jarvis injoignable.' }, 'API Jarvis injoignable. (HTTP 502)'],
    [200, { mailboxes: [] }, 'réponse inattendue (HTTP 200)'],
    [200, null, 'réponse inattendue (HTTP 200)'],
  ])('échec %s → message, jamais de boîte inventée', (status, payload, message) => {
    expect(toMailboxList(status, payload)).toEqual({ kind: 'failure', message });
  });
});

describe('toRunView — lot terminé', () => {
  const view = toRunView(200, COMPLETED);

  test('porte l’identifiant d’exécution, la boîte et le statut', () => {
    expect(view).toMatchObject({
      kind: 'run',
      runId: COMPLETED.runId,
      failed: false,
      statusLabel: 'Terminée',
      mailboxLabel: 'Boîte fictive',
      error: null,
    });
  });

  test('restitue libellé, raison et provenance de chaque message', () => {
    expect(view.items[0]).toMatchObject({
      sender: 'a@exemple.test',
      subject: 'Sujet A',
      receivedAt: '2026-11-10T09:14:00.000Z',
      labelText: 'Incertain',
      reason: 'Classement par défaut.',
      sourceText: 'repli par défaut',
      summary: null,
    });
    expect(view.items[1]).toMatchObject({
      labelText: 'Important',
      sourceText: 'LLM',
      summary: 'Résumé B.',
    });
  });

  test('distingue les étapes exécutées des étapes non activées', () => {
    expect(view.steps.map((s) => [s.title, s.statusLabel])).toEqual([
      ['Lecture de la boîte', 'Exécutée'],
      ['Classification', 'Exécutée'],
      ['Classification par LLM', 'Non activée'],
      ['Résumé', 'Non activée'],
    ]);
  });

  test('indique la source du lot', () => {
    expect(view.sourceLines).toEqual([
      'Boîte : Boîte fictive (fictive)',
      'Outil de lecture : inbox-fixture.read',
      'Messages demandés : 2 — lus : 2',
    ]);
  });
});

describe('toRunView — refus, erreurs et réponses inexploitables', () => {
  const REFUSED = {
    ...COMPLETED,
    status: 'failed',
    error: 'Lecture refusée par la politique de permissions.',
    source: { tool: 'inbox-fixture.read', requested: 2, returned: 0 },
    steps: [
      { id: 'read', status: 'refused', detail: 'Lecture refusée par la politique de permissions.' },
      { id: 'classify', status: 'skipped', detail: 'Non exécutée : aucun message lu.' },
    ],
  };

  test('lecture refusée : erreur visible, étapes réelles, aucun message', () => {
    // `items` est volontairement laissé rempli dans la réponse simulée : la
    // vue ne doit jamais afficher de message pour un lot en échec.
    const view = toRunView(403, REFUSED);

    expect(view.failed).toBe(true);
    expect(view.statusLabel).toBe('Terminée avec erreur');
    expect(view.error).toBe('Lecture refusée par la politique de permissions.');
    expect(view.items).toEqual([]);
    expect(view.steps.map((s) => s.statusLabel)).toEqual(['Refusée', 'Non exécutée']);
  });

  test.each([
    [400, { error: 'Le champ « maxResults » doit être un entier entre 1 et 10.' }],
    [404, { error: 'Boîte inconnue.' }],
    [502, { error: 'API Jarvis injoignable.' }],
    [504, { error: 'API Jarvis sans réponse dans le délai de 10 s.' }],
    [0, null],
    [200, { items: COMPLETED.items }],
    [200, 'pas du JSON'],
  ])('réponse sans exécution (HTTP %s) → échec, jamais un lot', (status, payload) => {
    const view = toRunView(status, payload);

    expect(view.kind).toBe('failure');
    expect(view.message.length).toBeGreaterThan(0);
    expect(view.items).toBeUndefined();
  });
});
