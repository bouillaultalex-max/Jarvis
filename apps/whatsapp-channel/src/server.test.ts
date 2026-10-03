import { describe, expect, it } from 'vitest';

import { buildLocalSyntheticConfig, LOCAL_BODY_LIMIT_BYTES } from './config.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import { InMemoryDeduplicator } from './in-memory-deduplicator.js';
import { LocalMessageQueue } from './local-message-queue.js';
import { buildWhatsAppChannelServer, type BuildWhatsAppChannelServerOptions } from './server.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import { HmacSha256SignatureVerifier } from './webhook-signature.js';
import {
  AUTHORIZED_SENDER_ID,
  ScriptedConversationalService,
  TEST_APP_SECRET,
  TEST_VERIFY_TOKEN,
  UNAUTHORIZED_SENDER_ID,
  badPrefixRequest,
  buildGroupMessagePayload,
  buildMultiMessagePayload,
  buildStatusPayload,
  buildTextMessagePayload,
  buildUnsupportedTypePayload,
  malformedJsonRequest,
  oversizedRequest,
  signedRequest,
  structurallyInvalidRequest,
  tamperedRequest,
  unsignedRequest,
  wrongLengthSignatureRequest,
} from './testing/fixtures.js';

const WEBHOOK_PATH = '/webhooks/whatsapp';

interface Harness {
  readonly app: ReturnType<typeof buildWhatsAppChannelServer>;
  readonly queue: LocalMessageQueue;
  readonly transport: SimulatedOutboundTransport;
  readonly conversationalService: ScriptedConversationalService;
}

function buildHarness(
  overrides: {
    readonly maxQueueSize?: number;
    readonly maxConcurrency?: number;
    readonly conversationalService?: ScriptedConversationalService;
    readonly bodyLimitBytes?: BuildWhatsAppChannelServerOptions['bodyLimitBytes'];
  } = {},
): Harness {
  const config = buildLocalSyntheticConfig({
    appSecret: TEST_APP_SECRET,
    verifyToken: TEST_VERIFY_TOKEN,
    allowedSenderId: AUTHORIZED_SENDER_ID,
  });
  const transport = new SimulatedOutboundTransport();
  const conversationalService =
    overrides.conversationalService ?? new ScriptedConversationalService();
  const allowlist = new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID]));

  const queue = new LocalMessageQueue({
    deduplicator: new InMemoryDeduplicator(),
    allowlist,
    conversationalService,
    transport,
    maxQueueSize: overrides.maxQueueSize ?? 10,
    maxConcurrency: overrides.maxConcurrency ?? 4,
  });

  const app = buildWhatsAppChannelServer({
    config,
    allowlist,
    signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
    queue,
    bodyLimitBytes: overrides.bodyLimitBytes,
  });

  return { app, queue, transport, conversationalService };
}

describe('GET /webhooks/whatsapp — handshake', () => {
  it('mode/jeton/challenge corrects → 200, renvoie le challenge tel quel', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'GET',
      url: `${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=123456`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('123456');
  });

  it('jeton incorrect → 403', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'GET',
      url: `${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=mauvais&hub.challenge=123456`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('jeton incorrect → le corps de la réponse 403 ne divulgue jamais le jeton configuré', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'GET',
      url: `${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=mauvais&hub.challenge=123456`,
    });
    expect(res.body).not.toContain(TEST_VERIFY_TOKEN);
  });
});

describe("POST /webhooks/whatsapp — parcours nominal jusqu'à la réponse simulée", () => {
  it('message signé, expéditeur autorisé → 200 accepted, puis réponse envoyée via le transport simulé après drain', async () => {
    const { app, queue, transport, conversationalService } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.1',
      from: AUTHORIZED_SENDER_ID,
      body: 'Bonjour Jarvis',
    });
    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'accepted',
      admissions: [{ eventId: 'wamid.1', kind: 'queued' }],
    });
    // Pas encore traité au moment de la réponse HTTP (voir test suivant pour
    // la preuve stricte de non-blocage) :
    await queue.drain();
    expect(transport.sentMessages).toEqual([
      { recipientId: AUTHORIZED_SENDER_ID, text: 'réponse simulée' },
    ]);
    expect(conversationalService.receivedCalls).toEqual([
      { senderId: AUTHORIZED_SENDER_ID, text: 'Bonjour Jarvis' },
    ]);
  });

  it("l'accusé HTTP revient avant la résolution d'un service conversationnel volontairement lenti", async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 40);
    const { app, queue } = buildHarness({ conversationalService: slow });
    const payload = buildTextMessagePayload({
      id: 'wamid.slow',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });

    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });

    expect(res.statusCode).toBe(200);
    // Le service a été invoqué (admission effective) mais n'a pas encore
    // résolu : la route n'a pas attendu le délai de 40ms.
    expect(queue.getOutcome('wamid.slow')).toBeUndefined();
    await queue.drain();
    expect(queue.getOutcome('wamid.slow')).toEqual({ status: 'replied' });
  });
});

