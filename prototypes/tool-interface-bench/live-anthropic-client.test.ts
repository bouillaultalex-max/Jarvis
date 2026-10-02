/**
 * BANC ISOLE — confirme que le client reel desactive effectivement les
 * retries SDK. Construire un client Anthropic n'emet AUCUNE requete reseau :
 * ce test reste donc deterministe et sans reseau, comme le reste du banc.
 */

import { describe, expect, it, vi } from 'vitest';

import { createLiveAnthropicClient } from './live-anthropic-client.js';

describe('createLiveAnthropicClient', () => {
  it('construit un client avec maxRetries = 0 (confirme sur l’instance, pas seulement l’option passee)', () => {
    const client = createLiveAnthropicClient('cle-de-test-non-reelle');

    expect(client.maxRetries).toBe(0);
  });

  it('ne journalise jamais la cle fournie pendant la construction', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createLiveAnthropicClient('cle-de-test-non-reelle');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
