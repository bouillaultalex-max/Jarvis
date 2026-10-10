/**
 * Implémentation `node:sqlite` du {@link MessageStore} (ADR-0023). Store
 * transactionnel unique : une seule table, une seule source de vérité pour
 * l'admission, la déduplication et l'état de traitement — remplace
 * `InMemoryDeduplicator` + l'historique d'issues en mémoire de l'ancienne
 * `LocalMessageQueue`.
 *
 * ## Exclusivité de process — PAS un fichier PID
 *
 * Une correction explicite par rapport à la proposition initiale de
 * l'ADR-0023 (fichier PID) : un fichier PID seul ne garantit rien
 * (existence vérifiée puis créée = fenêtre de course ; PID réutilisé par un
 * processus non apparenté = faux positif de vivacité ; un verrou laissé par
 * un crash est ambigu à nettoyer automatiquement sans risque réel). Cette
 * implémentation utilise à la place `PRAGMA locking_mode=EXCLUSIVE` : dès la
 * première transaction d'écriture, SQLite prend et conserve un verrou
 * **OS** (flock/fcntl, mécanisme du noyau, pas un fichier applicatif) sur le
 * fichier de base pour toute la durée de la connexion.
 *
 * Propriétés vérifiées empiriquement (deux process Node réels, pas supposées) :
 *   - acquisition atomique : `BEGIN IMMEDIATE` avec `busy_timeout=0` échoue
 *     **immédiatement** (`ERR_SQLITE_ERROR` / "database is locked") si un
 *     autre process détient déjà le verrou — aucune fenêtre de course entre
 *     une vérification et une acquisition, l'acquisition **est** la
 *     vérification ;
 *   - libération automatique par le noyau à la mort du process détenteur,
 *     **y compris sur `SIGKILL`** — vérifié par un process tué brutalement
 *     puis un second process acquérant immédiatement le même verrou et
 *     relisant les données déjà committées, sans corruption ;
 *   - donc **aucun verrou ambigu à nettoyer** : il n'existe pas de fichier de
 *     verrou séparé pouvant rester en place après un crash. L'état du verrou
 *     est toujours celui que le noyau rapporte à l'instant de l'acquisition,
 *     jamais un fichier obsolète à interpréter.
 *
 * Résiduel assumé : support **mono-process strictement** dans cette tranche
 * (voir ADR-0023 § Limites). Un second process qui tenterait de démarrer
 * pendant que le premier tourne reçoit {@link ExclusivityError} — jamais un
 * démarrage silencieux à deux instances.
 *
 * ## Durabilité — crash process vs coupure électrique
 *
 * `journal_mode=WAL` + `synchronous=FULL` : un commit synchronise le WAL sur
 * disque avant de retourner. D'après la documentation SQLite, cette
 * combinaison protège les transactions committées à la fois contre un crash
 * du process **et** contre une coupure électrique/crash de l'OS (au prix
 * d'un `fsync` par commit). **Non vérifié empiriquement dans cette session**
 * au-delà de la lecture de la documentation officielle — une coupure
 * électrique réelle n'est pas simulable de façon fiable par ces tests.
 * `synchronous=NORMAL` sous WAL ne protégerait que contre un crash process,
 * pas contre une coupure électrique (dernier(s) commit(s) potentiellement
 * perdus, jamais de corruption) — volontairement non retenu ici, la
 * garantie la plus forte étant préférée pour ce qui doit survivre à
 * l'accusé HTTP.
 */
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  type AdmissionOutcome,
  type AdmitInput,
  CorruptStoreError,
  DEFAULT_CONTENT_RETENTION_MS,
  DEFAULT_FULL_PURGE_AFTER_MS,
  ExclusivityError,
  IllegalTransitionError,
  MAX_RESPONSE_TEXT_LENGTH_CHARS,
  MAX_TEXT_LENGTH_CHARS,
  type MessageStatus,
  type MessageStore,
  type PurgeOptions,
  type PurgeReport,
  type RecoveryReport,
  type StoredMessageRow,
  UnsupportedSchemaError,
} from './message-store.js';

