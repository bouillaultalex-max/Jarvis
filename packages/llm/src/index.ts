import Anthropic from '@anthropic-ai/sdk';

/**
 * Message conversationnel classique.
 *
 * Forme inchangée depuis l'origine : les consommateurs qui construisent
 * `{ role, content }` continuent de fonctionner sans modification.
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tour « assistant » ayant émis une demande d'outil.
 *
 * Permet de reconstituer, côté provider, le bloc `tool_use` attendu par l'API
 * Anthropic **avant** un `tool_result`. Volontairement distinct de
 * {@link LlmMessage} : un simple `{ role: 'assistant', content }` reste valide
 * et n'a pas besoin de ce champ.
 */
export interface LlmAssistantToolCallMessage {
  role: 'assistant';
  /** Texte éventuel qui accompagnait la demande d'outil (souvent vide). */
  content: string;
  toolCall: LlmToolCall;
}

/**
 * Résultat d'un outil renvoyé au modèle, en réponse à un {@link LlmToolCall}.
 *
 * Forme minimale et volontairement plate — ce module n'introduit **pas** de
 * système générique de « content blocks ». Le provider la convertit en un
 * bloc `tool_result` Anthropic.
 */
export interface LlmToolResultMessage {
  role: 'tool';
  /** `id` du {@link LlmToolCall} auquel ce résultat répond (→ `tool_use_id`). */
  toolCallId: string;
  content: string;
}

/** Entrée de conversation acceptée par {@link LlmProvider.chat}. */
export type LlmConversationMessage =
  LlmMessage | LlmAssistantToolCallMessage | LlmToolResultMessage;

/**
 * Définition d'un outil exposée au modèle.
 *
 * `inputSchema` est un objet **compatible JSON Schema**, fourni tel quel par
 * l'appelant. Ce module ne génère aucun schéma : il le transmet à l'API sous
 * `input_schema`.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Options facultatives de {@link LlmProvider.chat}. */
export interface LlmChatOptions {
  /**
   * Outils exposés au modèle pour ce tour. Absent ou vide ⇒ conversation
   * pure, comportement identique à l'historique (aucun `tools` transmis).
   */
  tools?: readonly LlmToolDefinition[];
}

/**
 * Demande d'exécution d'outil émise par le modèle, sous forme *structurée*
 * (jamais du JSON fragile encodé dans une chaîne).
 *
 * `input` est volontairement `unknown` : c'est l'outil ciblé qui valide sa
 * propre entrée.
 */
export interface LlmToolCall {
  /**
   * Corrèle la demande et son résultat (`tool_use.id` côté réponse Anthropic,
   * `tool_result.tool_use_id` côté requête suivante). `AnthropicProvider` le
   * renseigne toujours.
   */
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
}

export interface LlmResponse {
  content: string;
  /**
   * Présent lorsque le modèle demande l'exécution d'un outil. `AnthropicProvider`
   * le renseigne quand la réponse contient un bloc `tool_use` (un seul —
   * le multi-tool-use n'est pas supporté, voir {@link AnthropicProvider.chat}).
   */
  toolCall?: LlmToolCall;
}

export interface LlmProvider {
  /**
   * @param messages conversation (messages classiques, tour assistant avec
   *   `toolCall`, et/ou résultats d'outils `role: 'tool'`).
   * @param options `tools` facultatif — omis ⇒ comportement conversationnel.
   */
  chat(messages: LlmConversationMessage[], options?: LlmChatOptions): Promise<LlmResponse>;
}

/** Modèle par défaut si ANTHROPIC_MODEL n'est pas défini. */
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Budget de tokens de sortie par défaut pour une requête `messages.create`. */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Sous-ensemble du client Anthropic réellement utilisé par {@link AnthropicProvider}.
 *
 * Sert de *seam* : les tests injectent un faux client conforme à cette
 * interface (aucun appel réseau). En production, une instance réelle du SDK
 * `@anthropic-ai/sdk` la satisfait structurellement.
 */
export interface AnthropicMessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

/** Options de construction — l'injection de client est réservée aux tests. */
export interface AnthropicProviderOptions {
  /**
   * Client injecté (tests). Absent ⇒ un client réel est créé au premier appel
   * à partir de `ANTHROPIC_API_KEY`.
   */
  readonly client?: AnthropicMessagesClient;
}

/**
 * Implémentation de {@link LlmProvider} basée sur le SDK officiel Anthropic.
 *
 * La clé d'API est lue exclusivement depuis la variable d'environnement
 * `ANTHROPIC_API_KEY` et n'est jamais journalisée ni incluse dans un message
 * d'erreur.
 *
 * L'instanciation ne requiert pas la clé : elle n'est vérifiée qu'au premier
 * appel de {@link AnthropicProvider.chat} lorsqu'aucun client n'est injecté.
 * Une application peut donc démarrer sans clé, et une requête déclenchera
 * alors une erreur explicite mais contrôlée.
 *
 * Tool-use : **single tool_use uniquement**. Une réponse contenant plusieurs
 * blocs `tool_use` lève une erreur explicite (voir {@link AnthropicProvider.chat}).
 * Aucun `tool_choice`, aucun parallel tool call.
 */
