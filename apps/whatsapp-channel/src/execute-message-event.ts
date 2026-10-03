/**
 * Exécute **un** événement message déjà admis par `LocalMessageQueue`
 * (réservation de déduplication déjà prise par la file — voir
 * `local-message-queue.ts`). Volontairement distinct du
 * `processChannelEvent` monolithique du prototype
 * (`prototypes/whatsapp-channel/channel-processor.ts`) : dans cette
 * intégration, la réservation de déduplication doit avoir lieu **à
 * l'admission** dans la file (synchrone, avant tout empilement), jamais au
 * moment où un worker dépile l'événement — sinon un doublon arrivé pendant
 * qu'un événement attend encore en file ne serait pas détecté. Ce fichier
 * ne connaît donc ni le `Deduplicator`, ni l'admission : il ne fait que
 * traiter — allowlist (défense en profondeur, re-vérifiée ici même si la
 * route a déjà filtré avant admission), service conversationnel, transport.
 *
 * Politique **au moins une fois, jamais exactement une fois** : c'est
 * `LocalMessageQueue` qui, selon le {@link ChannelOutcome} renvoyé ici,
 * décide de marquer `completed` (aucune relance automatique **tant que
 * l'identifiant reste retenu** — rétention bornée, pas un verrou permanent,
 * voir `local-message-queue.ts`/`in-memory-deduplicator.ts`) ou de libérer
 * (`released`) l'identifiant pour une relivraison. Une exception assumée :
 * `'transport_uncertain'` (voir `graph-api-transport.ts`) est traitée comme
 * `completed` aussi, bien que rien n'y soit confirmé — un timeout n'étant
 * jamais une preuve de non-envoi, relancer automatiquement risquerait un
 * double envoi.
 *
 * Toute exception inattendue (bug d'un double, rejet non géré) est
 * capturée ici et transformée en `processing_error` — jamais remontée à
 * l'appelant (le worker de la file traite plusieurs événements en
 * parallèle ; un seul événement fautif ne doit jamais interrompre les
 * autres).
 */
import type {
  ChannelOutcome,
  ConversationalService,
  MessageChannelEvent,
  OutboundTransport,
  SenderAllowlist,
} from './channel-ports.js';

export interface ExecuteMessageEventDeps {
  readonly allowlist: SenderAllowlist;
  readonly conversationalService: ConversationalService;
  readonly transport: OutboundTransport;
}

export async function executeMessageEvent(
  event: MessageChannelEvent,
  deps: ExecuteMessageEventDeps,
): Promise<ChannelOutcome> {
  try {
    if (!deps.allowlist.isAuthorized(event.senderId)) {
      return { status: 'ignored_unauthorized' };
    }

    // Traitement conversationnel — aucun envoi n'a encore eu lieu ici.
    const serviceResult = await deps.conversationalService.reply({
      senderId: event.senderId,
      text: event.text,
    });
    if (serviceResult.status === 'error') {
      return { status: 'conversational_service_error', reason: serviceResult.reason };
    }

    // Envoi de la réponse — étape distincte, peut échouer indépendamment du
    // traitement conversationnel qui, lui, a déjà réussi à cet instant.
    const transportResult = await deps.transport.send({
      recipientId: event.senderId,
      text: serviceResult.text,
    });
    if (transportResult.status === 'error') {
      return { status: 'transport_error', reason: transportResult.reason };
    }
    if (transportResult.status === 'uncertain') {
      // Ni succès confirmé ni échec certain — voir `TransportResult`.
      // Propagé tel quel ; `LocalMessageQueue` décide de la politique de
      // relance (jamais automatique pour cette issue).
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
