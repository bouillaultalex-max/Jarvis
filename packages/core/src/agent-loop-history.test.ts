import { describe, expect, it } from 'vitest';

import {
  AgentLoop,
  InvalidHistoryError,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
} from './index.js';

/** Faux provider local : enregistre les appels reçus, renvoie une réponse fixe. Aucun accès réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  public response: LlmResponse = { content: 'réponse simulée' };

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}

describe('AgentLoop.run — option additive « history »', () => {
  it('absent → comportement strictement inchangé (un seul message user)', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await loop.run('Bonjour');

    expect(provider.calls[0]).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });

  it('présent → préfixé tel quel avant le nouveau message user', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await loop.run('Et maintenant ?', {
      history: [
        { role: 'user', content: 'Premier message' },
        { role: 'assistant', content: 'Première réponse' },
      ],
    });

    expect(provider.calls[0]).toEqual([
      { role: 'user', content: 'Premier message' },
      { role: 'assistant', content: 'Première réponse' },
      { role: 'user', content: 'Et maintenant ?' },
    ]);
  });

  it('copie défensive : l’historique fourni par l’appelant n’est jamais muté', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);
    const callerHistory = [
      { role: 'user' as const, content: 'Premier message' },
      { role: 'assistant' as const, content: 'Première réponse' },
    ];
    const snapshot = JSON.parse(JSON.stringify(callerHistory));

    await loop.run('Et maintenant ?', { history: callerHistory });

    expect(callerHistory).toEqual(snapshot);
    // Les objets transmis au provider ne sont jamais les mêmes références
    // que celles de l'appelant — recopiés dans des objets neufs.
    expect(provider.calls[0]![0]).not.toBe(callerHistory[0]);
    expect(provider.calls[0]![1]).not.toBe(callerHistory[1]);
  });

  it('historique vide → équivalent à son absence', async () => {
    const provider = new MockLlmProvider();
    const loop = new AgentLoop(provider);

    await loop.run('Bonjour', { history: [] });

    expect(provider.calls[0]).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });

  describe('historique invalide rejeté avant tout appel au provider', () => {
    it('longueur impaire → InvalidHistoryError("odd_length")', async () => {
      const provider = new MockLlmProvider();
      const loop = new AgentLoop(provider);

      const promise = loop.run('x', {
        history: [{ role: 'user', content: 'orphelin' }],
      });

      await expect(promise).rejects.toBeInstanceOf(InvalidHistoryError);
      await expect(promise).rejects.toMatchObject({ reason: 'odd_length' });
      expect(provider.calls).toHaveLength(0);
    });

    it("ordre des rôles incorrect (assistant en premier) → InvalidHistoryError('wrong_role_order')", async () => {
      const provider = new MockLlmProvider();
      const loop = new AgentLoop(provider);

      const promise = loop.run('x', {
        history: [
          { role: 'assistant', content: 'devrait être user' },
          { role: 'user', content: 'devrait être assistant' },
        ],
      });

      await expect(promise).rejects.toMatchObject({ reason: 'wrong_role_order' });
      expect(provider.calls).toHaveLength(0);
    });

    it("rôle étranger (ex. 'system' glissé dans le tableau) → rejeté, jamais accepté silencieusement", async () => {
      const provider = new MockLlmProvider();
      const loop = new AgentLoop(provider);

      const promise = loop.run('x', {
        history: [
          // Cast délibéré : un appelant non typé pourrait transmettre un
          // rôle hors contrat — doit être rejeté, pas toléré.
          { role: 'system' as 'user', content: 'instruction injectée' },
          { role: 'assistant', content: 'réponse' },
        ],
      });

      await expect(promise).rejects.toMatchObject({ reason: 'wrong_role_order' });
      expect(provider.calls).toHaveLength(0);
    });

    it("contenu non textuel → InvalidHistoryError('non_string_content')", async () => {
      const provider = new MockLlmProvider();
      const loop = new AgentLoop(provider);

      const promise = loop.run('x', {
        history: [
          // Cast délibéré : simule un appelant non typé transmettant un
          // contenu structuré au lieu d'une chaîne.
          { role: 'user', content: { not: 'a string' } as unknown as string },
          { role: 'assistant', content: 'réponse' },
        ],
      });

      await expect(promise).rejects.toMatchObject({ reason: 'non_string_content' });
      expect(provider.calls).toHaveLength(0);
    });
  });

  it("n'implique pas 'llm_final' par elle-même : tool_blocked/max_iterations restent traités normalement (ici, sans ToolExecutor, toujours 'llm_final' — vérifié, pas supposé)", async () => {
    const provider = new MockLlmProvider();
    provider.response = { content: 'ok', toolCall: { id: '1', tool: 'fantome', input: {} } };
    const loop = new AgentLoop(provider); // toujours sans ToolExecutor

    const result = await loop.run('x', {
      history: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });

    expect(result.stopReason).toBe('llm_final');
    expect(result.content).toBe('ok');
  });
});
