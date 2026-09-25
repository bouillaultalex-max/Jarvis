/**
 * Calendrier grégorien proleptique — briques **sans `Date`** pour valider un jour
 * calendaire (LegalCase v3). Aucun fuseau, aucune horloge : un jour calendaire est
 * un triplet `(année, mois, jour)`, jamais un instant.
 */

/** Bornes des années acceptées (0000 exclue). */
export const LEGAL_MIN_YEAR = 1;
export const LEGAL_MAX_YEAR = 9999;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Nombre de jours du mois (`month` de 1 à 12). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= LEGAL_MIN_YEAR && year <= LEGAL_MAX_YEAR;
}

/** `true` si `(year, month, day)` désigne un jour qui existe au calendrier. */
export function isValidCalendarDay(year: number, month: number, day: number): boolean {
  if (!isValidYear(year)) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= daysInMonth(year, month);
}
