import type {
  LlmChatOptions,
  LlmConversationMessage,
  LlmProvider,
  LlmResponse,
} from '@jarvis/core';

/**
 * Provider LLM **simulé** — n'effectue strictement aucun appel réseau, ne
 * lit aucune clé d'API. Utilisé par le bootstrap local
 * (`main.ts`) et les tests ; `AnthropicProvider` (réel) n'est **jamais**
 * branché dans cette tranche — voir le rapport d'intégration.
 *
 * Enregistre chaque appel pour inspection par les tests ; renvoie une
 * réponse fixe ou scriptée.
 */
export class SimulatedLlmProvider implements LlmProvider {
  public readonly calls: LlmConversationMessage[][] = [];

  constructor(private readonly response: LlmResponse = { content: 'réponse simulée' }) {}

  async chat(messages: LlmConversationMessage[], _options?: LlmChatOptions): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.response;
  }
}
