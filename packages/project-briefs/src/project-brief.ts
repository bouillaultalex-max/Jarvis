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
 *
 * Format v2 (PB-01, partiel) : **sources déclarées** par l'utilisateur,
 * liens fait/hypothèse → sources (`sourceIds`) et justifications décision →
 * faits/hypothèses (`basis`). Une source déclarée n'est **jamais vérifiée**
 * par Jarvis ; une justification relie une décision à des éléments
 * déclarés, elle ne **prouve pas** la validité de la décision. `basis` est
 * figée dès qu'une décision n'est plus `proposed`, mais les sources
 * attachées aux faits/hypothèses restent enrichissables ensuite : ce modèle
 * n'est ni un instantané historique de justification, ni une preuve
 * immuable de ce que l'utilisateur a validé.
 */

/** Format historique (sans sources ni liens) — toujours lu, conservé tant qu'aucune notion v2 n'est utilisée. */
export const LEGACY_PROJECT_BRIEF_FILE_VERSION = 1;
/** Format v2 : sources déclarées, liens et justifications. */
export const SOURCES_PROJECT_BRIEF_FILE_VERSION = 2;
/** Format v3 : v2 + besoins déclarés (`needs`), déclenché à la première création d'un besoin. */
export const NEEDS_PROJECT_BRIEF_FILE_VERSION = 3;
/** Version la plus récente que ce code sait lire et écrire. */
export const CURRENT_PROJECT_BRIEF_FILE_VERSION = NEEDS_PROJECT_BRIEF_FILE_VERSION;
export type ProjectBriefFileVersion =
  | typeof LEGACY_PROJECT_BRIEF_FILE_VERSION
  | typeof SOURCES_PROJECT_BRIEF_FILE_VERSION
  | typeof NEEDS_PROJECT_BRIEF_FILE_VERSION;

export const MAX_ID_CHARS = 64;
export const MAX_NAME_CHARS = 200;
export const MAX_ITEM_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
/** Par catégorie (facts / hypotheses / decisions / questions), indépendamment. */
export const MAX_LIST_ITEMS = 50;
/** Par élément : `sourceIds` d'un fait/d'une hypothèse, `basis` d'une décision. */
export const MAX_LINKS_PER_ITEM = 20;

/** Identifiant restreint, vérifié avant tout accès disque (voir le store). */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DecisionStatus = 'proposed' | 'validated' | 'obsolete';
export type QuestionStatus = 'open' | 'resolved';

/** Élément à identifiant stable — jamais un index de tableau. */
export interface TextItem {
  readonly id: string;
  readonly text: string;
}

/** Source déclarée par l'utilisateur (ex. « échange oral du 16/10 ») — jamais vérifiée. */
export type Source = TextItem;

/** Fait ou hypothèse. `sourceIds` absent = source non renseignée — jamais déduite ni inventée. */
export interface SourcedItem extends TextItem {
  readonly sourceIds?: readonly string[];
}

/** Référence typée explicite — le type n'est jamais déduit du préfixe de l'id. */
export interface ItemRef {
  readonly kind: 'fact' | 'hypothesis';
  readonly id: string;
}

/**
 * Référence acceptée par `linkSource` uniquement : un besoin peut être relié
 * à des sources, mais ne peut JAMAIS justifier une décision (`ItemRef` reste
 * fait|hypothèse). Le type n'est jamais déduit du préfixe de l'id côté modèle.
 */
export type SourceableRef = ItemRef | { readonly kind: 'need'; readonly id: string };

export interface Decision extends TextItem {
  readonly status: DecisionStatus;
  /** Absent = aucune justification enregistrée. Modifiable seulement tant que `proposed`. */
  readonly basis?: readonly ItemRef[];
  /** ISO 8601. Absent = date de validation non enregistrée — jamais déduite ni inventée. */
  readonly validatedAt?: string;
}

export interface Question extends TextItem {
  readonly status: QuestionStatus;
  /** Présent seulement après `answerQuestion` — jamais inventée. */
  readonly answer?: string;
}

export interface ProjectBrief {
  readonly id: string;
  readonly name: string;
  /**
   * Version du fichier lu ou à écrire. Passe à 2 dès qu'une notion v2 est
   * utilisée (source, lien, justification), à 3 à la création d'un besoin ;
   * ne redescend jamais.
   */
  readonly formatVersion: ProjectBriefFileVersion;
  /**
   * Compteur de révision : incrémenté à chaque mutation, toujours relu
   * depuis le disque (sous verrou, voir `project-brief-lock.ts`) avant
   * d'être incrémenté — jamais déduit d'un état mémoire potentiellement
   * périmé. Sert de trace de changement, PAS le mécanisme de concurrence
   * lui-même (voir le store pour le mécanisme réel).
   */
  readonly revision: number;
  /** Toujours vide pour un fichier v1 (jamais écrite en v1). */
  readonly sources: readonly Source[];
  /** Rapportés par l'utilisateur — jamais présentés comme vérifiés de l'extérieur. */
  readonly facts: readonly SourcedItem[];
  readonly hypotheses: readonly SourcedItem[];
  /**
   * Besoins déclarés par l'utilisateur (« je veux … ») — jamais vérifiés.
   * Toujours vide pour un fichier v1/v2 ; `sourceIds` absent = source non renseignée.
   */
  readonly needs: readonly SourcedItem[];
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

/** Monte la version au minimum demandée ; idempotent, ne rétrograde jamais (une fiche v3 reste v3). */
export function withMinimumVersion(
  brief: ProjectBrief,
  minimum: ProjectBriefFileVersion,
): ProjectBrief {
  return brief.formatVersion >= minimum ? brief : { ...brief, formatVersion: minimum };
}

export function isValidProjectId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_CHARS && PROJECT_ID_PATTERN.test(id);
}

export function isBoundedNonEmptyText(value: string, maxChars: number): boolean {
  return value.trim().length > 0 && value.length <= maxChars;
}
