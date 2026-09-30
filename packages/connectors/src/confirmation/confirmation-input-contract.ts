/**
 * Contrat strict des données acceptées comme `input` par le **protocole de
 * confirmation** (`ConfirmationService.create()`/`verify()`,
 * `confirmAndExecute()`) — et uniquement par lui. `@jarvis/core`
 * (`Tool`/`ToolExecutor`, `input: unknown`) n'est pas touché : cette
 * restriction est locale à `packages/connectors/src/confirmation/`.
 *
 * Accepté — JSON « ordinaire » uniquement :
 *   - `null`, `boolean`, `string`, `number` **fini** (`Number.isFinite`) ;
 *   - tableau **dense** (aucun trou) de valeurs acceptées ;
 *   - objet simple (prototype `Object.prototype` ou `null`) dont chaque
 *     propriété **propre et énumérable** est une valeur acceptée.
 *
 * `undefined` n'est accepté **nulle part** (racine, imbriqué, élément de
 * tableau). Ce n'est pas une restriction nouvelle en pratique : c'est déjà
 * la convention systématique de ce dépôt — un champ optionnel absent est
 * **omis** (`...(x !== undefined ? {x} : {})`, voir
 * `gmail-connector.ts:239`, seul champ optionnel d'un `Tool` `execute`
 * existant), jamais présent avec une valeur `undefined`. Vérifié par lecture
 * exhaustive de tous les `Tool.validateInput()` du dépôt (`grep` sur
 * `return valid(`) : aucun ne produit de `undefined`, racine ou imbriqué,
 * pour un outil `execute`.
 *
 * Refusé explicitement, **jamais** converti silencieusement : `BigInt`,
 * `number` non fini (`NaN`/`Infinity`/`-Infinity`), fonction, `symbol`
 * (comme valeur **ou** comme clé de propriété), tableau creux (trou) ou
 * portant une propriété supplémentaire non indicielle, référence cyclique,
 * accesseur (`get`/`set` — détecté par **descripteur de propriété**, jamais
 * invoqué), propriété propre **non énumérable**, et tout objet dont le
 * prototype n'est pas `Object.prototype`/`null` (couvre `Date`, `Map`,
 * `Set`, `RegExp`, `Error`, toute instance de classe — y compris un
 * `toJSON()` personnalisé, jamais appelé par ce module).
 *
 * Une propriété nommée **`__proto__`** (telle que produite par
 * `JSON.parse('{"__proto__":...}')` — une vraie propriété propre via
 * `CreateDataProperty`, jamais un changement de prototype) est acceptée
 * comme une donnée ordinaire : la copie est construite avec
 * `Object.defineProperty` (jamais `result[key] = ...`), qui **ne déclenche
 * jamais** l'accesseur hérité `Object.prototype.__proto__` — sans quoi ce
 * champ serait silencieusement perdu ou changerait le prototype du clone.
 *
 * **Détection sans effet de bord** : `Object.keys()`/
 * `Object.getOwnPropertyNames()`/`Object.getOwnPropertySymbols()`
 * n'invoquent jamais un `get` ni ne lisent une valeur (seule une lecture
 * `obj[key]` le ferait) ; chaque propriété est donc inspectée via
 * `Object.getOwnPropertyDescriptor(obj, key)` — si le descripteur n'a pas de
 * `value` (accesseur) ou n'est pas énumérable, la propriété est rejetée
 * **sans jamais lire sa valeur**. Un élément de **tableau** défini comme
 * accesseur ou non énumérable reçoit exactement le même traitement (jamais
 * une simple lecture `value[i]`). `canonicalStringify`/`computeFingerprint`
 * (`fingerprint.ts`), eux, lisent `obj[key]` directement et invoqueraient un
 * `get` s'il existait — c'était déjà vrai avant ce module (comportement
 * inchangé, non corrigé ici) ; ce contrat les protège en amont, en
 * garantissant qu'aucun objet à accesseur n'atteint plus jamais
 * `canonicalStringify` via le protocole de confirmation.
 *
 * **Limite documentée, jamais promise** : pour un `Proxy`, `Object.keys`,
 * `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`,
 * `Object.getPrototypeOf` et `Object.getOwnPropertyDescriptor` passent tous
 * par les trappes du handler, dont le comportement échappe entièrement à ce
 * module — aucune inspection JavaScript ne peut garantir l'absence d'effet
 * de bord face à un `Proxy` arbitraire construit pour tromper l'inspection
 * elle-même. Ce contrat protège contre une donnée involontairement mal
 * formée (bug de `Tool.validateInput()`), pas contre un objet délibérément
 * hostile visant ce mécanisme de détection lui-même.
 */

export type ConfirmationInputRejectionReason =
  | 'undefined_value'
  | 'bigint'
  | 'function'
  | 'symbol'
  | 'non_finite_number'
  | 'sparse_array'
  | 'array_extra_property'
  | 'non_enumerable_property'
  | 'cyclic'
  | 'accessor'
  | 'unsupported_object';

