/**
 * Étape « génération » d'un message déjà admis — isolée de l'envoi
 * (`send-response.ts`) pour que le worker durable (ADR-0023) puisse
 * persister `response_ready` **entre** les deux étapes, et reprendre après
 * un crash sans jamais rappeler le service conversationnel une seconde fois
 * pour une réponse déjà générée. Remplace la partie « génération » de
 * l'ancien `execute-message-event.ts` (monolithique).
 *
 * Défense en profondeur : l'allowlist est re-vérifiée ici même si la route
 * HTTP (`server.ts`) l'a déjà vérifiée avant admission — au cas où la
 * politique changerait entre l'admission et le traitement réel.
 */
import type { ChannelOutcome, ConversationalService, SenderAllowlist } from './channel-ports.js';

/**
 * Sous-ensemble de `ChannelOutcome` que cette étape peut réellement
 * produire — aucun appel transport n'a encore eu lieu à ce stade, donc
 * jamais `replied`/`transport_error`/`transport_uncertain`. Restreindre le
 * type (plutôt que `ChannelOutcome` en entier) permet au worker de
 * distinguer statiquement « échec de génération » (toujours sûr à classer
 * `failed`) de « échec d'envoi » (jamais sûr sans vérifier le détail).
 */
export type GenerationTerminalOutcome = Extract<
  ChannelOutcome,
  { readonly status: 'ignored_unauthorized' | 'conversational_service_error' | 'processing_error' }
>;

export type GenerateResponseResult =
  | { readonly status: 'ok'; readonly text: string }
  | { readonly status: 'terminal'; readonly outcome: GenerationTerminalOutcome };

export interface GenerateResponseDeps {
  readonly allowlist: SenderAllowlist;
  readonly conversationalService: ConversationalService;
}

export async function generateResponse(
  input: { readonly senderId: string; readonly text: string },
  deps: GenerateResponseDeps,
): Promise<GenerateResponseResult> {
  try {
    if (!deps.allowlist.isAuthorized(input.senderId)) {
      return { status: 'terminal', outcome: { status: 'ignored_unauthorized' } };
    }

    const serviceResult = await deps.conversationalService.reply({
      senderId: input.senderId,
      text: input.text,
    });
    if (serviceResult.status === 'error') {
      return {
        status: 'terminal',
        outcome: { status: 'conversational_service_error', reason: serviceResult.reason },
      };
    }

    return { status: 'ok', text: serviceResult.text };
  } catch (err) {
    return {
      status: 'terminal',
      outcome: {
        status: 'processing_error',
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
