/**
 * Erreurs de **fichier** : le fichier existe mais ne peut pas être interprété
 * de façon sûre (corruption, version inconnue) — jamais confondu avec une
 * absence. Miroir délibéré de `MemoryFileError` (`@jarvis/memory`), jamais
 * importé : packages feuilles indépendants.
 */
export type ProjectBriefFileErrorReason =
  'empty_file' | 'invalid_json' | 'unknown_version' | 'invalid_structure' | 'duplicate_id';

export class ProjectBriefFileError extends Error {
  constructor(
    readonly reason: ProjectBriefFileErrorReason,
    readonly filePath: string,
  ) {
    super(`ProjectBriefFileError[${reason}] : fichier « ${filePath} » illisible.`);
    this.name = 'ProjectBriefFileError';
  }
}

/**
 * Erreurs **opérationnelles** du store (id invalide, projet déjà existant,
 * verrou déjà détenu, élément absent, transition de décision impossible) —
 * distinctes des erreurs de fichier : toujours dues à l'opération demandée,
 * jamais à une corruption du fichier lui-même.
 */
export type ProjectBriefStoreErrorReason =
  | 'invalid_id'
  | 'invalid_input'
  | 'already_exists'
  | 'not_found'
  | 'locked'
  | 'unknown_question'
  | 'unknown_decision'
  | 'invalid_transition'
  | 'already_answered';

export class ProjectBriefStoreError extends Error {
  constructor(
    readonly reason: ProjectBriefStoreErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectBriefStoreError';
  }
}
