import { describe, expect, it } from 'vitest';

import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { InMemoryDeduplicator } from './in-memory-deduplicator.js';
import { LocalMessageQueue } from './local-message-queue.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import {
  AUTHORIZED_SENDER_ID,
  NeverResolvingConversationalService,
  ScriptedConversationalService,
  UNAUTHORIZED_SENDER_ID,
  buildMessageEvent,
} from './testing/fixtures.js';

function buildQueue(overrides: Partial<ConstructorParameters<typeof LocalMessageQueue>[0]> = {}) {
  return new LocalMessageQueue({
    deduplicator: new InMemoryDeduplicator(),
    allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
    conversationalService: new ScriptedConversationalService(),
    transport: new SimulatedOutboundTransport(),
    maxQueueSize: 10,
    maxConcurrency: 4,
    ...overrides,
  });
}

describe('LocalMessageQueue — construction', () => {
  it('maxQueueSize/maxConcurrency doivent être des entiers >= 1', () => {
    expect(() => buildQueue({ maxQueueSize: 0 })).toThrow();
    expect(() => buildQueue({ maxConcurrency: 0 })).toThrow();
  });
});

describe('LocalMessageQueue — admission et réservation atomique', () => {
  it('une première admission réussit, une seconde avec le même id est un doublon', () => {
    const queue = buildQueue();
    const event = buildMessageEvent({ id: 'e1', senderId: AUTHORIZED_SENDER_ID });
    expect(queue.admit(event)).toBe('queued');
    expect(queue.admit(event)).toBe('duplicate');
  });

  it('doublon alors que le premier est encore en attente (pas démarré) : détecté', () => {
    // Concurrence = 0 effective pour ce test : on bloque le worker avec un
    // premier événement lent pour garder le second réellement « en attente ».
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 50);
    const queue = buildQueue({ conversationalService: slow, maxConcurrency: 1 });
    const blocker = buildMessageEvent({ id: 'blocker', senderId: AUTHORIZED_SENDER_ID });
    const target = buildMessageEvent({ id: 'target', senderId: AUTHORIZED_SENDER_ID });

    expect(queue.admit(blocker)).toBe('queued'); // démarre immédiatement (concurrence 1)
    expect(queue.admit(target)).toBe('queued'); // reste en attente (pendingCount > 0)
    expect(queue.pendingCount).toBeGreaterThan(0);
    expect(queue.admit(target)).toBe('duplicate'); // doublon d'un événement encore EN ATTENTE
  });

  it('doublon alors que le premier est déjà EN COURS (actif) : détecté', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 30);
    const queue = buildQueue({ conversationalService: slow });
    const event = buildMessageEvent({ id: 'active-dup', senderId: AUTHORIZED_SENDER_ID });

    expect(queue.admit(event)).toBe('queued');
    // Laisse le worker démarrer réellement (microtask + tick) sans attendre la fin.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queue.activeCount).toBe(1);
    expect(queue.admit(event)).toBe('duplicate');
    await queue.drain();
  });
});

describe('LocalMessageQueue — capacité bornée', () => {
  it("capacité atteinte → rejected_capacity, et ne laisse pas l'identifiant faussement réservé", async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 30);
    const queue = buildQueue({ conversationalService: slow, maxQueueSize: 1, maxConcurrency: 1 });

    const first = buildMessageEvent({ id: 'cap1', senderId: AUTHORIZED_SENDER_ID });
    const second = buildMessageEvent({ id: 'cap2', senderId: AUTHORIZED_SENDER_ID });

    expect(queue.admit(first)).toBe('queued');
    expect(queue.admit(second)).toBe('rejected_capacity');

    // Une fois de la place libérée, « cap2 » (jamais réellement traité) peut
    // être réadmis — preuve qu'il n'est pas resté faussement réservé.
    await queue.drain();
    expect(queue.admit(second)).toBe('queued');
    await queue.drain();
  });
});

describe('LocalMessageQueue — concurrence bornée', () => {
  it('au plus maxConcurrency événements actifs simultanément', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 30);
    const queue = buildQueue({ conversationalService: slow, maxQueueSize: 10, maxConcurrency: 2 });

    for (const id of ['a', 'b', 'c', 'd']) {
      queue.admit(buildMessageEvent({ id, senderId: AUTHORIZED_SENDER_ID }));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queue.activeCount).toBeLessThanOrEqual(2);
    await queue.drain();
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });
});

