import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildLocalSyntheticConfig, LOCAL_BODY_LIMIT_BYTES } from './config.js';
import { DurableMessageWorker } from './durable-message-worker.js';
import { InMemoryAllowlist } from './in-memory-allowlist.js';
import type { MessageStore } from './message-store.js';
import { buildWhatsAppChannelServer, type BuildWhatsAppChannelServerOptions } from './server.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
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

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

interface Harness {
  readonly app: ReturnType<typeof buildWhatsAppChannelServer>;
  readonly store: SqliteMessageStore;
  readonly worker: DurableMessageWorker;
  readonly transport: SimulatedOutboundTransport;
  readonly conversationalService: ScriptedConversationalService;
}

/** `status`/`lastError` persistés — remplace l'ancien `queue.getOutcome(id)` en mémoire. */
function rowState(
  store: MessageStore,
  id: string,
): { status: string; lastError: string | null } | undefined {
  const row = store.getRow(id);
  return row === undefined ? undefined : { status: row.status, lastError: row.lastError };
}

function buildHarness(
  overrides: {
    readonly maxActiveDepth?: number;
    readonly maxConcurrency?: number;
    readonly conversationalService?: ScriptedConversationalService;
    readonly transport?: SimulatedOutboundTransport;
    readonly bodyLimitBytes?: BuildWhatsAppChannelServerOptions['bodyLimitBytes'];
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'whatsapp-server-'));
  tempDirs.push(dir);

  const config = buildLocalSyntheticConfig({
    appSecret: TEST_APP_SECRET,
    verifyToken: TEST_VERIFY_TOKEN,
    allowedSenderId: AUTHORIZED_SENDER_ID,
  });
  const transport = overrides.transport ?? new SimulatedOutboundTransport();
  const conversationalService =
    overrides.conversationalService ?? new ScriptedConversationalService();
  const allowlist = new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID]));

  const store = SqliteMessageStore.open({
    filePath: join(dir, 'messages.db'),
    mode: 'simulated',
    maxActiveDepth: overrides.maxActiveDepth ?? 10,
  });

  const worker = new DurableMessageWorker({
    store,
    allowlist,
    conversationalService,
    transport,
    maxConcurrency: overrides.maxConcurrency ?? 4,
  });

  const app = buildWhatsAppChannelServer({
    config,
    allowlist,
    signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
    worker,
    bodyLimitBytes: overrides.bodyLimitBytes,
  });

  return { app, store, worker, transport, conversationalService };
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
    const { app, worker, transport, conversationalService } = buildHarness();
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
    await worker.drain();
    expect(transport.sentMessages).toEqual([
      { recipientId: AUTHORIZED_SENDER_ID, text: 'réponse simulée' },
    ]);
    expect(conversationalService.receivedCalls).toEqual([
      { senderId: AUTHORIZED_SENDER_ID, text: 'Bonjour Jarvis' },
    ]);
  });

  it("l'accusé HTTP revient avant la résolution d'un service conversationnel volontairement lent", async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 40);
    const { app, store, worker } = buildHarness({ conversationalService: slow });
    const payload = buildTextMessagePayload({
      id: 'wamid.slow',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });

    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });

    expect(res.statusCode).toBe(200);
    // Le service a été invoqué (admission effective) mais n'a pas encore
    // résolu : la route n'a pas attendu le délai de 40ms.
    expect(store.getRow('wamid.slow')?.status).not.toBe('sent');
    await worker.drain();
    expect(store.getRow('wamid.slow')?.status).toBe('sent');
  });
});

