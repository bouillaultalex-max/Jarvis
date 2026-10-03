/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md`.
 * Fixtures synthétiques (jamais un échange réel) et doubles de test pour les
 * ports de `channel-ports.ts`. Forme des payloads : reprend l'enveloppe
 * vérifiée par fetch direct de
 * `developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`
 * (message texte, statut « delivered ») — voir le tableau de
 * `whatsapp-webhook-adapter.ts` pour le détail de ce qui est vérifié vs non
 * vérifié.
 */
import { computeSignature } from './webhook-signature.js';
import type {
  ConversationalService,
  ConversationalServiceResult,
  ClaimResult,
  Deduplicator,
  OutboundTransport,
  ProcessingOutcome,
  RawInboundRequest,
  SenderAllowlist,
  TransportResult,
} from './channel-ports.js';

export const TEST_APP_SECRET = 'test-app-secret-never-a-real-one';
export const AUTHORIZED_SENDER_ID = '33600000000';
export const UNAUTHORIZED_SENDER_ID = '33699999999';

interface RawMessageFixture {
  readonly id: string;
  readonly from: string;
  readonly type?: string;
  readonly body?: string;
  readonly groupId?: string;
}

/**
 * Enveloppe `entry[].changes[].value` fidèle à l'exemple officiel vérifié
 * (object, entry.id, changes[].field, value.messaging_product,
 * value.metadata, value.contacts) — les champs non utilisés par
 * l'adaptateur (`metadata`, `contacts`) sont inclus volontairement pour
 * prouver que le parseur les tolère sans les exploiter.
 */
function buildEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
              ...value,
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function rawMessage(fixture: RawMessageFixture): Record<string, unknown> {
  const base: Record<string, unknown> = {
    from: fixture.from,
    id: fixture.id,
    timestamp: '1759500000',
    type: fixture.type ?? 'text',
  };
  if ((fixture.type ?? 'text') === 'text') {
    base.text = { body: fixture.body ?? '' };
  }
  if (fixture.groupId !== undefined) {
    base.group_id = fixture.groupId;
  }
  return base;
}

export function buildTextMessagePayload(input: {
  readonly id: string;
  readonly from: string;
  readonly body: string;
}): Record<string, unknown> {
  return buildEnvelope({
    contacts: [{ profile: { name: 'Fixture' }, wa_id: input.from }],
    messages: [rawMessage({ id: input.id, from: input.from, body: input.body })],
  });
}

/** Plusieurs messages dans un même événement webhook (un seul `changes[].value.messages`, plusieurs entrées). */
export function buildMultiMessagePayload(
  messages: readonly { readonly id: string; readonly from: string; readonly body: string }[],
): Record<string, unknown> {
  return buildEnvelope({
    contacts: messages.map((m) => ({ profile: { name: 'Fixture' }, wa_id: m.from })),
    messages: messages.map((m) => rawMessage({ id: m.id, from: m.from, body: m.body })),
  });
}

/** Message avec `group_id` — hors périmètre MVP (voir ADR-0022, conversations privées uniquement). */
export function buildGroupMessagePayload(input: {
  readonly id: string;
  readonly from: string;
  readonly groupId: string;
  readonly body: string;
}): Record<string, unknown> {
  return buildEnvelope({
    messages: [
      rawMessage({ id: input.id, from: input.from, body: input.body, groupId: input.groupId }),
    ],
  });
}

export function buildStatusPayload(statusId: string): Record<string, unknown> {
  return buildEnvelope({
    statuses: [
      {
        id: statusId,
        status: 'delivered',
        timestamp: '1759500010',
        recipient_id: AUTHORIZED_SENDER_ID,
      },
    ],
  });
}

export function buildUnsupportedTypePayload(input: {
  readonly id: string;
  readonly from: string;
}): Record<string, unknown> {
  return buildEnvelope({
    messages: [rawMessage({ id: input.id, from: input.from, type: 'image' })],
  });
}

/** Construit une requête brute signée correctement avec `TEST_APP_SECRET`. */
export function buildSignedRequest(
  payload: unknown,
  appSecret = TEST_APP_SECRET,
): RawInboundRequest {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBody,
    headers: { 'x-hub-signature-256': computeSignature(rawBody, appSecret) },
  };
}

/** Même corps, signature absente. */
export function buildUnsignedRequest(payload: unknown): RawInboundRequest {
  return { rawBody: Buffer.from(JSON.stringify(payload), 'utf8'), headers: {} };
}

/** En-tête présent mais sans le préfixe « sha256= » attendu. */
export function buildBadPrefixRequest(payload: unknown): RawInboundRequest {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return { rawBody, headers: { 'x-hub-signature-256': 'deadbeef' } };
}

/** En-tête avec le bon préfixe mais une longueur de digest incorrecte. */
export function buildWrongLengthSignatureRequest(payload: unknown): RawInboundRequest {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return { rawBody, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } };
}

/** Corps signé correctement, puis altéré après coup — signature désormais invalide. */
export function buildTamperedRequest(
  payload: unknown,
  appSecret = TEST_APP_SECRET,
): RawInboundRequest {
  const signed = buildSignedRequest(payload, appSecret);
  const tamperedBody = Buffer.concat([signed.rawBody, Buffer.from(',"tampered":true}', 'utf8')]);
  return { rawBody: tamperedBody, headers: signed.headers };
}

/** Requête signée dont le corps brut n'est pas du JSON valide. */
export function buildMalformedJsonRequest(appSecret = TEST_APP_SECRET): RawInboundRequest {
  const rawBody = Buffer.from('{ not valid json', 'utf8');
  return { rawBody, headers: { 'x-hub-signature-256': computeSignature(rawBody, appSecret) } };
}

/** Requête signée dont le corps JSON est syntaxiquement valide mais structurellement inattendu. */
export function buildStructurallyInvalidRequest(
  body: unknown,
  appSecret = TEST_APP_SECRET,
): RawInboundRequest {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return { rawBody, headers: { 'x-hub-signature-256': computeSignature(rawBody, appSecret) } };
}

export class InMemoryAllowlist implements SenderAllowlist {
  constructor(private readonly authorized: ReadonlySet<string>) {}
  isAuthorized(senderId: string): boolean {
    return this.authorized.has(senderId);
  }
}

/** Dédup en mémoire — voir `channel-ports.ts` sur le cycle de vie et la politique au-moins-une-fois. */
export class InMemoryDeduplicator implements Deduplicator {
  private readonly state = new Map<string, 'in_flight' | 'completed'>();

  beginProcessing(eventId: string): ClaimResult {
    if (this.state.has(eventId)) return 'duplicate';
    this.state.set(eventId, 'in_flight');
    return 'proceed';
  }

  finish(eventId: string, outcome: ProcessingOutcome): void {
    if (outcome === 'completed') {
      this.state.set(eventId, 'completed');
    } else {
      this.state.delete(eventId);
    }
  }
}

/** Double scriptable : renvoie une réponse fixe ou l'erreur configurée. */
export class FakeConversationalService implements ConversationalService {
  public readonly receivedCalls: Array<{ senderId: string; text: string }> = [];
  constructor(
    private readonly result: ConversationalServiceResult = {
      status: 'ok',
      text: 'réponse factice',
    },
  ) {}
  async reply(input: {
    readonly senderId: string;
    readonly text: string;
  }): Promise<ConversationalServiceResult> {
    this.receivedCalls.push({ senderId: input.senderId, text: input.text });
    return this.result;
  }
}

/** Double scriptable — n'effectue jamais d'envoi réel. */
export class FakeTransport implements OutboundTransport {
  public readonly sentMessages: Array<{ recipientId: string; text: string }> = [];
  constructor(private readonly result: TransportResult = { status: 'sent' }) {}
  async send(input: {
    readonly recipientId: string;
    readonly text: string;
  }): Promise<TransportResult> {
    this.sentMessages.push({ recipientId: input.recipientId, text: input.text });
    return this.result;
  }
}
