/**
 * BANC ISOLE — provider LLM scripte, deterministe, sans reseau.
 *
 * ATTENTION — limite assumee et documentee (voir rapport de mission) :
 * ce provider rejoue une sequence de reponses FIXEE A L'AVANCE. Il ne lit
 * jamais `options.tools` pour decider de sa reponse (il se contente de les
 * enregistrer pour verification). Il ne simule donc PAS un modele reel qui
 * choisirait un outil ou construirait ses arguments en fonction du nom, de la
 * description ou du schema presente — c'est precisement ce que le chemin reel
 * (`AnthropicProvider`) ferait, mais qu'aucun budget reseau/LLM n'autorise ici.
 * Une execution avec ce provider valide la plomberie du banc (registre,
 * permissions, boucle, metriques) — jamais la performance d'un modele.
 */

import type {
  LlmChatOptions,
  LlmConversationMessage,
  LlmProvider,
  LlmResponse,
  LlmToolDefinition,
} from '@jarvis/core';

export class ScriptedLlmProvider implements LlmProvider {
  private cursor = 0;
  /** Definitions d'outils recues a chaque appel, dans l'ordre — pour verification. */
  public readonly receivedToolDefinitions: (readonly LlmToolDefinition[])[] = [];

  constructor(private readonly turns: readonly LlmResponse[]) {}

  async chat(_messages: LlmConversationMessage[], options?: LlmChatOptions): Promise<LlmResponse> {
    this.receivedToolDefinitions.push(options?.tools ?? []);
    const turn = this.turns[this.cursor];
    this.cursor += 1;
    if (turn === undefined) {
      throw new Error(
        `ScriptedLlmProvider : script epuise (${this.turns.length} tour(s) prevu(s)), ` +
          'le banc a demande une reponse supplementaire.',
      );
    }
    return turn;
  }
}
