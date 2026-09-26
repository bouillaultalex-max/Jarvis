import type { LegalSource } from '@jarvis/legal-core';

import type { RetrievalResult } from './retrieval-types.js';
import { identifierKey } from './source-key.js';
import type { SourceVersionRef, VersionCompleteness, VersionHistory } from './temporal-types.js';

/**
 * Assembleur d'historique de versions — fonction **pure** (aucune I/O, aucune
 * horloge, aucune mutation), maillon entre les `RetrievalResult` et le
 * `VersionResolver` (ADR-0018).
 *
 * ## Pourquoi
 * `RetrievalResult.versions` provient de `articleVersions`, qui peut être
 * **incomplet et ne pas contenir la version récupérée** (observé : L36-11). Le
 * resolver a besoin d'un historique qui inclut la version réellement lue.
 *
 * ## Ce que fait l'assembleur
 * Pour les `RetrievalResult` d'**un même article**, réunit
 *   - la version réellement récupérée (`id`, `version`, bornes issues de
 *     `source` — sans `state`, que `LegalSource` ne porte pas) ;
 *   - les entrées de `versions` (`articleVersions`) de chaque résultat ;
 * puis fusionne les entrées de même `id`.
 *
 * ## Règle de fusion (même `id`)
 * - champs présents des deux côtés **identiques** → fusion ;
 * - champ présent d'un seul côté → **conservé** (ex. `state`, absent de la
 *   version reconstruite depuis `source`) ;
 * - **contradiction** (champ présent des deux côtés, valeurs différentes) →
 *   les deux entrées sont **transmises**, sans écrasement : le resolver
 *   répondra `indeterminate / insufficient_version_data`. L'assembleur ne
 *   résout jamais une contradiction.
 *
 * Deux limites assumées :
 * - l'égalité est **textuelle** : l'assembleur ne valide ni n'interprète aucune
 *   date. Deux écritures différentes d'un même instant sont donc vues comme une
 *   contradiction (fausse alerte prudente, jamais une réponse fausse) ; les
 *   deux sources de dates actuelles utilisent la même conversion et coïncident ;
 * - `effectiveTo` absent peut signifier « ouvert » ou « inconnu » (confondus en
 *   amont) ; un `effectiveTo` présent d'un seul côté est conservé.
 *
 * ## Exhaustivité
 * `unknown` par défaut. L'assembleur **ne déduit jamais** `complete` : il ne
 * l'accepte que fournie explicitement (tests, futures preuves). Il n'utilise pas
 * `previousVersionId` et ne parcourt aucune chaîne.
 *
 * ## Résultat
 * Ne dépend pas de l'ordre des entrées ni des résultats (tri canonique avant
 * fusion et en sortie).
 *
 * @throws {RangeError} si les résultats ne concernent pas un même article
 *   (`authority` + `identifier`) — le regroupement est fait par l'appelant.
 */

type VersionFields = 'version' | 'state' | 'effectiveFrom' | 'effectiveTo';
const FIELDS: readonly VersionFields[] = ['version', 'state', 'effectiveFrom', 'effectiveTo'];

/** Version réellement récupérée, exprimée comme référence de version (sans `state`). */
function refOfSource(source: LegalSource): SourceVersionRef {
  return {
    id: source.id,
    version: source.version,
    effectiveFrom: source.effectiveFrom,
    ...(source.effectiveTo !== undefined ? { effectiveTo: source.effectiveTo } : {}),
  };
}

function canonical(ref: SourceVersionRef): string {
  return JSON.stringify([ref.id, ...FIELDS.map((field) => ref[field] ?? null)]);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compatibles : aucun champ présent des deux côtés avec des valeurs différentes. */
function compatible(a: SourceVersionRef, b: SourceVersionRef): boolean {
  return FIELDS.every(
    (field) => a[field] === undefined || b[field] === undefined || a[field] === b[field],
  );
}

/** Fusionne deux entrées compatibles : les champs absents d'un côté sont comblés par l'autre. */
function merge(a: SourceVersionRef, b: SourceVersionRef): SourceVersionRef {
  const merged: { -readonly [K in keyof SourceVersionRef]: SourceVersionRef[K] } = { id: a.id };
  for (const field of FIELDS) {
    const value = a[field] ?? b[field];
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}

export function assembleVersionHistory(
  retrievals: readonly RetrievalResult[],
  completeness: VersionCompleteness = 'unknown',
): VersionHistory {
  if (new Set(retrievals.map((retrieval) => identifierKey(retrieval.source))).size > 1) {
    throw new RangeError(
      'assembleVersionHistory : les résultats doivent concerner un même article (même authority + identifier).',
    );
  }

  const entries = retrievals.flatMap((retrieval) => [
    refOfSource(retrieval.source),
    ...retrieval.versions,
  ]);
  const sorted = [...entries].sort((a, b) => compare(canonical(a), canonical(b)));

  const variantsById = new Map<string, SourceVersionRef[]>();
  for (const entry of sorted) {
    const variants = variantsById.get(entry.id) ?? [];
    const index = variants.findIndex((variant) => compatible(variant, entry));
    if (index < 0) variants.push(merge(entry, entry));
    else variants[index] = merge(variants[index]!, entry);
    variantsById.set(entry.id, variants);
  }

  const versions = [...variantsById.values()]
    .flat()
    .sort((a, b) => compare(canonical(a), canonical(b)));
  return { versions, completeness };
}
