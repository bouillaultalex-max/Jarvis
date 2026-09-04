import { describe, expect, it } from 'vitest';
import { ClassificationEngine, InMemoryPreferenceStore } from '@jarvis/classification';
import type { EmailMessage } from '@jarvis/types';

import { applyUserRule, recordFeedbackForEmail } from './feedback.js';
import { classifyEmails } from './classify-emails.js';

function email(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'm1',
    sender: 'someone@example.test',
    recipients: [],
    subject: 'Sujet',
    body: 'Corps',
    receivedAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  };
}

describe('recordFeedbackForEmail', () => {
  it('enregistre une correction utilisateur sur un email retrouvé par id', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    const target = email({ id: 'm1', sender: 'unknown@example.test' });

    const before = await classifyEmails(engine, [target]);
    expect(before[0]?.classification.label).toBe('uncertain');

    recordFeedbackForEmail(engine, before, 'm1', 'important');

    const after = await classifyEmails(engine, [target]);
    expect(after[0]?.classification).toMatchObject({ label: 'important', source: 'user_correction' });
  });

  it('une correction ciblée sur un expéditeur ne se généralise pas à tout un domaine', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    const target = email({ id: 'm1', sender: 'someone@newsletter.example' });
    const sameDomainOther = email({ id: 'm2', sender: 'someone-else@newsletter.example' });

    const batch = await classifyEmails(engine, [target]);
    recordFeedbackForEmail(engine, batch, 'm1', 'important');

    const results = await classifyEmails(engine, [target, sameDomainOther]);

    expect(results[0]?.classification).toMatchObject({ label: 'important', source: 'user_correction' });
    expect(results[1]?.classification.label).toBe('uncertain');
  });

  it('lève une erreur si l’id ne correspond à aucun email du lot', async () => {
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });
    const batch = await classifyEmails(engine, [email({ id: 'm1' })]);

    expect(() => recordFeedbackForEmail(engine, batch, 'inexistant', 'important')).toThrow(/inexistant/);
  });
});

describe('applyUserRule', () => {
  it('« les emails de cette adresse sont toujours importants » → règle explicite sender', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });

    const pref = applyUserRule(engine, {
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'important',
    });

    expect(pref).toMatchObject({ attribute: 'sender', decision: 'important', origin: 'explicit_rule' });
    const [result] = await classifyEmails(engine, [email({ sender: 'boss@example.com' })]);
    expect(result?.classification).toMatchObject({ label: 'important', source: 'explicit_rule' });
  });

  it('« les newsletters de ce domaine ne sont pas importantes » → règle explicite domain', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });

    applyUserRule(engine, {
      attribute: 'domain',
      value: 'newsletter.example',
      decision: 'not_important',
    });

    const [result] = await classifyEmails(engine, [email({ sender: 'promo@newsletter.example' })]);
    expect(result?.classification).toMatchObject({ label: 'not_important', source: 'explicit_rule' });
  });

  it('utilise une explication par défaut si aucune n’est fournie, sans écraser une explication explicite', () => {
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const withDefault = applyUserRule(engine, { attribute: 'sender', value: 'a@example.com', decision: 'important' });
    const withCustom = applyUserRule(engine, {
      attribute: 'sender',
      value: 'b@example.com',
      decision: 'important',
      reason: 'Raison personnalisée.',
    });

    expect(withDefault.reason.length).toBeGreaterThan(0);
    expect(withCustom.reason).toBe('Raison personnalisée.');
  });
});
