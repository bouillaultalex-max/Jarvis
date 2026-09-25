import { validateClosedObject } from './legal-primitives.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Localisation d'un passage dans un document du dossier — LegalCase v3.
 *
 * Jeu minimal de variantes, extensible sans rupture pour les données existantes :
 *   - `whole` : le document entier — **explicite** (l'absence de localisation est
 *     invalide : « tout le document » et « oublié » ne doivent pas se confondre) ;
 *   - `page` : page (1-based) ou plage de pages ;
 *   - `characterRange` : plage `[start, end)` de **points de code Unicode** du
 *     texte dont le SHA-256 est le `contentHash` du document. Elle n'a de sens que
 *     rapportée à cette identité de contenu : voir `legal-evidence.ts` (un
 *     `contentHash` de document est exigé, échec fermé).
 *
 * Aucun contenu de document n'est stocké dans `legal-core`.
 */
export type LegalDocumentLocation =
  | { readonly kind: 'whole' }
  | { readonly kind: 'page'; readonly page: number; readonly endPage?: number }
  | { readonly kind: 'characterRange'; readonly start: number; readonly end: number };

const WHOLE_KEYS: ReadonlySet<string> = new Set(['kind']);
const PAGE_KEYS: ReadonlySet<string> = new Set(['kind', 'page', 'endPage']);
const RANGE_KEYS: ReadonlySet<string> = new Set(['kind', 'start', 'end']);

function isSafeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

/** Valide une localisation non fiable. Clés fermées ; ne lève jamais. */
export function validateLegalDocumentLocation(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(
      `${path} : objet attendu (localisation explicite, « whole » pour le document entier).`,
    );
  }
  const kind = (value as Record<string, unknown>).kind;

  if (kind === 'whole') return validateClosedObject(value, WHOLE_KEYS, path);

  if (kind === 'page') {
    const closed = validateClosedObject(value, PAGE_KEYS, path);
    if (!closed.ok) return closed;
    const { page, endPage } = value as Record<string, unknown>;
    if (!isSafeInteger(page, 1)) return invalid(`${path}.page : entier >= 1 attendu.`);
    if (endPage !== undefined && (!isSafeInteger(endPage, 1) || endPage < page)) {
      return invalid(`${path}.endPage : entier >= page attendu.`);
    }
    return OK;
  }

  if (kind === 'characterRange') {
    const closed = validateClosedObject(value, RANGE_KEYS, path);
    if (!closed.ok) return closed;
    const { start, end } = value as Record<string, unknown>;
    if (!isSafeInteger(start, 0)) return invalid(`${path}.start : entier >= 0 attendu.`);
    if (!isSafeInteger(end, 0) || end <= start) {
      return invalid(`${path}.end : entier > start attendu.`);
    }
    return OK;
  }

  return invalid(`${path}.kind : « whole », « page » ou « characterRange » attendu.`);
}
