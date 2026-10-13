import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnthropicProvider,
  type AnthropicMessagesClient,
  type LlmConversationMessage,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
  type LlmToolDefinition,
} from './index.js';

/**
 * Tests du provider Anthropic — **aucun appel réseau réel**. Le client SDK est
 * injecté (`AnthropicProviderOptions.client`) par un faux qui enregistre les
 * paramètres de `messages.create` et rejoue une réponse scriptée.
 *
 * Toutes les valeurs (clé, contenu, ids) sont artificielles.
 */

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** Construit une réponse `Anthropic.Message` minimale mais structurellement valide. */
function fakeMessage(blocks: {
  readonly text?: string;
  readonly toolUses?: ReadonlyArray<{ id: string; name: string; input: unknown }>;
  readonly stopReason?: Anthropic.StopReason;
}): Anthropic.Message {
  const content: unknown[] = [];
  if (blocks.text !== undefined) {
    content.push({ type: 'text', text: blocks.text, citations: null });
  }
  for (const tu of blocks.toolUses ?? []) {
    content.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
  }
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason: blocks.stopReason ?? (blocks.toolUses?.length ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** Faux client injectable : enregistre chaque appel, rejoue un script (dernier répété). */
function fakeClient(script: Anthropic.Message | Error | ReadonlyArray<Anthropic.Message | Error>): {
  client: AnthropicMessagesClient;
  calls: CreateParams[];
} {
  const queue: Array<Anthropic.Message | Error> = Array.isArray(script)
    ? [...script]
    : [script as Anthropic.Message | Error];
  const calls: CreateParams[] = [];
  const create = vi.fn(async (params: CreateParams): Promise<Anthropic.Message> => {
    calls.push(params);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('fakeClient : script épuisé');
    return next;
  });
  return { client: { messages: { create } }, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AnthropicProvider — conversation classique', () => {
  it('chat(messages) sans tools : create appelé sans « tools », renvoie le texte', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'Bonjour, je suis JARVIS.' }));
    const provider = new AnthropicProvider({ client });

    const res = await provider.chat([{ role: 'user', content: 'Salut' }]);

    expect(res).toEqual({ content: 'Bonjour, je suis JARVIS.' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('tools');
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'Salut' }]);
    expect(calls[0].model).toBe('claude-sonnet-5');
    expect(calls[0].max_tokens).toBe(4096);
  });

  it('les messages `system` sont extraits vers le paramètre `system`, jamais dans `messages`', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'ok' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([
      { role: 'system', content: 'Tu es concis.' },
      { role: 'user', content: 'Salut' },
    ]);

    expect(calls[0].system).toBe('Tu es concis.');
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'Salut' }]);
  });

  it('aucun message user/assistant/tool → erreur explicite', async () => {
    const { client } = fakeClient(fakeMessage({ text: 'inatteignable' }));
    const provider = new AnthropicProvider({ client });

    await expect(provider.chat([{ role: 'system', content: 'x' }])).rejects.toThrow(
      /aucun message .user., .assistant. ou .tool./,
    );
  });

  it(
    'historique multi-tour texte simple (user/assistant alterné, sans outil) → transmis tel quel, ' +
      'même forme que celle produite par AgentLoop.run(message, { history }) — vérifie la ' +
      'contrainte structurelle sans appel payant',
    async () => {
      const { client, calls } = fakeClient(fakeMessage({ text: 'Et voici la suite.' }));
      const provider = new AnthropicProvider({ client });

      await provider.chat([
        { role: 'user', content: 'Premier message' },
        { role: 'assistant', content: 'Première réponse' },
        { role: 'user', content: 'Deuxième message' },
      ]);

      expect(calls[0].messages).toEqual([
        { role: 'user', content: 'Premier message' },
        { role: 'assistant', content: 'Première réponse' },
        { role: 'user', content: 'Deuxième message' },
      ]);
    },
  );

  it('ANTHROPIC_MODEL surcharge le modèle par défaut', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-opus-5');
    const { client, calls } = fakeClient(fakeMessage({ text: 'ok' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([{ role: 'user', content: 'Salut' }]);

    expect(calls[0].model).toBe('claude-opus-5');
  });
});

describe('AnthropicProvider — tools transmis', () => {
  const TOOL: LlmToolDefinition = {
    name: 'gmail.read',
    description: 'Lit les emails récents.',
    inputSchema: {
      type: 'object',
      properties: { maxResults: { type: 'integer', minimum: 1 } },
      required: [],
    },
  };

  it('chat(messages, { tools }) : create reçoit exactement les définitions sous input_schema', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'ok' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([{ role: 'user', content: 'Lis mes mails' }], { tools: [TOOL] });

    expect(calls[0].tools).toEqual([
      {
        name: 'gmail.read',
        description: 'Lit les emails récents.',
        input_schema: {
          type: 'object',
          properties: { maxResults: { type: 'integer', minimum: 1 } },
          required: [],
        },
      },
    ]);
  });

  it('tools vide → aucun `tools` transmis (comportement conversationnel)', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'ok' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([{ role: 'user', content: 'x' }], { tools: [] });

    expect(calls[0]).not.toHaveProperty('tools');
  });
});

