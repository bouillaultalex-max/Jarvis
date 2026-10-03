/**
 * PROTOTYPE JETABLE — voir `docs/adr/0022-whatsapp-channel-boundary.md`.
 *
 * ⚠️ **SUPERSEDED** — `apps/whatsapp-channel` ne reprend pas ce fichier
 * à l'identique : la réservation de déduplication (`beginProcessing`) doit y
 * avoir lieu **à l'admission dans la file bornée**, pas au moment où ce
 * `processChannelEvent` monolithique la prend lui-même — sinon un doublon
 * arrivé pendant qu'un événement attend encore en file ne serait pas
 * détecté. Voir `apps/whatsapp-channel/src/local-message-queue.ts`
 * (admission + réservation) et `apps/whatsapp-channel/src/execute-message-event.ts`
 * (traitement seul, sans dédup — équivalent fonctionnel de ce fichier moins
 * la réservation).
 *
 * Orchestrateur générique : ne connaît aucun fournisseur (pas de WhatsApp
 * ici) ni `AgentLoop` — uniquement les ports de `channel-ports.ts`. Conçu
 * pour être réutilisé tel quel par un futur canal (Telegram…) qui fournirait
 * son propre adaptateur de parsing vers `ChannelEvent`.
 */
import type {
  ChannelEvent,
  ConversationalService,
  Deduplicator,
  OutboundTransport,
  SenderAllowlist,
} from './channel-ports.js';

export type ChannelOutcome =
  | { readonly status: 'replied' }
  | { readonly status: 'ignored_duplicate' }
  | { readonly status: 'ignored_unauthorized' }
  | { readonly status: 'ignored_status' }
  | { readonly status: 'ignored_unsupported'; readonly reason: string }
  | { readonly status: 'conversational_service_error'; readonly reason: string }
  | { readonly status: 'transport_error'; readonly reason: string }
  /**
   * Exception inattendue (bug d'un double, erreur de programmation) levée
   * par `allowlist`/`conversationalService`/`transport` plutôt que
   * renvoyée comme résultat structuré. Distincte de `transport_error`/
   * `conversational_service_error` (qui restent des échecs *attendus et
   * typés*) — voir {@link processChannelEvent}, défense en profondeur.
   */
  | { readonly status: 'processing_error'; readonly reason: string };

export interface ChannelProcessorDeps {
  readonly allowlist: SenderAllowlist;
  readonly deduplicator: Deduplicator;
  readonly conversationalService: ConversationalService;
  readonly transport: OutboundTransport;
}

/**
 * Traite **un** événement déjà normalisé. Ordre volontaire :
 *   statut/non-supporté (jamais dédupliqués ni comptés comme message —
 *   des no-op idempotents par nature, aucune garantie supplémentaire utile)
 *   → déduplication (avant l'allowlist : garantit qu'une livraison
 *     concurrente du même identifiant ne peut jamais déclencher deux fois
 *     un effet, quelle que soit l'issue ultérieure)
 *   → identité autorisée
 *   → service conversationnel (traitement conversationnel — distinct de
 *     l'envoi, voir ci-dessous)
 *   → transport de sortie (envoi de la réponse — distinct du traitement).
 *
 * Politique de déduplication — **au moins une fois, jamais exactement une
 * fois** : seule l'issue `replied` (réponse réellement envoyée) marque
 * l'identifiant `completed` (bloqué définitivement). Toute autre issue
 * (refus, échec du service, échec du transport) **libère** l'identifiant
 * (`Deduplicator.finish(id, 'released')`) : une relivraison ultérieure du
 * même identifiant est retraitée comme un essai neuf. Conséquence assumée :
 * si le service conversationnel réussit mais que le transport échoue, une
 * relivraison réexécute le service (pas de cache de la réponse déjà
 * produite) — documenté, pas corrigé plus finement dans ce prototype (voir
 * README, Politique de déduplication).
 *
 * Après `beginProcessing`, tout le reste (allowlist, service, transport)
 * est couvert par un `try/catch` : une exception **inattendue** (pas un
 * résultat `{status:'error'}` structuré, mais un rejet/throw réel d'un
 * port) libère tout de même l'identifiant (`'released'`) avant de
 * remonter un `processing_error` — jamais de réservation orpheline en
 * `in_flight`, et jamais d'exception qui remonterait jusqu'à l'appelant
 * (qui traite plusieurs événements dans une boucle — voir
 * `whatsapp-channel.ts` — et ne doit donc jamais s'arrêter en cours de
 * route sur un seul message fautif).
 */
export async function processChannelEvent(
  event: ChannelEvent,
  deps: ChannelProcessorDeps,
): Promise<ChannelOutcome> {
  if (event.kind === 'status') {
    return { status: 'ignored_status' };
  }
  if (event.kind === 'unsupported') {
    return { status: 'ignored_unsupported', reason: event.reason };
  }

  if (deps.deduplicator.beginProcessing(event.id) === 'duplicate') {
    return { status: 'ignored_duplicate' };
  }

  try {
    if (!deps.allowlist.isAuthorized(event.senderId)) {
      deps.deduplicator.finish(event.id, 'released');
      return { status: 'ignored_unauthorized' };
    }

    // Traitement conversationnel — aucun envoi n'a encore eu lieu ici.
    const serviceResult = await deps.conversationalService.reply({
      senderId: event.senderId,
      text: event.text,
    });
    if (serviceResult.status === 'error') {
      deps.deduplicator.finish(event.id, 'released');
      return { status: 'conversational_service_error', reason: serviceResult.reason };
    }

    // Envoi de la réponse — étape distincte, peut échouer indépendamment du
    // traitement conversationnel qui, lui, a déjà réussi à cet instant.
    const transportResult = await deps.transport.send({
      recipientId: event.senderId,
      text: serviceResult.text,
    });
    if (transportResult.status === 'error') {
      deps.deduplicator.finish(event.id, 'released');
      return { status: 'transport_error', reason: transportResult.reason };
    }

    deps.deduplicator.finish(event.id, 'completed');
    return { status: 'replied' };
  } catch (err) {
    deps.deduplicator.finish(event.id, 'released');
    return {
      status: 'processing_error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
