/**
 * Concepts temporels du Research Engine — jalon LEGAL-03A (ADR-0014).
 *
 * Types et contrat d'un resolver **uniquement** : aucune résolution n'est
 * implémentée ici. Le resolver est un composant **séparé** du `SearchPort` et
 * du `RetrievalPort` (aucun des deux ne résout jamais « quelle version
 * s'appliquait à telle date »).
 *
 * Rappel (`LegalSource`, `@jarvis/legal-core`) : `effectiveFrom`/`effectiveTo`
 * sont la **seule** paire de dates qui porte une force de droit. `consultedAt`
 * (date d'un acte de consultation) et `publicationDate` ne s'y substituent
 * jamais, et `dateVersion` d'un résultat de recherche non plus tant qu'aucune
 * décision explicite ne l'autorise (voir `SearchReference.dateVersion`).
 */

/**
 * Intervalle de force de droit d'une version — ISO 8601.
 * `effectiveTo` absent = « aucune fin connue » (jamais une date sentinelle
 * littérale comme `2999-01-01`, convertie en absence par l'adapter).
 */
export interface EffectivePeriod {
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

/**
 * Référence à une version d'une source, sous une forme **indépendante du
 * fournisseur** (généralise `LegifranceArticleVersionInfo`, qui reste
 * spécifique à Légifrance).
 *
 * Tous les champs hormis `id` sont optionnels : un fournisseur peut ne pas
 * fournir de dates ou d'état, et le resolver doit alors pouvoir répondre
 * `indeterminate` plutôt que deviner.
 */
export interface SourceVersionRef {
  /** Identité technique de cette version (`LegalSource.id`). */
  readonly id: string;
  /** Version juridique (`LegalSource.version`). */
  readonly version?: string;
  /** État tel que fourni par la source (vocabulaire ouvert : `VIGUEUR`, `ABROGE`…). Jamais normalisé ici. */
  readonly state?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

/**
 * Raisons pour lesquelles **aucune** version n'est applicable à une date.
 * « Aucune version applicable » est une réponse légitime, distincte d'une
 * erreur : les bornes de versions successives ne se recouvrent pas
 * nécessairement (un trou de 2 910 jours est observé entre deux versions
 * d'un même article, voir ADR-0014).
 */
export type NoApplicableVersionReason =
  'before_first_version' | 'gap_between_versions' | 'after_last_version';

/**
 * Exhaustivité déclarée d'un historique de versions — **fournie par
 * l'appelant**, jamais déduite par le resolver.
 *
 *   - `complete` : l'appelant garantit (avec preuve) que la liste contient
 *     **toutes** les versions de la source ;
 *   - `unknown`  : rien n'est garanti. Défaut à retenir dès qu'aucune preuve
 *     n'existe — notamment pour `articleVersions` de Légifrance, observé
 *     **incomplet** (ADR-0018).
 */
export type VersionCompleteness = 'complete' | 'unknown';

/** Historique des versions d'une source + déclaration d'exhaustivité (entrée du resolver). */
export interface VersionHistory {
  readonly versions: readonly SourceVersionRef[];
  readonly completeness: VersionCompleteness;
}

/**
 * Raisons pour lesquelles une résolution reste **indéterminée** (ADR-0018) :
 *
 *   - `insufficient_version_data` : historique vide, date de version absente
 *     ou illisible, identifiant absent, ou doublons contradictoires ;
 *   - `incomplete_history`        : aucune version ne couvre la date, mais
 *     l'historique n'est pas déclaré `complete` (un trou visible n'est donc
 *     jamais une preuve) ;
 *   - `ambiguous_overlap`         : plusieurs versions couvrent la date ;
 *   - `boundary_date`             : la date tombe exactement sur une borne de
 *     version (inclusivité réelle non observée) ;
 *   - `invalid_interval`          : une version a `effectiveTo` <= `effectiveFrom`.
 */
export type IndeterminateVersionReason =
  | 'insufficient_version_data'
  | 'incomplete_history'
  | 'ambiguous_overlap'
  | 'boundary_date'
  | 'invalid_interval';

/** Résultat d'une résolution temporelle. */
export type VersionResolution =
  | { readonly status: 'resolved'; readonly version: SourceVersionRef }
  /** Uniquement si l'historique est déclaré `complete`. */
  | { readonly status: 'none_applicable'; readonly reason: NoApplicableVersionReason }
  /**
   * Les données ne permettent pas de conclure. Jamais une conclusion
   * affirmative. `versionIds` (triés) désigne les versions concernées quand il
   * y en a (chevauchement, bord, données défectueuses).
   */
  | {
      readonly status: 'indeterminate';
      readonly reason: IndeterminateVersionReason;
      readonly versionIds?: readonly string[];
    };

/**
 * Contrat d'un resolver temporel : pur, synchrone, sans I/O, sans horloge.
 *
 * `asOf` est la date **juridique** de référence (ISO 8601) — jamais
 * `consultedAt`. Convention de bords, granularité, chevauchements et champs
 * ignorés : voir ADR-0018 et l'implémentation `resolveVersion`.
 *
 * @throws {RangeError} si `asOf` n'est pas un ISO 8601 interprétable.
 */
export interface VersionResolver {
  resolve(history: VersionHistory, asOf: string): VersionResolution;
}
