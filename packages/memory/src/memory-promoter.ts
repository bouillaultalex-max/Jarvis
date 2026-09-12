import type { MemoryCandidate } from './memory-candidate.js';
import type { MemoryEntry, MemoryEntryInput } from './memory-entry.js';
import type { MemoryPromotionPolicy } from './memory-promotion.js';
import { promoteMemoryCandidate } from './memory-promotion.js';
import type { MemoryStore } from './memory-store.js';

/**
 * Résultat d'une confirmation (ou d'un refus) explicite de l'utilisateur.
 *
 * - `confirmed` : l'utilisateur a confirmé — **une** nouvelle `MemoryEntry`
 *   `user_confirmed` a été créée (`entry`) ;
 * - `refused`   : l'utilisateur a refusé — **aucune** écriture, aucune
 *   élévation de provenance ;
 * - `failed`    : l'écriture a échoué (`store.add` a levé) — rien n'a été
 *   persisté, jamais présenté comme un succès. Réessayable.
 */
export type MemoryConfirmationResult =
  | { readonly status: 'confirmed'; readonly entry: MemoryEntry }
  | { readonly status: 'refused' }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Implémentation du jeton de confirmation. **Non exportée** : il est
 * structurellement impossible d'en construire une depuis l'extérieur du
 * package — seul {@link MemoryPromoter.promote} en produit, sur une décision
 * `confirm`.
 */
class PendingMemoryConfirmationImpl {
  private resolution: MemoryConfirmationResult | undefined = undefined;

  constructor(
    private readonly store: MemoryStore,
    private readonly confirmedInput: MemoryEntryInput,
  ) {}

  /**
   * Confirmation **explicite** de l'utilisateur : crée exactement **une**
   * nouvelle `MemoryEntry` d'origine `user_confirmed` — `id`/`createdAt`
   * générés par le `MemoryStore`, contenu (`kind`/`subject`/`statement`)
   * repris **sans modification** du candidat validé.
   *
   * Idempotent : un second appel renvoie **le même** résultat, sans réécrire.
   * Une décision (confirmer / refuser) prise est définitive : la première
   * gagne. Un échec du store (`{ status: 'failed' }`) n'est **pas** verrouillé
   * — il peut être réessayé.
   */
  confirm(): MemoryConfirmationResult {
    if (this.resolution !== undefined) {
      return this.resolution;
    }
    let entry: MemoryEntry;
    try {
      entry = this.store.add(this.confirmedInput);
    } catch (err) {
      return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
    this.resolution = { status: 'confirmed', entry };
    return this.resolution;
  }

  /**
   * Refus **explicite** : aucune écriture, aucune mutation du `MemoryStore`,
   * aucune élévation de provenance. Idempotent ; définitif (un `confirm()`
   * ultérieur renvoie le refus).
   */
  refuse(): MemoryConfirmationResult {
    if (this.resolution !== undefined) {
      return this.resolution;
    }
    this.resolution = { status: 'refused' };
    return this.resolution;
  }

  /** `true` dès qu'une décision (confirmer / refuser) a été prise. */
  get resolved(): boolean {
    return this.resolution !== undefined;
  }
}

/**
 * Jeton de confirmation **opaque**. Produit **uniquement** par
 * {@link MemoryPromoter.promote} sur une décision `confirm` ; il n'existe
 * aucun constructeur public. Il porte le contenu **déjà validé** du candidat
 * et permet une confirmation (ou un refus) explicite **ultérieure**, sans
 * jamais avoir été persisté nulle part.
 */
export type PendingMemoryConfirmation = Pick<
  PendingMemoryConfirmationImpl,
  'confirm' | 'refuse' | 'resolved'
>;

/**
 * Résultat de l'application d'une décision de promotion à un candidat.
 *
 * - `accepted` : la policy a répondu `accept` **et** une `MemoryEntry` a été
 *   créée — `entry` est celle renvoyée par `MemoryStore.add()` ;
 * - `rejected` : rien écrit. Soit la policy a répondu `reject`, soit le
 *   candidat n'était **pas éligible** (structure invalide, ou provenance ≠
 *   `llm_proposed`) — dans ce dernier cas la policy **n'est pas consultée** ;
 * - `confirm`  : rien écrit — la policy demande une confirmation utilisateur
 *   explicite. `pending` est le jeton permettant de la confirmer ou de la
 *   refuser plus tard ({@link PendingMemoryConfirmation}) ;
 * - `failed`   : rien écrit de façon fiable — une exception est survenue
 *   pendant `policy.decide()` ou pendant `store.add()`. La promotion est
 *   **signalée comme échouée**, jamais présentée comme un succès.
 *
 * `reason` accompagne tout statut autre que `accepted`.
 */
export type MemoryPromotionResult =
  | { readonly status: 'accepted'; readonly entry: MemoryEntry }
  | { readonly status: 'rejected'; readonly reason: string }
  | {
      readonly status: 'confirm';
      readonly reason: string;
      readonly pending: PendingMemoryConfirmation;
    }
  | { readonly status: 'failed'; readonly reason: string };

export interface MemoryPromoterOptions {
  /** Où écrire une entrée acceptée ou confirmée. Seul `add()` est appelé — jamais `invalidate`/`supersede`. */
  readonly store: MemoryStore;
  /** Décide `accept` / `reject` / `confirm`. Pure, déterministe — voir {@link MemoryPromotionPolicy}. */
  readonly policy: MemoryPromotionPolicy;
}

/**
 * Applique une {@link MemoryPromotionPolicy} à des {@link MemoryCandidate}.
 *
 * C'est le **seul** endroit qui contient la logique d'application d'une
 * décision de promotion (ni `AgentLoop`, ni personne d'autre ne la duplique).
 *
 * Garanties :
 *   - `reject` / `confirm` / `failed` ⇒ **aucune écriture** ;
 *   - `accepted` ⇒ **exactement un** `store.add()` (provenance du candidat
 *     recopiée telle quelle via {@link promoteMemoryCandidate} — jamais
 *     élevée) ;
 *   - `confirm` ⇒ un {@link PendingMemoryConfirmation} portant le contenu
 *     validé et **`provenance.origin: 'user_confirmed'`** ; **rien n'est
 *     écrit** tant que l'utilisateur n'a pas explicitement appelé
 *     `pending.confirm()`. Un `MemoryCandidate` arbitraire ne peut **pas**
 *     devenir `user_confirmed` : seule une décision `confirm` produit un
 *     jeton, et le jeton n'est pas constructible ;
 *   - `id` / `createdAt` sont générés par le `MemoryStore`, jamais ici ;
 *   - aucune modification / suppression d'une mémoire existante ;
 *   - aucune analyse de contenu, aucun LLM, aucun réseau ;
 *   - une exception (policy ou store) ⇒ `{ status: 'failed' }` — jamais de
 *     promotion partielle silencieuse ; `promote()` **ne lève pas**.
 *
 * Testable indépendamment d'`AgentLoop`.
 */
export class MemoryPromoter {
  private readonly store: MemoryStore;
  private readonly policy: MemoryPromotionPolicy;

