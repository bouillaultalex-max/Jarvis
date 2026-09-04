import { describe, expect, it } from 'vitest';

import { AgentLoop, type LlmMessage, type LlmProvider, type LlmResponse } from './index.js';

/**
 * Faux provider local au test : enregistre les appels reçus et renvoie une
 * réponse fixe. Aucun accès réseau.
 */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  public response: LlmResponse = { content: 'réponse simulée' };

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}

describe('AgentLoop.process', () => {
  it('transmet le message utilisateur au provider', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await loop.process('Bonjour');

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });

  it('retourne le contenu de la réponse du provider', async () => {
    const provider = new MockLlmProvider();
    provider.response = { content: 'Bonjour, je suis JARVIS.' };
    const loop = new AgentLoop(provider);

    const result = await loop.process('Salut');

    expect(result).toBe('Bonjour, je suis JARVIS.');
  });

  it('rejette un message vide', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await expect(loop.process('')).rejects.toThrow();
    expect(provider.calls).toHaveLength(0);
  });

  it("rejette un message composé uniquement d'espaces", async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await expect(loop.process('   \t  \n ')).rejects.toThrow();
    expect(provider.calls).toHaveLength(0);
  });

  it('n’appelle le provider qu’une seule fois par process()', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await loop.process('Première question');

    expect(provider.calls).toHaveLength(1);
  });
});
