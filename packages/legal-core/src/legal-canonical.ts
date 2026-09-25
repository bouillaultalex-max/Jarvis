/**
 * Canonicalisation JSON **versionnée** du modèle juridique — LegalCase v3.
 *
 * Promotion de l'ancien `stableStringify` privé de `legal-case-citations.ts` en
 * primitive partagée de `legal-core` (une seule canonicalisation dans ce package ;
 * `connectors/confirmation/fingerprint.ts` reste hors d'atteinte : `legal-core`
 * est une feuille, et sa sémantique diffère sur `undefined`).
 *
 * ## Version 1
 *   - objets : clés triées selon l'ordre des unités de code UTF-16 (comparaison
 *     par défaut), propriétés `undefined` **omises** ;
 *   - tableaux : ordre **significatif** ;
 *   - primitifs : `JSON.stringify` (chaînes, booléens, `null`, nombres finis) ;
 *   - aucun espace.
 *
 * Sur des données JSON valides, le résultat est identique à celui de l'ancien
 * `stableStringify`. Différence voulue : les valeurs non représentables en JSON
 * (`undefined` en position de valeur, `NaN`/`Infinity`, `bigint`, fonctions,
 * symboles, objets non littéraux, cycles) sont **refusées** (`TypeError`) au lieu
 * de produire silencieusement un résultat indéfini.
 *
 * La version est inscrite dans chaque empreinte (`LegalFingerprint.canonicalization`) :
 * toute version émise doit rester vérifiable ; une version inconnue est refusée.
 */
export const LEGAL_CANONICALIZATION_VERSION = 1;

function isPlainData(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null || Array.isArray(value);
}

function canonicalizeV1(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonicalisation : nombre non fini refusé.');
      }
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalisation : valeur de type « ${typeof value} » refusée.`);
  }

  const object = value as object;
  if (!isPlainData(object)) {
    throw new TypeError('canonicalisation : objet non littéral refusé.');
  }
  if (ancestors.has(object)) {
    throw new TypeError('canonicalisation : référence circulaire refusée.');
  }
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${object.map((item) => canonicalizeV1(item, ancestors)).join(',')}]`;
    }
    const record = object as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalizeV1(record[key], ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(object);
  }
}

const CANONICALIZERS: Readonly<Record<number, (value: unknown) => string>> = {
  1: (value) => canonicalizeV1(value, new Set()),
};

/** `true` si cette version de canonicalisation est supportée. */
export function isSupportedCanonicalization(version: unknown): version is number {
  return (
    typeof version === 'number' && Object.prototype.hasOwnProperty.call(CANONICALIZERS, version)
  );
}

/**
 * Canonicalise `value` avec la version demandée (défaut : version courante).
 *
 * @throws {RangeError} si la version n'est pas supportée.
 * @throws {TypeError} si `value` n'est pas une donnée JSON canonicalisable.
 */
export function canonicalizeLegal(
  value: unknown,
  version: number = LEGAL_CANONICALIZATION_VERSION,
): string {
  if (!isSupportedCanonicalization(version)) {
    throw new RangeError(`canonicalisation : version ${String(version)} non supportée.`);
  }
  return CANONICALIZERS[version]!(value);
}
