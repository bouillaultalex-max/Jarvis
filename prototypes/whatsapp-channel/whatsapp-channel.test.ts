/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md`.
 * Aucun réseau, aucun secret réel, aucune connexion Meta. Toutes les
 * requêtes sont construites localement par `fixtures.ts`.
 */
import { describe, expect, it } from 'vitest';

import { handleWhatsAppWebhookPost } from './whatsapp-channel.js';
import { handleWhatsAppHandshake } from './whatsapp-webhook-adapter.js';
import { HmacSha256SignatureVerifier } from './webhook-signature.js';
import { processChannelEvent } from './channel-processor.js';
import {
  AUTHORIZED_SENDER_ID,
  FakeConversationalService,
  FakeTransport,
  InMemoryAllowlist,
  InMemoryDeduplicator,
  TEST_APP_SECRET,
  UNAUTHORIZED_SENDER_ID,
  buildBadPrefixRequest,
  buildGroupMessagePayload,
  buildMalformedJsonRequest,
  buildMultiMessagePayload,
  buildSignedRequest,
  buildStatusPayload,
  buildStructurallyInvalidRequest,
  buildTamperedRequest,
  buildTextMessagePayload,
  buildUnsignedRequest,
  buildUnsupportedTypePayload,
  buildWrongLengthSignatureRequest,
} from './fixtures.js';

function buildDeps(overrides: Partial<Parameters<typeof handleWhatsAppWebhookPost>[1]> = {}) {
  return {
    signatureVerifier: new HmacSha256SignatureVerifier(TEST_APP_SECRET),
    allowlist: new InMemoryAllowlist(new Set([AUTHORIZED_SENDER_ID])),
    deduplicator: new InMemoryDeduplicator(),
    conversationalService: new FakeConversationalService(),
    transport: new FakeTransport(),
    ...overrides,
  };
}

describe('handshake — hub.mode / hub.verify_token / hub.challenge', () => {
  it('mode, jeton et challenge corrects → ok, renvoie le challenge tel quel', () => {
    const result = handleWhatsAppHandshake(
      { mode: 'subscribe', verifyToken: 'le-bon-jeton', challenge: '123456' },
      'le-bon-jeton',
    );
    expect(result).toEqual({ status: 'ok', challenge: '123456' });
  });

  it('jeton incorrect → rejeté, aucun challenge renvoyé', () => {
    const result = handleWhatsAppHandshake(
      { mode: 'subscribe', verifyToken: 'mauvais-jeton', challenge: '123456' },
      'le-bon-jeton',
    );
    expect(result.status).toBe('rejected');
  });

  it('mode différent de « subscribe » → rejeté', () => {
    const result = handleWhatsAppHandshake(
      { mode: 'unsubscribe', verifyToken: 'le-bon-jeton', challenge: '123456' },
      'le-bon-jeton',
    );
    expect(result.status).toBe('rejected');
  });
});

describe('signature — vérification sur les octets bruts, avant parsing', () => {
  it('signature valide, expéditeur autorisé → traité, une réponse envoyée', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.1',
      from: AUTHORIZED_SENDER_ID,
      body: 'Bonjour Jarvis',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(1);
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toEqual([
      { senderId: AUTHORIZED_SENDER_ID, text: 'Bonjour Jarvis' },
    ]);
  });

  it('en-tête de signature absent → rejeté, jamais parsé, jamais de service ni de réponse appelés', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.2',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildUnsignedRequest(payload), deps);

    expect(result.status).toBe('rejected_signature');
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(0);
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });

  it('corps altéré après signature → signature invalide détectée, jamais exécuté', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.3',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildTamperedRequest(payload), deps);

    expect(result.status).toBe('rejected_signature');
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(0);
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });

  it('signature calculée avec un autre secret (ex. mauvaise config) → invalide', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.4',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildSignedRequest(payload, 'un-autre-secret'),
      deps,
    );
    expect(result.status).toBe('rejected_signature');
  });

  it('en-tête sans le préfixe « sha256= » → invalide, détecté avant toute comparaison', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.4b',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildBadPrefixRequest(payload), deps);
    expect(result.status).toBe('rejected_signature');
  });

  it('en-tête de longueur incorrecte (même préfixe) → invalide, sans lever sur `timingSafeEqual`', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.4c',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildWrongLengthSignatureRequest(payload), deps);
    expect(result.status).toBe('rejected_signature');
  });

  it("aucun motif d'erreur de signature ne contient le secret d'application ni une signature calculée", async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.4d',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildUnsignedRequest(payload), deps);
    const reason = result.status === 'rejected_signature' ? result.reason : '';
    expect(reason).not.toContain(TEST_APP_SECRET);
    expect(reason).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('expéditeur non autorisé', () => {
  it('signature valide mais expéditeur hors allowlist → ignoré, aucune réponse envoyée', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.5',
      from: UNAUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({ status: 'processed', outcomes: [{ status: 'ignored_unauthorized' }] });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(0);
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });

  it("l'allowlist est réévaluée pour chaque message d'un événement à plusieurs messages", async () => {
    const payload = buildMultiMessagePayload([
      { id: 'wamid.multi.a', from: AUTHORIZED_SENDER_ID, body: 'autorisé' },
      { id: 'wamid.multi.b', from: UNAUTHORIZED_SENDER_ID, body: 'refusé' },
    ]);
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'replied' }, { status: 'ignored_unauthorized' }],
    });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(1);
  });
});

describe("déduplication — cycle de vie d'un identifiant", () => {
  it('beginProcessing réserve atomiquement : deux appels synchrones consécutifs sur le même id ne peuvent jamais tous les deux renvoyer "proceed"', () => {
    const dedup = new InMemoryDeduplicator();
    const first = dedup.beginProcessing('id-atomique');
    const second = dedup.beginProcessing('id-atomique');
    expect(first).toBe('proceed');
    expect(second).toBe('duplicate');
  });

  it('même identifiant reçu deux fois séquentiellement après succès → 2e ignorée comme doublon', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.dup',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const request = buildSignedRequest(payload);

    const first = await handleWhatsAppWebhookPost(request, deps);
    const second = await handleWhatsAppWebhookPost(request, deps);

    expect(first).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
    expect(second).toEqual({ status: 'processed', outcomes: [{ status: 'ignored_duplicate' }] });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(1);
  });

  it('livraison concurrente du même identifiant → une seule exécution réelle', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.race',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps();
    const request = buildSignedRequest(payload);

    // Deux appels lancés "en même temps" (promesses créées avant tout await) :
    // la garantie vient de `Deduplicator.beginProcessing` synchrone (voir
    // `channel-ports.ts`), pas d'un verrou explicite ici.
    const [first, second] = await Promise.all([
      handleWhatsAppWebhookPost(request, deps),
      handleWhatsAppWebhookPost(request, deps),
    ]);

    const outcomes = [first, second].map((r) =>
      r.status === 'processed' ? r.outcomes[0]?.status : r.status,
    );
    expect(outcomes.sort()).toEqual(['ignored_duplicate', 'replied']);
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(1);
  });

  it('relivraison après échec du service conversationnel → retraitée (pas un doublon), peut réussir', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.retry.svc',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deduplicator = new InMemoryDeduplicator();
    const request = buildSignedRequest(payload);

    const failingDeps = buildDeps({
      deduplicator,
      conversationalService: new FakeConversationalService({
        status: 'error',
        reason: 'panne simulée',
      }),
    });
    const first = await handleWhatsAppWebhookPost(request, failingDeps);
    expect(first).toEqual({
      status: 'processed',
      outcomes: [{ status: 'conversational_service_error', reason: 'panne simulée' }],
    });

    // Même déduplicateur (même « process »), transport/service réparés —
    // simule une relivraison WhatsApp après un 5xx côté serveur.
    const retryDeps = buildDeps({ deduplicator });
    const second = await handleWhatsAppWebhookPost(request, retryDeps);

    expect(second).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
    expect((retryDeps.transport as FakeTransport).sentMessages).toHaveLength(1);
  });

  it('relivraison après échec du transport → retraitée, réexécute le service (au-moins-une-fois assumé)', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.retry.tx',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deduplicator = new InMemoryDeduplicator();
    const request = buildSignedRequest(payload);

    const failingDeps = buildDeps({
      deduplicator,
      transport: new FakeTransport({ status: 'error', reason: 'transport indisponible' }),
    });
    const first = await handleWhatsAppWebhookPost(request, failingDeps);
    expect(first.status).toBe('processed');

    const retryDeps = buildDeps({ deduplicator });
    const second = await handleWhatsAppWebhookPost(request, retryDeps);

    expect(second).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
    // Le service conversationnel a bien été réexécuté à la relivraison —
    // politique assumée, voir `channel-processor.ts` § Politique de déduplication.
    expect(
      (retryDeps.conversationalService as FakeConversationalService).receivedCalls,
    ).toHaveLength(1);
  });

  it('relivraison après refus (expéditeur non autorisé) → retraitée, pas bloquée définitivement', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.retry.unauth',
      from: UNAUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deduplicator = new InMemoryDeduplicator();
    const request = buildSignedRequest(payload);

    const first = await handleWhatsAppWebhookPost(request, buildDeps({ deduplicator }));
    expect(first).toEqual({ status: 'processed', outcomes: [{ status: 'ignored_unauthorized' }] });

    // L'allowlist change entre temps (ex. Alexandre change de numéro) —
    // la relivraison du même identifiant doit pouvoir aboutir.
    const second = await handleWhatsAppWebhookPost(
      request,
      buildDeps({
        deduplicator,
        allowlist: new InMemoryAllowlist(new Set([UNAUTHORIZED_SENDER_ID])),
      }),
    );
    expect(second).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
  });

  it('redémarrage simulé (nouveau déduplicateur) → un identifiant déjà « replied » est reconnu à neuf, aucune garantie de persistance', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.restart',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const request = buildSignedRequest(payload);

    const first = await handleWhatsAppWebhookPost(
      request,
      buildDeps({ deduplicator: new InMemoryDeduplicator() }),
    );
    expect(first).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });

    // Nouveau process = nouveau déduplicateur vide : documente explicitement
    // l'absence de persistance (README, Limites) — ne « corrige » pas ce
    // point, cette mission exclut toute persistance générique.
    const afterRestart = await handleWhatsAppWebhookPost(
      request,
      buildDeps({ deduplicator: new InMemoryDeduplicator() }),
    );
    expect(afterRestart).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
  });
});

describe('notifications de statut, types non pris en charge et messages de groupe', () => {
  it('notification de statut (accusé de livraison) → ignorée explicitement, jamais traitée comme un message', async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildSignedRequest(buildStatusPayload('status-id-1')),
      deps,
    );
    expect(result).toEqual({ status: 'processed', outcomes: [{ status: 'ignored_status' }] });
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });

  it('type de message non pris en charge (ex. image) → ignoré explicitement avec motif', async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildSignedRequest(
        buildUnsupportedTypePayload({ id: 'wamid.img', from: AUTHORIZED_SENDER_ID }),
      ),
      deps,
    );
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.outcomes[0]?.status).toBe('ignored_unsupported');
    }
  });

  it('message de groupe (« group_id » présent) → ignoré explicitement, hors périmètre conversation privée', async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildSignedRequest(
        buildGroupMessagePayload({
          id: 'wamid.group',
          from: AUTHORIZED_SENDER_ID,
          groupId: '123456789@g.us',
          body: 'message de groupe',
        }),
      ),
      deps,
    );
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.outcomes[0]).toEqual({
        status: 'ignored_unsupported',
        reason: 'Message de groupe (« group_id » présent) — hors périmètre MVP.',
      });
    }
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });
});

describe('plusieurs messages dans un même événement', () => {
  it('deux messages du même expéditeur autorisé dans un seul événement → traités indépendamment', async () => {
    const payload = buildMultiMessagePayload([
      { id: 'wamid.m1', from: AUTHORIZED_SENDER_ID, body: 'premier' },
      { id: 'wamid.m2', from: AUTHORIZED_SENDER_ID, body: 'second' },
    ]);
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'replied' }, { status: 'replied' }],
    });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(2);
  });

  it("l'échec inattendu du premier message n'abandonne pas le second : les deux sont traités", async () => {
    const payload = buildMultiMessagePayload([
      { id: 'wamid.multi.fail', from: AUTHORIZED_SENDER_ID, body: 'provoque une exception' },
      { id: 'wamid.multi.ok', from: AUTHORIZED_SENDER_ID, body: 'devrait quand même être traité' },
    ]);
    const deps = buildDeps({
      conversationalService: {
        async reply(input: { readonly senderId: string; readonly text: string }) {
          if (input.text === 'provoque une exception') {
            throw new Error('bug inattendu du double — jamais un {status:"error"} structuré');
          }
          return { status: 'ok', text: 'réponse factice' };
        },
      },
    });

    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes[0]?.status).toBe('processing_error');
      // Le second message n'est pas abandonné silencieusement.
      expect(result.outcomes[1]).toEqual({ status: 'replied' });
    }
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(1);
  });
});

describe('corps malformé ou de forme inattendue après signature valide', () => {
  it("JSON syntaxiquement invalide mais correctement signé → malformed_body, jamais d'exception", async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildMalformedJsonRequest(), deps);
    expect(result.status).toBe('malformed_body');
  });

  it("« entry » absent → malformed_body, jamais d'exception", async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(buildStructurallyInvalidRequest({}), deps);
    expect(result.status).toBe('malformed_body');
  });

  it("« entry » présent mais pas un tableau → malformed_body, jamais d'exception", async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildStructurallyInvalidRequest({ entry: 'pas-un-tableau' }),
      deps,
    );
    expect(result.status).toBe('malformed_body');
  });

  it('« changes » absent sur une entrée → ignorée sans exception, aucun événement produit', async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildStructurallyInvalidRequest({ entry: [{ id: 'x' }] }),
      deps,
    );
    expect(result).toEqual({ status: 'processed', outcomes: [] });
  });

  it('un message est `null` dans le tableau « messages » → classé non supporté, aucune exception', async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildStructurallyInvalidRequest({
        entry: [{ changes: [{ value: { messages: [null] } }] }],
      }),
      deps,
    );
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.outcomes[0]?.status).toBe('ignored_unsupported');
    }
  });

  it("« messages » contient une chaîne au lieu d'un objet → classé non supporté, aucune exception", async () => {
    const deps = buildDeps();
    const result = await handleWhatsAppWebhookPost(
      buildStructurallyInvalidRequest({
        entry: [{ changes: [{ value: { messages: ['pas-un-objet'] } }] }],
      }),
      deps,
    );
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.outcomes[0]?.status).toBe('ignored_unsupported');
    }
  });
});

describe('erreurs du service conversationnel et du transport', () => {
  it('le service conversationnel échoue → aucun envoi tenté', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.svcerr',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps({
      conversationalService: new FakeConversationalService({
        status: 'error',
        reason: 'panne simulée',
      }),
    });
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'conversational_service_error', reason: 'panne simulée' }],
    });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(0);
  });

  it('le transport échoue → erreur remontée, réponse déjà produite mais non délivrée', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.txerr',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps({
      transport: new FakeTransport({ status: 'error', reason: 'transport indisponible' }),
    });
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);

    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'transport_error', reason: 'transport indisponible' }],
    });
  });
});

describe('robustesse — exception inattendue (défense en profondeur)', () => {
  it('le service conversationnel lève au lieu de renvoyer une erreur structurée → processing_error, identifiant libéré, retraitable', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.throw.svc',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deduplicator = new InMemoryDeduplicator();
    const request = buildSignedRequest(payload);

    const throwingDeps = buildDeps({
      deduplicator,
      conversationalService: {
        async reply() {
          throw new Error('bug inattendu');
        },
      },
    });
    const first = await handleWhatsAppWebhookPost(request, throwingDeps);
    expect(first).toEqual({
      status: 'processed',
      outcomes: [{ status: 'processing_error', reason: 'bug inattendu' }],
    });

    // L'identifiant n'est pas resté bloqué en « in_flight » : une
    // relivraison avec un service réparé est retraitée et peut réussir.
    const second = await handleWhatsAppWebhookPost(request, buildDeps({ deduplicator }));
    expect(second).toEqual({ status: 'processed', outcomes: [{ status: 'replied' }] });
  });

  it('le transport lève au lieu de renvoyer une erreur structurée → processing_error, identifiant libéré', async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.throw.tx',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps({
      transport: {
        async send() {
          throw new Error('panne réseau inattendue');
        },
      },
    });
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);
    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'processing_error', reason: 'panne réseau inattendue' }],
    });
  });

  it("l'allowlist lève au lieu de renvoyer un booléen → processing_error, aucune réponse envoyée à l'expéditeur", async () => {
    const payload = buildTextMessagePayload({
      id: 'wamid.throw.allow',
      from: AUTHORIZED_SENDER_ID,
      body: 'x',
    });
    const deps = buildDeps({
      allowlist: {
        isAuthorized(): boolean {
          throw new Error('allowlist corrompue');
        },
      },
    });
    const result = await handleWhatsAppWebhookPost(buildSignedRequest(payload), deps);
    expect(result).toEqual({
      status: 'processed',
      outcomes: [{ status: 'processing_error', reason: 'allowlist corrompue' }],
    });
    expect((deps.transport as FakeTransport).sentMessages).toHaveLength(0);
    expect((deps.conversationalService as FakeConversationalService).receivedCalls).toHaveLength(0);
  });
});

describe('processChannelEvent — unitaire, sans HTTP', () => {
  it("un message « status » isolé est toujours ignoré, quel que soit l'expéditeur connu", async () => {
    const deps = buildDeps();
    const outcome = await processChannelEvent({ kind: 'status', id: 'x' }, deps);
    expect(outcome).toEqual({ status: 'ignored_status' });
  });
});
