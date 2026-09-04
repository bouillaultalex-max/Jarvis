import { describe, expect, it } from 'vitest';
import { ClassificationEngine, InMemoryPreferenceStore } from '@jarvis/classification';
import type { EmailMessage } from '@jarvis/types';

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

describe('classifyEmails', () => {
  it('plusieurs emails → plusieurs classifications, une par email, dans l’ordre', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    engine.addExplicitRule({
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'important',
      reason: 'Le patron.',
    });
    engine.addExplicitRule({
      attribute: 'domain',
      value: 'newsletter.example',
      decision: 'not_important',
      reason: 'Newsletters.',
    });

    const emails = [
      email({ id: 'm1', sender: 'boss@example.com' }),
      email({ id: 'm2', sender: 'promo@newsletter.example' }),
      email({ id: 'm3', sender: 'unknown@example.test' }),
    ];

    const results = await classifyEmails(engine, emails);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ email: emails[0], classification: { label: 'important' } });
    expect(results[1]).toMatchObject({ email: emails[1], classification: { label: 'not_important' } });
    expect(results[2]).toMatchObject({ email: emails[2], classification: { label: 'uncertain' } });
  });

  it('lot vide → résultat vide', async () => {
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const results = await classifyEmails(engine, []);

    expect(results).toEqual([]);
  });
});
