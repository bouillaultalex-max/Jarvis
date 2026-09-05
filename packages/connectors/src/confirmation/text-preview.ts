/**
 * Troncature d'affichage — utilisée pour construire un `ConfirmationSummaryField`
 * (ex. un aperçu de corps d'email) sans jamais exposer un texte arbitrairement
 * long à une UI de confirmation.
 *
 * Ceci est un utilitaire d'affichage : la valeur qu'il produit ne doit
 * **jamais** servir de matériau au fingerprint (`computeFingerprint` prend
 * l'input validé complet, jamais un aperçu tronqué) — les deux concepts
 * (payload réel vs. read-model de présentation) restent structurellement
 * séparés, aucune fonction commune ne les relie.
 */

/**
 * Limite reprise de la convention déjà établie deux fois de façon
 * indépendante dans le dépôt (`MAX_BODY_EXCERPT_CHARS`, `@jarvis/inbox` et
 * `@jarvis/classification` — même valeur, définie séparément dans chaque
 * package). Aucune limite arbitraire n'est inventée ici : on réutilise la
 * même valeur, avec la même convention de redéfinition indépendante par
 * package (pas d'export partagé inter-package pour une simple constante).
 */
export const MAX_SUMMARY_FIELD_VALUE_CHARS = 500;

export interface TextPreview {
  readonly value: string;
  readonly truncated: boolean;
}

/**
 * Tronque `text` à `maxChars` **points de code Unicode** (jamais des unités
 * UTF-16) : `Array.from(text)` itère par point de code, donc une paire de
 * substituts (ex. un emoji hors plan de base) n'est jamais coupée en deux
 * moitiés invalides — contrairement à `String.prototype.slice`, qui opère
 * en unités UTF-16.
 *
 * - Longueur (en points de code) ≤ `maxChars` : renvoyé tel quel, `truncated: false`.
 * - Longueur > `maxChars` : coupé exactement à `maxChars` points de code,
 *   `truncated: true` — l'appelant (UI) décide comment signaler visuellement
 *   la troncature (ex. un « … » ajouté à l'affichage) ; ce module ne
 *   l'ajoute pas lui-même à `value`, pour ne pas fausser un test d'égalité
 *   sur le contenu réel.
 */
export function buildTextPreview(text: string, maxChars: number = MAX_SUMMARY_FIELD_VALUE_CHARS): TextPreview {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) {
    return { value: text, truncated: false };
  }
  return { value: codePoints.slice(0, maxChars).join(''), truncated: true };
}
