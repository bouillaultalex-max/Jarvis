/**
 * Provenance d'une information conservée par JARVIS.
 *
 * Généralise un concept **déjà présent** dans `@jarvis/classification`
 * (`PreferenceOrigin`, `ClassificationSource`, `ClassificationResult.confidence`) :
 * ce module ne fusionne pas ces types existants — il fournit une forme
 * réutilisable pour toute information retenue en mémoire, quelle que soit sa
 * source.
 *
 * Règle fondamentale (« pas d'invention ») : une supposition n'est jamais
 * stockée avec la même origine qu'un fait fourni ou validé par l'utilisateur.
 * `@jarvis/memory` n'a **aucune dépendance** — cette distinction est portée
 * par la donnée, pas par le code appelant.
 */

/** Origine d'une information, de la plus fiable à la moins fiable. */
export type ProvenanceOrigin =
  /** Fourni explicitement par l'utilisateur. */
  | 'user_stated'
  /** Explicitement confirmé ou validé par l'utilisateur (ex. relecture d'une proposition). */
  | 'user_confirmed'
  /** Extrait d'un e-mail — contenu tiers, non validé par l'utilisateur. */
  | 'email_extracted'
  /** Déduit par JARVIS d'une correction ou d'un comportement observés. */
  | 'inferred'
  /** Proposé par le LLM, non validé. */
  | 'llm_proposed';

/** Ensemble des origines connues — exposé pour la validation et les tests. */
export const PROVENANCE_ORIGINS: readonly ProvenanceOrigin[] = [
  'user_stated',
  'user_confirmed',
  'email_extracted',
  'inferred',
  'llm_proposed',
];

/**
 * Origines dites « certaines » : l'information est **affirmée**, pas estimée.
 * Une telle origine ne peut pas porter de `confidence` (dire « sûr à 80 % »
 * d'un fait affirmé par l'utilisateur est une contradiction).
 */
const CERTAIN_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set<ProvenanceOrigin>([
  'user_stated',
  'user_confirmed',
]);

export interface Provenance {
  readonly origin: ProvenanceOrigin;
  /**
   * Niveau de confiance dans `[0, 1]`. Optionnel, et **interdit** pour une
   * origine certaine (`user_stated`, `user_confirmed`). N'a de sens que pour
   * une origine incertaine (`email_extracted`, `inferred`, `llm_proposed`).
   */
  readonly confidence?: number;
  /** Détail lisible optionnel : id de l'e-mail source, règle déclenchée, etc. */
  readonly note?: string;
}

/** Résultat d'une validation de {@link Provenance}. Ne lève jamais. */
export type ProvenanceValidation =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Valide une `Provenance` non fiable — même discipline que
 * `Tool.validateInput` (`@jarvis/core`) : ne lève jamais, renvoie une erreur
 * lisible.
 *
 * - `origin` doit être une valeur connue ;
 * - `confidence`, si présent, doit être un nombre fini dans `[0, 1]` ;
 * - `confidence` est refusé pour une origine certaine ;
 * - `note`, si présent, doit être une chaîne.
 */
export function validateProvenance(value: unknown): ProvenanceValidation {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'provenance : objet attendu.' };
  }
  const { origin, confidence, note } = value as Record<string, unknown>;

  if (typeof origin !== 'string' || !PROVENANCE_ORIGINS.includes(origin as ProvenanceOrigin)) {
    return {
      ok: false,
      error: `provenance : « origin » doit être l'une de ${PROVENANCE_ORIGINS.join(', ')}.`,
    };
  }

  if (confidence !== undefined) {
    if (
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      return { ok: false, error: 'provenance : « confidence » doit être un nombre dans [0, 1].' };
    }
    if (CERTAIN_ORIGINS.has(origin as ProvenanceOrigin)) {
      return {
        ok: false,
        error: `provenance : « confidence » n'a pas de sens pour l'origine « ${origin} » (information affirmée, non estimée).`,
      };
    }
  }

  if (note !== undefined && typeof note !== 'string') {
    return { ok: false, error: 'provenance : « note » doit être une chaîne.' };
  }

  return { ok: true };
}
