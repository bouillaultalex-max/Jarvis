import { isValidCalendarDay } from './legal-calendar.js';
import {
  invalid,
  isNonEmptyString,
  isPlainObject,
  OK,
  type LegalCaseValidation,
} from './legal-validation-shared.js';

/**
 * Primitives strictes du modèle v3 — LegalCase v3.
 *
 * - {@link LegalInstant} : instant physique ISO 8601 **avec décalage obligatoire**
 *   (`Z` ou `±hh:mm`). Jamais une date de fait (voir `legal-temporal.ts`), jamais
 *   un `asOf`.
 * - {@link LegalOpaqueId} : identifiant technique opaque, format restreint
 *   (barrière **structurelle** : une adresse e-mail — `Account.accountIdentifier` —
 *   est rejetée ; un secret dont la forme est valide ne l'est pas : aucun détecteur
 *   de secret par valeur n'existe).
 * - Clés **fermées** : toute clé inconnue est rejetée.
 *
 * Ce module ne dépend d'aucun autre package `@jarvis/*`.
 */

/** Instant ISO 8601 avec décalage explicite — ex. `2026-09-24T10:00:00.000Z`. */
export type LegalInstant = string;

/** Identifiant technique opaque — ex. `inv-42`, `legifrance.get_article`. */
export type LegalOpaqueId = string;

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** `true` si `value` est un instant ISO 8601 strict avec décalage, calendrier et heure valides. */
export function isLegalInstant(value: unknown): value is LegalInstant {
  if (typeof value !== 'string') return false;
  const match = INSTANT_PATTERN.exec(value);
  if (match === null) return false;
  const [, y, mo, d, h, mi, s, , zone] = match;
  if (!isValidCalendarDay(Number(y), Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59) return false;
  if (s !== undefined && Number(s) > 59) return false;
  if (zone !== 'Z') {
    const offsetHours = Number(zone!.slice(1, 3));
    const offsetMinutes = Number(zone!.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

/** `true` si `value` respecte le format d'identifiant opaque. */
export function isLegalOpaqueId(value: unknown): value is LegalOpaqueId {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

export function validateLegalInstant(value: unknown, path: string): LegalCaseValidation {
  return isLegalInstant(value)
    ? OK
    : invalid(`${path} : instant ISO 8601 avec décalage explicite (Z ou ±hh:mm) attendu.`);
}

export function validateLegalOpaqueId(value: unknown, path: string): LegalCaseValidation {
  return isLegalOpaqueId(value)
    ? OK
    : invalid(
        `${path} : identifiant opaque invalide (1 à 128 caractères parmi A-Z a-z 0-9 . _ : -).`,
      );
}

/** Objet de données (ni tableau, ni `null`) dont **toutes** les clés sont autorisées. */
export function validateClosedObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
): LegalCaseValidation {
  if (!isPlainObject(value)) return invalid(`${path} : objet attendu.`);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return invalid(`${path} : clé inconnue « ${key} ».`);
  }
  return OK;
}

/** Chaîne non vide **après trim** — factorisation locale de `isNonEmptyString`. */
export function validateRequiredText(value: unknown, path: string): LegalCaseValidation {
  return isNonEmptyString(value) ? OK : invalid(`${path} : chaîne non vide attendue.`);
}

/** Enchaîne des validations et renvoie la première erreur. */
export function firstFailure(...results: readonly LegalCaseValidation[]): LegalCaseValidation {
  for (const result of results) {
    if (!result.ok) return result;
  }
  return OK;
}
