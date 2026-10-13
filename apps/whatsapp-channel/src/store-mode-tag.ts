/**
 * Marquage durable du mode d'un store SQLite (`SqliteMessageStore` et
 * `SqliteSendAttemptBudget`) — corrige un défaut de la tranche précédente :
 * des chemins par défaut différents entre `simulated`/`real` (`data-path.ts`)
 * ne suffisent pas si une configuration personnalisée (`WHATSAPP_MESSAGES_DB_PATH`/
 * `WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH`) peut les faire converger sur le
 * même fichier. Le mode est écrit **une seule fois**, à la création du
 * schéma, puis vérifié à chaque ouverture ultérieure — jamais réécrit,
 * jamais une migration implicite d'un mode vers l'autre.
 */
import type { DatabaseSync } from 'node:sqlite';

import type { ChannelMode } from './channel-mode.js';

/** Un store créé en mode `simulated` est rouvert en mode `real` (ou l'inverse) — refus explicite. */
export class StoreModeMismatchError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expectedMode: ChannelMode,
    public readonly actualMode: string,
  ) {
    super(
      `"${filePath}" a été créé en mode "${actualMode}" — refus de l'ouvrir en mode "${expectedMode}". ` +
        'Jamais de convergence silencieuse entre un store simulé et un store réel : utilisez un ' +
        'chemin distinct pour chaque mode (voir data-path.ts), ou ouvrez ce fichier dans son mode ' +
        "d'origine.",
    );
    this.name = 'StoreModeMismatchError';
  }
}

const CREATE_STORE_MODE_TABLE_SQL = `
CREATE TABLE store_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL
);
`;

/**
 * À appeler une seule fois par ouverture, juste après la création/
 * vérification du schéma principal (même connexion, pas de transaction
 * séparée nécessaire : un seul `INSERT`/`SELECT`).
 *
 * @param isFreshSchema `true` si le schéma vient d'être créé à l'instant
 *   (première ouverture de ce fichier) — écrit le mode. `false` s'il
 *   existait déjà — vérifie le mode déjà écrit.
 * @throws {StoreModeMismatchError} si le mode enregistré diffère de `mode`,
 *   ou si la table de marquage est absente/corrompue sur un schéma déjà
 *   existant (ne devrait jamais arriver si le schéma a été créé par cette
 *   même fonction).
 */
export function ensureStoreMode(
  db: DatabaseSync,
  filePath: string,
  mode: ChannelMode,
  isFreshSchema: boolean,
): void {
  if (isFreshSchema) {
    db.exec(CREATE_STORE_MODE_TABLE_SQL);
    db.prepare('INSERT INTO store_mode (id, mode) VALUES (1, ?)').run(mode);
    return;
  }

  const row = db.prepare('SELECT mode FROM store_mode WHERE id = 1').get() as
    { readonly mode: string } | undefined;
  const actualMode = row?.mode ?? 'absent (table de marquage manquante)';
  if (actualMode !== mode) {
    throw new StoreModeMismatchError(filePath, mode, actualMode);
  }
}
