import { describe, test, expect } from 'vitest';

import {
  applyDraftResponse,
  describeDraftOption,
  initialDraftState,
  resetDraftState,
  startDraftRequest,
  toDraftView,
} from './inbox-draft.js';

describe('toDraftView', () => {
  test('brouillon prêt : body et subject restitués', () => {
    expect(
      toDraftView(200, { status: 'ok', draft: { body: 'Corps.', subject: 'Re: Sujet' } }),
    ).toEqual({
      kind: 'draft',
      body: 'Corps.',
      subject: 'Re: Sujet',
    });
  });

  test('brouillon prêt sans subject : subject à null, jamais inventé', () => {
    expect(toDraftView(200, { status: 'ok', draft: { body: 'Corps.' } })).toEqual({
      kind: 'draft',
      body: 'Corps.',
      subject: null,
    });
  });

  test('information manquante : questions restituées, jamais de brouillon', () => {
    const view = toDraftView(200, { status: 'needs_clarification', questions: ['date souhaitée'] });
    expect(view).toEqual({ kind: 'needs_clarification', questions: ['date souhaitée'] });
  });

  test('brouillon bloqué : raison restituée, jamais de brouillon', () => {
    expect(toDraftView(200, { status: 'blocked', reason: 'Affirmation non confirmée.' })).toEqual({
      kind: 'blocked',
      reason: 'Affirmation non confirmée.',
    });
  });

  test('échec serveur (status: error) : message restitué', () => {
    expect(toDraftView(200, { status: 'error', reason: 'Analyse en échec.' })).toEqual({
      kind: 'failure',
      message: 'Analyse en échec.',
    });
  });

  test.each([
    [0, null, 'Centre de commandement injoignable.'],
    [404, { error: 'Boîte inconnue.' }, 'Boîte inconnue. (HTTP 404)'],
    [200, { status: 'ok' }, 'Réponse inattendue du serveur.'],
    [200, { status: 'inconnu' }, 'Réponse inattendue du serveur.'],
  ])('échec %s → message, jamais un brouillon inventé', (status, payload, message) => {
    const view = toDraftView(status, payload);
    expect(view.kind).toBe('failure');
    expect(view.message).toBe(message);
  });
});

describe('describeDraftOption', () => {
  test('combine expéditeur et objet', () => {
    expect(describeDraftOption({ sender: 'a@b.test', subject: 'Sujet' })).toBe('a@b.test — Sujet');
  });
});

describe('cycle de vie du brouillon — réponse tardive (régression)', () => {
  const DRAFT_A = { kind: 'draft', body: 'Brouillon A.', subject: null };
  const DRAFT_B = { kind: 'draft', body: 'Brouillon B.', subject: null };

  test('réponse normale : jeton inchangé entre la demande et la réponse → appliquée', () => {
    let draft = startDraftRequest(initialDraftState(), 'A');
    const requestToken = draft.token;

    const next = applyDraftResponse(draft, requestToken, DRAFT_A);

    expect(next).toMatchObject({ status: 'ready', view: DRAFT_A, editedBody: 'Brouillon A.' });
  });

  test('mail A puis mail B demandé avant la réponse de A : la réponse tardive de A est ignorée, jamais affichée sous B', () => {
    let draft = startDraftRequest(initialDraftState(), 'A');
    const tokenA = draft.token;

    // B est demandé avant que la réponse de A n'arrive.
    draft = startDraftRequest(draft, 'B');
    const tokenB = draft.token;

    // La réponse de A arrive enfin, en retard.
    const afterStaleA = applyDraftResponse(draft, tokenA, DRAFT_A);
    expect(afterStaleA).toBeNull(); // jamais appliquée : ni affichée, ni fusionnée avec l'état de B

    // L'état affiché reste celui de B, toujours « en cours » tant que sa
    // propre réponse n'est pas arrivée.
    expect(draft).toMatchObject({ status: 'loading', messageId: 'B' });

    // La réponse de B, elle, s'applique normalement.
    const afterB = applyDraftResponse(draft, tokenB, DRAFT_B);
    expect(afterB).toMatchObject({ status: 'ready', view: DRAFT_B, messageId: 'B' });
  });

  test('mail A puis sélection de B sans redemander : la réponse tardive de A reste ignorée', () => {
    let draft = startDraftRequest(initialDraftState(), 'A');
    const tokenA = draft.token;

    // L'utilisateur change seulement la sélection vers B, sans cliquer sur « Demander un brouillon ».
    draft = resetDraftState(draft);

    const afterStaleA = applyDraftResponse(draft, tokenA, DRAFT_A);
    expect(afterStaleA).toBeNull();
    expect(draft).toMatchObject({ status: 'idle', view: null, messageId: null });
  });

  test('lot relancé pendant l’attente : la réponse tardive de l’ancien lot est ignorée', () => {
    let draft = startDraftRequest(initialDraftState(), 'A');
    const tokenA = draft.token;

    // Un nouveau lot est lancé : `launchRun` réinitialise l'état de brouillon.
    draft = resetDraftState(draft);

    const afterStaleA = applyDraftResponse(draft, tokenA, DRAFT_A);
    expect(afterStaleA).toBeNull();
    expect(draft).toMatchObject({ status: 'idle', view: null, messageId: null });
  });
});
