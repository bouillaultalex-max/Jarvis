import { describe, expect, it, vi } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import {
  ClassificationEngine,
  InMemoryPreferenceStore,
  LlmProviderEmailClassifier,
} from '@jarvis/classification';
import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';
import {
  GmailApiClient,
  gmailConnector,
  type AccessTokenProvider,
} from '@jarvis/connectors';

import { fetchAndClassifyEmails } from './pipeline.js';
import { fetchEmailsViaTool } from './fetch-emails.js';
import { classifyEmails } from './classify-emails.js';
import { recordFeedbackForEmail } from './feedback.js';

/**
 * Premier flux réel de bout en bout, testé sans aucun réseau :
 *
 *   gmailConnector (GmailApiClient, fetchFn mocké)
 *     → ToolExecutor → EmailMessage[]
 *     → ClassificationEngine → ClassifiedEmail[]
 */

const FAKE_TOKEN_MARKER = 'FAKE-ACCESS-TOKEN-MARKER-NOT-A-REAL-SECRET';

class FakeAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    return FAKE_TOKEN_MARKER;
  }
}

/** Faux provider LLM : aucun réseau, réponse scriptée. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  constructor(private readonly response: LlmResponse) {}
  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}

function encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

function rawGmailMessage(id: string, sender: string, subject: string, body: string) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: '1757000000000',
    payload: {
      headers: [
        { name: 'From', value: sender },
        { name: 'To', value: 'me@example.test' },
        { name: 'Subject', value: subject },
      ],
      mimeType: 'text/plain',
      body: { data: encode(body) },
    },
  };
}

function buildFakeGmailFetch(messages: readonly ReturnType<typeof rawGmailMessage>[]) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('/messages?')) {
      return new Response(JSON.stringify({ messages: messages.map((m) => ({ id: m.id })) }), { status: 200 });
    }
    const match = url.match(/\/messages\/([^/?]+)/);
    const found = messages.find((m) => m.id === match?.[1]);
    return found === undefined
      ? new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
      : new Response(JSON.stringify(found), { status: 200 });
  });
}

function buildGmailToolExecutor(messages: readonly ReturnType<typeof rawGmailMessage>[]) {
  const client = new GmailApiClient({
    accessTokenProvider: new FakeAccessTokenProvider(),
    fetchFn: buildFakeGmailFetch(messages),
  });
  const registry = new ToolRegistry();
  for (const tool of gmailConnector.createTools(client)) {
    registry.register(tool);
  }
  const executor = new ToolExecutor(registry, new PermissionManager({ rules: { 'gmail.read': 'allow' } }));
  return { executor, registry };
}

describe('Flux réel : GmailConnector → EmailMessage[] → ClassificationEngine → ClassifiedEmail[]', () => {
  it('Gmail → EmailMessage : le pipeline convertit correctement un message Gmail brut', async () => {
    const { executor } = buildGmailToolExecutor([rawGmailMessage('m1', 'boss@example.com', 'Bonjour', 'Contenu')]);
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const results = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(results).toHaveLength(1);
    expect(results[0]?.email).toMatchObject({ id: 'm1', sender: 'boss@example.com', subject: 'Bonjour' });
  });

  it('plusieurs emails Gmail → plusieurs classifications, chacune respectant une préférence existante', async () => {
    const { executor } = buildGmailToolExecutor([
      rawGmailMessage('m1', 'boss@example.com', 'Urgent', 'Contenu 1'),
      rawGmailMessage('m2', 'promo@newsletter.example', 'Offre', 'Contenu 2'),
      rawGmailMessage('m3', 'unknown@example.test', 'Sujet', 'Contenu 3'),
    ]);
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

    const results = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(results).toHaveLength(3);
    expect(results[0]?.classification).toMatchObject({ label: 'important', source: 'explicit_rule' });
    expect(results[1]?.classification).toMatchObject({ label: 'not_important', source: 'explicit_rule' });
    expect(results[2]?.classification).toMatchObject({ label: 'uncertain', source: 'default' });
  });

  it('absence de préférence : le classifieur LLM est sollicité (aucun réseau réel, MockLlmProvider)', async () => {
    const { executor } = buildGmailToolExecutor([
      rawGmailMessage('m1', 'unknown@example.test', 'Sujet', 'Contenu urgent'),
    ]);
    const llm = new MockLlmProvider({
      content: JSON.stringify({ label: 'important', reason: 'Ton urgent détecté.' }),
    });
    const engine = new ClassificationEngine({
      preferenceStore: new InMemoryPreferenceStore(),
      llmClassifier: new LlmProviderEmailClassifier(llm),
    });

    const results = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(results[0]?.classification).toMatchObject({ label: 'important', source: 'llm' });
    expect(llm.calls).toHaveLength(1);
  });

  it('absence de LLM et de préférence → uncertain', async () => {
    const { executor } = buildGmailToolExecutor([rawGmailMessage('m1', 'unknown@example.test', 'Sujet', 'Corps')]);
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const results = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(results[0]?.classification).toMatchObject({ label: 'uncertain', source: 'default' });
  });

  it('une correction utilisateur sur un email Gmail peut être enregistrée et change la classification suivante', async () => {
    const raw = [rawGmailMessage('m1', 'unknown@example.test', 'Sujet', 'Corps')];
    const { executor } = buildGmailToolExecutor(raw);
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const first = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });
    expect(first[0]?.classification.label).toBe('uncertain');

    recordFeedbackForEmail(engine, first, 'm1', 'important');

    const second = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });
    expect(second[0]?.classification).toMatchObject({ label: 'important', source: 'user_correction' });
  });

  it('une correction ciblée sur un expéditeur Gmail ne se généralise pas à son domaine', async () => {
    const raw = [
      rawGmailMessage('m1', 'someone@newsletter.example', 'Sujet 1', 'Corps 1'),
      rawGmailMessage('m2', 'someone-else@newsletter.example', 'Sujet 2', 'Corps 2'),
    ];
    const { executor } = buildGmailToolExecutor(raw);
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const first = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });
    recordFeedbackForEmail(engine, first, 'm1', 'important');

    const second = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(second[0]?.classification).toMatchObject({ label: 'important', source: 'user_correction' });
    expect(second[1]?.classification.label).toBe('uncertain');
  });

  it('aucun credential (marqueur du token d’accès Gmail) ne traverse le pipeline', async () => {
    const { executor } = buildGmailToolExecutor([rawGmailMessage('m1', 'boss@example.com', 'Sujet', 'Corps')]);
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const results = await fetchAndClassifyEmails(executor, engine, { toolName: 'gmail.read' });

    expect(JSON.stringify(results)).not.toContain(FAKE_TOKEN_MARKER);
  });

  it('Gmail reste strictement read-only : aucune capacité d’envoi n’existe dans le pipeline', async () => {
    const { executor, registry } = buildGmailToolExecutor([]);

    for (const forbidden of ['gmail.send', 'gmail.modify', 'gmail.delete', 'gmail.prepare_reply']) {
      expect(registry.has(forbidden)).toBe(false);
    }
    const outcome = await executor.run({
      tool: 'gmail.send',
      input: { to: 'x@example.test', subject: 's', body: 'b' },
    });
    expect(outcome.status).toBe('unknown_tool');

    // fetchEmailsViaTool n'expose qu'une opération de lecture — aucune fonction d'écriture n'existe dans ce module.
    expect(typeof fetchEmailsViaTool).toBe('function');
    expect((fetchEmailsViaTool as unknown as Record<string, unknown>).send).toBeUndefined();
  });

  it('classifyEmails seul, appliqué à des EmailMessage venus de Gmail, produit un lot de même taille', async () => {
    const { executor } = buildGmailToolExecutor([
      rawGmailMessage('m1', 'a@example.com', 'S1', 'C1'),
      rawGmailMessage('m2', 'b@example.com', 'S2', 'C2'),
    ]);
    const emails = await fetchEmailsViaTool(executor, { toolName: 'gmail.read' });
    const engine = new ClassificationEngine({ preferenceStore: new InMemoryPreferenceStore() });

    const results = await classifyEmails(engine, emails);

    expect(results).toHaveLength(2);
  });
});