export class UnsupportedConfirmationInputError extends Error {
  readonly reason: ConfirmationInputRejectionReason;
  /** Chemin diagnostique interne (ex. `.to`, `[2].body`) — jamais exposé tel quel à un appelant externe (voir `describeConfirmationFailure`). */
  readonly path: string;

  constructor(reason: ConfirmationInputRejectionReason, path: string) {
    super(`Entrée de confirmation non prise en charge (${reason}) à « ${path || '<racine>'} ».`);
    this.name = 'UnsupportedConfirmationInputError';
    this.reason = reason;
    this.path = path;
  }
}

function reject(reason: ConfirmationInputRejectionReason, path: string): never {
  throw new UnsupportedConfirmationInputError(reason, path);
}

/**
 * Valide récursivement `value` contre le contrat ci-dessus et renvoie une
 * copie indépendante, gelée récursivement (`Object.freeze` à chaque
 * niveau) — jamais la référence d'origine. Lève {@link UnsupportedConfirmationInputError}
 * à la première valeur non prise en charge rencontrée ; ne lit jamais un
 * accesseur, n'invoque jamais `toJSON`, ne convertit jamais silencieusement
 * une valeur refusée.
 *
 * `ancestors` (usage interne, jamais fourni par un appelant) trace le
 * chemin d'ascendance de la récursion en cours — pas un ensemble global —
 * pour distinguer une vraie référence cyclique d'une référence partagée
 * mais acyclique (ex. le même sous-objet référencé deux fois par des
 * champs différents, valide).
 */
export function captureConfirmationInput(
  value: unknown,
  path = '',
  ancestors: Set<unknown> = new Set(),
): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : reject('non_finite_number', path);
  }
  if (typeof value === 'bigint') return reject('bigint', path);
  if (typeof value === 'function') return reject('function', path);
  if (typeof value === 'symbol') return reject('symbol', path);
  if (value === undefined) return reject('undefined_value', path);

  // Propriétés symboliques : invisibles à Object.keys()/getOwnPropertyNames() —
  // vérifiées explicitement ici (objet et tableau) pour ne jamais les ignorer
  // silencieusement.
  if (Object.getOwnPropertySymbols(value).length > 0) {
    reject('symbol', path);
  }

  if (Array.isArray(value)) {
    // Object.getOwnPropertyNames() liste aussi "length" (non énumérable,
    // toujours présente, normale) — exclue du contrôle de densité/extras.
    const ownNames = Object.getOwnPropertyNames(value).filter((name) => name !== 'length');
    const indexNames = new Set(Array.from({ length: value.length }, (_, i) => String(i)));
    if (ownNames.some((name) => !indexNames.has(name))) {
      reject('array_extra_property', path);
    }
    if (ownNames.length !== value.length) {
      reject('sparse_array', path);
    }

    if (ancestors.has(value)) reject('cyclic', path);
    ancestors.add(value);
    try {
      const captured: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, i);
        if (descriptor === undefined) {
          reject('sparse_array', `${path}[${i}]`);
        }
        if (!('value' in descriptor)) {
          // Accesseur (get/set) — rejeté sans jamais invoquer get()/set().
          reject('accessor', `${path}[${i}]`);
        }
        if (descriptor.enumerable !== true) {
          reject('non_enumerable_property', `${path}[${i}]`);
        }
        captured.push(captureConfirmationInput(descriptor.value, `${path}[${i}]`, ancestors));
      }
      return Object.freeze(captured);
    } finally {
      ancestors.delete(value);
    }
  }

  // typeof value === 'object', non null, non tableau ici.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    reject('unsupported_object', path);
  }
  if (ancestors.has(value)) reject('cyclic', path);
  ancestors.add(value);
  try {
    const result: Record<string, unknown> = {};
    // Object.getOwnPropertyNames() (pas Object.keys()) : inclut aussi les
    // propriétés propres non énumérables, pour les rejeter explicitement
    // plutôt que de les ignorer silencieusement.
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        // Accesseur (get/set) — rejeté sans jamais invoquer get()/set().
        reject('accessor', `${path}.${key}`);
      }
      if (descriptor.enumerable !== true) {
        reject('non_enumerable_property', `${path}.${key}`);
      }
      // Object.defineProperty, jamais `result[key] = ...` : une clé nommée
      // "__proto__" via `result[key] = x` invoquerait l'accesseur hérité de
      // Object.prototype.__proto__ (changement de prototype ou perte
      // silencieuse de la valeur selon le type) au lieu de créer une
      // propriété de donnée ordinaire.
      Object.defineProperty(result, key, {
        value: captureConfirmationInput(descriptor.value, `${path}.${key}`, ancestors),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}
