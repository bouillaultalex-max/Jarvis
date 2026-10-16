/**
 * Modèle d'une fiche produit-builder — PAS une `Situation` générique
 * (`ADR-0010` diffère toute généralisation à un second cas d'usage validé) et
 * PAS une `MemoryEntry` (`@jarvis/memory` reste hors périmètre de ce
 * package : aucune dépendance `@jarvis/*`).
 *
 * Catégories volontairement séparées (pas un `kind` unique façon
 * `MemoryKind`) : un fait est une affirmation rapportée par l'utilisateur,
 * jamais présentée comme vérifiée de l'extérieur ; une hypothèse est
 * explicitement incertaine ; une décision a un cycle de vie
 * (proposée → validée, ou → obsolète) ; une question a un cycle de vie
 * séparé (ouverte → résolue, avec réponse).
 */

export const CURRENT_PROJECT_BRIEF_FILE_VERSION = 1;

export const MAX_ID_CHARS = 64;
export const MAX_NAME_CHARS = 200;
export const MAX_ITEM_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
/** Par catégorie (facts / hypotheses / decisions / questions), indépendamment. */
export const MAX_LIST_ITEMS = 50;

/** Identifiant restreint, vérifié avant tout accès disque (voir le store). */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DecisionStatus = 'proposed' | 'validated' | 'obsolete';
export type QuestionStatus = 'open' | 'resolved';

/** Élément à identifiant stable — jamais un index de tableau. */
export interface TextItem {
  readonly id: string;
  readonly text: string;
}

export interface Decision extends TextItem {
  readonly status: DecisionStatus;
}

export interface Question extends TextItem {
  readonly status: QuestionStatus;
  /** Présent seulement après `answerQuestion` — jamais inventée. */
  readonly answer?: string;
}

export interface ProjectBrief {
  readonly id: string;
  readonly name: string;
  readonly formatVersion: typeof CURRENT_PROJECT_BRIEF_FILE_VERSION;
  /**
   * Compteur de révision : incrémenté à chaque mutation, toujours relu
   * depuis le disque (sous verrou, voir `project-brief-lock.ts`) avant
   * d'être incrémenté — jamais déduit d'un état mémoire potentiellement
   * périmé. Sert de trace de changement, PAS le mécanisme de concurrence
   * lui-même (voir le store pour le mécanisme réel).
   */
  readonly revision: number;
  /** Rapportés par l'utilisateur — jamais présentés comme vérifiés de l'extérieur. */
  readonly facts: readonly TextItem[];
  readonly hypotheses: readonly TextItem[];
  readonly decisions: readonly Decision[];
  readonly questions: readonly Question[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Scanne les ids existants `<prefix>-<n>` et renvoie `<prefix>-<n+1>` — même technique que `FileMemoryStore`. */
export function nextStableId(items: readonly TextItem[], prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const max = items.reduce((acc, item) => {
    const match = re.exec(item.id);
    const n = match ? Number.parseInt(match[1]!, 10) : 0;
    return n > acc ? n : acc;
  }, 0);
  return `${prefix}-${max + 1}`;
}

export function isValidProjectId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_CHARS && PROJECT_ID_PATTERN.test(id);
}

export function isBoundedNonEmptyText(value: string, maxChars: number): boolean {
  return value.trim().length > 0 && value.length <= maxChars;
}
