/**
 * Primitives de validation partagées entre `legal-case-validation.ts`,
 * `legal-source-validation.ts` et `legal-citation-validation.ts`.
 *
 * Module interne : volontairement **non exporté** depuis `index.ts` — ce
 * n'est pas une surface publique du package, seulement une factorisation
 * pour éviter de dupliquer `isPlainObject`/`isNonEmptyString`/`OK`/`invalid`
 * dans chacun des trois fichiers de validation (découpage LEGAL-02A, revue
 * d'architecture LEGAL-01 §2/§10).
 */

/**
 * Résultat d'une validation non fiable. Ne lève jamais — même discipline
 * que `validateProvenance` (`@jarvis/memory`).
 */
export type LegalCaseValidation =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

export const OK: LegalCaseValidation = { ok: true };

export function invalid(error: string): LegalCaseValidation {
  return { ok: false, error };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Chaîne ISO 8601 non vide et effectivement interprétable comme une date. */
export function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

/** Valide chaque élément d'une liste avec `validateItem`, s'arrête à la première erreur. */
export function validateEachOf(
  items: unknown,
  path: string,
  validateItem: (item: unknown, itemPath: string) => LegalCaseValidation,
): LegalCaseValidation {
  if (!Array.isArray(items)) {
    return invalid(`${path} : liste attendue.`);
  }
  for (let i = 0; i < items.length; i += 1) {
    const result = validateItem(items[i], `${path}[${i}]`);
    if (!result.ok) {
      return result;
    }
  }
  return OK;
}

/**
 * Vérifie que chaque id d'une liste de références désigne un id
 * effectivement connu (ex. `argumentIds` d'une conclusion contre les `id`
 * réels des arguments du dossier).
 */
export function validateIdRefs(
  ids: unknown,
  path: string,
  knownIds: ReadonlySet<string>,
  knownIdsLabel: string,
): LegalCaseValidation {
  if (!Array.isArray(ids)) {
    return invalid(`${path} : liste attendue.`);
  }
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (!isNonEmptyString(id)) {
      return invalid(`${path}[${i}] : chaîne non vide attendue.`);
    }
    if (!knownIds.has(id)) {
      return invalid(`${path}[${i}] : ${knownIdsLabel} inconnu « ${id} ».`);
    }
  }
  return OK;
}

/**
 * Vérifie qu'aucun `id` n'est répété dans une liste d'entités — nécessaire
 * dès qu'une autre entité référence ces `id` (sources, citations,
 * arguments/contre-arguments, analyses) : un `id` dupliqué rendrait cette
 * référence ambiguë, silencieusement.
 */
export function checkNoDuplicateIds(
  items: readonly { readonly id: string }[],
  path: string,
): LegalCaseValidation {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      return invalid(`${path} : id dupliqué « ${item.id} ».`);
    }
    seen.add(item.id);
  }
  return OK;
}

/** Extrait, sans lever, les `id` valides d'une liste non fiable déjà connue pour être un tableau d'objets `{ id }`. */
export function extractKnownIds(items: unknown): ReadonlySet<string> {
  if (!Array.isArray(items)) {
    return new Set();
  }
  return new Set(
    items
      .filter((item): item is { id: string } => isPlainObject(item) && isNonEmptyString(item.id))
      .map((item) => item.id),
  );
}
