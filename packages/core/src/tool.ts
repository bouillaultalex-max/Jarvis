/**
 * Contrat générique d'un outil JARVIS.
 *
 * Un outil décrit *ce qu'il fait* et *comment valider son entrée*. Il n'a
 * aucune connaissance des permissions : la décision d'exécuter ou non est prise
 * en amont, de façon centralisée, par le {@link ToolExecutor}.
 */

/**
 * Niveau d'action d'un outil, par risque croissant.
 *
 * - `read`    : lecture d'informations, aucun effet de bord.
 * - `prepare` : prépare une action sans l'effectuer (brouillon, plan…).
 * - `execute` : effectue réellement l'action (envoi, création, suppression…).
 */
export type ActionLevel = 'read' | 'prepare' | 'execute';

/** Résultat d'une validation d'entrée réussie. */
export interface ToolInputValid<TInput> {
  readonly ok: true;
  readonly value: TInput;
}

/** Résultat d'une validation d'entrée échouée, avec message explicite. */
export interface ToolInputInvalid {
  readonly ok: false;
  readonly error: string;
}

export type ToolValidationResult<TInput> = ToolInputValid<TInput> | ToolInputInvalid;

/**
 * Un outil typé.
 *
 * `TInput` / `TOutput` sont explicites : aucun `any`. Le registre stocke des
 * `Tool` (soit `Tool<unknown, unknown>`) ; chaque implémentation reste
 * fortement typée de son côté.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Identifiant unique, ex. `echo`, `gmail.read`, `calendar.create`. */
  readonly name: string;
  /** Description courte, lisible par un humain. */
  readonly description: string;
  /** Niveau d'action (sert à la politique de permissions et à l'orchestration). */
  readonly action: ActionLevel;
  /**
   * Schéma JSON (compatible avec le champ `input_schema` attendu par Anthropic)
   * décrivant la **forme d'entrée attendue**, destiné à être présenté au LLM.
   *
   * ⚠️ **Ce n'est PAS une validation.** La validation de sécurité réelle reste
   * {@link Tool.validateInput}, exécutée par `ToolExecutor` avant toute
   * décision de permission et toute exécution — le LLM n'est jamais une source
   * fiable. `inputSchema` doit rester **cohérent** avec `validateInput` (mêmes
   * propriétés, mêmes champs `required`, `additionalProperties: false`
   * uniquement lorsque `validateInput` rejette les clés inconnues) mais ne le
   * remplace jamais.
   *
   * Toujours un objet JSON Schema de type `'object'`. N'expose jamais de
   * secret, de token, ni de champ interne (ex. `accountId`) que le `Tool`
   * n'accepte pas réellement.
   */
  readonly inputSchema: Record<string, unknown>;
  /** Valide (et normalise) une entrée non fiable. Ne lève jamais. */
  validateInput(input: unknown): ToolValidationResult<TInput>;
  /** Exécute l'outil sur une entrée déjà validée. */
  execute(input: TInput): Promise<TOutput>;
}

/** Fabrique un résultat de validation réussi. */
export function valid<TInput>(value: TInput): ToolInputValid<TInput> {
  return { ok: true, value };
}

/** Fabrique un résultat de validation échoué. */
export function invalid(error: string): ToolInputInvalid {
  return { ok: false, error };
}