  constructor(options: MemoryPromoterOptions) {
    this.store = options.store;
    this.policy = options.policy;
  }

  /**
   * Traite **un** candidat. Ordre :
   *   1. {@link promoteMemoryCandidate} — validation + garde de provenance
   *      (`llm_proposed` requis). Échec ⇒ `rejected`, **policy non consultée** ;
   *   2. `policy.decide(candidate)` ;
   *   3. `accept` ⇒ `store.add(input)` ⇒ `accepted` ;
   *      `reject` ⇒ `rejected` ;
   *      `confirm` ⇒ `confirm` + jeton `pending` (rien écrit).
   */
  promote(candidate: MemoryCandidate): MemoryPromotionResult {
    try {
      const outcome = promoteMemoryCandidate(candidate);
      if (!outcome.promoted) {
        return { status: 'rejected', reason: outcome.reason };
      }

      const decision = this.policy.decide(candidate);
      if (decision.action === 'reject') {
        return { status: 'rejected', reason: decision.reason };
      }
      if (decision.action === 'confirm') {
        // Contenu validé du candidat, provenance portée à `user_confirmed`.
        // `user_confirmed` est une origine certaine ⇒ aucune `confidence`
        // n'est transmise (elle serait inventée, et `validateProvenance`
        // l'interdit de toute façon).
        const confirmedInput: MemoryEntryInput = {
          kind: outcome.input.kind,
          statement: outcome.input.statement,
          ...(outcome.input.subject !== undefined ? { subject: outcome.input.subject } : {}),
          provenance: { origin: 'user_confirmed' },
        };
        return {
          status: 'confirm',
          reason: decision.reason,
          pending: new PendingMemoryConfirmationImpl(this.store, confirmedInput),
        };
      }

      const entry = this.store.add(outcome.input);
      return { status: 'accepted', entry };
    } catch (err) {
      return {
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
