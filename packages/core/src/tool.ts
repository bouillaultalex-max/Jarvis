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
