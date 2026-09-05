import { randomBytes, createHash } from 'node:crypto';

import { canonicalStringify, computeFingerprint, type ConfirmationPayload } from './fingerprint.js';

export type { ConfirmationPayload } from './fingerprint.js';

/**
 * Générateur de service de confirmation — garantit qu'une confirmation
 * accordée pour un payload précis, un Tool précis et un compte précis ne
 * peut être utilisée que pour exactement ce même payload/Tool/compte,
 * pendant sa durée de validité, et une seule fois.
 *
 * Générique et indépendant : n'importe/ne dépend ni de Gmail, ni d'une UI,
 * ni de `AgentLoop`, ni de `ToolExecutor`, ni de `PermissionManager`. Ce
 * service ne décide jamais si une action est *autorisée* — cette décision
 * reste entièrement au `PermissionManager` (`@jarvis/core`), en amont.
 * `ConfirmationService` prouve seulement qu'une approbation déjà accordée
 * porte encore, sans altération, sur ce qui est sur le point de
 * s'exécuter.
 *
 * États conceptuels d'une confirmation : `pending`, `consumed`, `denied`,
 * `expired`, `revoked`. `expired` n'est jamais écrit comme transition
 * stockée — il est *dérivé* à la demande (comparaison d'horodatage) lors
 * d'un `verify()`, ce qui évite tout balayage périodique/minuteur : une
 * entrée expirée mais jamais re-vérifiée reste simplement en mémoire,
 * inoffensive (elle échouera à `verify()` si jamais présentée). À
 * l'échelle réaliste d'un assistant personnel (quelques confirmations à la
 * fois), ceci est délibérément la solution la plus simple qui reste
 * correcte — voir le bilan M8-A3 pour la justification complète.
 *
 * **Strictement en mémoire, jamais persisté.** Un redémarrage de JARVIS
 * invalide de fait toute confirmation `pending` (une nouvelle instance de
 * `ConfirmationService` démarre avec un état vide) — comportement de
 * sécurité par défaut retenu dans l'étude M8-A : le contenu qu'une
 * confirmation autorise (même sous forme de simple empreinte) ne doit
 * jamais survivre plus longtemps que nécessaire.
 */

/** Raison structurée d'un échec de `verify()` — une seule catégorie d'erreur pour tous les cas, volontairement. */
export type ConfirmationFailureReason =
  | 'not_found'
  | 'payload_mismatch'
  | 'expired'
  | 'denied'
  | 'revoked'
  | 'already_consumed';

export type ConfirmationVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ConfirmationFailureReason };

export interface ConfirmationTicket {
  /** Opaque, imprévisible — jamais le token en clair n'est stocké tel quel côté service (voir plus bas). */
  readonly confirmationId: string;
  readonly expiresAt: string;
}

export interface ConfirmationServiceOptions {
  /**
   * Durée de validité par défaut d'une confirmation, en millisecondes.
   * Aucune convention de ce type n'existe déjà ailleurs dans le dépôt : 5
   * minutes est une valeur choisie pour cette étape (assez long pour
   * qu'un utilisateur lise et confirme un envoi, assez court pour limiter
   * la fenêtre d'une confirmation oubliée) — configurable, pas imposée.
   */
  readonly ttlMs?: number;
  /** Horloge injectable pour des tests déterministes. Défaut : `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60_000;

type StoredStatus = 'pending' | 'consumed' | 'denied' | 'revoked';

interface ConfirmationRecord {
  status: StoredStatus;
  readonly fingerprint: string;
  /**
   * Conservé en clair (ce n'est pas un secret) uniquement pour permettre
   * `revokeForAccount()` de filtrer sans avoir à inverser une empreinte —
   * `verify()`, lui, ne compare jamais `accountId` séparément : la
   * correspondance de compte passe entièrement par `fingerprint` (voir
   * plus bas).
   */
  readonly accountId: string;
  readonly expiresAtMs: number;
}

/** Jamais exporté : simple table de hachage interne, pas une API publique. */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}

