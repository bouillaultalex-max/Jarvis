/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md`.
 * Point d'entrée du harnais : assemble vérification de signature (octets
 * bruts), parsing WhatsApp, puis l'orchestrateur générique — un événement
 * à la fois. Aucun appel réseau, aucun branchement à `AgentLoop`.
 */
import type { ChannelOutcome, ChannelProcessorDeps } from './channel-processor.js';
import { processChannelEvent } from './channel-processor.js';
import type { RawInboundRequest, SignatureVerifier } from './channel-ports.js';
import { parseWhatsAppWebhookBody } from './whatsapp-webhook-adapter.js';

export type WebhookPostOutcome =
  | { readonly status: 'rejected_signature'; readonly reason: string }
  | { readonly status: 'malformed_body'; readonly reason: string }
  | { readonly status: 'processed'; readonly outcomes: readonly ChannelOutcome[] };

const SIGNATURE_HEADER = 'x-hub-signature-256';

export async function handleWhatsAppWebhookPost(
  request: RawInboundRequest,
  deps: ChannelProcessorDeps & { readonly signatureVerifier: SignatureVerifier },
): Promise<WebhookPostOutcome> {
  // La signature se vérifie sur `request.rawBody` tel quel — avant tout
  // `JSON.parse` — conformément à ADR-0022 §Decision point 1.
  const signatureResult = deps.signatureVerifier.verify(
    request.rawBody,
    request.headers[SIGNATURE_HEADER],
  );
  if (signatureResult.status === 'invalid') {
    return { status: 'rejected_signature', reason: signatureResult.reason };
  }

  const parseResult = parseWhatsAppWebhookBody(request.rawBody);
  if (parseResult.status === 'malformed_body') {
    return { status: 'malformed_body', reason: parseResult.reason };
  }

  const outcomes: ChannelOutcome[] = [];
  for (const event of parseResult.events) {
    outcomes.push(await processChannelEvent(event, deps));
  }
  return { status: 'processed', outcomes };
}
