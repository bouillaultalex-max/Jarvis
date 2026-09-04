import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '@jarvis/types';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';

import { ClassificationEngine } from './classification-engine.js';
import { InMemoryPreferenceStore } from './preference.js';
import { LlmProviderEmailClassifier, MAX_BODY_EXCERPT_CHARS } from './llm-classifier.js';

/** Faux provider LLM : rejoue une réponse scriptée, enregistre les appels. Aucun réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  constructor(private response: LlmResponse | (() => LlmResponse)) {}

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    return typeof this.response === 'function' ? this.response() : this.response;
  }
}

function email(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'msg-1',
    sender: 'someone@example.test',
    recipients: ['me@example.test'],
    subject: 'Sujet neutre',
    body: 'Contenu neutre.',
    receivedAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  };
}

describe('ClassificationEngine', () => {
  it('email clairement important via une règle explicite', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    engine.addExplicitRule({
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'important',
      reason: 'Les mails du patron sont importants.',
    });

    const result = await engine.classify(email({ sender: 'boss@example.com' }));

    expect(result).toMatchObject({ label: 'important', source: 'explicit_rule' });
    expect(result.preferenceId).toBeDefined();
  });

  it('email clairement non important via une règle explicite', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    engine.addExplicitRule({
      attribute: 'domain',
      value: 'newsletter.example',
      decision: 'not_important',
      reason: 'Les newsletters commerciales ne sont pas importantes.',
    });

    const result = await engine.classify(email({ sender: 'promo@newsletter.example' }));

    expect(result).toMatchObject({ label: 'not_important', source: 'explicit_rule' });
  });

  it('cas incertain : aucune préférence, aucun classifieur LLM configuré', async () => {
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const result = await engine.classify(email());

    expect(result).toMatchObject({ label: 'uncertain', source: 'default' });
    expect(result.preferenceId).toBeUndefined();
  });

  it('cas incertain : le LLM répond, mais de façon inexploitable', async () => {
    const engine = new ClassificationEngine({
      preferenceStore: new InMemoryPreferenceStore(),
      llmClassifier: new LlmProviderEmailClassifier(
        new MockLlmProvider({ content: 'ceci n’est pas du JSON' }),
      ),
    });

    const result = await engine.classify(email());

    expect(result).toMatchObject({ label: 'uncertain', source: 'default' });
  });

  it('classification LLM utilisée uniquement si aucune préférence ne correspond', async () => {
    const llm = new MockLlmProvider({
      content: JSON.stringify({ label: 'important', reason: 'Ton urgent détecté.', confidence: 0.8 }),
    });
    const engine = new ClassificationEngine({
      preferenceStore: new InMemoryPreferenceStore(),
      llmClassifier: new LlmProviderEmailClassifier(llm),
    });

    const result = await engine.classify(email());

    expect(result).toMatchObject({ label: 'important', source: 'llm', confidence: 0.8 });
    expect(llm.calls).toHaveLength(1);
  });

  it('une règle explicite est prioritaire sur le LLM — le LLM n’est même pas sollicité', async () => {
    const llm = new MockLlmProvider({
      content: JSON.stringify({ label: 'not_important', reason: 'Le LLM se trompe ici.' }),
    });
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({
      preferenceStore: store,
      llmClassifier: new LlmProviderEmailClassifier(llm),
    });
    engine.addExplicitRule({
      attribute: 'sender',
      value: 'boss@example.com',
      decision: 'important',
      reason: 'Les mails du patron sont importants.',
    });

    const result = await engine.classify(email({ sender: 'boss@example.com' }));

    expect(result).toMatchObject({ label: 'important', source: 'explicit_rule' });
    expect(llm.calls).toHaveLength(0);
  });

  it('correction utilisateur : modifie la classification d’un email initialement uncertain', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    const target = email({ sender: 'unknown@example.test' });

    const before = await engine.classify(target);
    expect(before.label).toBe('uncertain');

    engine.learnFromFeedback(target, 'important');
    const after = await engine.classify(target);

    expect(after).toMatchObject({ label: 'important', source: 'user_correction' });
  });

  it('la correction utilisateur ne crée qu’une préférence "sender", pas "domain"', async () => {
    const store = new InMemoryPreferenceStore();
    const engine = new ClassificationEngine({ preferenceStore: store });
    const target = email({ sender: 'unknown@newsletter.example' });

    engine.learnFromFeedback(target, 'important');

    // Un AUTRE expéditeur du même domaine ne doit pas hériter de la correction.
    const other = await engine.classify(email({ sender: 'someone-else@newsletter.example' }));
    expect(other.label).toBe('uncertain');

    const [pref] = store.list();
    expect(pref?.attribute).toBe('sender');
  });

  it('n’envoie au LLM ni recipients ni threadId, et borne le corps à MAX_BODY_EXCERPT_CHARS', async () => {
    const longBody = 'x'.repeat(MAX_BODY_EXCERPT_CHARS + 200);
    const llm = new MockLlmProvider({
      content: JSON.stringify({ label: 'uncertain', reason: 'peu importe' }),
    });
    const engine = new ClassificationEngine({
      preferenceStore: new InMemoryPreferenceStore(),
      llmClassifier: new LlmProviderEmailClassifier(llm),
    });

    await engine.classify(
      email({
        threadId: 'thread-secret-42',
        recipients: ['tiers-confidentiel@example.test'],
        body: longBody,
      }),
    );

    expect(llm.calls).toHaveLength(1);
    const sent = JSON.stringify(llm.calls[0]);
    expect(sent).not.toContain('thread-secret-42');
    expect(sent).not.toContain('tiers-confidentiel@example.test');

    const userMessage = llm.calls[0]?.find((m) => m.role === 'user');
    const excerptMatch = userMessage?.content.match(/Extrait du corps : (x+)/);
    expect(excerptMatch?.[1]?.length).toBe(MAX_BODY_EXCERPT_CHARS);
  });

  it('une erreur technique du provider LLM se traduit par uncertain, jamais par une exception', async () => {
    class ThrowingProvider implements LlmProvider {
      async chat(): Promise<LlmResponse> {
        throw new Error('panne réseau simulée');
      }
    }
    const engine = new ClassificationEngine({
      preferenceStore: new InMemoryPreferenceStore(),
      llmClassifier: new LlmProviderEmailClassifier(new ThrowingProvider()),
    });

    const result = await engine.classify(email());

    expect(result).toMatchObject({ label: 'uncertain', source: 'default' });
  });
});
