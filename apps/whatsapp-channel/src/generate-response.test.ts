import { describe, expect, it } from 'vitest';

import { generateResponse } from './generate-response.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { ScriptedConversationalService } from './testing/fixtures.js';

const AUTHORIZED = '33600000000';
const UNAUTHORIZED = '33699999999';

describe('generateResponse', () => {
  it('expéditeur autorisé, service ok → status ok, texte renvoyé', async () => {
    const result = await generateResponse(
      { senderId: AUTHORIZED, text: 'bonjour' },
      {
        allowlist: new InMemoryAllowlist(new Set([AUTHORIZED])),
        conversationalService: new ScriptedConversationalService({ status: 'ok', text: 'réponse' }),
      },
    );
    expect(result).toEqual({ status: 'ok', text: 'réponse' });
  });

  it('expéditeur non autorisé (défense en profondeur) → terminal ignored_unauthorized, service jamais appelé', async () => {
    const service = new ScriptedConversationalService();
    const result = await generateResponse(
      { senderId: UNAUTHORIZED, text: 'bonjour' },
      { allowlist: new InMemoryAllowlist(new Set([AUTHORIZED])), conversationalService: service },
    );
    expect(result).toEqual({ status: 'terminal', outcome: { status: 'ignored_unauthorized' } });
    expect(service.receivedCalls).toHaveLength(0);
  });

  it('erreur structurée du service → terminal conversational_service_error', async () => {
    const result = await generateResponse(
      { senderId: AUTHORIZED, text: 'bonjour' },
      {
        allowlist: new InMemoryAllowlist(new Set([AUTHORIZED])),
        conversationalService: new ScriptedConversationalService({
          status: 'error',
          reason: 'panne',
        }),
      },
    );
    expect(result).toEqual({
      status: 'terminal',
      outcome: { status: 'conversational_service_error', reason: 'panne' },
    });
  });

  it('exception inattendue du service → terminal processing_error (sûr : aucun appel transport à ce stade)', async () => {
    const throwing = {
      async reply(): Promise<never> {
        throw new Error('bug inattendu');
      },
    };
    const result = await generateResponse(
      { senderId: AUTHORIZED, text: 'bonjour' },
      { allowlist: new InMemoryAllowlist(new Set([AUTHORIZED])), conversationalService: throwing },
    );
    expect(result).toEqual({
      status: 'terminal',
      outcome: { status: 'processing_error', reason: 'bug inattendu' },
    });
  });
});
