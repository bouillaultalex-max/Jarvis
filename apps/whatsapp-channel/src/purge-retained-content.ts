/**
 * Purge manuelle de rétention (ADR-0023 § Données et rétention) —
 * **jamais programmée automatiquement** dans cette tranche, volontairement.
 * Ne touche jamais le travail actif ni un `uncertain` (voir
 * `MessageStore.purgeRetainedContent`, liste positive
 * `status IN ('sent','failed')` uniquement).
 *
 * **Doit être exécuté hors ligne** : ce script acquiert la même exclusivité
 * de process que le canal lui-même (`SqliteMessageStore.open`) — il échoue
 * explicitement (`ExclusivityError`) si `main.ts` tourne encore. Arrêter le
 * canal avant d'exécuter cette purge, jamais en même temps.
 *
 * Par défaut **dry-run** (aucune écriture, affiche seulement ce qui serait
 * purgé) — ajouter `--apply` pour réellement muter.
 *
 * Usage (données synthétiques — jamais un numéro/message réel dans ces
 * exemples) :
 *
 * ```bash
 * node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts
 * node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts --apply
 * node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts \
 *   --content-retention-days 14 --full-purge-after-days 90 --apply
 *
 * # --mode (défaut "simulated") choisit lequel des deux stores distincts
 * # purger — voir data-path.ts, jamais le même fichier par défaut entre
 * # mode simulé et mode réel :
 * node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts --mode real
 * ```
 */
import type { ChannelMode } from './channel-mode.js';
import { resolveMessagesDbPath } from './data-path.js';
import { ExclusivityError, UnsupportedSchemaError } from './message-store.js';
import { SqliteMessageStore } from './sqlite-message-store.js';

interface ParsedArgs {
  readonly apply: boolean;
  readonly mode: ChannelMode;
  readonly contentRetentionDays?: number;
  readonly fullPurgeAfterDays?: number;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let apply = false;
  let mode: ChannelMode = 'simulated';
  let contentRetentionDays: number | undefined;
  let fullPurgeAfterDays: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (value !== 'simulated' && value !== 'real') {
        throw new Error(
          `--mode invalide ("${value}") — valeurs acceptées : "simulated" (défaut) ou "real".`,
        );
      }
      mode = value;
    } else if (arg === '--content-retention-days') {
      contentRetentionDays = Number.parseInt(argv[++i] ?? '', 10);
    } else if (arg === '--full-purge-after-days') {
      fullPurgeAfterDays = Number.parseInt(argv[++i] ?? '', 10);
    }
  }
  return { apply, mode, contentRetentionDays, fullPurgeAfterDays };
}

function daysToMs(days: number | undefined): number | undefined {
  return days === undefined || Number.isNaN(days) ? undefined : days * 24 * 60 * 60 * 1000;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveMessagesDbPath(args.mode);

  let store: SqliteMessageStore;
  try {
    store = SqliteMessageStore.open({ filePath: dbPath, mode: args.mode });
  } catch (err) {
    if (err instanceof ExclusivityError) {
      console.error(
        `Purge refusée : "${dbPath}" est déjà ouvert par un autre process (le canal tourne-t-il ` +
          `encore ?). Arrêter le canal avant d'exécuter cette purge. Détail : ${err.message}`,
      );
    } else if (err instanceof UnsupportedSchemaError) {
      console.error(`Purge refusée : ${err.message}`);
    } else {
      console.error('Purge refusée — échec d’ouverture du store :', err);
    }
    process.exitCode = 1;
    return;
  }

  const report = store.purgeRetainedContent({
    now: new Date().toISOString(),
    contentRetentionMs: daysToMs(args.contentRetentionDays),
    fullPurgeAfterMs: daysToMs(args.fullPurgeAfterDays),
    dryRun: !args.apply,
  });
  store.close();

  console.log(
    `${args.apply ? 'Purge appliquée' : 'Dry-run (aucune écriture — relancer avec --apply pour appliquer)'} ` +
      `sur "${dbPath}" : ${report.contentCleared} ligne(s) sent/failed vidée(s) de leur texte, ` +
      `${report.rowsDeleted} ligne(s) sent/failed entièrement supprimée(s). ` +
      `Travail actif et "uncertain" jamais concernés.`,
  );
}

main();