describe('POST /webhooks/whatsapp — signature', () => {
  it('absente → 403, jamais admise', async () => {
    const { app, queue } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.2',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...unsignedRequest(payload),
    });
    expect(res.statusCode).toBe(403);
    expect(queue.getOutcome('wamid.2')).toBeUndefined();
  });

  it('corps altéré après signature → 403', async () => {
    const { app } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.3',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...tamperedRequest(payload),
    });
    expect(res.statusCode).toBe(403);
  });

  it('préfixe « sha256= » absent → 403', async () => {
    const { app } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.4',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...badPrefixRequest(payload),
    });
    expect(res.statusCode).toBe(403);
  });

  it('longueur de signature incorrecte → 403', async () => {
    const { app } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.5',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...wrongLengthSignatureRequest(payload),
    });
    expect(res.statusCode).toBe(403);
  });

  it('signature invalide → le corps de la réponse 403 ne divulgue jamais le secret configuré ni une signature calculée', async () => {
    const { app } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.leak',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...unsignedRequest(payload),
    });
    expect(res.body).not.toContain(TEST_APP_SECRET);
    expect(res.body).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('POST /webhooks/whatsapp — corps invalide après signature valide', () => {
  it('JSON syntaxiquement invalide → 400, jamais un événement vide accepté', async () => {
    const { app } = buildHarness();
    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...malformedJsonRequest() });
    expect(res.statusCode).toBe(400);
    expect(res.json().status).toBe('malformed_body');
  });

  it('enveloppe structurellement invalide (« entry » absent) → 400', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...structurallyInvalidRequest({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('taille excessive → 413', async () => {
    const { app } = buildHarness({ bodyLimitBytes: 1024 });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...oversizedRequest(4096),
    });
    expect(res.statusCode).toBe(413);
  });

  it('la limite de corps par défaut est un choix applicatif documenté, pas une valeur Meta', () => {
    expect(LOCAL_BODY_LIMIT_BYTES).toBeGreaterThan(0);
  });
});

describe('POST /webhooks/whatsapp — expéditeur refusé, statuts et types ignorés', () => {
  it('expéditeur non autorisé → 200, ignored_unauthorized, aucun envoi', async () => {
    const { app, transport } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.unauth',
      from: UNAUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'accepted',
      admissions: [{ eventId: 'wamid.unauth', kind: 'ignored_unauthorized' }],
    });
    expect(transport.sentMessages).toHaveLength(0);
  });

  it('un expéditeur non autorisé ne consomme jamais la capacité de la file — filtré avant admission', async () => {
    // Capacité à 1 : si le message refusé consommait une place, le message
    // autorisé suivant serait rejeté par capacité au lieu d'être admis.
    const { app, queue } = buildHarness({ maxQueueSize: 1, maxConcurrency: 1 });
    const refused = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.refused', from: UNAUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(refused.json().admissions[0].kind).toBe('ignored_unauthorized');
    expect(queue.pendingCount).toBe(0);
    expect(queue.activeCount).toBe(0);

    const authorized = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.authorized', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().admissions[0].kind).toBe('queued');
    await queue.drain();
  });

  it('notification de statut → 200, ignored_status, jamais mise en file', async () => {
    const { app, queue } = buildHarness();
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(buildStatusPayload('status-1')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'accepted',
      admissions: [{ eventId: 'status-1', kind: 'ignored_status' }],
    });
    expect(queue.pendingCount).toBe(0);
    expect(queue.activeCount).toBe(0);
  });

  it('type non supporté → 200, ignored_unsupported avec motif', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildUnsupportedTypePayload({ id: 'wamid.img', from: AUTHORIZED_SENDER_ID }),
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().admissions[0].kind).toBe('ignored_unsupported');
  });

  it('message de groupe (group_id) → 200, ignored_unsupported', async () => {
    const { app } = buildHarness();
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildGroupMessagePayload({
          id: 'wamid.group',
          from: AUTHORIZED_SENDER_ID,
          groupId: '123@g.us',
          body: 'x',
        }),
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().admissions[0].kind).toBe('ignored_unsupported');
  });
});

