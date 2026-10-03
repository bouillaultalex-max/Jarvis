import Fastify, { type FastifyInstance } from 'fastify';

import type { SenderAllowlist, SignatureVerifier } from './channel-ports.js';
import type { WhatsAppChannelConfig } from './config.js';
import { LOCAL_BODY_LIMIT_BYTES } from './config.js';
import type { LocalMessageQueue } from './local-message-queue.js';
import { handleWhatsAppHandshake, parseWhatsAppWebhookBody } from './whatsapp-webhook-adapter.js';

const WEBHOOK_PATH = '/webhooks/whatsapp';
const SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * Issue d'admission d'**un** événement, telle que renvoyée au client HTTP —
 * distincte de `ChannelOutcome` (`channel-ports.ts`), qui n'est connue
 * qu'une fois le traitement effectivement terminé, en tâche de fond.
 */
export interface EventAdmission {
  readonly eventId: string | undefined;
  readonly kind:
    | 'queued'
    | 'duplicate'
    | 'rejected_capacity'
    | 'closed'
    | 'ignored_unauthorized'
    | 'ignored_status'
    | 'ignored_unsupported';
  readonly reason?: string;
}

export interface BuildWhatsAppChannelServerOptions {
  readonly config: WhatsAppChannelConfig;
  readonly allowlist: SenderAllowlist;
  readonly signatureVerifier: SignatureVerifier;
  readonly queue: LocalMessageQueue;
  /** Défaut : {@link LOCAL_BODY_LIMIT_BYTES} — choix applicatif, pas une limite officielle Meta. */
  readonly bodyLimitBytes?: number;
}

/**
 * Construit le serveur HTTP du canal WhatsApp. Lié à l'appelant pour le
 * choix de l'hôte/port (`main.ts` l'écoute en 127.0.0.1 uniquement — ce
 * module ne décide jamais lui-même de l'adresse).
 *
 *   GET  /webhooks/whatsapp   — handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`)
 *   POST /webhooks/whatsapp   — événements, signature vérifiée sur les octets bruts
 *
 * La route POST ne répond **200** pour un message à traiter qu'après
 * admission effective dans `queue` (réservation de déduplication prise,
 * capacité disponible) — jamais avant, jamais en pariant que le traitement
 * réussira. Le traitement réel (service conversationnel, transport) se
 * déroule en tâche de fond, suivi par `queue` (voir `local-message-queue.ts`) —
 * jamais attendu par cette route.
 */
export function buildWhatsAppChannelServer(
  options: BuildWhatsAppChannelServerOptions,
): FastifyInstance {
  const { config, allowlist, signatureVerifier, queue } = options;
  const bodyLimit = options.bodyLimitBytes ?? LOCAL_BODY_LIMIT_BYTES;

  const app = Fastify({ logger: false, bodyLimit });

  // Préserve les octets bruts du corps — nécessaires à la vérification de
  // signature, qui doit se faire **avant** tout `JSON.parse` (ADR-0022).
  // Le corps est tout de même soumis à `bodyLimit` (Fastify applique la
  // limite pendant la lecture du flux, avant d'invoquer ce parseur) — un
  // dépassement produit une erreur mappée en 413 par le gestionnaire
  // d'erreurs ci-dessous.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err: unknown, _request, reply) => {
    const code = err instanceof Error ? (err as { code?: string }).code : undefined;
    const statusCode =
      err instanceof Error ? (err as { statusCode?: number }).statusCode : undefined;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE' || statusCode === 413) {
      return reply.code(413).send({ error: 'Corps de requête trop volumineux.' });
    }
    throw err;
  });

  app.get(WEBHOOK_PATH, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const result = handleWhatsAppHandshake(
      {
        mode: readStringParam(query['hub.mode']),
        verifyToken: readStringParam(query['hub.verify_token']),
        challenge: readStringParam(query['hub.challenge']),
      },
      config.verifyToken,
    );
    if (result.status === 'rejected') {
      return reply.code(403).send({ error: result.reason });
    }
    return reply.code(200).type('text/plain').send(result.challenge);
  });

  app.post(WEBHOOK_PATH, async (request, reply) => {
    const rawBody = request.body as Buffer;
    const headers = normalizeHeaders(request.headers);

    const signatureResult = signatureVerifier.verify(rawBody, headers[SIGNATURE_HEADER]);
    if (signatureResult.status === 'invalid') {
      return reply.code(403).send({ status: 'rejected_signature', reason: signatureResult.reason });
    }

    const parseResult = parseWhatsAppWebhookBody(rawBody);
    if (parseResult.status === 'malformed_body') {
      // Jamais transformé en liste d'événements vide acceptée (ADR-0022) :
      // code distinct, aucune admission tentée.
      return reply.code(400).send({ status: 'malformed_body', reason: parseResult.reason });
    }

    const admissions: EventAdmission[] = [];
    let capacityExceeded = false;

    for (const event of parseResult.events) {
      if (event.kind === 'status') {
        admissions.push({ eventId: event.id, kind: 'ignored_status' });
        continue;
      }
      if (event.kind === 'unsupported') {
        admissions.push({ eventId: event.id, kind: 'ignored_unsupported', reason: event.reason });
        continue;
      }

      // event.kind === 'message' : filtré par l'allowlist **avant**
      // d'atteindre la file — protège sa capacité bornée d'un expéditeur
      // non autorisé, et garantit qu'aucune réponse n'est jamais envoyée à
      // un expéditeur refusé (défense en profondeur ré-appliquée par
      // `executeMessageEvent` au moment du traitement réel).
      if (!allowlist.isAuthorized(event.senderId)) {
        admissions.push({ eventId: event.id, kind: 'ignored_unauthorized' });
        continue;
      }

      const admission = queue.admit(event);
      if (admission === 'rejected_capacity' || admission === 'closed') {
        capacityExceeded = true;
      }
      admissions.push({ eventId: event.id, kind: admission });
    }

    // Politique d'admission pour un événement multi-message : **partielle**,
    // par identifiant — chaque message est admis/refusé indépendamment (sa
    // propre réservation de déduplication). Si au moins un message de ce
    // lot n'a pas pu être admis (capacité), le lot entier reçoit 503 pour
    // provoquer une relivraison WhatsApp du lot complet ; les messages déjà
    // admis gardent leur réservation (`'in_flight'`/`'completed'` selon
    // l'avancement) et ne sont donc jamais redupliqués lors de cette
    // relivraison — seuls ceux non admis la première fois obtiennent une
    // admission neuve.
    if (capacityExceeded) {
      return reply.code(503).send({ status: 'queue_full', admissions });
    }
    return reply.code(200).send({ status: 'accepted', admissions });
  });

  return app;
}

function readStringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      normalized[key] = value[0];
    }
  }
  return normalized;
}
