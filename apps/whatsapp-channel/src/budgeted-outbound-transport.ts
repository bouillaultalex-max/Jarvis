/**
 * Décore un `OutboundTransport` réel avec le budget d'une seule tentative
 * (`send-attempt-budget.ts`) — réservation **avant** `inner.send()` (donc
 * avant tout `fetch`), jamais après. Ne modifie ni `GraphApiOutboundTransport`
 * ni `durable-message-worker.ts` : la décision de réessayer/bloquer reste
 * entièrement dans cette couche, câblée conditionnellement par
 * `build-channel-dependencies.ts` uniquement en mode réel.
 *
 * **Contention ou erreur SQLite au `reserve()` — jamais un fallback
 * permissif** : `'already_consumed'` et `'storage_error'`
 * (`send-attempt-budget.ts`) sont traités **identiquement** — dans les
 * deux cas, `inner.send()` n'est **jamais appelé**. Une incertitude sur
 * l'état du budget doit toujours mener à un refus, jamais à un envoi
 * optimiste.
 *
 * Erreurs inattendues (point sécurité) : si `inner.send()` lève une
 * exception (ne devrait pas arriver — `GraphApiOutboundTransport` capture
 * déjà tout en interne — mais jamais supposé), le motif renvoyé est un
 * message **générique fixe**, jamais `err.message`/la pile/un corps de
 * réponse brut — aucune fuite possible même si l'exception inattendue en
 * contenait. Même traitement si `recordOutcome()` échoue après un envoi
 * réel déjà effectué (contention à l'écriture) : jamais une exception qui
 * remonte et interrompt le worker — la réservation elle-même est déjà
 * durable (voir `send-attempt-budget.ts`), donc la garantie « une seule
 * tentative » tient même si cette seule écriture d'issue échoue.
 */
import type { OutboundTransport, TransportResult } from './channel-ports.js';
import type { SendAttemptBudget, SendAttemptOutcome } from './send-attempt-budget.js';

const BUDGET_UNAVAILABLE_REASON =
  "Budget d'essai d'envoi réel indisponible (déjà consommé, ou erreur de stockage) — " +
  'aucun envoi réel autorisé tant que ce budget ne peut pas être confirmé disponible.';
const UNEXPECTED_TRANSPORT_EXCEPTION_REASON =
  "Exception inattendue du transport sortant — statut d'envoi indéterminé.";

export class BudgetedOutboundTransport implements OutboundTransport {
  constructor(
    private readonly inner: OutboundTransport,
    private readonly budget: SendAttemptBudget,
  ) {}

  async send(input: {
    readonly recipientId: string;
    readonly text: string;
  }): Promise<TransportResult> {
    const now = new Date().toISOString();
    const claim = this.budget.reserve(now);
    if (claim !== 'reserved') {
      // 'already_consumed' OU 'storage_error' — même traitement : jamais
      // même tenté d'appeler le transport réel sans confirmation ferme que
      // cette tentative est la seule.
      return { status: 'error', reason: BUDGET_UNAVAILABLE_REASON };
    }

    let result: TransportResult;
    try {
      result = await this.inner.send(input);
    } catch {
      // Toute exception inattendue est une issue incertaine (elle a pu
      // atteindre le fournisseur avant d'échouer ici) — jamais classée
      // `'error'` sous ce seul prétexte. Motif générique fixe, voir l'en-tête.
      this.#recordOutcomeSafely('uncertain', UNEXPECTED_TRANSPORT_EXCEPTION_REASON, now);
      return { status: 'uncertain', reason: UNEXPECTED_TRANSPORT_EXCEPTION_REASON };
    }

    this.#recordOutcomeSafely(
      result.status === 'sent' ? 'sent' : result.status,
      result.status === 'sent' ? undefined : result.reason,
      now,
    );
    return result;
  }

  /**
   * N'écrit jamais rien de plus que ce que `recordOutcome` accepte déjà
   * (aucun secret, aucune pile) ; si l'écriture elle-même échoue
   * (contention, disque), journalise un avertissement **générique** — nom
   * d'erreur uniquement, jamais son message — et continue : le véritable
   * `TransportResult` déjà obtenu reste renvoyé à l'appelant tel quel.
   */
  #recordOutcomeSafely(outcome: SendAttemptOutcome, reason: string | undefined, now: string): void {
    try {
      this.budget.recordOutcome(outcome, reason, now);
    } catch (err) {
      console.warn(
        '[whatsapp-channel] budget d’essai : échec de l’enregistrement de l’issue ' +
          `(${err instanceof Error ? err.name : 'erreur inconnue'}) — la réservation reste ` +
          'consommée durablement malgré tout (voir send-attempt-budget.ts).',
      );
    }
  }
}
