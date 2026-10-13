import { PassThrough, Writable } from 'node:stream';

import type { LlmConversationMessage, LlmProvider, LlmResponse } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_HISTORY_CONTEXT_CHARS,
  MAX_HISTORY_MESSAGES,
  describeChatError,
  describeStopReason,
  runChatRepl,
} from './chat-repl.js';

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

  it("la bannière de démarrage annonce la mémoire de session bornée, /reset, l'absence de stockage et le coût API", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'x' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    stdin.end();
    await promise;

    const text = readText();
    expect(text).toContain('/reset');
    expect(text).toContain('jamais écrit sur disque');
    expect(text).toContain('facturé');
    expect(text).toContain('ANTHROPIC_MODEL');
  });
});

describe('runChatRepl — contexte transmis au deuxième tour', () => {
  it('deux messages successifs → le second appel reçoit le premier échange (user+assistant) PUIS le nouveau message', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider((messages) => ({
      content: `écho:${(messages[messages.length - 1] as { content: string }).content}`,
    }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'premier message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, 'second message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    expect(llm.calls[0]).toEqual([{ role: 'user', content: 'premier message' }]);
    expect(llm.calls[1]).toEqual([
      { role: 'user', content: 'premier message' },
      { role: 'assistant', content: 'écho:premier message' },
      { role: 'user', content: 'second message' },
    ]);
    expect(readText()).toContain('écho:premier message');
    expect(readText()).toContain('écho:second message');
  });
});

describe('runChatRepl — /reset', () => {
  it("efface l'historique sans appeler le provider, le tour suivant repart d'une conversation vierge", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'ok' }));

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'premier message');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, '/reset');
    await vi.waitFor(() => expect(readText()).toContain('Historique de session effacé'));
    sendLine(stdin, 'après reset');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    // `/reset` lui-même n'a déclenché aucun appel : seulement 2 appels pour
    // 2 messages réels, jamais 3.
    expect(llm.calls.length).toBe(2);
    expect(llm.calls[1]).toEqual([{ role: 'user', content: 'après reset' }]);
  });
});

describe('runChatRepl — bornes de nombre et de taille (nouveau message inclus)', () => {
  it(
    `plus de ${MAX_HISTORY_MESSAGES / 2} échanges courts → l'historique conservé ne dépasse ` +
      `jamais ${MAX_HISTORY_MESSAGES} messages, les plus anciens sont retirés`,
    async () => {
      const stdin = fakeTty();
      const { output } = collectingOutput();
      const llm = new RecordingLlmProvider((messages) => ({
        content: `r:${(messages[messages.length - 1] as { content: string }).content}`,
      }));

      const promise = runChatRepl({ llm, input: stdin, output });
      const exchanges = MAX_HISTORY_MESSAGES / 2 + 3; // dépasse délibérément la borne
      for (let i = 1; i <= exchanges; i += 1) {
        sendLine(stdin, `msg${i}`);
        await vi.waitFor(() => expect(llm.calls.length).toBe(i));
      }
      sendLine(stdin, '/quit');
      await promise;

      const lastCallHistory = llm.calls[llm.calls.length - 1]!;
      // Le dernier appel transmet l'historique (sans compter son propre
      // message `user`, déjà inclus dans `lastCallHistory`) : jamais plus
      // que la borne.
      expect(lastCallHistory.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES + 1);
      // Le tout premier échange (« msg1 ») a été retiré — il ne figure plus
      // nulle part dans ce qui a été transmis au dernier appel (égalité
      // exacte, pas une sous-chaîne : « msg13 » contient « msg1 »).
      expect(lastCallHistory.some((m) => m.content === 'msg1')).toBe(false);
      expect(lastCallHistory.some((m) => m.content === 'r:msg1')).toBe(false);
    },
  );

  it(
    `réponses volontairement longues → troncature par taille déclenchée bien avant ` +
      `d'atteindre ${MAX_HISTORY_MESSAGES} messages`,
    async () => {
      const stdin = fakeTty();
      const { output, readText } = collectingOutput();
      const longReply = 'x'.repeat(Math.floor(MAX_HISTORY_CONTEXT_CHARS / 2));
      const llm = new RecordingLlmProvider(() => ({ content: longReply }));

      const promise = runChatRepl({ llm, input: stdin, output });
      sendLine(stdin, 'premier');
      await vi.waitFor(() => expect(llm.calls.length).toBe(1));
      sendLine(stdin, 'second');
      await vi.waitFor(() => expect(llm.calls.length).toBe(2));
      sendLine(stdin, 'troisième');
      await vi.waitFor(() => expect(llm.calls.length).toBe(3));
      sendLine(stdin, '/quit');
      await promise;

      // Deux réponses de ~moitié du budget chacune dépassent déjà le budget
      // total : la plus ancienne paire doit avoir été retirée avant le
      // troisième appel, bien en deçà de la borne de nombre (6 messages < 20).
      const thirdCallHistory = llm.calls[2]!;
      expect(thirdCallHistory.length).toBeLessThan(2 * 2 + 1); // < 2 paires + le nouveau message
      expect(readText()).toContain('respecter la limite de taille');
    },
  );

  it('message dépassant seul la limite de contexte → refusé localement, aucun appel, historique conservé tel quel', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const llm = new RecordingLlmProvider(() => ({ content: 'ok' }));
    const tooLong = 'y'.repeat(MAX_HISTORY_CONTEXT_CHARS + 1);

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'message normal établissant un historique');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, tooLong);
    await vi.waitFor(() => expect(readText()).toContain('refusé'));
    sendLine(stdin, 'message suivant normal');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    // Le message trop long n'a jamais déclenché d'appel.
    expect(llm.calls.length).toBe(2);
    // L'historique établi par le premier message est toujours là pour le
    // second appel « normal » : rien n'a été perdu par le refus local.
    expect(llm.calls[1]).toEqual([
      { role: 'user', content: 'message normal établissant un historique' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'message suivant normal' },
    ]);
  });

  it("réponse trop volumineuse pour être conservée → affichée, mais absente de l'historique transmis au tour suivant", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const hugeReply = 'z'.repeat(MAX_HISTORY_CONTEXT_CHARS + 1);
    let callCount = 0;
    const llm = new RecordingLlmProvider(() => {
      callCount += 1;
      return { content: callCount === 1 ? hugeReply : 'réponse normale' };
    });

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'déclenche une réponse énorme');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    await vi.waitFor(() => expect(readText()).toContain(hugeReply));
    sendLine(stdin, 'message suivant');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    sendLine(stdin, '/quit');
    await promise;

    expect(readText()).toContain('trop volumineuse pour être conservée');
    // Le second appel ne porte AUCUNE trace de l'échange précédent — la
    // paire (énorme) n'a jamais été ajoutée à l'historique conservé.
    expect(llm.calls[1]).toEqual([{ role: 'user', content: 'message suivant' }]);
  });
});

