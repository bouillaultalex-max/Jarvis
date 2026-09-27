import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { parseLegalCaseFile, serializeLegalCaseFile, type LegalCase } from '@jarvis/legal-core';

/**
 * `@jarvis/legal-case-store` — persistance des dossiers juridiques (LEGAL-STORE-01).
 *
 * Package **séparé** de `@jarvis/legal-core` (seule dépendance, par son point
 * d'entrée public) : `legal-core` reste une feuille sans I/O — voir son garde-fou
 * `architecture-boundaries.test.ts` (« le seul module node importé est
 * `node:crypto` »), volontairement non modifié par ce chantier. La persistance
 * est donc une couche au-dessus du modèle, pas un ajout au modèle lui-même.
 *
 * Aucune abstraction partagée avec `@jarvis/memory` (`FileMemoryStore`) : les
 * deux mémoires — générale et dossiers juridiques — restent des espaces
 * étanches (`LEGAL_SPECIFICATION.md` §5). Seule la **stratégie** d'écriture
 * atomique est reprise par inspiration (fichier temporaire, `fsync`, `rename`),
 * pas le code.
 *
 * ## Convention de stockage : un fichier JSON par dossier
 * `<baseDir>/<id>.json`. `LegalCase.id` n'est contraint par
 * `validateLegalCaseV3` qu'à être une chaîne non vide : il ne peut donc pas
 * être utilisé sans contrôle dans un chemin de fichier (traversée de
 * répertoire, séparateurs). Ce store **restreint** l'identifiant accepté à
 * `[A-Za-z0-9_-]+` — tout autre identifiant est refusé (`LegalCaseStoreError`
 * `invalid_id`), avant tout accès disque. `createLegalCase` (défaut :
 * `randomUUID()`) respecte déjà ce format.
 *
 * ## Ce qui est persistant
 * Exactement ce que {@link serializeLegalCaseFile} sérialise. **Aucun contenu
 * textuel juridique** : le texte d'une source récupérée (`RetrievedContent`,
 * `@jarvis/legal-research`) n'est, et ne peut structurellement pas être, un
 * champ de `LegalCase` — ce store ne fait qu'appeler `serializeLegalCaseFile`/
 * `parseLegalCaseFile`, qui l'ignorent déjà. Un futur stockage durable de ce
 * contenu (`ContentStore`) est un chantier séparé, hors périmètre ici.
 *
 * ## Lecture (`load`)
 *   - fichier **absent** ⇒ `undefined`, aucune erreur, aucun fichier créé ;
 *   - fichier **vide** ⇒ `LegalCaseStoreError('empty_file')` — jamais confondu
 *     avec une absence ;
 *   - **JSON invalide** ⇒ `LegalCaseStoreError('invalid_json')` ;
 *   - **format legacy v2** ⇒ `LegalCaseFileError('legacy_version')` (levée par
 *     `parseLegalCaseFile`, `@jarvis/legal-core`, propagée telle quelle — jamais
 *     lue « comme » v3, jamais migrée implicitement) ;
 *   - **version inconnue / structure invalide / dossier invalide** ⇒ les motifs
 *     correspondants de `LegalCaseFileError` (`parseLegalCaseFile`, inchangé).
 *
 * ## Écriture (`save`)
 * Valide **avant** tout accès disque (`serializeLegalCaseFile`, qui lève
 * `LegalCaseFileError('invalid_case')` si le dossier est invalide). Puis
 * écriture **atomique**, par inspiration de `FileMemoryStore` : `mkdir -p` de
 * `baseDir`, fichier temporaire unique `<chemin>.<pid>-<hex>.tmp`, écriture
 * complète, `fsync`, puis `rename` sur le fichier cible. Un `rename` est
 * atomique sur un même système de fichiers ⇒ jamais de JSON à moitié écrit à
 * la place d'un dossier existant. Si l'écriture ou le renommage échoue, le
 * fichier temporaire est supprimé du mieux possible (`unlinkSync`, erreur de
 * nettoyage elle-même ignorée) et l'erreur d'origine est propagée — le fichier
 * cible, s'il existait déjà, n'est jamais touché.
 *
 * ## Concurrence
 * Prévu pour **un seul processus** accédant à `baseDir`. Aucun verrou
 * inter-processus : deux instances écrivant le même dossier en parallèle
 * peuvent se perdre des écritures (dernier `rename` gagne) — même limite que
 * `FileMemoryStore`, non résolue ici faute de nécessité démontrée.
 */

