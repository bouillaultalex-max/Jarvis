import type { ClaimResult, Deduplicator, ProcessingOutcome } from './channel-ports.js';

/** Nombre d'identifiants `completed` conservés par défaut avant éviction FIFO. */
export const DEFAULT_MAX_COMPLETED_ENTRIES = 1000;

export interface InMemoryDeduplicatorOptions {
  /**
   * Nombre maximum d'identifiants `completed` retenus. Une file bornée ne
   * borne pas automatiquement son historique : sans cette limite, `#completed`
   * grossirait indéfiniment avec le nombre total de messages jamais traités
   * avec succès, même si la file de travail elle-même reste petite.
   *
   * Éviction **FIFO** (le plus ancien `completed` d'abord) une fois la
   * limite dépassée. Conséquence assumée, pas une dégradation silencieuse :
   * un identifiant évincé peut être **retraité** comme neuf si le fournisseur
   * le relivre bien plus tard — ce déduplicateur ne garantit donc **pas**
   * une déduplication illimitée dans le temps, seulement sur une fenêtre
   * récente bornée. Aucune persistance n'est ajoutée pour fermer cet écart.
   */
  readonly maxCompletedEntries?: number;
}

/**
 * Déduplicateur en mémoire — état perdu à chaque redémarrage du process
 * (voir `channel-ports.ts` et `local-message-queue.ts` pour les garanties
 * réellement fournies). Implémentation de production de ce premier
 * parcours **et** des tests — une seule implémentation, jamais deux
 * divergentes.
 *
 * Deux collections distinctes, jamais confondues :
 *   - `#inFlight` (`Set`) — identifiants réservés, en attente ou en cours de
 *     traitement. **Jamais évincé** : sa taille est naturellement bornée par
 *     la capacité de la file qui l'utilise (`LocalMessageQueue.maxQueueSize`),
 *     évincer un `in_flight` casserait la garantie d'atomicité (deux
 *     traitements concurrents du même message deviendraient possibles).
 *   - `#completed` (`Map`, ordre d'insertion = FIFO) — identifiants dont le
 *     traitement a réussi. Borné par `maxCompletedEntries`, avec éviction
 *     explicite ci-dessus.
 */
export class InMemoryDeduplicator implements Deduplicator {
  readonly #inFlight = new Set<string>();
  readonly #completed = new Map<string, true>();
  readonly #maxCompletedEntries: number;

  constructor(options: InMemoryDeduplicatorOptions = {}) {
    const max = options.maxCompletedEntries ?? DEFAULT_MAX_COMPLETED_ENTRIES;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('InMemoryDeduplicator : « maxCompletedEntries » doit être un entier >= 1.');
    }
    this.#maxCompletedEntries = max;
  }

  /** Nombre d'identifiants `completed` actuellement retenus (observabilité). */
  get completedCount(): number {
    return this.#completed.size;
  }

  beginProcessing(eventId: string): ClaimResult {
    if (this.#inFlight.has(eventId) || this.#completed.has(eventId)) {
      return 'duplicate';
    }
    this.#inFlight.add(eventId);
    return 'proceed';
  }

  finish(eventId: string, outcome: ProcessingOutcome): void {
    this.#inFlight.delete(eventId);
    if (outcome !== 'completed') {
      return;
    }
    this.#completed.set(eventId, true);
    this.#evictOldestCompletedIfOverCapacity();
  }

  #evictOldestCompletedIfOverCapacity(): void {
    while (this.#completed.size > this.#maxCompletedEntries) {
      const oldest = this.#completed.keys().next();
      if (oldest.done === true) break;
      this.#completed.delete(oldest.value);
    }
  }
}
