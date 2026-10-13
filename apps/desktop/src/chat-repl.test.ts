import { PassThrough, Writable } from 'node:stream';

import type { LlmConversationMessage, LlmProvider, LlmResponse } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';

import { describeChatError, describeStopReason, runChatRepl } from './chat-repl.js';

/**
 * Tests de `chat-repl.ts` — exclusivement avec un `LlmProvider` simulé
 * (jamais `AnthropicProvider`, jamais `ANTHROPIC_API_KEY`) et un `stdin`
 * simulé (`PassThrough`, jamais `process.stdin`). **Aucun appel réseau, ni
 * échange avec un vrai modèle, n'a lieu dans cette suite** — un provider
 * simulé enregistre ses appels et renvoie une réponse scriptée, exactement
 * comme `SimulatedLlmProvider` (`apps/whatsapp-channel`).
 */

type FakeTty = PassThrough & { isTTY: boolean };

function fakeTty(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.isTTY = true;
  return stream;
}

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

/** Provider simulé — enregistre chaque appel pour inspection, jamais de réseau. */
class RecordingLlmProvider implements LlmProvider {
  public readonly calls: LlmConversationMessage[][] = [];

  constructor(
    private readonly reply: (
      messages: LlmConversationMessage[],
    ) => LlmResponse | Promise<LlmResponse>,
  ) {}

  async chat(messages: LlmConversationMessage[]): Promise<LlmResponse> {
    this.calls.push(messages);
    return this.reply(messages);
  }
}

function sendLine(stdin: PassThrough, line: string): void {
  stdin.write(`${line}\n`);
}

describe('describeStopReason — traite explicitement les trois statuts', () => {
  it("'llm_final' renvoie le contenu tel quel", () => {
    expect(describeStopReason('llm_final', 'bonjour')).toBe('bonjour');
  });

  it("'tool_blocked' produit un message explicite, jamais un contenu vide silencieux", () => {
    const line = describeStopReason('tool_blocked', '');
    expect(line.length).toBeGreaterThan(0);
    expect(line).not.toBe('');
  });

  it("'max_iterations' produit un message explicite distinct", () => {
    const line = describeStopReason('max_iterations', '');
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('describeChatError — jamais err.message/pile/réponse brute', () => {
  it('clé API absente → message contrôlé reconnu explicitement', () => {
    const err = new Error(
      "ANTHROPIC_API_KEY manquante : définissez la variable d'environnement ANTHROPIC_API_KEY avant d'appeler AnthropicProvider.chat().",
    );
    expect(describeChatError(err)).toContain('Clé API absente');
    expect(describeChatError(err)).not.toContain('ANTHROPIC_API_KEY manquante');
  });

  it('toute autre erreur → motif générique fixe, jamais le message/la chaîne sensible d’origine', () => {
    const sensitive = 'sk-ant-leaked-secret-token-xyz';
    const err = new Error(
      `Erreur de l'API Anthropic : statut HTTP 401 — clé ${sensitive} invalide`,
    );
    const described = describeChatError(err);
    expect(described).not.toContain(sensitive);
    expect(described).not.toContain('statut HTTP');
  });
});

describe('runChatRepl — une demande, une réponse', () => {
  it('message non vide → un seul appel au provider, réponse affichée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'réponse simulée' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'bonjour');
    sendLine(stdin, '/quit');

    await promise;

    expect(llm.calls.length).toBe(1);
    expect(readText()).toContain('réponse simulée');
  });

  it('la bannière de démarrage annonce la portée mono-tour, le coût API et la configuration du modèle', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'x' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    stdin.end();
    await promise;

    const text = readText();
    expect(text).toContain('mono-tour');
    expect(text).toContain('facturé');
    expect(text).toContain('ANTHROPIC_MODEL');
  });
});

describe('runChatRepl — plusieurs tours indépendants, aucun historique', () => {
  it('deux messages successifs → deux appels, chacun avec une conversation fraîche (un seul message user)', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider((messages) => ({
      content: `écho:${(messages[0] as { content: string }).content}`,
    }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'premier message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, 'second message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    expect(llm.calls[0]).toHaveLength(1);
    expect(llm.calls[1]).toHaveLength(1);
    expect(readText()).toContain('écho:premier message');
    expect(readText()).toContain('écho:second message');
  });
});

describe('runChatRepl — lignes vides et /quit', () => {
  it('lignes vides ignorées : aucun appel au provider', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'jamais appelé' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, '');
    sendLine(stdin, '   ');
    sendLine(stdin, '/quit');
    await promise;

    expect(llm.calls.length).toBe(0);
  });

  it('/quit termine la boucle sans appeler le provider pour cette ligne', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'jamais appelé' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, '/quit');

    await expect(promise).resolves.toBeUndefined();
    expect(llm.calls.length).toBe(0);
  });
});

describe('runChatRepl — fin de stdin et Ctrl+C', () => {
  it('fin de stdin (sans /quit) → la boucle se termine proprement', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'x' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'un message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    stdin.end();

    await expect(promise).resolves.toBeUndefined();
  });

  it('Ctrl+C (SIGINT) ferme la boucle sans lancer de nouveau message', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'ne devrait jamais être affiché' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    // Ctrl+C brut, aucun message en vol au moment de la frappe.
    stdin.write('\u0003');

    await expect(promise).resolves.toBeUndefined();
    expect(llm.calls.length).toBe(0);
  });
});

