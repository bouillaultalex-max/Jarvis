import { describe, expect, it } from 'vitest';

import type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/core';

import { buildServer } from './server.js';

/** Faux provider : enregistre les appels, renvoie une réponse fixe, zéro réseau. */
class MockLlmProvider implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  public response: LlmResponse = { content: 'réponse simulée' };

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}

describe('POST /chat', () => {
  it('transmet un message valide à AgentLoop et renvoie le contenu', async () => {
    const provider = new MockLlmProvider();
    provider.response = { content: 'Bonjour, je suis JARVIS.' };
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'Bonjour' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ content: 'Bonjour, je suis JARVIS.' });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });

  it('renvoie 400 si le corps JSON est absent', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({ method: 'POST', url: '/chat' });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si le corps est un JSON non-objet', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { 'content-type': 'application/json' },
      payload: '"just a string"',
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » est absent', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { autre: 'valeur' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » n’est pas une chaîne', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » est vide', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('renvoie 400 si « message » ne contient que des espaces', async () => {
    const provider = new MockLlmProvider();
    const app = buildServer(provider);

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: '   \t \n ' },
    });

    expect(res.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });
});