describe('runChatRepl — erreur avec historique déjà établi : aucune corruption', () => {
  it("un tour en échec ne modifie jamais l'historique conservé — le tour suivant reçoit l'historique d'avant l'échec, inchangé", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    let callCount = 0;
    const llm = new RecordingLlmProvider(() => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('erreur fournisseur simulée');
      }
      return { content: `réponse ${callCount}` };
    });

    const promise = runChatRepl({ llm, input: stdin, output });
    sendLine(stdin, 'premier');
    await vi.waitFor(() => expect(llm.calls.length).toBe(1));
    sendLine(stdin, 'deuxième (va échouer)');
    await vi.waitFor(() => expect(llm.calls.length).toBe(2));
    await vi.waitFor(() => expect(readText()).toContain('Le fournisseur LLM a renvoyé une erreur'));
    sendLine(stdin, 'troisième');
    await vi.waitFor(() => expect(llm.calls.length).toBe(3));
    sendLine(stdin, '/quit');
    await promise;

    // Le troisième appel reçoit exactement l'historique issu du PREMIER
    // échange réussi — ni le message/la réponse ratés du deuxième tour, ni
    // une corruption quelconque.
    expect(llm.calls[2]).toEqual([
      { role: 'user', content: 'premier' },
      { role: 'assistant', content: 'réponse 1' },
      { role: 'user', content: 'troisième' },
    ]);
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

  it(
    'avec un historique déjà établi par un échange précédent : le second appel en vol ' +
      'reçoit bien cet historique, Ctrl+C + ligne déjà en attente → toujours aucun troisième appel',
    async () => {
      const stdin = fakeTty();
      const { output } = collectingOutput();

      let releaseSecond: (() => void) | undefined;
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });

      let callCount = 0;
      const llm = new RecordingLlmProvider(async () => {
        callCount += 1;
        if (callCount === 2) {
          await secondGate;
        }
        return { content: `réponse ${callCount}` };
      });

      const promise = runChatRepl({ llm, input: stdin, output });

      // Premier échange, terminé normalement → établit un historique.
      sendLine(stdin, 'premier');
      await vi.waitFor(() => expect(llm.calls.length).toBe(1));

      // Second message : déclenche l'appel 2, bloqué sur `secondGate`.
      sendLine(stdin, 'second');
      await vi.waitFor(() => expect(llm.calls.length).toBe(2));

      // Troisième ligne déjà disponible AVANT l'interruption.
      sendLine(stdin, 'troisième-jamais-traité');
      stdin.write('\u0003');

      await new Promise((resolve) => setImmediate(resolve));
      expect(llm.calls.length).toBe(2);

      releaseSecond?.();
      await promise;

      // Le second appel (en vol au moment de Ctrl+C) a bien reçu
      // l'historique du premier échange — l'interruption ne l'a pas vidé
      // ni corrompu.
      expect(llm.calls[1]).toEqual([
        { role: 'user', content: 'premier' },
        { role: 'assistant', content: 'réponse 1' },
        { role: 'user', content: 'second' },
      ]);
      // Et toujours aucun troisième appel, malgré la ligne déjà en attente.
      expect(llm.calls.length).toBe(2);
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
      const text = (messages[messages.length - 1] as { content: string }).content;
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
