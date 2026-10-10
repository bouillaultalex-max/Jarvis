/**
 * Étape « envoi » d'une réponse déjà générée — voir `generate-response.ts`
 * pour la raison de la séparation (persistance de `response_ready` entre
 * les deux étapes, ADR-0023). Reçoit un texte déjà décidé, ne régénère
 * jamais rien.
 */
import type { ChannelOutcome, OutboundTransport } from './channel-ports.js';

/**
 * Sous-ensemble de `ChannelOutcome` que l'étape d'envoi peut produire —
 * jamais `ignored_unauthorized`/`conversational_service_error` (déjà
 * tranchés à la génération). Voir `generate-response.ts` pour la
 * contrepartie côté génération et la raison de cette restriction de type.
 */
export type SendTerminalOutcome = Extract<
  ChannelOutcome,
  { readonly status: 'replied' | 'transport_error' | 'transport_uncertain' | 'processing_error' }
>;

export interface SendResponseDeps {
  readonly transport: OutboundTransport;
}

export async function sendResponse(
  input: { readonly recipientId: string; readonly text: string },
  deps: SendResponseDeps,
): Promise<SendTerminalOutcome> {
  try {
    const transportResult = await deps.transport.send({
      recipientId: input.recipientId,
      text: input.text,
    });
    if (transportResult.status === 'error') {
      return { status: 'transport_error', reason: transportResult.reason };
    }
    if (transportResult.status === 'uncertain') {
      return { status: 'transport_uncertain', reason: transportResult.reason };
    }
    return { status: 'replied' };
  } catch (err) {
    return {
      status: 'processing_error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
