/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md`.
 *
 * Seul fichier de ce prototype qui connaît la forme du JSON webhook
 * WhatsApp (enveloppe `entry[].changes[].value.messages[]`/`statuses[]`).
 * Voir `README.md` § Conformité au contrat officiel pour le détail
 * vérifié/non vérifié avec sources et dates. Résumé :
 *   - enveloppe `object`/`entry[].changes[].value`/`field: "messages"`,
 *     message texte (`messages[].{id,from,timestamp,type,text.body}`), et
 *     statut (`statuses[].id`) : **vérifiés par fetch direct**
 *     (`developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`).
 *   - plusieurs messages dans un même événement : aucun exemple officiel
 *     vu explicitement, mais `messages` est structurellement un tableau
 *     dans l'exemple vérifié — traité par construction, non un cas
 *     spécial.
 *   - `group_id` distinguant un message de groupe : rapporté par fetch
 *     direct de la page officielle « Group messaging » + une source
 *     indépendante concordante, sans bloc JSON complet obtenu — confiance
 *     raisonnable, pas une citation verbatim vérifiée au même niveau que
 *     l'enveloppe message/statut ci-dessus.
 *   - type non pris en charge (image, audio…) : aucun exemple officiel de
 *     payload vu ; ce fichier traite tout `type !== 'text'` comme
 *     `unsupported`, ce qui couvre ce cas par construction sans avoir eu
 *     besoin de l'exemple exact.
 * Si une forme réelle diverge, seul ce fichier change —
 * `channel-processor.ts` et les ports restent inchangés par construction
 * (ADR-0022).
 */
import type { ChannelEvent, HandshakeRequest, HandshakeResult } from './channel-ports.js';

export function handleWhatsAppHandshake(
  request: HandshakeRequest,
  expectedVerifyToken: string,
): HandshakeResult {
  if (request.mode !== 'subscribe') {
    return { status: 'rejected', reason: '« hub.mode » attendu : « subscribe ».' };
  }
  if (request.verifyToken !== expectedVerifyToken) {
    return { status: 'rejected', reason: '« hub.verify_token » ne correspond pas.' };
  }
  if (request.challenge === undefined || request.challenge.length === 0) {
    return { status: 'rejected', reason: '« hub.challenge » absent.' };
  }
  return { status: 'ok', challenge: request.challenge };
}

export type ParseResult =
  | { readonly status: 'ok'; readonly events: readonly ChannelEvent[] }
  | { readonly status: 'malformed_body'; readonly reason: string };

/**
 * Parse le corps déjà authentifié (signature vérifiée par l'appelant sur
 * les octets bruts, **avant** cet appel) en événements normalisés. Ne lève
 * jamais : un corps syntaxiquement invalide ou de forme inattendue produit
 * `malformed_body`, jamais une exception non gérée.
 */
export function parseWhatsAppWebhookBody(rawBody: Buffer): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return {
      status: 'malformed_body',
      reason: err instanceof Error ? err.message : 'JSON invalide.',
    };
  }

  const entries = asRecord(parsed)?.entry;
  if (!Array.isArray(entries)) {
    return { status: 'malformed_body', reason: 'Champ « entry » absent ou invalide.' };
  }

  const events: ChannelEvent[] = [];
  for (const entry of entries) {
    const changes = asRecord(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = asRecord(asRecord(change)?.value);
      if (value === undefined) continue;
      events.push(...extractMessageEvents(value), ...extractStatusEvents(value));
    }
  }
  return { status: 'ok', events };
}

function extractMessageEvents(value: Record<string, unknown>): ChannelEvent[] {
  const messages = value.messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((raw): ChannelEvent => {
    const msg = asRecord(raw);
    const id = typeof msg?.id === 'string' ? msg.id : undefined;
    const from = typeof msg?.from === 'string' ? msg.from : undefined;
    const type = msg?.type;
    const timestamp = typeof msg?.timestamp === 'string' ? msg.timestamp : undefined;

    if (id === undefined || from === undefined) {
      return { kind: 'unsupported', id, reason: 'Message sans « id » ou « from » exploitable.' };
    }
    // Message de groupe — hors périmètre MVP (conversations privées
    // uniquement, ADR-0022). Champ `group_id` : voir l'avertissement en
    // tête de fichier sur son niveau de vérification.
    if (typeof msg?.group_id === 'string') {
      return {
        kind: 'unsupported',
        id,
        reason: 'Message de groupe (« group_id » présent) — hors périmètre MVP.',
      };
    }
    if (type !== 'text') {
      return {
        kind: 'unsupported',
        id,
        reason: `Type de message non pris en charge : « ${String(type)} ».`,
      };
    }
    const text = asRecord(msg?.text)?.body;
    if (typeof text !== 'string') {
      return { kind: 'unsupported', id, reason: 'Message « text » sans corps exploitable.' };
    }
    return {
      kind: 'message',
      id,
      senderId: from,
      text,
      receivedAt: timestamp ?? new Date(0).toISOString(),
    };
  });
}

function extractStatusEvents(value: Record<string, unknown>): ChannelEvent[] {
  const statuses = value.statuses;
  if (!Array.isArray(statuses)) return [];
  return statuses
    .map((raw) => asRecord(raw)?.id)
    .filter((id): id is string => typeof id === 'string')
    .map((id): ChannelEvent => ({ kind: 'status', id }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
