import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '@jarvis/types';

import { matchPreference } from './preference-matcher.js';
import { InMemoryPreferenceStore } from './preference.js';
import type { Preference } from './preference.js';

function email(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'msg-1',
    sender: 'ceo@newsletter.example',
    recipients: ['me@example.test'],
    subject: 'Point hebdo',
    body: 'Contenu neutre.',
    receivedAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  };
}

describe('matchPreference', () => {
  it('reconnaît une préférence sur l’expéditeur exact (insensible à la casse)', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'sender',
      value: 'Boss@Example.com',
      decision: 'important',
      origin: 'explicit_rule',
      reason: 'Les mails du patron sont importants.',
    });

    const matched = matchPreference(email({ sender: 'boss@example.com' }), store.list());

    expect(matched?.decision).toBe('important');
  });

  it('reconnaît une préférence sur le domaine', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'domain',
      value: 'newsletter.example',
      decision: 'not_important',
      origin: 'explicit_rule',
      reason: 'Les newsletters commerciales ne sont pas importantes.',
    });

    const matched = matchPreference(email({ sender: 'promo@newsletter.example' }), store.list());

    expect(matched?.decision).toBe('not_important');
  });

  it('reconnaît une préférence sur l’objet (sous-chaîne, insensible à la casse)', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'subject_contains',
      value: 'Facture',
      decision: 'important',
      origin: 'explicit_rule',
      reason: 'Les factures sont importantes.',
    });

    const matched = matchPreference(email({ subject: 'Votre facture de septembre' }), store.list());

    expect(matched?.decision).toBe('important');
  });

  it('reconnaît une préférence sur un mot-clé, dans l’objet ou le corps', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'keyword',
      value: 'urgent',
      decision: 'important',
      origin: 'user_correction',
      reason: 'Mot-clé « urgent » jugé important.',
    });

    const matchedViaBody = matchPreference(
      email({ subject: 'Sans rapport', body: 'Ceci est URGENT, merci de répondre.' }),
      store.list(),
    );
    const matchedViaSubject = matchPreference(email({ subject: 'Urgent : à traiter' }), store.list());

    expect(matchedViaBody?.decision).toBe('important');
    expect(matchedViaSubject?.decision).toBe('important');
  });

  it('renvoie undefined en l’absence de correspondance', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'sender',
      value: 'other@example.com',
      decision: 'important',
      origin: 'explicit_rule',
      reason: 'sans rapport',
    });

    expect(matchPreference(email(), store.list())).toBeUndefined();
  });

  it('deux préférences contradictoires de spécificité différente : la plus spécifique gagne', () => {
    const store = new InMemoryPreferenceStore();
    store.add({
      attribute: 'domain',
      value: 'newsletter.example',
      decision: 'not_important',
      origin: 'explicit_rule',
      reason: 'Newsletters non importantes.',
    });
    store.add({
      attribute: 'sender',
      value: 'ceo@newsletter.example',
      decision: 'important',
      origin: 'user_correction',
      reason: 'Sauf le PDG.',
    });

    const matched = matchPreference(email({ sender: 'ceo@newsletter.example' }), store.list());

    expect(matched?.decision).toBe('important');
    expect(matched?.attribute).toBe('sender');
  });

  it('deux préférences contradictoires de même spécificité : la plus récente gagne, quelle que soit l’origine', () => {
    const store = new InMemoryPreferenceStore();
    const older: Preference = store.add({
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'important',
      origin: 'explicit_rule',
      reason: 'Ancienne règle.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer: Preference = store.add({
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'not_important',
      origin: 'user_correction',
      reason: 'Correction plus récente.',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    const matched = matchPreference(email({ sender: 'boss@example.com' }), store.list());

    expect(matched?.id).toBe(newer.id);
    expect(matched?.decision).toBe('not_important');
    expect(matched?.id).not.toBe(older.id);
  });
});
