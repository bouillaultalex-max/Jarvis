import type { LegalSourceAuthority, LegalSourceType } from '@jarvis/legal-core';

/**
 * Types de la phase « découverte » du Research Engine — jalon LEGAL-03A
 * (ADR-0011, ADR-0012).
 *
 * Aucun type de ce fichier ne connaît un fournisseur particulier :
 * `collection` et `legalStatus` sont des chaînes **ouvertes** dont le
 * vocabulaire appartient au fournisseur (ex. `CODE_DATE`, `VIGUEUR`). Une
 * `SearchReference` n'est **jamais** une `LegalSource` : elle désigne un
 * candidat à récupérer, sans texte, sans empreinte de contenu et sans
 * garantie de version (ADR-0012).
 */

/** Mode de correspondance des termes — vocabulaire du domaine, traduit par chaque adapter. */
export type SearchMatchMode = 'all_terms' | 'any_term' | 'exact_phrase';

/** Champ visé par la recherche. `article_number` est le seul mode ciblé observé en Sandbox. */
export type SearchField = 'any' | 'article_number';

export interface SearchPageRequest {
  /** Numéro de page, à partir de 1. Pagine des **résultats** du fournisseur, pas des articles (ADR-0011). */
  readonly number: number;
  readonly size: number;
}

/**
 * Requête de recherche indépendante du fournisseur. Ne contient aucun
 * payload spécifique : la traduction (fond, filtres, `DATE_VERSION`…)
 * appartient à l'adapter (ADR-0017).
 */
export interface SearchQuery {
  /** Termes recherchés — chaîne non vide. */
  readonly text: string;
  readonly matchMode: SearchMatchMode;
  readonly field?: SearchField;
  /** Restreint aux natures de source voulues, si le fournisseur sait filtrer. */
  readonly sourceTypes?: readonly LegalSourceType[];
  /**
   * Date **juridique** de référence (ISO 8601) : « quel droit s'applique à
   * cette date ». Jamais une date de consultation. Certains fonds l'exigent
   * (ADR-0017 : `CODE_DATE` sans filtre de date est inutilisable).
   */
  readonly asOf?: string;
  readonly page: SearchPageRequest;
}

/**
 * Trace de la découverte d'une référence : de quelle requête, de quelle
 * page et de quelle position elle provient. Permet d'expliquer plus tard
 * pourquoi une source a été retenue (chaîne Conclusion → … → Source).
 */
export interface SearchProvenance {
  /** Identifiant du provider de recherche (ex. `legifrance`). */
  readonly providerId: string;
  /** Fond/collection interrogé, tel que le fournisseur le nomme (ex. `CODE_DATE`). */
  readonly collection: string;
  /** Requête telle qu'émise. */
  readonly query: SearchQuery;
  /** Instant d'exécution de la recherche (ISO 8601) — jamais une validité juridique. */
  readonly executedAt: string;
  /** Page demandée (>= 1). */
  readonly page: number;
  /** Position (0-based) du résultat/conteneur dans la page. */
  readonly resultIndex: number;
  /**
   * Identifiant du résultat/conteneur, tel que fourni (ex. `<texte>_<date>` observé en Sandbox).
   * Absent si le fournisseur n'en a pas donné : jamais inventé, jamais remplacé par un index.
   */
  readonly resultId?: string;
  readonly sectionIndex?: number;
  readonly extractIndex?: number;
}

/**
 * Référence issue d'une recherche — représentation **intermédiaire**
 * (ADR-0012). Tous les champs facultatifs ne sont renseignés que s'ils sont
 * réellement fournis : aucune valeur n'est déduite ni fabriquée.
 */
export interface SearchReference {
  readonly authority: LegalSourceAuthority;
  readonly collection: string;
  /**
   * Identifiant du candidat tel que fourni (ex. un `LEGIARTI…` observé).
   * Désigne une version précise selon les observations Sandbox (ADR-0013),
   * mais reste opaque pour le domaine ; seul le `RetrievalPort` sait s'il
   * est récupérable.
   */
  readonly candidateId: string;
  /** Titre ou numéro affiché (ex. `L1237-1`). */
  readonly title?: string;
  /** État tel que fourni, vocabulaire ouvert. Non normalisé. */
  readonly legalStatus?: string;
  /**
   * `dateVersion` du fournisseur, ISO 8601, **sémantique variable** :
   * observé égal à `dateDebut` pour une version en vigueur mais à `dateFin`
   * pour une version abrogée. Ne jamais lire comme `effectiveFrom`
   * (ADR-0014).
   */
  readonly dateVersion?: string;
  /** Début de force de droit **tel que fourni par la recherche**, si fourni. À confirmer par la récupération. */
  readonly effectiveFrom?: string;
  /** Fin de force de droit ; absent si aucune borne connue (sentinelle convertie en absence par l'adapter). */
  readonly effectiveTo?: string;
  /** Extrait de recherche. Aperçu uniquement, jamais le texte de la source. */
  readonly excerpt?: string;
  /**
   * Nature du conteneur telle que fournie (ex. `code`). Indication
   * informative : n'est **jamais** reprise telle quelle dans
   * `LegalSource.sourceType`.
   */
  readonly containerNature?: string;
  /**
   * Identifiant du texte parent, **uniquement** s'il est fourni sous forme
   * structurée. Ne pas l'extraire d'une chaîne composite (ADR-0012).
   */
  readonly parentTextId?: string;
  readonly provenance: SearchProvenance;
}

/** Raisons pour lesquelles un élément d'une page n'a produit aucune `SearchReference`. */
export type SearchSkipReason = 'no_candidate_id' | 'malformed_item';

/** Élément d'un résultat écarté : tracé, jamais silencieusement ignoré. */
export interface SearchSkippedItem {
  readonly reason: SearchSkipReason;
  readonly resultIndex: number;
  readonly sectionIndex?: number;
  readonly extractIndex?: number;
}

export interface SearchMetadata {
  readonly page: number;
  readonly pageSize: number;
  /** Nombre de résultats (conteneurs) dans cette page — pas un nombre d'articles. */
  readonly resultCount: number;
  /** Total de **résultats** annoncé par le fournisseur, si fourni. Même unité que `resultCount`. */
  readonly totalResults?: number;
  /**
   * Somme des articles correspondants **non exposés** dans les extraits
   * (`moreArticlesCount` observé). Leur accès n'est pas établi (ADR-0011,
   * décision ouverte) : ils constituent une lacune de recherche, à signaler.
   */
  readonly unexposedArticleCount?: number;
}

/**
 * Une page de résultats normalisée. `references` respecte l'ordre reçu et
 * **peut contenir des doublons** : la déduplication est une étape séparée
 * (ADR-0013), jamais faite silencieusement par le provider.
 */
export interface SearchResultPage {
  readonly references: readonly SearchReference[];
  readonly skipped: readonly SearchSkippedItem[];
  readonly metadata: SearchMetadata;
}