export class AnthropicProvider implements LlmProvider {
  private client: AnthropicMessagesClient | undefined;
  private readonly maxTokens: number = DEFAULT_MAX_TOKENS;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.client;
  }

  /** Modèle courant, relu à chaque appel pour rester configurable via l'env. */
  private get model(): string {
    return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  }

  /**
   * Retourne le client injecté, sinon crée (une seule fois) un client réel à
   * partir de `ANTHROPIC_API_KEY`.
   *
   * @throws {Error} si aucun client n'est injecté et `ANTHROPIC_API_KEY` est
   *   absente ou vide.
   */
  private resolveClient(): AnthropicMessagesClient {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        "ANTHROPIC_API_KEY manquante : définissez la variable d'environnement " +
          "ANTHROPIC_API_KEY avant d'appeler AnthropicProvider.chat().",
      );
    }

    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async chat(
    messages: LlmConversationMessage[],
    options: LlmChatOptions = {},
  ): Promise<LlmResponse> {
    const client = this.resolveClient();

    // L'API Anthropic traite le system prompt séparément : on extrait tous les
    // messages `system` et on concatène leur contenu.
    const system = messages
      .filter((m): m is LlmMessage => m.role === 'system')
      .map((m) => m.content.trim())
      .filter((c) => c.length > 0)
      .join('\n\n');

    const conversation: Anthropic.MessageParam[] = messages
      .map((m) => toMessageParam(m))
      .filter((p): p is Anthropic.MessageParam => p !== undefined);

    if (conversation.length === 0) {
      throw new Error(
        'AnthropicProvider.chat : aucun message `user`, `assistant` ou `tool` à envoyer.',
      );
    }

    const tools: Anthropic.Tool[] = (options.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      // Frontière SDK : `inputSchema` est fourni tel quel par l'appelant.
      input_schema: t.inputSchema as unknown as Anthropic.Tool.InputSchema,
    }));

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: conversation,
        ...(system.length > 0 ? { system } : {}),
        ...(tools.length > 0 ? { tools } : {}),
      });
    } catch (err) {
      throw new Error(`Erreur de l'API Anthropic : ${describeError(err)}`);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    // La présence d'un bloc `tool_use` dans `content` est le signal faisant
    // foi (l'API le garantit lorsque `stop_reason === 'tool_use'`). On n'a
    // donc pas besoin de brancher sur `response.stop_reason` séparément.
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUseBlocks.length > 1) {
      // Comportement explicite : le multi-tool-use (plusieurs blocs `tool_use`
      // dans une même réponse, appels parallèles inclus) n'est PAS supporté.
      throw new Error(
        `AnthropicProvider.chat : réponse contenant ${toolUseBlocks.length} blocs « tool_use » — ` +
          "le multi-tool-use n'est pas supporté (single tool_use uniquement).",
      );
    }

    const toolUse = toolUseBlocks[0];
    if (toolUse !== undefined) {
      // Une réponse `tool_use` peut ne porter aucun bloc `text` : ce n'est pas
      // une erreur (contrairement au chemin conversationnel pur).
      return {
        content: text,
        toolCall: { id: toolUse.id, tool: toolUse.name, input: toolUse.input },
      };
    }

    if (text.length === 0) {
      throw new Error('Réponse Anthropic sans contenu textuel exploitable.');
    }

    return { content: text };
  }
}

/**
 * Convertit une entrée de conversation en `MessageParam` Anthropic.
 *
 * - `system`    → `undefined` (traité séparément en amont).
 * - `user`      → message texte.
 * - `assistant` sans `toolCall` → message texte.
 * - `assistant` avec `toolCall` → `[text?, tool_use]`.
 * - `tool`      → message `user` portant un unique bloc `tool_result`
 *                 (`tool_use_id` = `toolCallId`).
 */
function toMessageParam(m: LlmConversationMessage): Anthropic.MessageParam | undefined {
  switch (m.role) {
    case 'system':
      return undefined;

    case 'user':
      return { role: 'user', content: m.content };

    case 'assistant': {
      if ('toolCall' in m) {
        if (m.toolCall.id === undefined) {
          throw new Error(
            "AnthropicProvider.chat : un message `assistant` porteur d'un `toolCall` " +
              'doit fournir `toolCall.id` (utilisé comme `tool_use_id`).',
          );
        }
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content.length > 0) {
          blocks.push({ type: 'text', text: m.content });
        }
        blocks.push({
          type: 'tool_use',
          id: m.toolCall.id,
          name: m.toolCall.tool,
          input: m.toolCall.input,
        });
        return { role: 'assistant', content: blocks };
      }
      return { role: 'assistant', content: m.content };
    }

    case 'tool':
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      };
  }
}

/**
 * Décrit une erreur de manière lisible sans jamais exposer d'information
 * sensible (la clé d'API n'apparaît pas dans les erreurs du SDK).
 */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 'inconnu';
    return `statut HTTP ${status} — ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
