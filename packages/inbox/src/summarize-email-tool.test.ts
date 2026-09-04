import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import { createSummarizeEmailTool } from './summarize-email-tool.js';
import type { EmailSummarizer } from './email-summarizer.js';

function email(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'm1',
    sender: 'boss@example.com',
    recipients: [],
    subject: 'Sujet',
    body: 'Corps',
    receivedAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  };
}

/** Faux EmailSummarizer, aucun LLM ni réseau réel. */
class FakeSummarizer implements EmailSummarizer {
  public callCount = 0;
  constructor(private readonly result: { summary: string } | undefined | Error) {}

  async summarize(): Promise<{ summary: string } | undefined> {
    this.callCount += 1;
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function buildExecutor(summarizer: EmailSummarizer, decision: 'allow' | 'deny' | 'require_confirmation') {
  const tool = createSummarizeEmailTool(summarizer);
  const registry = new ToolRegistry();
  registry.register(tool);
  const permissions = new PermissionManager({ rules: { [tool.name]: decision } });
  return { tool, executor: new ToolExecutor(registry, permissions) };
}

describe('createSummarizeEmailTool — contrat', () => {
  it('déclare action: "read"', () => {
    const tool = createSummarizeEmailTool(new FakeSummarizer({ summary: 'x' }));

    expect(tool.action).toBe('read');
  });

  it('validateInput rejette une entrée malformée', () => {
    const tool = createSummarizeEmailTool(new FakeSummarizer({ summary: 'x' }));

    expect(tool.validateInput(undefined).ok).toBe(false);
    expect(tool.validateInput(null).ok).toBe(false);
    expect(tool.validateInput({}).ok).toBe(false);
    expect(tool.validateInput({ email: { subject: 'Sujet incomplet' } }).ok).toBe(false);
    expect(tool.validateInput({ email: 'pas un objet' }).ok).toBe(false);
  });

  it('validateInput accepte un EmailMessage valide', () => {
    const tool = createSummarizeEmailTool(new FakeSummarizer({ summary: 'x' }));

    const result = tool.validateInput({ email: email() });

    expect(result.ok).toBe(true);
  });
});

describe('email.summarize — passage par ToolExecutor uniquement', () => {
  it('permission "allow" : le résumé est produit via ToolExecutor', async () => {
    const summarizer = new FakeSummarizer({ summary: 'Résumé.' });
    const { executor } = buildExecutor(summarizer, 'allow');

    const result = await executor.run({ tool: 'email.summarize', input: { email: email() } });

    expect(result).toMatchObject({ status: 'executed', output: { summary: 'Résumé.' } });
    expect(summarizer.callCount).toBe(1);
  });

  it('permission "deny" : l’outil n’est jamais exécuté', async () => {
    const summarizer = new FakeSummarizer({ summary: 'Résumé.' });
    const { executor } = buildExecutor(summarizer, 'deny');

    const result = await executor.run({ tool: 'email.summarize', input: { email: email() } });

    expect(result.status).toBe('denied');
    expect(summarizer.callCount).toBe(0);
  });

  it('"require_confirmation" sans confirmation : bloqué', async () => {
    const summarizer = new FakeSummarizer({ summary: 'Résumé.' });
    const { executor } = buildExecutor(summarizer, 'require_confirmation');

    const result = await executor.run({ tool: 'email.summarize', input: { email: email() } });

    expect(result.status).toBe('awaiting_confirmation');
    expect(summarizer.callCount).toBe(0);
  });

  it('"require_confirmation" avec confirmed: true : exécuté', async () => {
    const summarizer = new FakeSummarizer({ summary: 'Résumé confirmé.' });
    const { executor } = buildExecutor(summarizer, 'require_confirmation');

    const result = await executor.run({
      tool: 'email.summarize',
      input: { email: email() },
      confirmed: true,
    });

    expect(result).toMatchObject({ status: 'executed', output: { summary: 'Résumé confirmé.' } });
    expect(summarizer.callCount).toBe(1);
  });

  it('erreur du summarizer (résumé inexploitable) : issue "error", jamais "executed"', async () => {
    const summarizer = new FakeSummarizer(undefined);
    const { executor } = buildExecutor(summarizer, 'allow');

    const result = await executor.run({ tool: 'email.summarize', input: { email: email() } });

    expect(result.status).toBe('error');
    expect(result.status).not.toBe('executed');
  });

  it('exception technique du summarizer : issue "error", jamais "executed"', async () => {
    const summarizer = new FakeSummarizer(new Error('panne interne simulée'));
    const { executor } = buildExecutor(summarizer, 'allow');

    const result = await executor.run({ tool: 'email.summarize', input: { email: email() } });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('panne interne simulée');
    }
  });
});
