import { normalizePreferenceValue } from './normalize.js';

/**
 * Modèle de préférence utilisateur pour la classification d'emails.
 *
 * Une préférence est une règle plate `attribut = valeur → décision`. Le
 * `PreferenceStore` est un stockage **pur** : il ne décide jamais si une
 * préférence s'applique à un email donné (voir `preference-matcher.ts`),
 * exactement comme `ToolRegistry` (côté `@jarvis/core`) ne décide jamais des
 * permissions.
 */

/** Attribut d'email sur lequel porte une préférence. */
export type PreferenceAttribute = 'sender' | 'domain' | 'subject_contains' | 'keyword';

/**
 * Provenance d'une préférence — conservée uniquement pour la traçabilité
 * (`ClassificationResult.source`). Les deux origines ont le **même niveau de
 * priorité** dans la résolution (voir `preference-matcher.ts`) : une
 * correction ponctuelle sur un expéditeur précis doit pouvoir l'emporter sur
 * une règle générale plus ancienne, et réciproquement.
 *
 * - `explicit_rule`    : règle générale déclarée directement par l'utilisateur
 *                        (« les mails de mon patron sont importants »).
 * - `user_correction`  : correction faite en réaction à une classification
 *                        précise (« non, ceux de cet expéditeur sont importants »).
 */
export type PreferenceOrigin = 'explicit_rule' | 'user_correction';

export type PreferenceDecision = 'important' | 'not_important';

export interface Preference {
  readonly id: string;
  readonly attribute: PreferenceAttribute;
  /** Valeur normalisée (voir `normalize.ts`) : comparaison insensible à la casse. */
  readonly value: string;
  readonly decision: PreferenceDecision;
  readonly origin: PreferenceOrigin;
  /** Explication lisible, réutilisée telle quelle dans `ClassificationResult.reason`. */
  readonly reason: string;
  /** ISO 8601 — sert de départage entre préférences de même spécificité. */
  readonly createdAt: string;
}

export interface PreferenceInput {
  readonly attribute: PreferenceAttribute;
  readonly value: string;
  readonly decision: PreferenceDecision;
  readonly origin: PreferenceOrigin;
  readonly reason: string;
  /** Optionnel : surtout utile pour des tests déterministes. Défaut : maintenant. */
  readonly createdAt?: string;
}

/**
 * Stockage pur des préférences. N'effectue aucune résolution de conflit, aucun
 * matching : uniquement `add`/`list`.
 */
export interface PreferenceStore {
  add(input: PreferenceInput): Preference;
  list(): readonly Preference[];
}

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly preferences: Preference[] = [];
  private counter = 0;

  add(input: PreferenceInput): Preference {
    this.counter += 1;
    const preference: Preference = {
      id: `pref-${this.counter}`,
      attribute: input.attribute,
      value: normalizePreferenceValue(input.attribute, input.value),
      decision: input.decision,
      origin: input.origin,
      reason: input.reason,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.preferences.push(preference);
    return preference;
  }

  list(): readonly Preference[] {
    return [...this.preferences];
  }
}
