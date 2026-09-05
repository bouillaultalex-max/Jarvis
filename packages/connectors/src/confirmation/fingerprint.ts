import { createHash } from 'node:crypto';

import type { Tool } from '@jarvis/core';

/**
 * Matériau lié par une empreinte de confirmation. `action` réutilise
 * `Tool['action']` (même type que `Capability`, `@jarvis/core`) — un lien
 * purement typé, sans dépendance d'exécution vers `ToolExecutor` ni
 * `PermissionManager`.
 */
export interface ConfirmationPayload {
  readonly toolName: string;
  readonly action: Tool['action'];
  readonly accountId: string;
  /** Entrée déjà validée du Tool (`Tool.validateInput`'s output), pas l'entrée brute. */
  readonly input: unknown;
}

/**
 * Sérialisation canonique et déterministe d'une valeur JSON-compatible.
 *
 * Règles :
 *   - Les clés d'objet sont triées récursivement par ordre lexicographique
 *     (`Object.keys(...).sort()`), donc `{b:2,a:1}` et `{a:1,b:2}`
 *     produisent la même sortie. Le tri est fait manuellement sur un
 *     tableau de clés puis réémis explicitement — jamais en reconstruisant
 *     un objet JS et en déléguant l'ordre à `JSON.stringify`, ce qui
 *     serait incorrect pour des clés « ressemblant » à des indices
 *     numériques (ré-ordonnées par le moteur JS indépendamment de l'ordre
 *     d'insertion).
 *   - Une propriété d'objet dont la valeur est `undefined` est omise,
 *     comme le ferait `JSON.stringify` nativement.
 *   - **Les tableaux ne sont jamais réordonnés** : leur ordre est
 *     sémantiquement significatif (ex. une liste de destinataires) — donc
 *     `[a,b]` et `[b,a]` produisent des sorties différentes,
 *     délibérément.
 *   - Un élément de tableau valant `undefined` devient `null`, comme le
 *     ferait `JSON.stringify` nativement dans un tableau.
 *   - Les primitives (`string`, `number`, `boolean`, `null`) sont
 *     sérialisées via `JSON.stringify` natif (donc `NaN`/`Infinity`
 *     deviennent `null`, comme nativement).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : canonicalStringify(item)));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
    return `{${entries.join(',')}}`;
  }

  // string | number | boolean
  return JSON.stringify(value);
}

/**
 * Empreinte SHA-256 (hexadécimal) liant `toolName`, `action`, `accountId`
 * et `input` (l'entrée déjà validée du Tool) via la sérialisation
 * canonique ci-dessus. Toute divergence sur l'un de ces quatre éléments —
 * y compris un simple réordonnancement de tableau dans `input` — change
 * l'empreinte.
 */
export function computeFingerprint(payload: ConfirmationPayload): string {
  const canonical = canonicalStringify({
    toolName: payload.toolName,
    action: payload.action,
    accountId: payload.accountId,
    input: payload.input,
  });
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
