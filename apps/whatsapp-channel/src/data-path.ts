import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Emplacement par défaut du store durable — même convention que
 * `defaultAccountsFilePath()` (`apps/desktop/src/main.ts`) :
 * `JARVIS_DATA_DIR` si défini, sinon répertoire de données applicatif par
 * OS. Partagé par `main.ts` et `purge-retained-content.ts` pour qu'ils
 * s'accordent toujours sur le même fichier sans dupliquer la logique.
 */
export function defaultMessagesDbPath(): string {
  const dataDir =
    process.env.JARVIS_DATA_DIR ??
    (process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')));

  return join(dataDir, 'jarvis', 'whatsapp-channel', 'messages.db');
}

/** Même convention de résolution que `main.ts` : override explicite, puis emplacement par défaut. */
export function resolveMessagesDbPath(): string {
  return process.env.WHATSAPP_MESSAGES_DB_PATH ?? defaultMessagesDbPath();
}