describe('POST /webhooks/whatsapp — signature', () => {
  it('absente → 403, jamais admise', async () => {
    const { app, store } = buildHarness();
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
    expect(store.getRow('wamid.2')).toBeUndefined();
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

  it('un expéditeur non autorisé ne consomme jamais la capacité du store — filtré avant admission', async () => {
    // Capacité à 1 : si le message refusé consommait une place, le message
    // autorisé suivant serait rejeté par capacité au lieu d'être admis.
    const { app, store, worker } = buildHarness({ maxActiveDepth: 1 });
    const refused = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.refused', from: UNAUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(refused.json().admissions[0].kind).toBe('ignored_unauthorized');
    expect(store.countActive()).toBe(0);

    const authorized = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.authorized', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().admissions[0].kind).toBe('queued');
    await worker.drain();
  });

  it('notification de statut → 200, ignored_status, jamais mise en file', async () => {
    const { app, store } = buildHarness();
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
    expect(store.countActive()).toBe(0);
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

describe('POST /webhooks/whatsapp — doublons séquentiels, concurrents et au contenu divergent', () => {
  it('même identifiant, deux requêtes séquentielles après succès → la 2e est un doublon', async () => {
    const { app, worker } = buildHarness();
    const req = {
      method: 'POST' as const,
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.dup', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    };

    const first = await app.inject(req);
    expect(first.json().admissions[0].kind).toBe('queued');
    await worker.drain();

    const second = await app.inject(req);
    expect(second.statusCode).toBe(200);
    expect(second.json().admissions[0].kind).toBe('duplicate');
  });

  it('deux requêtes concurrentes avec le même identifiant → une seule admise', async () => {
    const { app, worker, transport } = buildHarness();
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

    await worker.drain();
    expect(transport.sentMessages).toHaveLength(1);
  });

  it('même identifiant relivré avec un texte différent → admis/dupliqué quand même, mais signalé (content_mismatch_kept_original), texte original conservé', async () => {
    const { app, store, worker } = buildHarness();
    const first = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({
          id: 'wamid.diverge',
          from: AUTHORIZED_SENDER_ID,
          body: 'texte original',
        }),
      ),
    });
    expect(first.json().admissions[0].kind).toBe('queued');
    await worker.drain();

    const second = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({
          id: 'wamid.diverge',
          from: AUTHORIZED_SENDER_ID,
          body: 'texte différent',
        }),
      ),
    });
    expect(second.json().admissions[0]).toEqual({
      eventId: 'wamid.diverge',
      kind: 'duplicate',
      reason: 'content_mismatch_kept_original',
    });
    expect(store.getRow('wamid.diverge')?.text).toBe('texte original');
  });
});

describe('POST /webhooks/whatsapp — texte trop long (limite applicative, pas Meta)', () => {
  it('texte au-delà de la limite → 200, rejected_text_too_long, jamais mis en file, jamais de pression de relivraison', async () => {
    const { app, store, transport } = buildHarness();
    const payload = buildTextMessagePayload({
      id: 'wamid.toolong',
      from: AUTHORIZED_SENDER_ID,
      body: 'x'.repeat(5000),
    });
    const res = await app.inject({ method: 'POST', url: WEBHOOK_PATH, ...signedRequest(payload) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'accepted',
      admissions: [{ eventId: 'wamid.toolong', kind: 'rejected_text_too_long' }],
    });
    expect(store.getRow('wamid.toolong')).toBeUndefined();
    expect(transport.sentMessages).toHaveLength(0);
  });
});

describe('POST /webhooks/whatsapp — saturation et relivraison', () => {
  it('événement multi-messages, capacité insuffisante pour le second → 503, le premier reste admis', async () => {
    const { app, worker } = buildHarness({ maxActiveDepth: 1 });
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
    await worker.drain();
  });

  it("une relivraison du même lot n'admet que les messages pas encore admis — aucune duplication des déjà-admis", async () => {
    const { app, worker, transport } = buildHarness({ maxActiveDepth: 1 });
    const payload = buildMultiMessagePayload([
      { id: 'wamid.r1', from: AUTHORIZED_SENDER_ID, body: 'premier' },
      { id: 'wamid.r2', from: AUTHORIZED_SENDER_ID, body: 'second' },
    ]);
    const request = { method: 'POST' as const, url: WEBHOOK_PATH, ...signedRequest(payload) };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(503);
    await worker.drain(); // le premier message a eu le temps d'être traité et libère la capacité

    const retry = await app.inject(request);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({
      status: 'accepted',
      admissions: [
        { eventId: 'wamid.r1', kind: 'duplicate' }, // déjà traité, pas redupliqué
        { eventId: 'wamid.r2', kind: 'queued' }, // pas encore traité, admis cette fois
      ],
    });
    await worker.drain();
    // Un seul envoi pour wamid.r1 malgré la relivraison du lot.
    expect(transport.sentMessages.filter((m) => m.text === 'réponse simulée')).toHaveLength(2);
  });
});

describe('POST /webhooks/whatsapp — erreur conversationnelle et transport', () => {
  it('erreur structurée du service conversationnel → admis, puis failed après drain (échec démontré sans envoi)', async () => {
    const failing = new ScriptedConversationalService({ status: 'error', reason: 'panne' });
    const { app, store, worker } = buildHarness({ conversationalService: failing });
    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.svcerr', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(res.statusCode).toBe(200);
    await worker.drain();
    expect(rowState(store, 'wamid.svcerr')).toEqual({ status: 'failed', lastError: 'panne' });
  });

  it('erreur du transport (4xx explicite, démontré) → admis, puis failed après drain', async () => {
    const failingTransport = new SimulatedOutboundTransport({
      status: 'error',
      reason: 'injoignable',
    });
    const { app, store, worker } = buildHarness({ transport: failingTransport });

    const res = await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.txerr', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });
    expect(res.statusCode).toBe(200);
    await worker.drain();
    expect(rowState(store, 'wamid.txerr')).toEqual({ status: 'failed', lastError: 'injoignable' });
  });

  it("issue incertaine du transport → admis, outcome 'uncertain', relivraison immédiate du même id jamais relancée", async () => {
    const uncertainTransport = new SimulatedOutboundTransport({
      status: 'uncertain',
      reason: 'délai dépassé',
    });
    const { app, store, worker } = buildHarness({ transport: uncertainTransport });
    const request = {
      method: 'POST' as const,
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.uncertain', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    await worker.drain();
    expect(rowState(store, 'wamid.uncertain')).toEqual({
      status: 'uncertain',
      lastError: 'délai dépassé',
    });

    // Une relivraison WhatsApp immédiate du même message n'est pas
    // retraitée automatiquement : elle est vue comme un doublon, pas un
    // essai neuf — évite un double envoi si le message avait en réalité
    // été délivré. Jamais un blocage « définitif » au sens absolu — voir
    // `sqlite-message-store.test.ts` pour les bornes de capacité/rétention.
    const retry = await app.inject(request);
    expect(retry.json().admissions[0].kind).toBe('duplicate');
  });
});

describe('POST /webhooks/whatsapp — erreur de stockage pendant l’admission', () => {
  it("le store lève pendant l'admission → jamais un 200, 503 explicite, événement marqué storage_error", async () => {
    const { app } = buildHarness();
    // On remplace le worker interne par un double dont le store échoue
    // systématiquement — reproduit le contrat exigé (ADR-0023 § admission)
    // sans dépendre d'un mécanisme bas niveau spécifique à SQLite.
    const throwingStore: Pick<MessageStore, 'admit'> = {
      admit() {
        throw new Error('disque indisponible (simulé)');
      },
    };
    const allowlist = new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID]));
    const worker = new DurableMessageWorker({
      store: throwingStore as MessageStore,
      allowlist,
      conversationalService: new ScriptedConversationalService(),
      transport: new SimulatedOutboundTransport(),
      maxConcurrency: 1,
    });
    const config = buildLocalSyntheticConfig({
      appSecret: TEST_APP_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
      allowedSenderId: AUTHORIZED_SENDER_ID,
    });
    const dedicatedApp = buildWhatsAppChannelServer({
      config,
      allowlist,
      signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
      worker,
    });

    const res = await dedicatedApp.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.storage-err', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().admissions[0].kind).toBe('storage_error');
    void app; // harnais par défaut non utilisé dans ce test, construit pour la cohérence du fichier
  });
});

