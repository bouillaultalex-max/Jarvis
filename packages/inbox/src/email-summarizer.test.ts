import { describe, expect, it } from 'vitest';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';
import type { EmailMessage } from '@jarvis/types';

import { LlmProviderEmailSummarizer, MAX_BODY_EXCERPT_CHARS, buildSummaryPrompt } from './email-summarizer.js';

/** Faux provider LLM : rejoue une réponse scriptée. Aucun réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  constructor(private readonly response: LlmResponse | (() => LlmResponse)) {}

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    return typeof this.response === 'function' ? this.response() : this.response;
  }
}

function email(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'm1',
    sender: 'boss@example.com',
    recipients: ['tiers-confidentiel@example.test'],
    subject: 'Point hebdo',
    body: 'Contenu du message.',
    receivedAt: '2026-09-04T09:00:00.000Z',
    threadId: 'thread-secret-42',
    ...overrides,
  };
}

describe('buildSummaryPrompt', () => {
  it('contient l’expéditeur, le sujet et le corps (borné)', () => {
    const messages = buildSummaryPrompt(email());
    const user = messages.find((m) => m.role === 'user');

    expect(user?.content).toContain('Expéditeur : boss@example.com');
    expect(user?.content).toContain('Objet : Point hebdo');
    expect(user?.content).toContain('Extrait du corps : Contenu du message.');
  });

  it('n’inclut jamais recipients', () => {
    const messages = buildSummaryPrompt(email({ recipients: ['tiers-confidentiel@example.test'] }));

    expect(JSON.stringify(messages)).not.toContain('tiers-confidentiel@example.test');
  });

  it('n’inclut jamais threadId', () => {
    const messages = buildSummaryPrompt(email({ threadId: 'thread-secret-42' }));

    expect(JSON.stringify(messages)).not.toContain('thread-secret-42');
  });

  it('borne le corps à MAX_BODY_EXCERPT_CHARS quand il est plus long', () => {
    const longBody = 'x'.repeat(MAX_BODY_EXCERPT_CHARS + 200);

    const messages = buildSummaryPrompt(email({ body: longBody }));
    const user = messages.find((m) => m.role === 'user');
    const match = user?.content.match(/Extrait du corps : (x+)/);

    expect(match?.[1]).toHaveLength(MAX_BODY_EXCERPT_CHARS);
  });

  it('ne tronque pas un corps plus court que la limite', () => {
    const shortBody = 'court';

    const messages = buildSummaryPrompt(email({ body: shortBody }));
    const user = messages.find((m) => m.role === 'user');

    expect(user?.content).toContain('Extrait du corps : court');
    expect(user?.content).not.toContain('…');
  });
});

describe('LlmProviderEmailSummarizer', () => {
  it('produit un résumé via MockLlmProvider (aucun réseau réel)', async () => {
    const llm = new MockLlmProvider({ content: 'Résumé concis du message.' });
    const summarizer = new LlmProviderEmailSummarizer(llm);

    const result = await summarizer.summarize(email());

    expect(result).toEqual({ summary: 'Résumé concis du message.' });
    expect(llm.calls).toHaveLength(1);
  });

  it('réponse LLM vide/inexploitable → undefined, jamais un faux résumé', async () => {
    const llm = new MockLlmProvider({ content: '   ' });
    const summarizer = new LlmProviderEmailSummarizer(llm);

    const result = await summarizer.summarize(email());

    expect(result).toBeUndefined();
  });

  it('exception du provider → undefined, jamais propagée telle quelle', async () => {
    class ThrowingProvider implements LlmProvider {
      async chat(): Promise<LlmResponse> {
        throw new Error('panne réseau simulée');
      }
    }
    const summarizer = new LlmProviderEmailSummarizer(new ThrowingProvider());

    await expect(summarizer.summarize(email())).resolves.toBeUndefined();
  });
});
