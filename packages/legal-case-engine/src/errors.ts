/**
 * Erreur typée du moteur de faits et de dossiers (LEGAL-04.1).
 *
 * Toute opération du moteur est **atomique** : elle renvoie un nouveau dossier ou lève
 * cette erreur — jamais de résultat partiel. Le message ne contient que des identifiants
 * techniques et des chemins de champ, **jamais** le contenu d'un fait, d'une question ou
 * d'une pièce (aucun contenu de dossier dans les messages ni dans les journaux).
 *
 * Motifs :
 *   - `invalid_context`  : contexte injecté absent ou invalide (`actorId`, `interactionId`) ;
 *   - `invalid_clock`    : horloge absente, ou instant renvoyé invalide ;
 *   - `invalid_input`    : entrée de l'opération invalide (forme, texte vide, température…) ;
 *   - `duplicate_id`     : identifiant déjà présent (aucun remplacement, jamais) ;
 *   - `unknown_question` : question absente du dossier ;
 *   - `chronology`       : violation chronologique à l'écriture (décision D6), ou dates du
 *                          dossier (`createdAt`, `updatedAt`) qui ne sont pas des instants ;
 *   - `invalid_case`     : le dossier fourni n'est pas un `LegalCase` v3 valide ;
 *   - `invalid_result`   : le dossier résultant est invalide (aucune sortie n'est produite).
 */
export type LegalCaseEngineErrorReason =
  | 'invalid_context'
  | 'invalid_clock'
  | 'invalid_input'
  | 'duplicate_id'
  | 'unknown_question'
  | 'chronology'
  | 'invalid_case'
  | 'invalid_result';

export class LegalCaseEngineError extends Error {
  constructor(
    readonly reason: LegalCaseEngineErrorReason,
    readonly detail: string,
  ) {
    super(`LegalCaseEngineError[${reason}] : ${detail}`);
    this.name = 'LegalCaseEngineError';
  }
}
