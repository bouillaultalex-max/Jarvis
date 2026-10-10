/**
 * Port du store transactionnel unique de réception durable (ADR-0023).
 * Remplace `Deduplicator` + l'historique d'issues en mémoire de l'ancienne
 * `LocalMessageQueue` — une seule source de vérité, pas deux structures à
 * synchroniser. Zéro import `@jarvis/*`, comme `channel-ports.ts`.
 */

export type MessageStatus =
  'queued' | 'processing' | 'response_ready' | 'sending' | 'sent' | 'uncertain' | 'failed';

/**
 * Limites **applicatives locales** pour cette tranche — ne reflètent
 * aucune limite officielle Meta (non vérifiée). Un nombre de lignes borné
 * (`maxStoredMessages`, `sqlite-message-store.ts`) ne borne pas, seul, le
 * volume disque : sans ces limites de longueur, une seule ligne pourrait
 * porter un texte arbitrairement grand. Vivent dans ce module (port),
 * plutôt que dans l'implémentation SQLite, pour que toute implémentation
 * de {@link MessageStore} (y compris un double de test) partage la même
 * limite — pas une coïncidence entre deux constantes dupliquées.
 */
export const MAX_TEXT_LENGTH_CHARS = 4096;
export const MAX_RESPONSE_TEXT_LENGTH_CHARS = 4096;

export interface StoredMessageRow {
  readonly providerMessageId: string;
  readonly senderId: string;
  readonly text: string;
  readonly status: MessageStatus;
  readonly attempts: number;
  readonly responseText: string | null;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly lastError: string | null;
  readonly receivedAt: string;
  readonly updatedAt: string;
}

export interface AdmitInput {
  readonly providerMessageId: string;
  readonly senderId: string;
  readonly text: string;
  readonly now: string;
}

/**
 * `contentMismatch` est renseigné dès que ce `providerMessageId` existait
 * déjà avec un `senderId`/`text` différent — admis ou dupliqué, le texte et
 * l'expéditeur **stockés à la première admission ne sont jamais réécrits**
 * silencieusement par une admission ultérieure (voir `sqlite-message-store.ts`
 * § admit). C'est à l'appelant (`server.ts`) de journaliser ce cas.
 */
export type AdmissionOutcome =
  | { readonly kind: 'admitted'; readonly contentMismatch: boolean }
  | { readonly kind: 'duplicate'; readonly contentMismatch: boolean }
  | { readonly kind: 'rejected_capacity' }
  | { readonly kind: 'closed' }
  /**
   * Texte entrant au-delà de `MAX_TEXT_LENGTH_CHARS` (`sqlite-message-store.ts`)
   * — limite **applicative locale**, jamais présentée comme une limite
   * officielle Meta (non vérifiée). Rejet **permanent** : jamais mis en
   * file, jamais retenté automatiquement — une redélivraison du même texte
   * échouerait identiquement.
   */
  | { readonly kind: 'rejected_text_too_long' };

/**
 * Défauts proposés (ADR-0023 § Données et rétention), pas encore actés
 * comme politique de production — valeurs raisonnables pour cette tranche.
 * `fullPurgeAfterMs` doit toujours être nettement supérieur à
 * `contentRetentionMs` : le contenu est effacé en premier, la ligne
 * (identifiant seul, pour la déduplication tardive) ne disparaît que
 * bien plus tard.
 */
export const DEFAULT_CONTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
export const DEFAULT_FULL_PURGE_AFTER_MS = 180 * 24 * 60 * 60 * 1000; // 180 jours

export interface PurgeOptions {
  readonly now: string;
  readonly contentRetentionMs?: number;
  readonly fullPurgeAfterMs?: number;
  /** `true` (défaut) : calcule ce qui serait purgé sans rien modifier — voir `purge-retained-content.ts`. */
  readonly dryRun?: boolean;
}

export interface PurgeReport {
  /** Lignes `sent`/`failed` dont `text`/`response_text` ont été (ou seraient) effacés. */
  readonly contentCleared: number;
  /** Lignes `sent`/`failed` entièrement supprimées (au-delà de `fullPurgeAfterMs`). */
  readonly rowsDeleted: number;
}

export interface RecoveryReport {
  /** `processing` retrouvé au démarrage, remis en `queued` (aucun effet de bord possible — ADR-0023). */
  readonly resumedProcessing: number;
  /** `sending` retrouvé au démarrage, mis en quarantaine `uncertain` (jamais classé non-envoyé). */
  readonly quarantinedSending: number;
  /**
   * `response_ready` retrouvé au démarrage — compté, **non muté** par cette
   * méthode : c'est la boucle normale du worker (`claimNextResponseReady`)
   * qui les reprendra, exactement comme en fonctionnement courant, réponse
   * déjà stockée réutilisée sans régénération.
   */
  readonly pendingResponseReady: number;
}

/** Une transition a été demandée depuis un état qui ne la permet pas — jamais silencieuse. */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly providerMessageId: string,
    public readonly expectedFrom: MessageStatus,
    public readonly to: MessageStatus,
  ) {
    super(
      `Transition illégale pour "${providerMessageId}" : attendu depuis "${expectedFrom}" vers "${to}", ` +
        `mais l'état courant ne le permettait pas (déjà transitionné, ou jamais atteint cet état).`,
    );
    this.name = 'IllegalTransitionError';
  }
}

/** Exclusivité de process non obtenue — voir `sqlite-message-store.ts` § ouverture/verrouillage. */
export class ExclusivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExclusivityError';
  }
}

/** Schéma stocké incompatible avec cette version du code — jamais de migration implicite. */
export class UnsupportedSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSchemaError';
  }
}

