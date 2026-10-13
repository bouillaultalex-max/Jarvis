/**
 * Budget durable d'**une seule tentative d'envoi réel**, pour le futur
 * premier essai (un seul message, une seule fois — jamais une politique de
 * production). Totalement indépendant du `MessageStore` : celui-ci borne
 * les tentatives *par message* (`maxAdmissionAttempts`), ce budget borne le
 * nombre total d'envois réels tentés par ce canal, **toutes identités de
 * message confondues**, à exactement un, pour toute la durée de vie de ce
 * fichier.
 *
 * Réservation **avant** tout appel réseau (`fetch`), jamais après — voir
 * {@link BudgetedOutboundTransport} (`budgeted-outbound-transport.ts`), seul
 * appelant prévu. Une erreur ou une issue `uncertain` consomme la tentative
 * exactement comme un succès : aucune différence de traitement, puisque le
 * but est de ne jamais retenter un second envoi réel, quelle que soit
 * l'issue du premier. **Aucun reset implicite au redémarrage** : une fois
 * réservée, la tentative reste consommée pour toujours sur ce fichier,
 * crash ou pas — ce n'est pas une politique de nouvelle tentative, c'est un
 * verrou à sens unique.
 */

export type SendAttemptOutcome = 'sent' | 'error' | 'uncertain';

export type SendAttemptBudgetState =
  | { readonly status: 'reserved'; readonly reservedAt: string }
  | {
      readonly status: SendAttemptOutcome;
      readonly reservedAt: string;
      readonly resolvedAt: string;
      readonly reason: string | undefined;
    };

/**
 * `'storage_error'` — ajouté en revue finale : une contention prolongée ou
 * toute autre erreur SQLite pendant `reserve()` (vérifié par un test à
 * deux vrais sous-processus concurrents). L'appelant doit la traiter
 * **exactement comme** `'already_consumed'` — un refus d'envoi, jamais un
 * fallback permissif qui autoriserait l'envoi faute de certitude.
 */
export type ReserveResult = 'reserved' | 'already_consumed' | 'storage_error';

/** `recordOutcome` appelé sans réservation préalable valide (jamais censé arriver si l'appelant respecte le contrat). */
export class BudgetNotReservedError extends Error {
  constructor() {
    super(
      "recordOutcome() appelé sans réservation 'reserved' active — contrat rompu : " +
        'reserve() doit toujours précéder recordOutcome(), exactement une fois chacun.',
    );
    this.name = 'BudgetNotReservedError';
  }
}

export interface SendAttemptBudget {
  /**
   * Réservation **atomique**, synchrone : aucune fenêtre d'« await » entre
   * la vérification et la marque — une seule réservation peut jamais
   * réussir sur un fichier donné, pour toute sa durée de vie.
   */
  reserve(now: string): ReserveResult;

  /** @throws {BudgetNotReservedError} si aucune réservation `'reserved'` n'est active. */
  recordOutcome(outcome: SendAttemptOutcome, reason: string | undefined, now: string): void;

  getState(): SendAttemptBudgetState | undefined;

  close(): void;
}