/**
 * Message générique renvoyé à un appelant externe (jamais le détail de la
 * cause). Volontairement identique pour toutes les raisons d'échec : un
 * message qui distinguerait « payload modifié » d'« expiré » donnerait à
 * un appelant (potentiellement le modèle lui-même) de l'information utile
 * pour affiner une tentative. `reason` (structuré, interne) reste
 * disponible pour un diagnostic précis côté développeur/logs.
 */
export function describeConfirmationFailure(_reason: ConfirmationFailureReason): string {
  return 'Invalid or expired confirmation';
}

export class ConfirmationService {
  /** Clé = hash du token, jamais le token en clair (voir le bilan M8-A3 pour la justification). */
  readonly #records = new Map<string, ConfirmationRecord>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: ConfirmationServiceOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Crée une confirmation `pending` pour ce payload exact et renvoie un
   * jeton opaque et imprévisible (256 bits, `crypto.randomBytes` —
   * jamais `Math.random`, un compteur, ou un horodatage seul).
   */
  async create(payload: ConfirmationPayload): Promise<ConfirmationTicket> {
    const confirmationId = randomBytes(32).toString('base64url');
    const expiresAtMs = this.#now() + this.#ttlMs;

    this.#records.set(hashToken(confirmationId), {
      status: 'pending',
      fingerprint: computeFingerprint(payload),
      accountId: payload.accountId,
      expiresAtMs,
    });

    return { confirmationId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /**
   * Vérifie et, en cas de succès, **consomme** (transition atomique
   * `pending → consumed`) la confirmation. `payload` doit être exactement
   * ce qui est sur le point de s'exécuter — recalculé et comparé par
   * empreinte à ce qui a été approuvé par `create()`. `async` par
   * cohérence avec `AccountStore`/`SecretStore` (mêmes conventions dans ce
   * package) ; aucun `await` n'intervient avant la transition d'état, donc
   * la portion critique reste synchrone de bout en bout — deux appels
   * concurrents ne peuvent jamais s'entrelacer au milieu de la vérification
   * (voir les tests de concurrence : un seul `ok:true` sur N appels
   * identiques).
   */
  async verify(confirmationId: string, payload: ConfirmationPayload): Promise<ConfirmationVerifyResult> {
    const record = this.#records.get(hashToken(confirmationId));
    if (record === undefined) {
      return { ok: false, reason: 'not_found' };
    }

    if (record.status === 'denied') {
      return { ok: false, reason: 'denied' };
    }
    if (record.status === 'revoked') {
      return { ok: false, reason: 'revoked' };
    }
    if (record.status === 'consumed') {
      return { ok: false, reason: 'already_consumed' };
    }

    // record.status === 'pending' ici. L'expiration est dérivée, pas stockée.
    if (this.#now() >= record.expiresAtMs) {
      return { ok: false, reason: 'expired' };
    }

    if (computeFingerprint(payload) !== record.fingerprint) {
      return { ok: false, reason: 'payload_mismatch' };
    }

    record.status = 'consumed';
    return { ok: true };
  }

  /**
   * Refuse une confirmation `pending` : elle ne redeviendra jamais valide
   * (`verify()` échouera ensuite avec `reason: 'denied'`). Idempotent —
   * un id inconnu ou déjà dans un état terminal ne lève rien.
   */
  async deny(confirmationId: string): Promise<void> {
    const record = this.#records.get(hashToken(confirmationId));
    if (record !== undefined && record.status === 'pending') {
      record.status = 'denied';
    }
  }

  /**
   * Invalide toute confirmation `pending` liée à ce compte (ex. le compte
   * a été déconnecté/supprimé entre-temps). Les confirmations d'un autre
   * compte, ou déjà dans un état terminal, ne sont jamais affectées.
   */
  async revokeForAccount(accountId: string): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.status === 'pending' && record.accountId === accountId) {
        record.status = 'revoked';
      }
    }
  }
}

// Ré-export : la canonicalisation est un détail d'implémentation du
// fingerprint, mais reste utile aux tests/consommateurs qui veulent
// vérifier une propriété de canonicalisation sans dépendre de la classe.
export { canonicalStringify, computeFingerprint };