/** Codes SQLite distinguant « déjà détenu ailleurs » de « fichier invalide » — voir § ouverture. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

const SUPPORTED_SCHEMA_VERSION = 1;

// `MAX_TEXT_LENGTH_CHARS`/`MAX_RESPONSE_TEXT_LENGTH_CHARS` vivent dans
// `message-store.ts` (voir ce fichier pour la justification) — appliquées
// ici en deux temps : rejet applicatif explicite (`admit()`,
// `durable-message-worker.ts`) **et** contrainte `CHECK` en base
// ci-dessous, filet de sécurité si un bug contournait un jour la
// vérification applicative.

const CREATE_TABLE_SQL = `
CREATE TABLE whatsapp_inbound_messages (
  provider_message_id TEXT PRIMARY KEY,
  sender_id            TEXT NOT NULL,
  text                  TEXT NOT NULL CHECK (length(text) <= ${MAX_TEXT_LENGTH_CHARS}),
  status                TEXT NOT NULL,
  attempts              INTEGER NOT NULL DEFAULT 0,
  response_text         TEXT CHECK (response_text IS NULL OR length(response_text) <= ${MAX_RESPONSE_TEXT_LENGTH_CHARS}),
  claimed_by             TEXT,
  claimed_at             TEXT,
  last_error             TEXT,
  received_at           TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
`;

const ACTIVE_STATUSES: readonly MessageStatus[] = [
  'queued',
  'processing',
  'response_ready',
  'sending',
];

export const DEFAULT_MAX_ACTIVE_DEPTH = 50;
export const DEFAULT_MAX_STORED_MESSAGES = 5000;
export const DEFAULT_MAX_ADMISSION_ATTEMPTS = 5;

export interface SqliteMessageStoreOptions {
  readonly filePath: string;
  readonly maxActiveDepth?: number;
  readonly maxStoredMessages?: number;
  readonly maxAdmissionAttempts?: number;
}

interface RawRow {
  readonly provider_message_id: string;
  readonly sender_id: string;
  readonly text: string;
  readonly status: string;
  readonly attempts: number;
  readonly response_text: string | null;
  readonly claimed_by: string | null;
  readonly claimed_at: string | null;
  readonly last_error: string | null;
  readonly received_at: string;
  readonly updated_at: string;
}

function toRow(raw: RawRow): StoredMessageRow {
  return {
    providerMessageId: raw.provider_message_id,
    senderId: raw.sender_id,
    text: raw.text,
    status: raw.status as MessageStatus,
    attempts: raw.attempts,
    responseText: raw.response_text,
    claimedBy: raw.claimed_by,
    claimedAt: raw.claimed_at,
    lastError: raw.last_error,
    receivedAt: raw.received_at,
    updatedAt: raw.updated_at,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `0o600` sur le fichier principal et ses annexes WAL/SHM — explicite, pas supposé hérité de l'umask. */