/** Lettres, chiffres, `-`, `_` uniquement — jamais un séparateur de chemin. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type LegalCaseStoreErrorReason = 'empty_file' | 'invalid_json' | 'invalid_id';

/**
 * Levée par ce store pour un cas que `@jarvis/legal-core` ne peut pas détecter
 * lui-même (`parseLegalCaseFile` est pur, sans I/O — il ne voit jamais le texte
 * brut d'un fichier) : fichier vide, JSON illisible, ou identifiant de dossier
 * non sûr comme nom de fichier. Toute autre anomalie (structure, version,
 * validité du dossier) reste une `LegalCaseFileError` (`@jarvis/legal-core`),
 * propagée sans changement.
 */
export class LegalCaseStoreError extends Error {
  constructor(
    readonly reason: LegalCaseStoreErrorReason,
    readonly detail?: string,
  ) {
    super(
      `LegalCaseStoreError[${reason}]${detail ? ` : ${detail}` : ''} — dossier juridique illisible sur disque.`,
    );
    this.name = 'LegalCaseStoreError';
  }
}

export interface FileLegalCaseStoreOptions {
  /**
   * Répertoire contenant un fichier JSON par dossier (`<id>.json`). **Fourni
   * explicitement par l'appelant** — jamais deviné, jamais lu depuis
   * l'environnement. Créé à la première écriture s'il n'existe pas encore.
   */
  readonly baseDir: string;
}

export class FileLegalCaseStore {
  private readonly baseDir: string;

  constructor(options: FileLegalCaseStoreOptions) {
    this.baseDir = options.baseDir;
  }

  /**
   * Enregistre `legalCase` sous `<baseDir>/<legalCase.id>.json`, en écrasant
   * un éventuel fichier existant pour le même `id`.
   *
   * @throws {LegalCaseStoreError} `invalid_id` si `legalCase.id` n'est pas un
   *   identifiant de fichier sûr — avant tout accès disque.
   * @throws {LegalCaseFileError} `invalid_case` si `legalCase` est invalide
   *   (`validateLegalCaseV3`, `@jarvis/legal-core`) — avant tout accès disque.
   */
  save(legalCase: LegalCase): void {
    const path = this.pathFor(legalCase.id);
    const serialized = serializeLegalCaseFile(legalCase);

    mkdirSync(this.baseDir, { recursive: true });
    writeAtomic(path, serialized);
  }

  /**
   * Relit le dossier d'identifiant `id`.
   *
   * @returns `undefined` si aucun fichier n'existe pour cet `id` — jamais
   *   confondu avec un fichier présent mais illisible.
   * @throws {LegalCaseStoreError} `invalid_id` si `id` n'est pas un
   *   identifiant de fichier sûr ; `empty_file`/`invalid_json` si le fichier
   *   existe mais n'est pas exploitable en confiance.
   * @throws {LegalCaseFileError} structure invalide, version inconnue, format
   *   legacy v2, ou dossier invalide (`parseLegalCaseFile`, propagé tel quel).
   */
  load(id: string): LegalCase | undefined {
    const path = this.pathFor(id);

    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }

    if (raw.trim().length === 0) {
      throw new LegalCaseStoreError('empty_file', path);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LegalCaseStoreError('invalid_json', path);
    }

    return parseLegalCaseFile(parsed);
  }

  private pathFor(id: string): string {
    if (!SAFE_ID_PATTERN.test(id)) {
      throw new LegalCaseStoreError(
        'invalid_id',
        `identifiant « ${id} » — attendu : lettres, chiffres, "-", "_" uniquement.`,
      );
    }
    return join(this.baseDir, `${id}.json`);
  }
}

/**
 * Écrit `serialized` dans `path` de façon atomique : fichier temporaire unique,
 * écriture complète, `fsync`, `rename`. En cas d'échec (écriture ou
 * renommage), le fichier temporaire est supprimé du mieux possible et l'erreur
 * d'origine est propagée — `path` n'est jamais touché tant que `rename` n'a
 * pas réussi.
 */
function writeAtomic(path: string, serialized: string): void {
  const tempPath = `${path}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  const handle = openSync(tempPath, 'w');
  try {
    writeFileSync(handle, serialized, 'utf-8');
    fsyncSync(handle);
  } catch (err) {
    closeSync(handle);
    cleanupTempFile(tempPath);
    throw err;
  }
  closeSync(handle);

  try {
    renameSync(tempPath, path);
  } catch (err) {
    cleanupTempFile(tempPath);
    throw err;
  }
}

function cleanupTempFile(tempPath: string): void {
  try {
    unlinkSync(tempPath);
  } catch {
    // Best effort : le nettoyage lui-même ne doit jamais masquer l'erreur d'origine.
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