/**
 * Le fichier à `filePath` n'a pas pu être ouvert comme une base SQLite
 * valide — corruption, fichier étranger, ou toute autre erreur d'ouverture
 * non reconnue comme une simple exclusivité déjà détenue (code SQLite
 * distinct, voir `sqlite-message-store.ts` § ouverture). Refus prudent,
 * jamais de reconstruction automatique qui écraserait un fichier peut-être
 * récupérable.
 */
export class CorruptStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptStoreError';
  }
}

/**
 * ## Politique exacte de réouverture d'un `failed` sur redélivraison
 *
 * `admit()` ne rouvre un `failed` que si `attempts < maxAdmissionAttempts`
 * (défaut 5) — au-delà, doublon permanent, jamais de boucle de tentatives
 * même si le fournisseur redélivre indéfiniment un message que son
 * destinataire rejette de façon permanente (ex. numéro invalide).
 *
 * La **cible** de la réouverture dépend de la phase qui a échoué, dérivée
 * de `response_text` (pas une colonne séparée — suffisant, voir
 * `sqlite-message-store.ts` § admit) :
 *
 * - `response_text IS NULL` → l'échec vient de la **génération**
 *   (`recordGenerationFailed`, jamais appelée après un `recordResponseReady`
 *   réussi) → réouverture vers **`queued`** : une nouvelle génération est
 *   nécessaire, il n'existe rien à réutiliser.
 * - `response_text IS NOT NULL` → l'échec vient de l'**envoi**
 *   (`recordSendRejected`, uniquement depuis `sending`, qui ne s'atteint
 *   qu'après un `recordResponseReady` réussi) → réouverture vers
 *   **`response_ready`** directement : la réponse déjà générée est
 *   **réutilisée telle quelle**, le service conversationnel n'est **jamais**
 *   rappelé une seconde fois pour le même message.
 *
 * Un `uncertain` (issue d'envoi non prouvée) n'est **jamais** rouvert par
 * ce mécanisme, quel que soit `attempts` — seule une décision explicite,
 * hors de cette politique automatique, peut le faire réévoluer.
 */
export interface MessageStore {
  /**
   * Rejette explicitement (`rejected_text_too_long`) un texte entrant
   * au-delà de `MAX_TEXT_LENGTH_CHARS` **avant** toute transaction —
   * un nombre de lignes borné (`maxStoredMessages`) ne borne pas, seul, le
   * volume disque si chaque ligne pouvait porter un texte arbitrairement long.
   */
  admit(input: AdmitInput): AdmissionOutcome;

  /**
   * `queued` → `processing`. `undefined` si rien d'éligible.
   *
   * N'incrémente **plus** `attempts` (contrairement à une version
   * antérieure de cette implémentation) : `attempts` compte désormais les
   * **réouvertures** d'un `failed` déclenchées par une redélivraison
   * (voir `admit`), pas les réclamations normales — un message qui réussit
   * du premier coup garde `attempts = 0`. C'est ce compteur de
   * réouvertures, borné par `maxAdmissionAttempts`, qui empêche un rejet
   * **permanent** du fournisseur de devenir une boucle de tentatives :
   * au-delà de la borne, la ligne `failed` reste un doublon pour toujours.
   */
  claimNextQueued(now: string): StoredMessageRow | undefined;

  /**
   * `response_ready` → `sending`. Utilisé aussi bien en fonctionnement
   * normal (juste après `recordResponseReady`) qu'à la reprise après crash
   * pour un `response_ready` laissé par un process précédent — dans les
   * deux cas, c'est l'appelant qui procède ensuite à l'envoi réel, jamais
   * ce store lui-même. `undefined` si rien d'éligible.
   */
  claimNextResponseReady(now: string): StoredMessageRow | undefined;

  /** `processing` → `response_ready`. Lève {@link IllegalTransitionError} si l'état courant diffère. */
  recordResponseReady(providerMessageId: string, responseText: string, now: string): void;

  /** `sending` → `sent`. */
  recordSent(providerMessageId: string, now: string): void;

  /** `sending` → `failed` — uniquement pour un échec **démontré sans envoi** (ex. rejet 4xx explicite). */
  recordSendRejected(providerMessageId: string, reason: string, now: string): void;

  /** `processing` → `failed` — échec certain du service conversationnel, aucun envoi n'a pu avoir lieu. */
  recordGenerationFailed(providerMessageId: string, reason: string, now: string): void;

  /** `sending` → `uncertain` — jamais renvoyé automatiquement, voir ADR-0023. */
  recordUncertain(providerMessageId: string, reason: string, now: string): void;

  /** Reprise au démarrage, exécutée une seule fois, après acquisition confirmée de l'exclusivité. */
  recoverAfterRestart(now: string): RecoveryReport;

  /**
   * Purge manuelle (jamais programmée automatiquement dans cette tranche —
   * voir `purge-retained-content.ts`). Ne touche **jamais** le travail
   * actif (`queued`/`processing`/`response_ready`/`sending`) ni un
   * `uncertain` (ambiguïté non résolue) : liste **positive**
   * `status IN ('sent','failed')` uniquement, jamais un blocage par
   * exclusion qui laisserait passer un futur statut ajouté par erreur.
   */
  purgeRetainedContent(options: PurgeOptions): PurgeReport;

  getRow(providerMessageId: string): StoredMessageRow | undefined;

  /** Lignes en travail actif (`queued`/`processing`/`response_ready`/`sending`). */
  countActive(): number;

  /** Toutes les lignes, y compris terminales (`sent`/`failed`/`uncertain`) — voir § rétention. */
  countTotal(): number;

  close(): void;
}
