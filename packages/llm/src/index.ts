import Anthropic from '@anthropic-ai/sdk';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
}

export interface LlmProvider {
  chat(messages: LlmMessage[]): Promise<LlmResponse>;
}

/** Modèle par défaut si ANTHROPIC_MODEL n'est pas défini. */
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Budget de tokens de sortie par défaut pour une requête `messages.create`. */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Implémentation de {@link LlmProvider} basée sur le SDK officiel Anthropic.
 *
 * La clé d'API est lue exclusivement depuis la variable d'environnement
 * `ANTHROPIC_API_KEY` et n'est jamais journalisée ni incluse dans un message
 * d'erreur.
 *
 * L'instanciation ne requiert pas la clé : elle n'est vérifiée qu'au premier
 * appel de {@link AnthropicProvider.chat}. Une application peut donc démarrer
 * sans clé, et une requête déclenchera alors une erreur explicite mais
 * contrôlée.
 */
export class AnthropicProvider implements LlmProvider {
  private client: Anthropic | undefined;
  private readonly maxTokens: number = DEFAULT_MAX_TOKENS;

  /** Modèle courant, relu à chaque appel pour rester configurable via l'env. */
  private get model(): string {
    return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  }

  /**
   * Crée (une seule fois) le client Anthropic à partir de `ANTHROPIC_API_KEY`.
   *
   * @throws {Error} si `ANTHROPIC_API_KEY` est absente ou vide.
   */
  private resolveClient(): Anthropic {
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

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    const client = this.resolveClient();

    // L'API Anthropic traite le system prompt séparément : on extrait tous les
    // messages `system` et on concatène leur contenu.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content.trim())
      .filter((c) => c.length > 0)
      .join('\n\n');

    const conversation: Anthropic.MessageParam[] = messages
      .filter((m): m is LlmMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    if (conversation.length === 0) {
      throw new Error(
        'AnthropicProvider.chat : aucun message `user` ou `assistant` à envoyer.',
      );
    }

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: conversation,
        ...(system.length > 0 ? { system } : {}),
      });
    } catch (err) {
      throw new Error(`Erreur de l'API Anthropic : ${describeError(err)}`);
    }

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (content.length === 0) {
      throw new Error('Réponse Anthropic sans contenu textuel exploitable.');
    }

    return { content };
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
