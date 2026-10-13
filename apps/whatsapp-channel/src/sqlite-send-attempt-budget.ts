/**
 * Implémentation `node:sqlite` de {@link SendAttemptBudget} — même posture
 * de durabilité que `sqlite-message-store.ts` (`journal_mode=WAL` +
 * `synchronous=FULL`), fichier dédié et distinct du store de messages
 * (préoccupation différente : un verrou à usage unique, pas un cycle de
 * vie de message). N'exige **pas** sa propre exclusivité de process
 * (`locking_mode=EXCLUSIVE`) : ce fichier n'est jamais ouvert que par le
 * même process qui a déjà acquis l'exclusivité sur le `MessageStore`
 * (voir `main.ts`) — un second process réel ne peut donc jamais atteindre
 * ce point par la voie normale de ce canal.
 *
 * **Corrigé en revue finale** : `reserve()` peut malgré tout être appelé
 * par deux connexions concurrentes (vérifié par un vrai test à deux
 * sous-processus, `sqlite-send-attempt-budget.multi-process.test.ts`) —
 * `busy_timeout=5000` laisse une contention brève se résoudre normalement
 * (le perdant obtient alors `'already_consumed'`, pas une erreur) ; toute
 * erreur SQLite au-delà (contention prolongée, corruption, disque plein)
 * est convertie en `'storage_error'`, **jamais un fallback permissif** —
 * l'appelant (`budgeted-outbound-transport.ts`) doit refuser l'envoi dans
 * les deux cas (`'already_consumed'` et `'storage_error'`), jamais
 * seulement le premier.
 */
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ChannelMode } from './channel-mode.js';
import {
  BudgetNotReservedError,
  type ReserveResult,
  type SendAttemptBudget,
  type SendAttemptBudgetState,
  type SendAttemptOutcome,
} from './send-attempt-budget.js';
import { ensureStoreMode } from './store-mode-tag.js';

const CREATE_TABLE_SQL = `
CREATE TABLE send_attempt_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  reason TEXT,
  reserved_at TEXT NOT NULL,
  resolved_at TEXT
);
`;

/** Laisse une contention brève (deux process réels, voir en-tête) se résoudre sans échec artificiel. */
const BUSY_TIMEOUT_MS = 5000;

export interface SqliteSendAttemptBudgetOptions {
  readonly filePath: string;
  /** Vérifié/écrit par `ensureStoreMode()` — jamais de valeur par défaut, voir `store-mode-tag.ts`. */
  readonly mode: ChannelMode;
}

interface RawRow {
  readonly status: string;
  readonly reason: string | null;
  readonly reserved_at: string;
  readonly resolved_at: string | null;
}

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

export class SqliteSendAttemptBudget implements SendAttemptBudget {
  readonly #db: DatabaseSync;
  #closed = false;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  static open(options: SqliteSendAttemptBudgetOptions): SqliteSendAttemptBudget {
    mkdirSync(dirname(options.filePath), { recursive: true, mode: 0o700 });
    try {
      chmodSync(dirname(options.filePath), 0o700);
    } catch {
      // Best-effort, jamais bloquant.
    }

    const db = new DatabaseSync(options.filePath);
    db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');

    const existing = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='send_attempt_budget'`)
      .get();
    const isFreshSchema = existing === undefined;
    if (isFreshSchema) {
      db.exec(CREATE_TABLE_SQL);
    }

    try {
      ensureStoreMode(db, options.filePath, options.mode, isFreshSchema);
    } catch (err) {
      db.close();
      throw err;
    }

    restrictFilePermissions(options.filePath);
    return new SqliteSendAttemptBudget(db);
  }

  /**
   * Synchrone et atomique au sein d'un process (aucune fenêtre d'`await`).
   * Entre deux process réels, une contention brève se résout via
   * `busy_timeout` ; au-delà, ou pour toute autre erreur SQLite,
   * `'storage_error'` — **jamais** traité comme `'reserved'` par erreur.
   */
  reserve(now: string): ReserveResult {
    try {
      const row = this.#db
        .prepare(
          `INSERT INTO send_attempt_budget (id, status, reserved_at)
           VALUES (1, 'reserved', ?)
           ON CONFLICT(id) DO NOTHING
           RETURNING status`,
        )
        .get(now);
      return row === undefined ? 'already_consumed' : 'reserved';
    } catch {
      // Contention prolongée (au-delà de busy_timeout), corruption, disque
      // plein… — refus explicite, jamais un succès supposé.
      return 'storage_error';
    }
  }

  recordOutcome(outcome: SendAttemptOutcome, reason: string | undefined, now: string): void {
    const result = this.#db
      .prepare(
        `UPDATE send_attempt_budget
            SET status = ?, reason = ?, resolved_at = ?
          WHERE id = 1 AND status = 'reserved'`,
      )
      .run(outcome, reason ?? null, now);
    if (Number(result.changes) !== 1) {
      throw new BudgetNotReservedError();
    }
  }

  getState(): SendAttemptBudgetState | undefined {
    const row = this.#db.prepare('SELECT * FROM send_attempt_budget WHERE id = 1').get() as
      RawRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    if (row.status === 'reserved') {
      return { status: 'reserved', reservedAt: row.reserved_at };
    }
    return {
      status: row.status as SendAttemptOutcome,
      reservedAt: row.reserved_at,
      resolvedAt: row.resolved_at!,
      reason: row.reason ?? undefined,
    };
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#db.close();
  }
}