describe('AnthropicProvider — tool_use reçu', () => {
  it('réponse contenant un bloc tool_use → LlmResponse.toolCall { id, tool, input }', async () => {
    const { client } = fakeClient(
      fakeMessage({
        text: 'Je vais lire vos emails.',
        toolUses: [{ id: 'toolu_01', name: 'gmail.read', input: { maxResults: 5 } }],
        stopReason: 'tool_use',
      }),
    );
    const provider = new AnthropicProvider({ client });

    const res = await provider.chat([{ role: 'user', content: 'Lis mes mails' }]);

    expect(res).toEqual({
      content: 'Je vais lire vos emails.',
      toolCall: { id: 'toolu_01', tool: 'gmail.read', input: { maxResults: 5 } },
    });
  });

  it('tool_use SANS bloc text → fonctionne, ne lève PAS « sans contenu textuel exploitable »', async () => {
    const { client } = fakeClient(
      fakeMessage({
        toolUses: [{ id: 'toolu_02', name: 'gmail.read', input: {} }],
        stopReason: 'tool_use',
      }),
    );
    const provider = new AnthropicProvider({ client });

    const res = await provider.chat([{ role: 'user', content: 'Lis' }]);

    expect(res.toolCall).toEqual({ id: 'toolu_02', tool: 'gmail.read', input: {} });
    expect(res.content).toBe('');
  });

  it('réponse texte sans tool_use → { content } comme aujourd’hui', async () => {
    const { client } = fakeClient(fakeMessage({ text: 'Voici la réponse.' }));
    const provider = new AnthropicProvider({ client });

    const res = await provider.chat([{ role: 'user', content: 'Question' }]);

    expect(res).toEqual({ content: 'Voici la réponse.' });
    expect(res.toolCall).toBeUndefined();
  });

  it('réponse vide (ni texte ni tool_use) → erreur inchangée', async () => {
    const { client } = fakeClient(fakeMessage({}));
    const provider = new AnthropicProvider({ client });

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      'Réponse Anthropic sans contenu textuel exploitable.',
    );
  });
});

describe('AnthropicProvider — tool_result entrant', () => {
  it('message role="tool" → message Anthropic `user` avec bloc tool_result + bon tool_use_id', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'Merci.' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([
      { role: 'user', content: 'Lis mes mails' },
      {
        role: 'assistant',
        content: '',
        toolCall: { id: 'toolu_09', tool: 'gmail.read', input: {} },
      },
      { role: 'tool', toolCallId: 'toolu_09', content: '{"messages":[]}' },
    ]);

    expect(calls[0].messages).toEqual([
      { role: 'user', content: 'Lis mes mails' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_09', name: 'gmail.read', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_09', content: '{"messages":[]}' }],
      },
    ]);
  });

  it('assistant + toolCall AVEC texte → bloc text puis bloc tool_use', async () => {
    const { client, calls } = fakeClient(fakeMessage({ text: 'fini' }));
    const provider = new AnthropicProvider({ client });

    await provider.chat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'Je lis vos mails.',
        toolCall: { id: 'toolu_10', tool: 'gmail.read', input: { maxResults: 3 } },
      },
      { role: 'tool', toolCallId: 'toolu_10', content: 'ok' },
    ]);

    expect(calls[0].messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Je lis vos mails.' },
        { type: 'tool_use', id: 'toolu_10', name: 'gmail.read', input: { maxResults: 3 } },
      ],
    });
  });

  it('assistant porteur d’un toolCall sans id (contournement du typage) → erreur explicite', async () => {
    const { client } = fakeClient(fakeMessage({ text: 'x' }));
    const provider = new AnthropicProvider({ client });

    // `LlmToolCall.id` est obligatoire au niveau du type. Ce test couvre la
    // garde d'exécution (défense en profondeur) de `toMessageParam` pour un
    // appelant non typé qui contournerait le compilateur.
    const brokenAssistant = {
      role: 'assistant',
      content: '',
      toolCall: { tool: 'gmail.read', input: {} },
    } as unknown as LlmConversationMessage;

    await expect(
      provider.chat([
        { role: 'user', content: 'go' },
        brokenAssistant,
        { role: 'tool', toolCallId: '', content: 'r' },
      ]),
    ).rejects.toThrow(/doit fournir .toolCall\.id./);
  });
});