describe('POST /webhooks/whatsapp — exception inattendue (hors du try/catch d’admission)', () => {
  it('une exception inattendue (ex. allowlist.isAuthorized qui lève) → 500 générique, jamais err.message/pile/secret dans la réponse', async () => {
    const secretLookingMessage = 'app-secret-should-never-leak-in-response';
    const throwingAllowlist = {
      isAuthorized(): boolean {
        throw new Error(secretLookingMessage);
      },
    };
    const config = buildLocalSyntheticConfig({
      appSecret: TEST_APP_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
      allowedSenderId: AUTHORIZED_SENDER_ID,
    });
    const worker = new DurableMessageWorker({
      store: {} as MessageStore, // jamais atteint — l'exception survient avant
      allowlist: throwingAllowlist,
      conversationalService: new ScriptedConversationalService(),
      transport: new SimulatedOutboundTransport(),
      maxConcurrency: 1,
    });
    const dedicatedApp = buildWhatsAppChannelServer({
      config,
      allowlist: throwingAllowlist,
      signatureVerifier: new HmacSha256SignatureVerifier(config.appSecret),
      worker,
    });

    const res = await dedicatedApp.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.unexpected', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ status: 'internal_error' });
    expect(res.body).not.toContain(secretLookingMessage);
    expect(res.body).not.toContain(TEST_APP_SECRET);
    expect(res.body.toLowerCase()).not.toContain('.ts:'); // aucune pile/référence de fichier
  });
});

describe('fermeture — serveur et worker', () => {
  it('app.close() puis worker.close() : plus aucune requête acceptée, travail déjà admis terminé', async () => {
    const slow = new ScriptedConversationalService({ status: 'ok', text: 'ok' }, 15);
    const { app, store, worker } = buildHarness({ conversationalService: slow });

    await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      ...signedRequest(
        buildTextMessagePayload({ id: 'wamid.close', from: AUTHORIZED_SENDER_ID, body: 'x' }),
      ),
    });

    await app.close();
    await worker.close();

    expect(worker.isClosed).toBe(true);
    expect(store.getRow('wamid.close')?.status).toBe('sent');
  });

  it('un message POSTé après la fermeture du worker est refusé (503), jamais silencieusement accepté', async () => {
    const { app, worker } = buildHarness();
    await worker.close();

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
