import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConversationalService, OutboundTransport, TransportResult } from './channel-ports.js';
import { DurableMessageWorker } from './durable-message-worker.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { ExclusivityError } from './message-store.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
import {
  AUTHORIZED_SENDER_ID,
  ScriptedConversationalService,
  buildMessageEvent,
} from './testing/fixtures.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Poll déterministe sur l'état réel du store — jamais un délai arbitraire deviné. */
async function waitForStatus(
  store: SqliteMessageStore,
  id: string,
  status: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (store.getRow(id)?.status !== status) {
    if (Date.now() > deadline) {
      throw new Error(`timeout en attendant que "${id}" atteigne le statut "${status}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function buildWorker(
  overrides: {
    readonly maxConcurrency?: number;
    readonly maxActiveDepth?: number;
    readonly conversationalService?: ConversationalService;
    readonly transport?: OutboundTransport;
  } = {},
): { worker: DurableMessageWorker; store: SqliteMessageStore } {
  const dir = mkdtempSync(join(tmpdir(), 'whatsapp-worker-'));
  tempDirs.push(dir);
  const store = SqliteMessageStore.open({
    filePath: join(dir, 'messages.db'),
    mode: 'simulated',
    maxActiveDepth: overrides.maxActiveDepth ?? 10,
  });
  const worker = new DurableMessageWorker({
    store,
    allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
    conversationalService: overrides.conversationalService ?? new ScriptedConversationalService(),
    transport: overrides.transport ?? new SimulatedOutboundTransport(),
    maxConcurrency: overrides.maxConcurrency ?? 4,
  });
  return { worker, store };
}

describe('DurableMessageWorker — construction', () => {
  it('maxConcurrency doit être un entier >= 1', () => {
    const { store } = buildWorker();
    expect(
      () =>
        new DurableMessageWorker({
          store,
          allowlist: new InMemoryAllowlist(new Set()),
          conversationalService: new ScriptedConversationalService(),
          transport: new SimulatedOutboundTransport(),
          maxConcurrency: 0,
        }),
    ).toThrow();
  });
});

describe('DurableMessageWorker — concurrence bornée', () => {
  it('au plus maxConcurrency jobs actifs simultanément', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 30);
    const { worker } = buildWorker({ maxConcurrency: 2, conversationalService: slow });

    for (const id of ['a', 'b', 'c', 'd']) {
      worker.admit(buildMessageEvent({ id, senderId: AUTHORIZED_SENDER_ID }));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(worker.activeCount).toBeLessThanOrEqual(2);
    await worker.drain();
    expect(worker.activeCount).toBe(0);
  });
});

describe('DurableMessageWorker — drain et fermeture', () => {
  it('drain() résout immédiatement si rien n’est actif', async () => {
    const { worker } = buildWorker();
    await expect(worker.drain()).resolves.toEqual({ status: 'idle' });
  });

  it('close(timeoutMs) sur un traitement bloqué : rapporte le travail restant, ne ferme pas le store (reste repris au redémarrage)', async () => {
    const neverResolving = {
      receivedCalls: [] as Array<{ senderId: string; text: string }>,
      async reply(input: { senderId: string; text: string }): Promise<never> {
        this.receivedCalls.push(input);
        return new Promise<never>(() => {});
      },
    };
    const { worker, store } = buildWorker({ conversationalService: neverResolving });
    worker.admit(buildMessageEvent({ id: 'stuck', senderId: AUTHORIZED_SENDER_ID }));

    const result = await worker.close(20);
    expect(result).toEqual({ status: 'closed_with_pending_work', activeCount: 1 });
    expect(worker.isClosed).toBe(true);
    // Toujours "processing" dans le store — jamais perdu, repris par recoverAfterRestart.
    expect(store.getRow('stuck')?.status).toBe('processing');
    store.close();
  });

  it('admit() après close() → closed, jamais admis', async () => {
    const { worker } = buildWorker();
    await worker.close();
    const outcome = worker.admit(
      buildMessageEvent({ id: 'after-close', senderId: AUTHORIZED_SENDER_ID }),
    );
    expect(outcome).toEqual({ kind: 'closed' });
  });

  it("close(timeoutMs) pendant un ENVOI bloqué : même garantie — le travail reste 'sending', jamais perdu", async () => {
    const neverSending: OutboundTransport = {
      async send(): Promise<TransportResult> {
        return new Promise<never>(() => {});
      },
    };
    const { worker, store } = buildWorker({ transport: neverSending });
    worker.admit(buildMessageEvent({ id: 'stuck-send', senderId: AUTHORIZED_SENDER_ID }));
    // Attend l'état réel « sending » (envoi démarré, jamais résolu) plutôt
    // qu'un délai deviné — la génération, elle, se termine normalement.
    await waitForStatus(store, 'stuck-send', 'sending');

    const result = await worker.close(20);
    expect(result).toEqual({ status: 'closed_with_pending_work', activeCount: 1 });
    expect(store.getRow('stuck-send')?.status).toBe('sending');
    store.close();
  });

  it("le store n'est jamais fermé explicitement tant que worker.close() rapporte du travail pendant — le verrou SQLite reste détenu (reproduit l'invariant de main.ts)", async () => {
    const neverResolving: ConversationalService = {
      async reply(): Promise<never> {
        return new Promise<never>(() => {});
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-worker-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'messages.db');
    const store = SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' });
    const worker = new DurableMessageWorker({
      store,
      allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
      conversationalService: neverResolving,
      transport: new SimulatedOutboundTransport(),
      maxConcurrency: 1,
    });
    worker.admit(buildMessageEvent({ id: 'pending', senderId: AUTHORIZED_SENDER_ID }));

    const result = await worker.close(20);
    expect(result.status).toBe('closed_with_pending_work');
    // Reproduit exactement la décision de `main.ts` : ne JAMAIS appeler
    // `store.close()` ici — le verrou doit donc rester détenu, preuve
    // qu'une seconde ouverture échoue toujours.
    expect(() => SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      ExclusivityError,
    );
    // Le process réel se terminerait ici (`process.exit(1)`) ; dans ce
    // test, on ferme explicitement pour permettre le nettoyage du répertoire.
    store.close();
  });
});

describe('DurableMessageWorker — priorité response_ready sur queued', () => {
  it('un response_ready en attente est envoyé avant qu’un nouveau queued ne commence sa génération', async () => {
    const slowGeneration = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 20);
    const { worker, store } = buildWorker({
      maxConcurrency: 1,
      conversationalService: slowGeneration,
    });

    // Prépare directement un `response_ready` déjà présent (simule une reprise).
    store.admit({
      providerMessageId: 'ready-1',
      senderId: AUTHORIZED_SENDER_ID,
      text: 'x',
      now: new Date().toISOString(),
    });
    const claimed = store.claimNextQueued(new Date().toISOString())!;
    store.recordResponseReady(
      claimed.providerMessageId,
      'réponse déjà prête',
      new Date().toISOString(),
    );

    // Un nouveau message arrive en même temps — avec maxConcurrency=1, le
    // scheduler doit préférer vider "ready-1" (déjà proche du terme) avant
    // de démarrer la génération lente du nouveau message.
    worker.admit(buildMessageEvent({ id: 'new-1', senderId: AUTHORIZED_SENDER_ID }));
    worker.start();

    await worker.drain();
    expect(store.getRow('ready-1')?.status).toBe('sent');
    expect(store.getRow('new-1')?.status).toBe('sent');
    store.close();
  });
});

describe('DurableMessageWorker — relivraison : compte des appels service/transport', () => {
  it("après un REJET D'ENVOI certain, une relivraison réutilise la réponse déjà générée — le service conversationnel n'est rappelé AUCUNE fois", async () => {
    const service = new ScriptedConversationalService({ status: 'ok', text: 'réponse unique' });
    const rejectingTransport = new SimulatedOutboundTransport({
      status: 'error',
      reason: 'rejet 4xx',
    });
    const { worker, store } = buildWorker({
      conversationalService: service,
      transport: rejectingTransport,
    });

    worker.admit(buildMessageEvent({ id: 'send-reject', senderId: AUTHORIZED_SENDER_ID }));
    await worker.drain();
    expect(store.getRow('send-reject')?.status).toBe('failed');
    expect(service.receivedCalls).toHaveLength(1);
    expect(rejectingTransport.sentMessages).toHaveLength(1);

    // Relivraison : réouverture directe en `response_ready` (réponse déjà
    // générée réutilisée) — AUCUN nouvel appel au service conversationnel,
    // mais une nouvelle tentative d'envoi.
    worker.admit(buildMessageEvent({ id: 'send-reject', senderId: AUTHORIZED_SENDER_ID }));
    await worker.drain();
    expect(service.receivedCalls).toHaveLength(1); // toujours 1 — jamais régénéré
    expect(rejectingTransport.sentMessages).toHaveLength(2); // nouvelle tentative d'envoi
    expect(rejectingTransport.sentMessages[1]).toEqual({
      recipientId: AUTHORIZED_SENDER_ID,
      text: 'réponse unique',
    });
    store.close();
  });

  it('après une erreur de GÉNÉRATION certaine, une relivraison appelle bien le service conversationnel à nouveau (rien à réutiliser)', async () => {
    const service = new ScriptedConversationalService({ status: 'error', reason: 'panne' });
    const transport = new SimulatedOutboundTransport();
    const { worker, store } = buildWorker({ conversationalService: service, transport });

    worker.admit(buildMessageEvent({ id: 'gen-fail', senderId: AUTHORIZED_SENDER_ID }));
    await worker.drain();
    expect(store.getRow('gen-fail')?.status).toBe('failed');
    expect(service.receivedCalls).toHaveLength(1);

    worker.admit(buildMessageEvent({ id: 'gen-fail', senderId: AUTHORIZED_SENDER_ID }));
    await worker.drain();
    expect(service.receivedCalls).toHaveLength(2); // régénération nécessaire, appelé à nouveau
    expect(transport.sentMessages).toHaveLength(0); // jamais atteint l'envoi
    store.close();
  });

  it("après TIMEOUT/rupture/exception pendant l'envoi (uncertain), AUCUNE relivraison ne redéclenche quoi que ce soit — ni service ni transport", async () => {
    const service = new ScriptedConversationalService({ status: 'ok', text: 'x' });
    const uncertainTransport = new SimulatedOutboundTransport({
      status: 'uncertain',
      reason: 'timeout',
    });
    const { worker, store } = buildWorker({
      conversationalService: service,
      transport: uncertainTransport,
    });

    worker.admit(buildMessageEvent({ id: 'uncertain-case', senderId: AUTHORIZED_SENDER_ID }));
    await worker.drain();
    expect(store.getRow('uncertain-case')?.status).toBe('uncertain');
    expect(service.receivedCalls).toHaveLength(1);
    expect(uncertainTransport.sentMessages).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      worker.admit(buildMessageEvent({ id: 'uncertain-case', senderId: AUTHORIZED_SENDER_ID }));
      await worker.drain();
    }
    // Ni le service ni le transport ne sont jamais rappelés pour ce message.
    expect(service.receivedCalls).toHaveLength(1);
    expect(uncertainTransport.sentMessages).toHaveLength(1);
    expect(store.getRow('uncertain-case')?.status).toBe('uncertain');
    store.close();
  });

  it("un rejet d'envoi PERMANENT (toujours 4xx) est borné par maxAdmissionAttempts : pas une boucle de tentatives, même redélivré indéfiniment", async () => {
    const service = new ScriptedConversationalService({ status: 'ok', text: 'réponse' });
    const alwaysRejecting = new SimulatedOutboundTransport({
      status: 'error',
      reason: 'numéro invalide',
    });
    const dir = mkdtempSync(join(tmpdir(), 'whatsapp-worker-'));
    tempDirs.push(dir);
    const store = SqliteMessageStore.open({
      filePath: join(dir, 'messages.db'),
      mode: 'simulated',
      maxAdmissionAttempts: 3,
    });
    const worker = new DurableMessageWorker({
      store,
      allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
      conversationalService: service,
      transport: alwaysRejecting,
      maxConcurrency: 1,
    });

    // Dix "redélivraisons" du fournisseur — bien plus que maxAdmissionAttempts.
    for (let i = 0; i < 10; i++) {
      worker.admit(buildMessageEvent({ id: 'permanent-reject', senderId: AUTHORIZED_SENDER_ID }));
      await worker.drain();
    }

    expect(store.getRow('permanent-reject')?.status).toBe('failed');
    // 1 génération initiale + 3 réouvertures (maxAdmissionAttempts) = 4 tentatives d'envoi, jamais 10.
    expect(alwaysRejecting.sentMessages.length).toBeLessThanOrEqual(4);
    expect(service.receivedCalls).toHaveLength(1); // réponse générée une seule fois, toujours réutilisée
    store.close();
  });
});