describe('AnthropicProvider — aller-retour tool_use → tool_result → réponse finale', () => {
  it('les deux formes sont correctement transportées sur deux appels create', async () => {
    const { client, calls } = fakeClient([
      fakeMessage({
        toolUses: [{ id: 'toolu_ar', name: 'gmail.read', input: { maxResults: 2 } }],
        stopReason: 'tool_use',
      }),
      fakeMessage({ text: 'Vous avez 2 emails importants.' }),
    ]);
    const provider = new AnthropicProvider({ client });

    // 1er appel → le modèle demande l'outil
    const first = await provider.chat([{ role: 'user', content: 'Résume mes mails' }], {
      tools: [{ name: 'gmail.read', description: 'lit', inputSchema: { type: 'object' } }],
    });
    expect(first.toolCall).toEqual({
      id: 'toolu_ar',
      tool: 'gmail.read',
      input: { maxResults: 2 },
    });

    // 2e appel → on renvoie le résultat de l'outil
    const second = await provider.chat([
      { role: 'user', content: 'Résume mes mails' },
      { role: 'assistant', content: first.content, toolCall: first.toolCall! },
      { role: 'tool', toolCallId: 'toolu_ar', content: '{"messages":[{"id":"m1"},{"id":"m2"}]}' },
    ]);
    expect(second).toEqual({ content: 'Vous avez 2 emails importants.' });

    // Forme du 1er appel : tools présents
    expect(calls[0].tools).toHaveLength(1);
    // Forme du 2e appel : tool_use (assistant) puis tool_result (user)
    expect(calls[1].messages).toEqual([
      { role: 'user', content: 'Résume mes mails' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_ar', name: 'gmail.read', input: { maxResults: 2 } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_ar',
            content: '{"messages":[{"id":"m1"},{"id":"m2"}]}',
          },
        ],
      },
    ]);
  });
});

describe('AnthropicProvider — plusieurs tool_use (non supporté)', () => {
  it('réponse avec 2 blocs tool_use → erreur explicite, jamais un toolCall silencieux', async () => {
    const { client } = fakeClient(
      fakeMessage({
        toolUses: [
          { id: 'a', name: 'gmail.read', input: {} },
          { id: 'b', name: 'gmail.prepare_reply', input: { messageId: 'm1', body: 'x' } },
        ],
        stopReason: 'tool_use',
      }),
    );
    const provider = new AnthropicProvider({ client });

    await expect(provider.chat([{ role: 'user', content: 'go' }])).rejects.toThrow(
      /multi-tool-use n.est pas support/,
    );
  });
});

describe('AnthropicProvider — erreurs', () => {
  it('erreur SDK/API → préfixe « Erreur de l’API Anthropic », clé jamais exposée', async () => {
    const { client } = fakeClient(new Error('boom réseau'));
    const provider = new AnthropicProvider({ client });

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      "Erreur de l'API Anthropic : boom réseau",
    );
  });

  it('Anthropic.APIError → « statut HTTP N — message »', async () => {
    const apiErr = new Anthropic.APIError(503, undefined, 'service indisponible', new Headers());
    const { client } = fakeClient(apiErr);
    const provider = new AnthropicProvider({ client });

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      /Erreur de l'API Anthropic : statut HTTP 503 — /,
    );
  });

  it('aucun client injecté + ANTHROPIC_API_KEY absente → erreur contrôlée, pas d’appel', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const provider = new AnthropicProvider();

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      'ANTHROPIC_API_KEY manquante',
    );
  });
});

describe('AnthropicProvider — rétrocompatibilité du contrat', () => {
  it('un consommateur qui appelle chat(messages) sans options compile et fonctionne', async () => {
    const { client } = fakeClient(fakeMessage({ text: 'ok' }));
    const provider: LlmProvider = new AnthropicProvider({ client });

    // Signature historique : LlmMessage[] sans 2e argument.
    const messages: LlmMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ];
    const res: LlmResponse = await provider.chat(messages);

    expect(res.content).toBe('ok');
  });

  it('un provider tiers avec la signature historique satisfait toujours LlmProvider', async () => {
    // Signature d'origine `chat(messages: LlmMessage[])` — doit rester assignable.
    class LegacyProvider implements LlmProvider {
      async chat(messages: LlmMessage[]): Promise<LlmResponse> {
        return { content: `reçu ${messages.length}` };
      }
    }
    const p: LlmProvider = new LegacyProvider();
    const conv: LlmConversationMessage[] = [{ role: 'user', content: 'x' }];

    expect(await p.chat(conv)).toEqual({ content: 'reçu 1' });
  });
});
