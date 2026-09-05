import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Account, AccountStore } from '../account.js';
import { AccountStoreCorruptedError, UnknownAccountError } from '../errors.js';
import { parseAccountFile, serializeAccountFile } from './account-file-format.js';

/**
 * Implémentation persistante d'{@link AccountStore}, basée sur un unique
 * fichier JSON local — voir `account-file-format.ts` pour le format et le
 * contrat de sécurité (allowlist stricte, aucun credential ne peut être
 * lu ni écrit via ce format).
 *
 * `@jarvis/connectors` reste indépendant de toute application desktop :
 * cette classe ne connaît ni Electron, ni Windows/macOS/Linux, ni
 * `apps/desktop` — le chemin du fichier est entièrement fourni par
 * l'appelant (voir {@link FileAccountStoreOptions.filePath}). C'est à
 * l'application hôte de choisir un chemin approprié à son OS.
 *
 * Pas de cache interne : chaque lecture relit le fichier. À l'échelle
 * réaliste d'un assistant personnel (quelques comptes), c'est largement
 * suffisant et évite toute logique d'invalidation de cache — en
 * particulier, deux instances de `FileAccountStore` pointant vers le même
 * fichier (ex. après un « redémarrage » simulé en test) se voient
 * mutuellement sans synchronisation additionnelle.
 */
export interface FileAccountStoreOptions {
  /** Chemin absolu du fichier JSON. Fourni par l'appelant — jamais deviné ici. */
  readonly filePath: string;
}

export class FileAccountStore implements AccountStore {
  private readonly filePath: string;
  /**
   * Sérialise les écritures concurrentes **sur cette instance** : chaque
   * mutation attend que la précédente ait fini d'écrire avant de relire
   * l'état courant, pour qu'une écriture concurrente n'écrase jamais les
   * modifications d'une autre. Ne protège pas contre deux processus (ou
   * deux instances indépendantes) écrivant le même fichier en parallèle —
   * ce cas nécessiterait un verrou au niveau du système de fichiers,
   * volontairement hors scope ici (voir le bilan M8-A2).
   */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileAccountStoreOptions) {
    this.filePath = options.filePath;
  }

  async register(account: Account): Promise<void> {
    await this.mutate((accounts) => {
      const byId = new Map(accounts.map((existing) => [existing.id, existing] as const));
      byId.set(account.id, account);
      return [...byId.values()];
    });
  }

  async has(accountId: string): Promise<boolean> {
    const accounts = await this.readAll();
    return accounts.some((account) => account.id === accountId);
  }

  async get(accountId: string): Promise<Account> {
    const accounts = await this.readAll();
    const found = accounts.find((account) => account.id === accountId);
    if (found === undefined) {
      throw new UnknownAccountError(accountId);
    }
    return found;
  }

  async listByProvider(provider: string): Promise<Account[]> {
    return (await this.readAll()).filter((account) => account.provider === provider);
  }

  async list(): Promise<Account[]> {
    return this.readAll();
  }

  private async readAll(): Promise<Account[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        // Fichier absent = store vide. On ne le crée pas ici : seule une
        // écriture (register()) crée le fichier.
        return [];
      }
      throw err;
    }

    return parseStoredAccounts(raw, this.filePath);
  }

  /**
   * Lit l'état courant, applique `update`, puis écrit le résultat de façon
   * atomique — le tout mis en file derrière `writeQueue` pour rester
   * cohérent face à des appels concurrents sur cette même instance.
   */
  private async mutate(update: (current: Account[]) => Account[]): Promise<void> {
    const run = this.writeQueue.then(async () => {
      const current = await this.readAll();
      const next = update(current);
      await writeAccountFileAtomic(this.filePath, next);
    });
    // Une mutation en échec ne doit jamais bloquer les suivantes.
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function parseStoredAccounts(raw: string, filePath: string): Account[] {
  if (raw.trim().length === 0) {
    // Le fichier existe mais est vide : notre propre chemin d'écriture ne
    // produit jamais ce résultat (l'écriture atomique ne renomme qu'un
    // fichier temporaire entièrement écrit) — un fichier vide est donc une
    // anomalie (troncature externe, crash avant notre propre premier
    // write…), pas un état légitime de « store vide ». On refuse de le
    // traiter comme tel plutôt que de risquer de masquer une perte de
    // données : voir le bilan M8-A2 pour la justification complète.
    throw new AccountStoreCorruptedError('empty_file', filePath);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AccountStoreCorruptedError('invalid_json', filePath);
  }

  return parseAccountFile(parsed, filePath);
}

async function writeAccountFileAtomic(filePath: string, accounts: readonly Account[]): Promise<void> {
  const serialized = serializeAccountFile(accounts);

  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tempPath, 'w');
  try {
    await handle.writeFile(serialized, 'utf-8');
    // Flush avant rename : réduit le risque qu'un crash juste après le
    // rename laisse un fichier renommé mais pas encore réellement sur
    // disque. Ne couvre pas la durabilité complète en cas de coupure
    // d'alimentation (il faudrait aussi fsync le répertoire) — hors scope
    // pour une app desktop qui se protège d'un crash de process, pas d'une
    // perte d'alimentation.
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(tempPath, filePath);
}
