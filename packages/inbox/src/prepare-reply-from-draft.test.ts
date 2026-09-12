import { describe, expect, it, vi } from 'vitest';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  invalid,
  valid,
  type Tool,
  type ToolValidationResult,
} from '@jarvis/core';

import type { EmailReplyDraft } from './email-reply-planner.js';
import { PrepareReplyBlockedError, prepareReplyFromDraft } from './prepare-reply-from-draft.js';

interface FakePrepareInput {
  readonly messageId: string;
  readonly body: string;
}

/**
 * Faux `gmail.prepare_reply` : enregistre l'entrée BRUTE reçue (avant
 * validation) pour vérifier ce qui lui est réellement transmis. Comme le vrai
 * Tool, ne retient que `messageId` + `body`.
 */
function fakePrepareReplyTool(sink: {
  rawInput?: unknown;
  calls: number;
}): Tool<FakePrepareInput, { to: string; subject: string; threadId?: string; body: string }> {
  return {
    name: 'gmail.prepare_reply',
    description: 'Faux prepare_reply (tests).',
    action: 'prepare',
    inputSchema: { type: 'object', properties: {}, required: ['messageId', 'body'] },
    validateInput(rawInput: unknown): ToolValidationResult<FakePrepareInput> {
      sink.rawInput = rawInput;
      if (typeof rawInput !== 'object' || rawInput === null) {
        return invalid('prepare : objet attendu.');
      }
      const { messageId, body } = rawInput as Record<string, unknown>;
      if (typeof messageId !== 'string' || messageId.length === 0) {
        return invalid('prepare : messageId requis.');
      }
      if (typeof body !== 'string' || body.length === 0) {
        return invalid('prepare : body requis.');
      }
      return valid({ messageId, body });
    },
    async execute(inputValue: FakePrepareInput) {
      sink.calls += 1;
      return {
        to: 'client@example.com',
        subject: 'Re: Devis projet Phoenix',
        threadId: 'thread-42',
        body: inputValue.body,
      };
    },
  };
}

const sendSpy = vi.fn();
function fakeSendTool(): Tool {
  return {
    name: 'gmail.send',
    description: 'Faux send (tests) — ne doit jamais être appelé.',
    action: 'execute',
    inputSchema: { type: 'object' },
    validateInput: (i: unknown) => valid(i),
    async execute(i: unknown) {
      sendSpy(i);
      return { id: 'sent' };
    },
  };
}

function buildExecutor(
  tools: readonly Tool[],
  rules: Record<string, 'allow' | 'deny' | 'require_confirmation'>,
): ToolExecutor {
  const registry = new ToolRegistry();
  tools.forEach((tool) => registry.register(tool));
  return new ToolExecutor(registry, new PermissionManager({ rules }));
}

const DRAFT: EmailReplyDraft = {
  body: 'Bonjour,\n\nVoici le devis à jour.\n\nBien à vous.',
  subject: 'Re: quelque chose',
  rationale: 'NOTE INTERNE : ton cordial, relation établie — NE PAS ENVOYER.',
  usedMemoryIds: ['mem-1', 'mem-2'],
  unresolved: ['Version exacte du devis'],
};

describe('prepareReplyFromDraft', () => {
  it('16/17. ne transmet QUE { messageId, body: draft.body } à gmail.prepare_reply', async () => {
    const sink = { calls: 0 } as { rawInput?: unknown; calls: number };
    const executor = buildExecutor([fakePrepareReplyTool(sink), fakeSendTool()], {
      'gmail.prepare_reply': 'allow',
      'gmail.send': 'allow',
    });

    const prepared = await prepareReplyFromDraft(executor, { messageId: 'm-123', draft: DRAFT });

    expect(sink.rawInput).toEqual({ messageId: 'm-123', body: DRAFT.body });
    expect(Object.keys(sink.rawInput as object).sort()).toEqual(['body', 'messageId']);
    // Aucune métadonnée interne transmise.
    const serialized = JSON.stringify(sink.rawInput);
    expect(serialized).not.toContain('NOTE INTERNE');
    expect(serialized).not.toContain('mem-1');
    expect(serialized).not.toContain('Version exacte du devis');
    expect(serialized).not.toContain('Re: quelque chose');
    // Le corps préparé est exactement celui du brouillon (jamais body + rationale).
    expect(prepared.body).toBe(DRAFT.body);
  });

  it('15. n’appelle jamais gmail.send', async () => {
    sendSpy.mockClear();
    const sink = { calls: 0 } as { rawInput?: unknown; calls: number };
    const executor = buildExecutor([fakePrepareReplyTool(sink), fakeSendTool()], {
      'gmail.prepare_reply': 'allow',
      'gmail.send': 'allow',
    });

    await prepareReplyFromDraft(executor, { messageId: 'm-1', draft: DRAFT });

    expect(sink.calls).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('préparation refusée (deny) → PrepareReplyBlockedError, aucun send', async () => {
    sendSpy.mockClear();
    const sink = { calls: 0 } as { rawInput?: unknown; calls: number };
    const executor = buildExecutor([fakePrepareReplyTool(sink), fakeSendTool()], {
      'gmail.prepare_reply': 'deny',
      'gmail.send': 'allow',
    });

    await expect(
      prepareReplyFromDraft(executor, { messageId: 'm-1', draft: DRAFT }),
    ).rejects.toBeInstanceOf(PrepareReplyBlockedError);
    expect(sink.calls).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('outil absent → PrepareReplyBlockedError (status "unknown_tool")', async () => {
    const executor = buildExecutor([fakeSendTool()], { 'gmail.send': 'allow' });
    try {
      await prepareReplyFromDraft(executor, { messageId: 'm-1', draft: DRAFT });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PrepareReplyBlockedError);
      expect((err as PrepareReplyBlockedError).outcome.status).toBe('unknown_tool');
    }
  });

  it('sortie de forme inattendue → erreur explicite', async () => {
    const weirdTool: Tool = {
      name: 'gmail.prepare_reply',
      description: 'renvoie une forme inexploitable',
      action: 'prepare',
      inputSchema: { type: 'object' },
      validateInput: (i: unknown) => valid(i),
      async execute() {
        return { unexpected: true };
      },
    };
    const executor = buildExecutor([weirdTool], { 'gmail.prepare_reply': 'allow' });

    await expect(
      prepareReplyFromDraft(executor, { messageId: 'm-1', draft: DRAFT }),
    ).rejects.toThrow(/forme attendue/);
  });

  it('messageId ou body vide → erreur avant tout appel à l’executor', async () => {
    const sink = { calls: 0 } as { rawInput?: unknown; calls: number };
    const executor = buildExecutor([fakePrepareReplyTool(sink)], {
      'gmail.prepare_reply': 'allow',
    });

    await expect(prepareReplyFromDraft(executor, { messageId: '', draft: DRAFT })).rejects.toThrow(
      /messageId/,
    );
    await expect(
      prepareReplyFromDraft(executor, { messageId: 'm-1', draft: { body: '' } }),
    ).rejects.toThrow(/body/);
    expect(sink.calls).toBe(0);
    expect(sink.rawInput).toBeUndefined();
  });
});
