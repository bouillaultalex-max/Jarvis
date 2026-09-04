/** Étiquette d'importance. Volontairement minimale : 3 valeurs. */
export type ClassificationLabel = 'important' | 'not_important' | 'uncertain';

/**
 * Provenance de la décision. `explicit_rule` et `user_correction` sont deux
 * origines de préférence utilisateur (même priorité effective, voir
 * `preference-matcher.ts`) ; `llm` n'intervient que si aucune préférence ne
 * correspond ; `default` est le filet de sécurité (`uncertain`).
 */
export type ClassificationSource = 'explicit_rule' | 'user_correction' | 'llm' | 'default';

export interface ClassificationResult {
  readonly label: ClassificationLabel;
  readonly source: ClassificationSource;
  /** Explication lisible : pourquoi cette décision a été prise. */
  readonly reason: string;
  /** Uniquement présent pour une décision `source: 'llm'`, si le provider le renseigne. */
  readonly confidence?: number;
  /** Uniquement présent lorsqu'une préférence a déterminé le résultat. */
  readonly preferenceId?: string;
}