describe('LocalMessageQueue — outcomes consultables', () => {
  it('getOutcome est undefined avant la fin du traitement, puis renseigné après drain', async () => {
    const queue = buildQueue();
    const event = buildMessageEvent({ id: 'outcome-1', senderId: AUTHORIZED_SENDER_ID });
    queue.admit(event);
    expect(queue.getOutcome('outcome-1')).toBeUndefined();
    await queue.drain();
    expect(queue.getOutcome('outcome-1')).toEqual({ status: 'replied' });
  });

  it('expéditeur non autorisé → ignored_unauthorized, aucun envoi', async () => {
    const transport = new SimulatedOutboundTransport();
    const queue = buildQueue({
      transport,
      allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
    });
    const event = buildMessageEvent({ id: 'unauth-1', senderId: UNAUTHORIZED_SENDER_ID });
    queue.admit(event);
    await queue.drain();
    expect(queue.getOutcome('unauth-1')).toEqual({ status: 'ignored_unauthorized' });
    expect(transport.sentMessages).toHaveLength(0);
  });

  it('erreur structurée du service conversationnel → conversational_service_error, identifiant libéré', async () => {
    const queue = buildQueue({
      conversationalService: new ScriptedConversationalService({
        status: 'error',
        reason: 'panne',
      }),
    });
    const event = buildMessageEvent({ id: 'svcerr-1', senderId: AUTHORIZED_SENDER_ID });
    queue.admit(event);
    await queue.drain();
    expect(queue.getOutcome('svcerr-1')).toEqual({
      status: 'conversational_service_error',
      reason: 'panne',
    });
    // Libéré : une relivraison est retraitée, pas un doublon.
    expect(queue.admit(event)).toBe('queued');
  });

  it('erreur structurée du transport → transport_error, identifiant libéré', async () => {
    const queue = buildQueue({
      transport: new SimulatedOutboundTransport({ status: 'error', reason: 'injoignable' }),
    });
    const event = buildMessageEvent({ id: 'txerr-1', senderId: AUTHORIZED_SENDER_ID });
    queue.admit(event);
    await queue.drain();
    expect(queue.getOutcome('txerr-1')).toEqual({
      status: 'transport_error',
      reason: 'injoignable',
    });
    expect(queue.admit(event)).toBe('queued');
  });

  it('exception inattendue du service → processing_error, identifiant libéré', async () => {
    const throwingService = {
      async reply(): Promise<never> {
        throw new Error('bug inattendu');
      },
    };
    const queue = buildQueue({ conversationalService: throwingService });
    const event = buildMessageEvent({ id: 'throw-1', senderId: AUTHORIZED_SENDER_ID });
    queue.admit(event);
    await queue.drain();
    expect(queue.getOutcome('throw-1')).toEqual({
      status: 'processing_error',
      reason: 'bug inattendu',
    });
    expect(queue.admit(event)).toBe('queued');
  });
});

describe('LocalMessageQueue — drain', () => {
  it('résout immédiatement si la file est déjà inactive', async () => {
    const queue = buildQueue();
    await expect(queue.drain()).resolves.toEqual({ status: 'idle' });
  });

  it('attend que tout le travail admis se termine', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 20);
    const queue = buildQueue({ conversationalService: slow });
    queue.admit(buildMessageEvent({ id: 'drain-1', senderId: AUTHORIZED_SENDER_ID }));
    queue.admit(buildMessageEvent({ id: 'drain-2', senderId: AUTHORIZED_SENDER_ID }));
    await queue.drain();
    expect(queue.getOutcome('drain-1')).toEqual({ status: 'replied' });
    expect(queue.getOutcome('drain-2')).toEqual({ status: 'replied' });
  });

  it("sans délai, n'attend jamais moins longtemps qu'un service qui ne se résout jamais (pas de délai borné implicite)", async () => {
    const neverResolving = new NeverResolvingConversationalService();
    const queue = buildQueue({ conversationalService: neverResolving });
    queue.admit(buildMessageEvent({ id: 'stuck-plain', senderId: AUTHORIZED_SENDER_ID }));

    const STILL_WAITING = Symbol('still-waiting');
    const raced = await Promise.race([
      queue.drain(),
      new Promise((resolve) => setTimeout(() => resolve(STILL_WAITING), 30)),
    ]);
    // `drain()` sans timeout ne « gagne » pas la course : il n'a pas
    // résolu plus tôt que l'attente de 30ms — la promesse du service ne
    // se résout jamais, donc `drain()` seul non plus.
    expect(raced).toBe(STILL_WAITING);
  });

  it('avec délai, résout au plus tard après timeoutMs avec {status: "timed_out", …}', async () => {
    const neverResolving = new NeverResolvingConversationalService();
    const queue = buildQueue({ conversationalService: neverResolving });
    queue.admit(buildMessageEvent({ id: 'stuck-timeout', senderId: AUTHORIZED_SENDER_ID }));

    const result = await queue.drain(20);
    expect(result).toEqual({ status: 'timed_out', pendingCount: 0, activeCount: 1 });
  });
});

