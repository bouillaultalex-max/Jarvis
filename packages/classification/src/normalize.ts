import type { PreferenceAttribute } from './preference.js';

/** Normalise une adresse email pour comparaison (espace + casse). */
export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

/** Normalise un domaine (tolère un `@` en préfixe, ex. copié depuis un expéditeur). */
export function normalizeDomain(value: string): string {
  const v = value.trim().toLowerCase();
  return v.startsWith('@') ? v.slice(1) : v;
}

/** Normalise un texte libre (objet, mot-clé) pour comparaison par sous-chaîne. */
export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Extrait le domaine d'une adresse email (partie après `@`). */
export function domainOfAddress(address: string): string {
  const normalized = normalizeEmailAddress(address);
  const at = normalized.indexOf('@');
  return at === -1 ? normalized : normalized.slice(at + 1);
}

/** Normalise la valeur d'une préférence selon son attribut. */
export function normalizePreferenceValue(attribute: PreferenceAttribute, value: string): string {
  switch (attribute) {
    case 'sender':
      return normalizeEmailAddress(value);
    case 'domain':
      return normalizeDomain(value);
    case 'subject_contains':
    case 'keyword':
      return normalizeText(value);
  }
}