describe('runChatRepl — Ctrl+C pendant un appel en vol, avec une ligne déjà en attente', () => {
  it(
    'premier appel bloqué, seconde ligne déjà disponible, Ctrl+C, puis résolution du premier → ' +
      "le premier appel va à son terme (limite documentée), mais AUCUN second appel n'est jamais " +
      'lancé ; IO fermée et écouteurs nettoyés',
    async () => {
      const stdin = fakeTty();
      const { output, readText } = collectingOutput();

      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const llm = new RecordingLlmProvider(async () => {
        await firstGate;
        return { content: 'réponse du premier appel' };
      });

      const promise = runChatRepl({ llm, input: stdin, output });

      // Premier message : déclenche l'appel, qui reste bloqué sur `firstGate`.
      sendLine(stdin, 'premier');
      await vi.waitFor(() => expect(llm.calls.length).toBe(1));

      // Seconde ligne déjà disponible dans le flux AVANT toute interruption —
      // readline la met en file d'attente interne puisque la boucle
      // `for await` n'a pas encore redemandé de ligne (elle est bloquée sur
      // l'`await agent.run('premier')`).
      sendLine(stdin, 'second');

      // Ctrl+C pendant que le premier appel est toujours en vol.
      stdin.write('\u0003');

      // Laisse l'event loop traiter l'évènement SIGINT avant de résoudre le
      // premier appel — si l'interruption ne bloquait pas la suite, le
      // second appel pourrait démarrer ici, avant même la résolution.
      await new Promise((resolve) => setImmediate(resolve));
      expect(llm.calls.length).toBe(1);

      releaseFirst?.();
      await promise;

      // Le premier appel a bien pu terminer et s'afficher (limite
      // documentée : un appel déjà en vol n'est jamais annulé).
      expect(readText()).toContain('réponse du premier appel');
      // Mais AUCUN second appel n'a jamais été lancé — la ligne « second »,
      // bien que déjà disponible avant l'interruption, n'a jamais été
      // transformée en nouvelle demande.
      expect(llm.calls.length).toBe(1);

      // IO fermée, écouteurs nettoyés : plus rien n'écoute `stdin` une fois
      // la boucle terminée (readline retire ses propres écouteurs à la
      // fermeture).
      expect(stdin.listenerCount('data')).toBe(0);
      expect(stdin.listenerCount('keypress')).toBe(0);
    },
  );

  it('/quit suivi de lignes déjà en attente → aucune demande après /quit, même déjà disponibles', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'ne devrait jamais être appelé' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    // Les trois lignes sont écrites d'un coup, avant que la boucle n'ait eu
    // la moindre chance de traiter quoi que ce soit : `/quit` est suivi de
    // deux lignes déjà présentes dans le flux au moment où il est lu.
    stdin.write('/quit\nligne-en-attente-1\nligne-en-attente-2\n');

    await expect(promise).resolves.toBeUndefined();
    expect(llm.calls.length).toBe(0);
    expect(stdin.listenerCount('data')).toBe(0);
  });
});

describe('runChatRepl — séquentialité (aucun appel concurrentiel)', () => {
  it('un second message tapé pendant un appel en vol ne déclenche le provider que lorsque le premier est résolu', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();

    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const callOrder: string[] = [];
    const llm = new RecordingLlmProvider(async (messages) => {
      const text = (messages[0] as { content: string }).content;
      callOrder.push(`start:${text}`);
      if (text === 'premier') {
        await firstGate;
      }
      callOrder.push(`end:${text}`);
      return { content: `réponse:${text}` };
    });

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'premier');
    // Tapé immédiatement, pendant que le premier appel est encore bloqué sur `firstGate`.
    sendLine(stdin, 'second');

    // Laisse l'event loop tourner : si la séquentialité n'était pas respectée,
    // le second appel aurait déjà démarré ici.
    await new Promise((resolve) => setImmediate(resolve));
    expect(callOrder).toEqual(['start:premier']);

    releaseFirst?.();
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    expect(callOrder).toEqual(['start:premier', 'end:premier', 'start:second', 'end:second']);
    expect(readText()).toContain('réponse:premier');
    expect(readText()).toContain('réponse:second');
  });
});

describe('runChatRepl — clé API absente', () => {
  it('erreur « ANTHROPIC_API_KEY manquante » → message contrôlé, aucune réponse fabriquée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => {
      throw new Error(
        "ANTHROPIC_API_KEY manquante : définissez la variable d'environnement ANTHROPIC_API_KEY avant d'appeler AnthropicProvider.chat().",
      );
    });

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'bonjour');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, '/quit');
    await promise;

    expect(readText()).toContain('Clé API absente');
    expect(readText()).not.toContain('ANTHROPIC_API_KEY manquante');
  });
});

describe('runChatRepl — erreur fournisseur avec chaîne sensible', () => {
  it('aucune fuite dans la sortie terminal, même si l’exception contient un secret', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const sensitive = 'sk-ant-should-never-leak-1234567890';
    const llm = new RecordingLlmProvider(() => {
      throw new Error(`requête rejetée, en-tête Authorization: Bearer ${sensitive}`);
    });

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'bonjour');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, '/quit');
    await promise;

    expect(readText()).not.toContain(sensitive);
  });
});

describe('runChatRepl — tentative d’appel d’outil sans outil enregistré', () => {
  it('un provider qui renvoie quand même un toolCall est ignoré (AgentLoop sans ToolExecutor) — réponse normale affichée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({
      content: 'réponse malgré le toolCall',
      toolCall: { id: '1', tool: 'outil-fantome', input: {} },
    }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'bonjour');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, '/quit');
    await promise;

    expect(readText()).toContain('réponse malgré le toolCall');
  });
});