function restrictFilePermissions(filePath: string): void {
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try {
      chmodSync(candidate, 0o600);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

export class SqliteMessageStore implements MessageStore {
  readonly #db: DatabaseSync;
  readonly #maxActiveDepth: number;
  readonly #maxStoredMessages: number;
  readonly #maxAdmissionAttempts: number;
  readonly #workerId: string;
  #closed = false;

  private constructor(
    db: DatabaseSync,
    options: { maxActiveDepth: number; maxStoredMessages: number; maxAdmissionAttempts: number },
  ) {
    this.#db = db;
    this.#maxActiveDepth = options.maxActiveDepth;
    this.#maxStoredMessages = options.maxStoredMessages;
    this.#maxAdmissionAttempts = options.maxAdmissionAttempts;
    this.#workerId = `${process.pid}@${new Date().toISOString()}`;
  }

  /**
   * Ouvre (ou crée) le fichier de base, acquiert l'exclusivité de process
   * (voir l'en-tête de fichier), puis applique/vérifie le schéma versionné.
   * Lève {@link ExclusivityError} si un autre process détient déjà le
   * verrou, {@link UnsupportedSchemaError} si le fichier contient un schéma
   * que cette version du code ne sait pas lire.
   */
  static open(options: SqliteMessageStoreOptions): SqliteMessageStore {
    const maxActiveDepth = options.maxActiveDepth ?? DEFAULT_MAX_ACTIVE_DEPTH;
    const maxStoredMessages = options.maxStoredMessages ?? DEFAULT_MAX_STORED_MESSAGES;
    const maxAdmissionAttempts = options.maxAdmissionAttempts ?? DEFAULT_MAX_ADMISSION_ATTEMPTS;

    mkdirSync(dirname(options.filePath), { recursive: true, mode: 0o700 });
    try {
      chmodSync(dirname(options.filePath), 0o700);
    } catch {
      // Répertoire partagé avec des permissions différentes : best-effort,
      // jamais bloquant pour l'ouverture.
    }

    // Toute la séquence d'ouverture — y compris les PRAGMA eux-mêmes, qui
    // peuvent déjà échouer avec "database is locked" si un autre process
    // détient l'exclusivité — doit être couverte par ce `try` : l'erreur
    // n'attend pas forcément `BEGIN IMMEDIATE` pour apparaître.
    const db = new DatabaseSync(options.filePath);
    try {
      db.exec('PRAGMA busy_timeout=0');
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA synchronous=FULL');
      db.exec('PRAGMA locking_mode=EXCLUSIVE');
      db.exec('BEGIN IMMEDIATE');
      db.exec('COMMIT');
    } catch (err) {
      db.close();
      const code = (err as { errcode?: number }).errcode;
      if (code === SQLITE_BUSY || code === SQLITE_LOCKED) {
        throw new ExclusivityError(
          `Un autre process détient déjà l'exclusivité sur "${options.filePath}" : ${errorMessage(err)}`,
        );
      }
      if (code === SQLITE_CORRUPT || code === SQLITE_NOTADB) {
        throw new CorruptStoreError(
          `"${options.filePath}" n'est pas une base SQLite valide ou est corrompu — refus explicite, ` +
            `aucune reconstruction automatique (perdrait les données existantes) : ${errorMessage(err)}`,
        );
      }
      // Erreur non classifiée (permissions, disque plein, etc.) — ne jamais
      // la faire passer pour un simple problème d'exclusivité.
      throw new CorruptStoreError(
        `Échec inattendu à l'ouverture de "${options.filePath}" : ${errorMessage(err)}`,
      );
    }

    const userVersionRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (userVersionRow.user_version === 0) {
      db.exec(CREATE_TABLE_SQL);
      db.exec(`PRAGMA user_version=${SUPPORTED_SCHEMA_VERSION}`);
    } else if (userVersionRow.user_version !== SUPPORTED_SCHEMA_VERSION) {
      const found = userVersionRow.user_version;
      db.close();
      throw new UnsupportedSchemaError(
        `Schéma inattendu dans "${options.filePath}" (user_version=${found}, attendu ` +
          `${SUPPORTED_SCHEMA_VERSION}) — aucune migration automatique dans cette tranche.`,
      );
    }

    restrictFilePermissions(options.filePath);

    return new SqliteMessageStore(db, { maxActiveDepth, maxStoredMessages, maxAdmissionAttempts });
  }

  admit(input: AdmitInput): AdmissionOutcome {
    if (this.#closed) {
      return { kind: 'closed' };
    }
    // Vérifié avant toute transaction — rejet permanent, jamais mis en
    // file, jamais retenté (une redélivraison du même texte échouerait
    // identiquement). Un nombre de lignes borné (`maxStoredMessages`) ne
    // borne pas, seul, le volume disque sans cette limite de longueur.
    if (input.text.length > MAX_TEXT_LENGTH_CHARS) {
      return { kind: 'rejected_text_too_long' };
    }

    try {
      this.#db.exec('BEGIN IMMEDIATE');
      const existing = this.#selectRaw(input.providerMessageId);

      if (existing === undefined) {
        if (
          this.countTotal() >= this.#maxStoredMessages ||
          this.countActive() >= this.#maxActiveDepth
        ) {
          this.#db.exec('ROLLBACK');
          return { kind: 'rejected_capacity' };
        }
        this.#insertStmt().run(
          input.providerMessageId,
          input.senderId,
          input.text,
          input.now,
          input.now,
        );
        this.#db.exec('COMMIT');
        return { kind: 'admitted', contentMismatch: false };
      }

      const contentMismatch = existing.sender_id !== input.senderId || existing.text !== input.text;
      const reopenable =
        existing.status === 'failed' && existing.attempts < this.#maxAdmissionAttempts;

      if (!reopenable) {
        this.#db.exec('COMMIT'); // lecture seule, rien à committer
        return { kind: 'duplicate', contentMismatch };
      }

      if (this.countActive() >= this.#maxActiveDepth) {
        this.#db.exec('ROLLBACK');
        return { kind: 'rejected_capacity' };
      }

      // Réouverture d'un échec démontré sans envoi : jamais le texte/expéditeur
      // d'origine écrasé, même si l'admission entrante diverge (signalé via
      // `contentMismatch`, jamais remplacé silencieusement). Cible dérivée
      // de `response_text` — voir `message-store.ts` § politique de
      // réouverture : une réponse déjà générée est réutilisée
      // (`response_ready`), jamais un échec de génération (`queued`,
      // rien à réutiliser). `attempts` incrémenté ici, pas à la
      // réclamation — c'est ce compteur qui borne le nombre de
      // réouvertures, empêchant un rejet permanent du fournisseur de
      // devenir une boucle de tentatives.
      const reopenTarget: MessageStatus =
        existing.response_text !== null ? 'response_ready' : 'queued';
      this.#reopenStmt().run(reopenTarget, input.now, input.providerMessageId);
      this.#db.exec('COMMIT');
      return { kind: 'admitted', contentMismatch };
    } catch (err) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // Rien à annuler (échec avant toute écriture) — l'erreur d'origine prime.
      }
      throw err;
    }
  }

  claimNextQueued(now: string): StoredMessageRow | undefined {
    const row = this.#db
      .prepare(
        `UPDATE whatsapp_inbound_messages
            SET status = 'processing', claimed_by = ?, claimed_at = ?, updated_at = ?
          WHERE provider_message_id = (
            SELECT provider_message_id FROM whatsapp_inbound_messages
             WHERE status = 'queued' ORDER BY received_at LIMIT 1
          )
          RETURNING *`,
      )
      .get(this.#workerId, now, now) as RawRow | undefined;
    return row === undefined ? undefined : toRow(row);
  }

  claimNextResponseReady(now: string): StoredMessageRow | undefined {
    const row = this.#db
      .prepare(
        `UPDATE whatsapp_inbound_messages
            SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = ?
          WHERE provider_message_id = (
            SELECT provider_message_id FROM whatsapp_inbound_messages
             WHERE status = 'response_ready' ORDER BY received_at LIMIT 1
          )
          RETURNING *`,
      )
      .get(this.#workerId, now, now) as RawRow | undefined;
    return row === undefined ? undefined : toRow(row);
  }

  recordResponseReady(providerMessageId: string, responseText: string, now: string): void {
    this.#guardedTransition(
      providerMessageId,
      'processing',
      'response_ready',
      `UPDATE whatsapp_inbound_messages
          SET status = 'response_ready', response_text = ?, updated_at = ?
        WHERE provider_message_id = ? AND status = 'processing'`,
      [responseText, now, providerMessageId],
    );
  }

  recordSent(providerMessageId: string, now: string): void {
    this.#guardedTransition(
      providerMessageId,
      'sending',
      'sent',
      `UPDATE whatsapp_inbound_messages
          SET status = 'sent', updated_at = ?
        WHERE provider_message_id = ? AND status = 'sending'`,
      [now, providerMessageId],
    );
  }

  recordSendRejected(providerMessageId: string, reason: string, now: string): void {
    this.#guardedTransition(
      providerMessageId,
      'sending',
      'failed',
      `UPDATE whatsapp_inbound_messages
          SET status = 'failed', last_error = ?, updated_at = ?
        WHERE provider_message_id = ? AND status = 'sending'`,
      [reason, now, providerMessageId],
    );
  }

  recordGenerationFailed(providerMessageId: string, reason: string, now: string): void {
    this.#guardedTransition(
      providerMessageId,
      'processing',
      'failed',
      `UPDATE whatsapp_inbound_messages
          SET status = 'failed', last_error = ?, updated_at = ?
        WHERE provider_message_id = ? AND status = 'processing'`,
      [reason, now, providerMessageId],
    );
  }

  recordUncertain(providerMessageId: string, reason: string, now: string): void {
    this.#guardedTransition(
      providerMessageId,
      'sending',
      'uncertain',
      `UPDATE whatsapp_inbound_messages
          SET status = 'uncertain', last_error = ?, updated_at = ?
        WHERE provider_message_id = ? AND status = 'sending'`,
      [reason, now, providerMessageId],
    );
  }

  recoverAfterRestart(now: string): RecoveryReport {
    const resumedProcessing = this.#db
      .prepare(
        `UPDATE whatsapp_inbound_messages SET status = 'queued', updated_at = ? WHERE status = 'processing'`,
      )
      .run(now).changes;

    const quarantinedSending = this.#db
      .prepare(
        `UPDATE whatsapp_inbound_messages
            SET status = 'uncertain', last_error = 'interrupted_by_restart', updated_at = ?
          WHERE status = 'sending'`,
      )
      .run(now).changes;

    const pendingResponseReady = (
      this.#db
        .prepare(
          `SELECT COUNT(*) as n FROM whatsapp_inbound_messages WHERE status = 'response_ready'`,
        )
        .get() as { n: number }
    ).n;

    return {
      resumedProcessing: Number(resumedProcessing),
      quarantinedSending: Number(quarantinedSending),
      pendingResponseReady,
    };
  }

  purgeRetainedContent(options: PurgeOptions): PurgeReport {
    const contentRetentionMs = options.contentRetentionMs ?? DEFAULT_CONTENT_RETENTION_MS;
    const fullPurgeAfterMs = options.fullPurgeAfterMs ?? DEFAULT_FULL_PURGE_AFTER_MS;
    const dryRun = options.dryRun ?? true;
    const nowMs = new Date(options.now).getTime();
    const contentCutoff = new Date(nowMs - contentRetentionMs).toISOString();
    const fullCutoff = new Date(nowMs - fullPurgeAfterMs).toISOString();

    // Comparaison lexicographique sur des horodatages ISO-8601 (ordre
    // chronologique garanti pour ce format) plutôt qu'une arithmétique de
    // date SQLite — évite tout piège d'arrondi/fuseau sur `julianday()`.
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      // `updated_at` n'est JAMAIS retouché ici — effacer le contenu n'est
      // pas une transition de statut, et réécrire cet horodatage
      // remettrait à zéro l'âge de la ligne, l'empêchant indéfiniment
      // d'atteindre un jour `fullPurgeAfterMs` (bug corrigé avant ce commit,
      // détecté par le test de cette méthode).
      const contentCleared = this.#db
        .prepare(
          `UPDATE whatsapp_inbound_messages
              SET text = '', response_text = NULL
            WHERE status IN ('sent','failed')
              AND updated_at < ?
              AND (text != '' OR response_text IS NOT NULL)`,
        )
        .run(contentCutoff).changes;

      const rowsDeleted = this.#db
        .prepare(
          `DELETE FROM whatsapp_inbound_messages WHERE status IN ('sent','failed') AND updated_at < ?`,
        )
        .run(fullCutoff).changes;

      this.#db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
      return { contentCleared: Number(contentCleared), rowsDeleted: Number(rowsDeleted) };
    } catch (err) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // Rien à annuler — l'erreur d'origine prime.
      }
      throw err;
    }
  }

  getRow(providerMessageId: string): StoredMessageRow | undefined {
    const raw = this.#selectRaw(providerMessageId);
    return raw === undefined ? undefined : toRow(raw);
  }

  countActive(): number {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) as n FROM whatsapp_inbound_messages WHERE status IN (${placeholders})`,
      )
      .get(...ACTIVE_STATUSES) as { n: number };
    return row.n;
  }

  countTotal(): number {
    const row = this.#db.prepare('SELECT COUNT(*) as n FROM whatsapp_inbound_messages').get() as {
      n: number;
    };
    return row.n;
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#db.close();
  }

  #selectRaw(providerMessageId: string): RawRow | undefined {
    return this.#db
      .prepare('SELECT * FROM whatsapp_inbound_messages WHERE provider_message_id = ?')
      .get(providerMessageId) as RawRow | undefined;
  }

  #insertStmt(): StatementSync {
    return this.#db.prepare(
      `INSERT INTO whatsapp_inbound_messages
         (provider_message_id, sender_id, text, status, attempts, received_at, updated_at)
       VALUES (?, ?, ?, 'queued', 0, ?, ?)`,
    );
  }

  #reopenStmt(): StatementSync {
    return this.#db.prepare(
      `UPDATE whatsapp_inbound_messages
          SET status = ?, attempts = attempts + 1, updated_at = ?
        WHERE provider_message_id = ?`,
    );
  }

  #guardedTransition(
    providerMessageId: string,
    from: MessageStatus,
    to: MessageStatus,
    sql: string,
    params: readonly string[],
  ): void {
    const result = this.#db.prepare(sql).run(...params);
    if (Number(result.changes) !== 1) {
      throw new IllegalTransitionError(providerMessageId, from, to);
    }
  }
}
