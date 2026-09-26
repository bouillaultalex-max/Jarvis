import type { LegalSource, LegalSourceAuthority } from '@jarvis/legal-core';

import type { RetrievedContent } from './retrieved-content.js';
import type { SearchReference } from './search-types.js';
import type { SourceVersionRef } from './temporal-types.js';

/**
 * Types de la phase « récupération » — jalon LEGAL-03A (ADR-0011, ADR-0015).
 * La récupération transforme une référence en `LegalSource` canonique ; elle
 * ne résout **aucune** question temporelle (ADR-0014).
 */

export interface RetrievalRequest {
  /**
   * Référence à hydrater. Transporte sa provenance de découverte, qui est
   * conservée dans le résultat.
   */
  readonly reference: SearchReference;
}

/**
 * Résultat d'une récupération réussie.
 *
 * Le **texte** de la source n'est pas un champ de `LegalSource` : il est porté,
 * transitoirement, par `content` (ADR-0021) — opaque, vérifié contre le
 * `contentHash` de `source`, absent de toute sérialisation. Son stockage durable
 * (chiffrement, hors `LegalCase`) reste une décision ouverte (ADR-0011).
 * Le `contentHash` de `source` est calculé côté JARVIS.
 */
export interface RetrievalResult {
  /** Représentation canonique — la version précise désignée par la référence. */
  readonly source: LegalSource;
  /** Historique des versions connu du fournisseur, sous forme générique ; `[]` si non fourni. */
  readonly versions: readonly SourceVersionRef[];
  /** Identité technique de la version précédente, si fournie (`versionPrecedente`). */
  readonly previousVersionId?: string;
  /** Référence de découverte d'origine, conservée pour la provenance. */
  readonly reference: SearchReference;
  /**
   * Contenu juridique **transitoire et vérifié** de cette version (ADR-0021).
   * Capturé pendant l'appel de récupération existant : aucun appel de plus.
   * Absent si le fournisseur n'expose pas de contenu. Jamais persisté ni sérialisé.
   */
  readonly content?: RetrievedContent;
}

/**
 * Demande de récupération d'une **version cible** — issue d'une résolution
 * temporelle (ADR-0019), donc **pas** d'une découverte : elle ne porte aucune
 * `SearchReference` et n'en fabrique jamais. Elle exprime seulement « cette
 * version précise, de cet article ».
 *
 * `authority` et `identifier` sont ceux du groupe (article) dont la résolution
 * est issue ; ils permettent de vérifier que la source reçue est bien celle
 * demandée. La provenance (candidat d'origine, résolution, `asOf`) reste côté
 * moteur, transitoire : le port n'en a pas besoin.
 */
export interface VersionTargetRequest {
  /** Identité technique de la version voulue (`SourceVersionRef.id` = `LegalSource.id`). */
  readonly targetId: string;
  readonly authority: LegalSourceAuthority;
  /** Identifiant stable de l'article attendu (`LegalSource.identifier`). */
  readonly identifier: string;
}

/**
 * Résultat d'une récupération de version cible. Même contenu utile qu'un
 * {@link RetrievalResult}, **sans** `reference` : il n'existe pas de référence de
 * découverte pour une cible, et réutiliser celle du candidat d'origine ferait
 * désigner à `reference` autre chose que ce qu'elle décrit (ADR-0019).
 * Le texte n'est pas un champ de `source` : comme pour `RetrievalResult`, il est
 * porté par `content` (ADR-0021).
 */
export interface VersionTargetResult {
  readonly source: LegalSource;
  /** Historique connu du fournisseur pour cette version ; **jamais** exploité par le moteur (un seul saut). */
  readonly versions: readonly SourceVersionRef[];
  readonly previousVersionId?: string;
  /**
   * Contenu juridique transitoire et vérifié de la version cible (ADR-0021),
   * capturé par l'appel de version cible existant. Propre à cette version : jamais
   * confondu avec celui de la version initialement récupérée.
   */
  readonly content?: RetrievedContent;
}

/**
 * Source correspondant à la version résolue d'un candidat, avec son **mode
 * d'obtention explicite** (jamais déduit) :
 *
 *   - `initial`   : la version résolue est celle que ce candidat a lui-même
 *                   récupérée ; `result` est **le même objet** que `candidate.retrieval` ;
 *   - `shared`    : elle avait déjà été récupérée pour un autre candidat du même
 *                   article ; `result` est le `RetrievalResult` de cet autre candidat
 *                   (même objet, aucun appel) ;
 *   - `retrieved` : elle a été récupérée par un saut (un appel de version cible).
 */
export type ResolvedRetrieval =
  | { readonly mode: 'initial'; readonly result: RetrievalResult }
  | { readonly mode: 'shared'; readonly result: RetrievalResult }
  | { readonly mode: 'retrieved'; readonly result: VersionTargetResult };

export type ResolvedRetrievalMode = ResolvedRetrieval['mode'];
