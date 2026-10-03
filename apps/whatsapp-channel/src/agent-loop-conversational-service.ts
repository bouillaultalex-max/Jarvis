import { AgentLoop, type LlmProvider } from '@jarvis/core';

import type { ConversationalService, ConversationalServiceResult } from './channel-ports.js';

/**
 * Adaptateur `ConversationalService` → `AgentLoop`. Construit **sans**
 * `ToolExecutor` : aucun outil n'est présenté au modèle, donc aucun outil
 * `execute` n'est atteignable — garantie **structurelle** (voir
 * `agent-loop.ts` : sans `ToolExecutor`, `AgentLoop` reste purement
 * conversationnel, `stopReason` vaut toujours `'llm_final'` dès le premier
 * appel), pas une simple politique.
 *
 * **Mono-tour, sans état** : chaque appel à `reply()` construit un tour
 * `AgentLoop` entièrement indépendant — aucun historique de conversation
 * n'est conservé entre deux messages du même expéditeur. `senderId` est
 * reçu (contrat du port) mais **non exploité** ici : conserver une session
 * par expéditeur est une amélioration future distincte, non implémentée
 * dans cette tranche (voir le rapport d'intégration).
 */
export class AgentLoopConversationalService implements ConversationalService {
  private readonly agentLoop: AgentLoop;

  constructor(llm: LlmProvider) {
    this.agentLoop = new AgentLoop(llm);
  }

  async reply(input: {
    readonly senderId: string;
    readonly text: string;
  }): Promise<ConversationalServiceResult> {
    const result = await this.agentLoop.run(input.text);

    // Structurellement inatteignable sans `ToolExecutor` (voir en-tête de
    // fichier) — gardé en défense explicite plutôt que supposé en silence.
    if (result.stopReason !== 'llm_final') {
      return {
        status: 'error',
        reason: `arrêt inattendu du tour conversationnel (« ${result.stopReason} »).`,
      };
    }

    return { status: 'ok', text: result.content };
  }
}
