/**
 * Fixtures et doubles **de test uniquement** — jamais importé par le code
 * applicatif (`main.ts`/`server.ts`/…). Forme des payloads : voir l'en-tête
 * de `../whatsapp-webhook-adapter.ts` pour le détail vérifié/non vérifié.
 */
import { computeSignature } from '../webhook-signature.js';
import type {
  ConversationalService,
  ConversationalServiceResult,
  MessageChannelEvent,
} from '../channel-ports.js';

export const TEST_APP_SECRET = 'test-app-secret-never-a-real-one';
export const TEST_VERIFY_TOKEN = 'test-verify-token';
export const AUTHORIZED_SENDER_ID = '33600000000';
export const UNAUTHORIZED_SENDER_ID = '33699999999';

/** Construit un `MessageChannelEvent` directement, pour les tests unitaires de la file. */
export function buildMessageEvent(input: {
  readonly id: string;
  readonly senderId: string;
  readonly text?: string;
}): MessageChannelEvent {
  return {
    kind: 'message',
    id: input.id,
    senderId: input.senderId,
    text: input.text ?? 'x',
    receivedAt: new Date(0).toISOString(),
  };
}

interface RawMessageFixture {
  readonly id: string;
  readonly from: string;
  readonly type?: string;
  readonly body?: string;
  readonly groupId?: string;
}

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

export function buildMultiMessagePayload(
  messages: readonly { readonly id: string; readonly from: string; readonly body: string }[],
): Record<string, unknown> {
  return buildEnvelope({
    contacts: messages.map((m) => ({ profile: { name: 'Fixture' }, wa_id: m.from })),
    messages: messages.map((m) => rawMessage({ id: m.id, from: m.from, body: m.body })),
  });
}

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
    statuses: [{ id: statusId, status: 'delivered', timestamp: '1759500010' }],
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

export interface InjectedRequest {
  readonly payload: Buffer;
  readonly headers: Record<string, string>;
}

export function signedRequest(payload: unknown, appSecret = TEST_APP_SECRET): InjectedRequest {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': computeSignature(body, appSecret),
    },
  };
}

export function unsignedRequest(payload: unknown): InjectedRequest {
  return {
    payload: Buffer.from(JSON.stringify(payload), 'utf8'),
    headers: { 'content-type': 'application/json' },
  };
}

export function badPrefixRequest(payload: unknown): InjectedRequest {
  return {
    payload: Buffer.from(JSON.stringify(payload), 'utf8'),
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'deadbeef' },
  };
}

export function wrongLengthSignatureRequest(payload: unknown): InjectedRequest {
  return {
    payload: Buffer.from(JSON.stringify(payload), 'utf8'),
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
  };
}

export function tamperedRequest(payload: unknown, appSecret = TEST_APP_SECRET): InjectedRequest {
  const signed = signedRequest(payload, appSecret);
  return {
    payload: Buffer.concat([signed.payload, Buffer.from(',"tampered":true}', 'utf8')]),
    headers: signed.headers,
  };
}

export function malformedJsonRequest(appSecret = TEST_APP_SECRET): InjectedRequest {
  const body = Buffer.from('{ not valid json', 'utf8');
  return {
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': computeSignature(body, appSecret),
    },
  };
}

export function structurallyInvalidRequest(
  body: unknown,
  appSecret = TEST_APP_SECRET,
): InjectedRequest {
  return signedRequest(body, appSecret);
}

export function oversizedRequest(sizeBytes: number, appSecret = TEST_APP_SECRET): InjectedRequest {
  const payload = buildTextMessagePayload({
    id: 'wamid.oversized',
    from: AUTHORIZED_SENDER_ID,
    body: 'x'.repeat(sizeBytes),
  });
  return signedRequest(payload, appSecret);
}

/**
 * Double scriptable pour `ConversationalService` — indépendant de
 * `AgentLoop`/`SimulatedLlmProvider`, pour tester le canal (file, route)
 * sans dépendre du comportement interne du moteur conversationnel (déjà
 * testé ailleurs, `packages/core`). `delayMs` simule un appel lent sans
 * jamais toucher le réseau — utilisé pour prouver que l'accusé HTTP ne
 * l'attend pas.
 */
export class ScriptedConversationalService implements ConversationalService {
  public readonly receivedCalls: Array<{ senderId: string; text: string }> = [];

  constructor(
    private readonly result: ConversationalServiceResult = {
      status: 'ok',
      text: 'réponse simulée',
    },
    private readonly delayMs = 0,
  ) {}

  async reply(input: {
    readonly senderId: string;
    readonly text: string;
  }): Promise<ConversationalServiceResult> {
    this.receivedCalls.push({ senderId: input.senderId, text: input.text });
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.result;
  }
}

/**
 * Double dont la promesse **ne se résout jamais** — pour prouver qu'un
 * `drain()`/`close()` sans délai peut attendre indéfiniment, et qu'un
 * délai observable (`drain(timeoutMs)`/`close(timeoutMs)`) ne libère
 * jamais la réservation du message bloqué (voir `local-message-queue.ts`).
 */
export class NeverResolvingConversationalService implements ConversationalService {
  public readonly receivedCalls: Array<{ senderId: string; text: string }> = [];

  async reply(input: { readonly senderId: string; readonly text: string }): Promise<never> {
    this.receivedCalls.push({ senderId: input.senderId, text: input.text });
    return new Promise<never>(() => {
      // Volontairement jamais résolue ni rejetée.
    });
  }
}
