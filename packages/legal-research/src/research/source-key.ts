import type { LegalSource } from '@jarvis/legal-core';

import type { SearchReference } from './search-types.js';

/**
 * Clés d'identité du Research Engine — jalon LEGAL-03A (ADR-0013).
 *
 * Deux clés, car l'information disponible n'est pas la même avant et après
 * la récupération :
 *
 *   - avant : une `SearchReference` ne porte ni `identifier` (`cid`) ni
 *     `version` ; seul `candidateId` la distingue (observé : l'identifiant
 *     d'un extrait désigne **une version** d'un article) ;
 *   - après : `LegalSource` porte `identifier` + `version`.
 *
 * `identifier` seul serait **incorrect** : il est stable à travers les
 * versions (observé sur l'article L3121-27 : deux versions, un seul
 * `identifier`) et fusionnerait donc des versions juridiquement distinctes.
 * `contentHash` n'entre dans aucune clé : deux versions au contenu identique
 * restent deux versions, jamais fusionnées automatiquement.
 *
 * Les composantes sont sérialisées en JSON pour qu'aucun séparateur ne
 * puisse créer d'ambiguïté entre deux valeurs différentes.
 */

/** Clé de déduplication **avant** récupération : `authority` + `candidateId`. */
export function referenceKey(
  reference: Pick<SearchReference, 'authority' | 'candidateId'>,
): string {
  return JSON.stringify([reference.authority, reference.candidateId]);
}

/** Clé de déduplication **après** récupération : `authority` + `identifier` + `version`. */
export function sourceKey(
  source: Pick<LegalSource, 'authority' | 'identifier' | 'version'>,
): string {
  return JSON.stringify([source.authority, source.identifier, source.version]);
}

/**
 * Clé de groupement des versions d'**un même article** : `authority` +
 * `identifier` (`cid`, stable à travers les versions). Sert à réunir les
 * `RetrievalResult` de versions distinctes d'un même article avant résolution
 * temporelle — jamais à déduplication de sources (voir `sourceKey`).
 *
 * La question de savoir si un même `identifier` peut désigner deux articles
 * dans des fonds différents d'une même autorité n'est pas tranchée (ouverte).
 */
export function identifierKey(source: Pick<LegalSource, 'authority' | 'identifier'>): string {
  return JSON.stringify([source.authority, source.identifier]);
}