describe('LocalMessageQueue — fermeture maîtrisée', () => {
  it('close() refuse toute nouvelle admission après coup', async () => {
    const queue = buildQueue();
    const result = await queue.close();
    expect(result).toEqual({ status: 'closed' });
    expect(queue.isClosed).toBe(true);
    expect(
      queue.admit(buildMessageEvent({ id: 'after-close', senderId: AUTHORIZED_SENDER_ID })),
    ).toBe('closed');
  });

  it('close() laisse le travail déjà admis se terminer avant de résoudre', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 20);
    const queue = buildQueue({ conversationalService: slow });
    queue.admit(buildMessageEvent({ id: 'inflight-close', senderId: AUTHORIZED_SENDER_ID }));
    await queue.close();
    expect(queue.getOutcome('inflight-close')).toEqual({ status: 'replied' });
  });

  it('close(timeoutMs) sur un traitement bloqué : refuse les nouvelles admissions immédiatement, rapporte le travail restant, et NE LIBÈRE JAMAIS sa réservation', async () => {
    const dedup = new InMemoryDeduplicator();
    const neverResolving = new NeverResolvingConversationalService();
    const queue = buildQueue({ deduplicator: dedup, conversationalService: neverResolving });
    const stuckEvent = buildMessageEvent({ id: 'stuck-close', senderId: AUTHORIZED_SENDER_ID });
    queue.admit(stuckEvent);

    const result = await queue.close(20);

    expect(result).toEqual({ status: 'closed_with_pending_work', pendingCount: 0, activeCount: 1 });
    expect(queue.isClosed).toBe(true);
    // Preuve directe, au niveau du déduplicateur partagé : la réservation
    // du message bloqué est toujours détenue — `Promise.race` n'a pas
    // annulé le travail réel, et rien ne l'a libérée artificiellement.
    // Une exécution concurrente du même message reste donc impossible.
    expect(dedup.beginProcessing('stuck-close')).toBe('duplicate');
  });
});

describe('LocalMessageQueue — rétention bornée des issues (getOutcome)', () => {
  it('retainedOutcomeCount ne dépasse jamais maxRetainedOutcomes, éviction FIFO', async () => {
    const queue = buildQueue({ maxRetainedOutcomes: 2, maxQueueSize: 10, maxConcurrency: 10 });
    for (const id of ['o1', 'o2', 'o3']) {
      queue.admit(buildMessageEvent({ id, senderId: AUTHORIZED_SENDER_ID }));
    }
    await queue.drain();
    expect(queue.retainedOutcomeCount).toBe(2);
  });

  it('une issue évincée redevient introuvable via getOutcome, sans affecter la déduplication', async () => {
    const dedup = new InMemoryDeduplicator();
    const queue = buildQueue({
      deduplicator: dedup,
      maxRetainedOutcomes: 1,
      maxQueueSize: 10,
      maxConcurrency: 10,
    });
    queue.admit(buildMessageEvent({ id: 'old-outcome', senderId: AUTHORIZED_SENDER_ID }));
    await queue.drain();
    expect(queue.getOutcome('old-outcome')).toEqual({ status: 'replied' });

    queue.admit(buildMessageEvent({ id: 'newer-outcome', senderId: AUTHORIZED_SENDER_ID }));
    await queue.drain();

    // Évincé de l'historique consultable…
    expect(queue.getOutcome('old-outcome')).toBeUndefined();
    // … mais toujours correctement « completed » côté déduplication (ce
    // sont deux collections distinctes, voir `in-memory-deduplicator.ts`) :
    expect(dedup.beginProcessing('old-outcome')).toBe('duplicate');
  });
});