describe('POST /webhooks/whatsapp — doublons séquentiels et concurrents', () => {
  it('même identifiant, deux requêtes séquentielles après succès → la 2e est un doublon', async () => {
    const { app, queue } = buildHarness();
    const req = {
      method: 'POST' as const,
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.dup', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    };

    const first = await app.inject(req);
    expect(first.json().admissions[0].kind).toBe('queued');
    await queue.drain();

    const second = await app.inject(req);
    expect(second.statusCode).toBe(200);
    expect(second.json().admissions[0].kind).toBe('duplicate');
  });

  it('deux requêtes concurrentes avec le même identifiant → une seule admise', async () => {
    const { app, queue, transport } = buildHarness();
    const req = {
      method: 'POST' as const,
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.race', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    };

    const [first, second] = await Promise.all([app.inject(req), app.inject(req)]);
    const kinds = [first.json().admissions[0].kind, second.json().admissions[0].kind].sort();
    expect(kinds).toEqual(['duplicate', 'queued']);

    await queue.drain();
    expect(transport.sentMessages).toHaveLength(1);
  });
});

describe('POST /webhooks/whatsapp — saturation et relivraison', () => {
  it('événement multi-messages, capacité insuffisante pour le second → 503, le premier reste admis', async () => {
    const { app, queue } = buildHarness({ maxQueueSize: 1, maxConcurrency: 1 });
    const payload = buildMultiMessagePayload([
      { id: 'wamid.m1', from: AUTHORIZED_SENDER_ID, body: 'premier' },
      { id: 'wamid.m2', from: AUTHORIZED_SENDER_ID, body: 'second' },
    ]);

    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'queue_full',
      admissions: [
        { eventId: 'wamid.m1', kind: 'queued' },
        { eventId: 'wamid.m2', kind: 'rejected_capacity' },
      ],
    });
    await queue.drain();
  });

  it("une relivraison du même lot n'admet que les messages pas encore admis — aucune duplication des déjà-admis", async () => {
    const { app, queue, transport } = buildHarness({ maxQueueSize: 1, maxConcurrency: 1 });
    const payload = buildMultiMessagePayload([
      { id: 'wamid.r1', from: AUTHORIZED_SENDER_ID, body: 'premier' },
      { id: 'wamid.r2', from: AUTHORIZED_SENDER_ID, body: 'second' },
    ]);
    const request = { method: 'POST' as const, url: WEBHOOK_PATH, ...signedRequest(payload) };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(503);
    await queue.drain(); // le premier message a eu le temps d'être traité et libère la capacité

    const retry = await app.inject(request);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({
      status: 'accepted',
      admissions: [
        { eventId: 'wamid.r1', kind: 'duplicate' }, // déjà traité, pas redupliqué
        { eventId: 'wamid.r2', kind: 'queued' }, // pas encore traité, admis cette fois
      ],
    });
    await queue.drain();
    // Un seul envoi pour wamid.r1 malgré la relivraison du lot.
    expect(transport.sentMessages.filter((m) => m.text === 'réponse simulée')).toHaveLength(2);
  });
});

describe('POST /webhooks/whatsapp — erreur conversationnelle et transport', () => {
  it('erreur structurée du service conversationnel → admis, puis conversational_service_error après drain', async () => {
    const failing = new ScriptedConversationalService({ status: 'error', reason: 'panne' });
    const { app, queue } = buildHarness({ conversationalService: failing });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.svcerr', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(res.statusCode).toBe(200);
    await queue.drain();
    expect(queue.getOutcome('wamid.svcerr')).toEqual({
      status: 'conversational_service_error',
      reason: 'panne',
    });
  });

  it('erreur du transport → admis, puis transport_error après drain', async () => {
    // Transport en échec pour ce test : harnais dédié plutôt que de muter
    // le transport simulé du harnais par défaut.
    const config = buildLocalSyntheticConfig({
      appSecret: TEST_APP_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
    });
    const allowlist = new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID]));
    const failingTransport = new SimulatedOutboundTransport({
      status: 'error',
      reason: 'injoignable',
    });
    const dedicatedQueue = new LocalMessageQueue({
      deduplicator: new InMemoryDeduplicator(),
      allowlist,
      conversationalService: new ScriptedConversationalService(),
      transport: failingTransport,
      maxQueueSize: 10,
      maxConcurrency: 4,
    });
    const dedicatedApp = buildWhatsAppChannelServer({
      config,
      allowlist,
      signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
      queue: dedicatedQueue,
    });

    const res = await dedicatedApp.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.txerr', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(res.statusCode).toBe(200);
    await dedicatedQueue.drain();
    expect(dedicatedQueue.getOutcome('wamid.txerr')).toEqual({
      status: 'transport_error',
      reason: 'injoignable',
    });
  });
});

describe('fermeture — serveur et worker', () => {
  it('app.close() puis queue.close() : plus aucune requête acceptée, travail déjà admis terminé', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 15);
    const { app, queue } = buildHarness({ conversationalService: slow });

    await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.close', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });

    await app.close();
    await queue.close();

    expect(queue.isClosed).toBe(true);
    expect(queue.getOutcome('wamid.close')).toEqual({ status: 'replied' });
  });

  it('un message POSTé après la fermeture de la file est refusé (503), jamais silencieusement accepté', async () => {
    const { app, queue } = buildHarness();
    await queue.close();

    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.after-close', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'queue_full',
      admissions: [{ eventId: 'wamid.after-close', kind: 'closed' }],
    });
  });
});
