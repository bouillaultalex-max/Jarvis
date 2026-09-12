import { describe, expect, it } from 'vitest';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  invalid,
  valid,
  type Tool,
  type ToolValidationResult,
} from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import { EmailFetchBlockedError, fetchEmailsViaTool } from './fetch-emails.js';

/** Faux Tool de lecture générique (ni Gmail ni aucun fournisseur). */
interface FakeReadInput {
  readonly count?: number;
}
interface FakeReadOutput {
  readonly messages: readonly EmailMessage[];
}

function email(id: string): EmailMessage {
  return {
    id,
    sender: 'someone@example.test',
    recipients: [],
    subject: 'Sujet',
    body: 'Corps',
    receivedAt: '2026-09-04T09:00:00.000Z',
  };
}

const fakeReadTool: Tool<FakeReadInput, FakeReadOutput> = {
  name: 'fake.read',
  description: 'Faux Tool de lecture pour les tests.',
  action: 'read',
  inputSchema: {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: [],
  },
  validateInput(input: unknown): ToolValidationResult<FakeReadInput> {
    if (input === undefined || input === null) return valid({});
    if (typeof input !== 'object') return invalid('fake.read : entrée invalide.');
    const { count } = input as Record<string, unknown>;
    if (count !== undefined && typeof count !== 'number') {
      return invalid('fake.read : « count » doit être un nombre.');
    }
    return valid({ count });
  },
  async execute(input: FakeReadInput): Promise<FakeReadOutput> {
    const count = input.count ?? 2;
    return { messages: Array.from({ length: count }, (_, i) => email(`m${i + 1}`)) };
  },
};

const malformedTool: Tool = {
  name: 'malformed.read',
  description: 'Renvoie une forme inexploitable.',
  action: 'read',
  inputSchema: { type: 'object' },
  validateInput: (input: unknown) => valid(input),
  async execute() {
    return { notMessages: [] };
  },
};

function buildExecutor(
  decision: 'allow' | 'deny' | 'require_confirmation',
  tool: Tool = fakeReadTool,
) {
  const registry = new ToolRegistry();
  registry.register(tool);
  const permissions = new PermissionManager({ rules: { [tool.name]: decision } });
  return new ToolExecutor(registry, permissions);
}

describe('fetchEmailsViaTool — générique, aucun fournisseur codé en dur', () => {
  it('renvoie les emails quand le Tool est autorisé et exécuté', async () => {
    const executor = buildExecutor('allow');

    const emails = await fetchEmailsViaTool(executor, {
      toolName: 'fake.read',
      input: { count: 3 },
    });

    expect(emails).toHaveLength(3);
    expect(emails[0]?.id).toBe('m1');
  });

  it('lecture refusée (deny) : lève EmailFetchBlockedError, aucun email renvoyé', async () => {
    const executor = buildExecutor('deny');

    const promise = fetchEmailsViaTool(executor, { toolName: 'fake.read' });

    await expect(promise).rejects.toBeInstanceOf(EmailFetchBlockedError);
    await expect(promise).rejects.toMatchObject({ toolName: 'fake.read' });
  });

  it('lecture en attente de confirmation : lève EmailFetchBlockedError', async () => {
    const executor = buildExecutor('require_confirmation');

    await expect(fetchEmailsViaTool(executor, { toolName: 'fake.read' })).rejects.toBeInstanceOf(
      EmailFetchBlockedError,
    );
  });

  it('outil inconnu : lève EmailFetchBlockedError (status "unknown_tool")', async () => {
    const executor = buildExecutor('allow');

    try {
      await fetchEmailsViaTool(executor, { toolName: 'absent.read' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EmailFetchBlockedError);
      expect((err as EmailFetchBlockedError).outcome.status).toBe('unknown_tool');
    }
  });

  it('entrée invalide : lève EmailFetchBlockedError (status "invalid_input")', async () => {
    const executor = buildExecutor('allow');

    try {
      await fetchEmailsViaTool(executor, { toolName: 'fake.read', input: { count: 'trois' } });
      expect.unreachable();
    } catch (err) {
      expect((err as EmailFetchBlockedError).outcome.status).toBe('invalid_input');
    }
  });

  it('sortie du Tool de forme inattendue : erreur explicite, jamais un tableau vide silencieux', async () => {
    const executor = buildExecutor('allow', malformedTool);

    await expect(fetchEmailsViaTool(executor, { toolName: 'malformed.read' })).rejects.toThrow(
      /forme attendue/,
    );
  });
});
