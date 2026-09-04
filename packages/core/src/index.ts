import type { LlmMessage, LlmProvider } from '@jarvis/llm';

export type { LlmMessage, LlmProvider, LlmResponse } from '@jarvis/llm';

/**
 * Moteur d'orchestration d'une conversation.
 *
 * `AgentLoop` ne connaît que l'interface {@link LlmProvider} : il ne référence
 * aucune implémentation concrète (comme `AnthropicProvider`) et ne réalise
 * lui-même aucun appel réseau.
 *
 * Flux : utilisateur → {@link AgentLoop.process} → {@link LlmProvider.chat} → `string`
 */
export class AgentLoop {
  constructor(private readonly llm: LlmProvider) {}

  /**
   * Transmet `message` au provider comme message `user` et renvoie le texte de
   * la réponse.
   *
   * @throws {Error} si `message` est vide ou uniquement composé d'espaces.
   */
  async process(message: string): Promise<string> {
    if (message.trim().length === 0) {
      throw new Error('AgentLoop.process : le message utilisateur est vide.');
    }

    const userMessage: LlmMessage = { role: 'user', content: message };
    const response = await this.llm.chat([userMessage]);
    return response.content;
  }
}

/**
 * @deprecated Ancien point d'entrée conservé uniquement pour la compatibilité
 * avec `apps/api`. Le moteur de conversation est désormais {@link AgentLoop},
 * qui reçoit explicitement un {@link LlmProvider}. À retirer lorsque `apps/api`
 * sera migré vers `AgentLoop`.
 */
export class JarvisCore {}
