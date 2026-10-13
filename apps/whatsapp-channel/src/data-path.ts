import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ChannelMode } from './channel-mode.js';

/**
 * Répertoire de données applicatif par défaut — `JARVIS_DATA_DIR` si
 * défini, sinon convention par OS (même que
 * `defaultAccountsFilePath()`, `apps/desktop/src/main.ts`).
 */
function defaultDataDir(): string {
  return (
    process.env.JARVIS_DATA_DIR ??
    (process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')))
  );
}

/**
 * Le mode **réel** vit sous un sous-répertoire `real-trial/` distinct du
 * mode simulé, par défaut — jamais le même fichier. C'est la protection
 * principale contre l'envoi réel de travaux admis en mode simulé (ADR-0023
 * suite, revue de cette mission) : aucun message `queued`/`response_ready`
 * préexistant du store de développement simulé ne peut jamais être
 * ramassé par un worker réel qui ouvre, par défaut, un fichier différent.
 * Aucun store n'est supprimé par ce choix — les deux chemins coexistent.
 *
 * Un override explicite (`WHATSAPP_MESSAGES_DB_PATH`/
 * `WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH`) reste possible et **contourne**
 * volontairement cette séparation — décision de l'opérateur, pas de ce
 * module, documentée ici plutôt que devinée.
 */
function modeSubdirectory(mode: ChannelMode): string {
  return mode === 'real' ? 'real-trial' : '.';
}

export function defaultMessagesDbPath(mode: ChannelMode): string {
  return join(
    defaultDataDir(),
    'jarvis',
    'whatsapp-channel',
    modeSubdirectory(mode),
    'messages.db',
  );
}

export function defaultSendAttemptBudgetDbPath(mode: ChannelMode): string {
  return join(
    defaultDataDir(),
    'jarvis',
    'whatsapp-channel',
    modeSubdirectory(mode),
    'send-attempt-budget.db',
  );
}

/** Override explicite, puis emplacement par défaut dépendant du mode. */
export function resolveMessagesDbPath(mode: ChannelMode): string {
  return process.env.WHATSAPP_MESSAGES_DB_PATH ?? defaultMessagesDbPath(mode);
}

/** Override explicite, puis emplacement par défaut dépendant du mode — n'est jamais ouvert en mode simulé. */
export function resolveSendAttemptBudgetDbPath(mode: ChannelMode): string {
  return process.env.WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH ?? defaultSendAttemptBudgetDbPath(mode);
}
