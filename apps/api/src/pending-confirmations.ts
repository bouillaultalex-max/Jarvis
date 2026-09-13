import type { ConfirmationPayload } from '@jarvis/connectors';

/**
 * Table `confirmationId → payload` d'`apps/api` (ADR-0008 §3, ADR-0009
 * §11/§12).
 *
 * Ne recrée jamais la machine à états de `ConfirmationService` : ne connaît
 * que la présence ou l'absence d'une entrée, jamais un statut
 * pending/consumed/denied recalculé indépendamment. `get()` ne court-circuite
 * jamais vers une décision d'expiration basée sur son propre `expiresAt` —
 * toute entrée présente est toujours retransmise à `ConfirmationService`,
 * seul juge de l'expiration réelle du ticket. Le TTL local ne sert qu'à
 * purger la mémoire, avec une marge de sécurité après l'expiration
 * annoncée, jamais à décider seul une réponse HTTP (une entrée « juste
 * expirée mais pas encore purgée » doit toujours pouvoir être forwardée à
 * `ConfirmationService`, qui répondra correctement `expired` → `409`).
 */

export interface PendingConfirmationEntry {
  readonly payload: ConfirmationPayload;
  /** Recopié tel quel depuis `ConfirmationTicket.expiresAt` — jamais recalculé. */
  readonly expiresAt: string;
}

export interface PendingConfirmationsOptions {
  /** Nombre maximal d'entrées conservées simultanément. */
  readonly maxSize?: number;
  /**
   * Marge appliquée après `expiresAt` avant purge mémoire effective — laisse
   * le temps à une requête légitime d'obtenir un `409` de
   * `ConfirmationService` plutôt qu'un `404` prématuré côté `apps/api`.
   */
  readonly purgeGraceMs?: number;
  /** Horloge injectable pour des tests déterministes. Défaut : `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_PURGE_GRACE_MS = 5 * 60_000;

export class PendingConfirmations {
  private readonly entries = new Map<string, PendingConfirmationEntry>();
  private readonly maxSize: number;
  private readonly purgeGraceMs: number;
  private readonly now: () => number;

  constructor(options: PendingConfirmationsOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.purgeGraceMs = options.purgeGraceMs ?? DEFAULT_PURGE_GRACE_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Enregistre une entrée. Purge opportuniste des entrées expirées (avec
   * marge) puis, si la limite de taille est encore atteinte, éviction FIFO
   * de la plus ancienne (ordre d'insertion natif de `Map`) — jamais un choix
   * basé sur un statut recalculé.
   */
  set(confirmationId: string, entry: PendingConfirmationEntry): void {
    this.purgeExpired();
    if (this.entries.size >= this.maxSize && !this.entries.has(confirmationId)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(confirmationId, entry);
  }

  /**
   * Lecture. Purge opportuniste avant lecture, mais **ne décide jamais**
   * qu'une entrée présente est « expirée » sur la seule base de
   * `expiresAt` : une entrée encore présente est toujours renvoyée, à
   * charge pour l'appelant de la soumettre à `ConfirmationService`.
   */
  get(confirmationId: string): PendingConfirmationEntry | undefined {
    this.purgeExpired();
    return this.entries.get(confirmationId);
  }

  size(): number {
    return this.entries.size;
  }

  private purgeExpired(): void {
    const nowMs = this.now();
    for (const [id, entry] of this.entries) {
      if (nowMs >= Date.parse(entry.expiresAt) + this.purgeGraceMs) {
        this.entries.delete(id);
      }
    }
  }
}
