import { describe, expect, it } from 'vitest';
import type { ClassificationResult } from '@jarvis/classification';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';
import type { EmailMessage } from '@jarvis/types';

import { summarizeEmailsNeedingAttention } from './triage.js';
import type { ClassifiedEmail } from './classified-email.js';
import { LlmProviderEmailSummarizer } from './email-summarizer.js';
import type { EmailSummarizer } from './email-summarizer.js';

/** Faux provider LLM : rejoue une réponse scriptée, compte ses appels. Aucun réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  constructor(private readonly response: LlmResponse | (() => LlmResponse)) {}

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages.map((m) => ({ ...m })));
    return typeof this.response === 'function' ? this.response() : this.response;
  }
}

/** Faux summarizer local : compte ses appels sans passer par un LlmProvider. */
class FakeSummarizer implements EmailSummarizer {
  public readonly summarizedEmailIds: string[] = [];
  async summarize(email: EmailMessage) {
    this.summarizedEmailIds.push(email.id);
    return { summary: `Résumé de ${email.id}` };
  }
}

function email(id: string): EmailMessage {
  return {
    id,
    sender: 'someone@example.test',
    recipients: [],
    subject: `Sujet ${id}`,
    body: `Corps ${id}`,
    receivedAt: '2026-09-04T09:00:00.000Z',
  };
}

function classified(id: string, classification: ClassificationResult): ClassifiedEmail {
  return { email: email(id), classification };
}

const important = classified('m1', { label: 'important', source: 'explicit_rule', reason: 'r' });
const notImportant = classified('m2', { label: 'not_important', source: 'explicit_rule', reason: 'r' });
const uncertain = classified('m3', { label: 'uncertain', source: 'default', reason: 'r' });

describe('summarizeEmailsNeedingAttention', () => {
  it('seuls les emails retenus par needsAttention (policy par défaut : important) sont envoyés au summarizer', async () => {
    const summarizer = new FakeSummarizer();
    const batch = [important, notImportant, uncertain];

    const results = await summarizeEmailsNeedingAttention(batch, summarizer);

    expect(summarizer.summarizedEmailIds).toEqual(['m1']);
    expect(results).toEqual([{ classified: important, summary: 'Résumé de m1' }]);
  });

  it('un email "not_important" ou "uncertain" par défaut n’atteint jamais le LLM (MockLlmProvider)', async () => {
    const llm = new MockLlmProvider({ content: 'Résumé.' });
    const summarizer = new LlmProviderEmailSummarizer(llm);
    const batch = [important, notImportant, uncertain];

    await summarizeEmailsNeedingAttention(batch, summarizer);

    // Un seul appel LLM : uniquement pour l'email "important".
    expect(llm.calls).toHaveLength(1);
    const [userMessage] = llm.calls[0]!.filter((m) => m.role === 'user');
    expect(userMessage?.content).toContain('Sujet m1');
  });

  it('une policy personnalisée modifie ce qui est transmis au LLM (ex. inclure "uncertain")', async () => {
    const llm = new MockLlmProvider({ content: 'Résumé.' });
    const summarizer = new LlmProviderEmailSummarizer(llm);
    const batch = [important, notImportant, uncertain];

    const results = await summarizeEmailsNeedingAttention(batch, summarizer, {
      labels: ['important', 'uncertain'],
    });

    expect(llm.calls).toHaveLength(2);
    expect(results.map((r) => r.classified.email.id)).toEqual(['m1', 'm3']);
  });

  it('préserve l’ordre des emails retenus', async () => {
    const summarizer = new FakeSummarizer();
    const secondImportant = classified('m4', { label: 'important', source: 'llm', reason: 'r' });
    const batch = [notImportant, important, uncertain, secondImportant];

    const results = await summarizeEmailsNeedingAttention(batch, summarizer);

    expect(results.map((r) => r.classified.email.id)).toEqual(['m1', 'm4']);
  });

  it('ne mute jamais le lot d’origine ni les ClassifiedEmail qu’il contient', async () => {
    const summarizer = new FakeSummarizer();
    const batch = [important, notImportant, uncertain];
    const snapshot = [...batch];
    const importantSnapshot = { ...important };

    await summarizeEmailsNeedingAttention(batch, summarizer, { labels: ['important', 'not_important', 'uncertain'] });

    expect(batch).toEqual(snapshot);
    expect(important).toEqual(importantSnapshot);
  });

  it('lot vide → résultat vide, aucun appel LLM', async () => {
    const llm = new MockLlmProvider({ content: 'Résumé.' });
    const summarizer = new LlmProviderEmailSummarizer(llm);

    const results = await summarizeEmailsNeedingAttention([], summarizer);

    expect(results).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('réponse LLM inexploitable → summary: undefined, jamais une exception ni un faux résumé', async () => {
    const llm = new MockLlmProvider({ content: '   ' });
    const summarizer = new LlmProviderEmailSummarizer(llm);

    const results = await summarizeEmailsNeedingAttention([important], summarizer);

    expect(results).toEqual([{ classified: important, summary: undefined }]);
  });
});
