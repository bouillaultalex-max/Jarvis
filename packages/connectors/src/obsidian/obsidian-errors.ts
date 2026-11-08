/**
 * Erreurs techniques de `obsidian.read` (ADR-0025, Proposed).
 *
 * Chaque erreur porte un code stable et un message **fixe** : jamais la
 * sortie brute du lanceur, jamais une valeur fournie par l'utilisateur. Le
 * message devient le `reason` du statut `error` de `ToolExecutor` — il peut
 * donc être affiché tel quel par une application.
 */
export type ObsidianReadErrorCode =
  | 'obsidian_not_running'
  | 'launcher_not_found'
  | 'vault_mismatch'
  | 'vault_check_failed'
  | 'vault_root_unavailable'
  | 'link_in_path'
  | 'not_a_file'
  | 'ambiguous_not_found'
  | 'timeout'
  | 'output_too_large'
  | 'process_failed';

export const OBSIDIAN_READ_ERROR_MESSAGES: Readonly<Record<ObsidianReadErrorCode, string>> = {
  obsidian_not_running:
    'Obsidian n’est pas ouvert dans la session Windows courante : lanceur non appelé.',
  launcher_not_found: 'Lanceur Obsidian introuvable au chemin configuré.',
  vault_mismatch:
    'Le vault désigné par Obsidian ne correspond pas à la racine configurée : lecture refusée.',
  vault_check_failed: 'Vérification du vault impossible : lecture refusée.',
  vault_root_unavailable: 'Racine du vault configurée introuvable ou invalide.',
  link_in_path:
    'Le chemin traverse un lien ou une jonction : lecture refusée (sortie possible de la racine).',
  not_a_file: 'Le chemin désigne un dossier, pas une note.',
  ambiguous_not_found:
    'Résultat ambigu : Obsidian signale la note introuvable alors que le fichier existe.',
  timeout: 'Délai maximal dépassé : appel Obsidian interrompu.',
  output_too_large: 'Sortie Obsidian trop volumineuse : lecture interrompue.',
  process_failed: 'Échec de l’appel Obsidian.',
};

export class ObsidianReadError extends Error {
  readonly code: ObsidianReadErrorCode;

  constructor(code: ObsidianReadErrorCode) {
    super(OBSIDIAN_READ_ERROR_MESSAGES[code]);
    this.name = 'ObsidianReadError';
    this.code = code;
  }
}
