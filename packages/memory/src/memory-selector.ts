import type { MemoryEntry } from './memory-entry.js';

/**
 * Requête de sélection : le texte pour lequel on cherche des souvenirs
 * pertinents (typiquement le message utilisateur courant).
 *
 * Un objet — et non une simple chaîne — pour laisser de la place à des signaux
 * supplémentaires (tokens de conversation, sujets explicites…) **sans casser**
 * la signature de {@link MemorySelector.select} lorsqu'un sélecteur plus riche
 * arrivera.
 */
export interface MemoryQuery {
  readonly text: string;
}

/**
 * Choisit, parmi des entrées **déjà filtrées** (invalidées exclues,
 * `memoryContextFilter` appliqué en amont par l'appelant), celles pertinentes
 * pour une requête — et les ordonne.
 *
 * Contrat volontairement minimal : un futur sélecteur sémantique (embeddings,
 * base vectorielle, modèle dédié…) implémente cette même interface et remplace
 * {@link LexicalMemorySelector} sans qu'aucun appelant (dont `AgentLoop`) ne
 * change.
 *
 * Toute implémentation **doit** être :
 *   - déterministe — mêmes `candidates` + même `query` ⇒ même résultat, même
 *     ordre ;
 *   - locale et synchrone — aucun réseau, aucune I/O, aucune horloge ;
 *   - sans effet de bord — ne mute ni `candidates`, ni les entrées ; **jamais**
 *     d'écriture dans un `MemoryStore` (`add`/`invalidate`/`supersede`) ;
 *   - conservatrice de la provenance — les entrées renvoyées sont les
 *     `MemoryEntry` **d'origine** (mêmes références), jamais des copies
 *     modifiées ; `provenance.origin` et `provenance.confidence` ne sont
 *     **jamais** altérés.
 *
 * `select` **peut** lever (implémentation buguée) : un appelant robuste comme
 * `AgentLoop` dégrade alors proprement vers « aucun contexte mémoire » et ne
 * fait jamais échouer l'interaction utilisateur pour autant.
 */
export interface MemorySelector {
  select(query: MemoryQuery, candidates: readonly MemoryEntry[]): readonly MemoryEntry[];
}

/**
 * Nombre maximal d'entrées renvoyées par {@link LexicalMemorySelector} par
 * défaut.
 *
 * Assez pour couvrir plusieurs souvenirs liés à une requête, assez peu pour ne
 * pas noyer le message utilisateur ni gonfler le contexte de façon non
 * maîtrisée. Une limite au token près exigerait un tokenizer propre au modèle
 * (hors périmètre) : la limite est donc exprimée en **nombre d'entrées**.
 */
export const DEFAULT_MAX_MEMORY_ENTRIES = 8;

/** Longueur minimale d'un token retenu : en dessous, trop peu discriminant. */
const MIN_TOKEN_LENGTH = 3;

/**
 * Mots-outils fréquents (fr/en) sans pouvoir discriminant, ignorés pour le
 * calcul de recouvrement. Liste courte et explicite — pas une ressource
 * linguistique, seulement le bruit le plus commun.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'les',
  'des',
  'une',
  'que',
  'qui',
  'quoi',
  'est',
  'sont',
  'pour',
  'avec',
  'dans',
  'sur',
  'par',
  'pas',
  'plus',
  'mon',
  'mes',
  'ton',
  'tes',
  'son',
  'ses',
  'nos',
  'vos',
  'leur',
  'the',
  'and',
  'for',
  'with',
  'you',
  'your',
  'are',
  'was',
  'this',
  'that',
  'what',
]);

/** Poids d'un token de requête qui touche le `subject` d'une entrée. */
const SUBJECT_TOKEN_WEIGHT = 2;
/** Poids d'un token de requête qui touche le `statement` d'une entrée. */
const STATEMENT_TOKEN_WEIGHT = 1;

/**
 * Découpe un texte en tokens comparables : accents repliés (« é » → « e » via
 * NFD + suppression des diacritiques), minuscules, séparés sur tout ce qui
 * n'est pas alphanumérique, longueur ≥ {@link MIN_TOKEN_LENGTH}, mots-outils
 * exclus.
 *
 * Le repli d'accents rend le recouvrement moins fragile en français **sans**
 * prétendre à une quelconque compréhension : cela reste une comparaison
 * lexicale, mot à mot.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
}

function overlapCount(queryTokens: ReadonlySet<string>, text: string): number {
  let count = 0;
  for (const token of new Set(tokenize(text))) {
    if (queryTokens.has(token)) {
      count += 1;
    }
  }
  return count;
}

export interface LexicalMemorySelectorOptions {
  /**
   * Nombre maximal d'entrées renvoyées. Défaut :
   * {@link DEFAULT_MAX_MEMORY_ENTRIES}. Doit être un entier ≥ 1.
   */
  readonly maxEntries?: number;
}

/**
 * Sélecteur **lexical** : le score d'une entrée est le recouvrement de tokens
 * entre la requête et l'entrée. Aucune sémantique, aucun modèle, aucun réseau —
 * un matching lexical, présenté comme tel.
 *
 * Score d'une entrée pour une requête de tokens `Q` :
 *
 * ```
 * score = 2 × |Q ∩ tokens(subject)|  +  1 × |Q ∩ tokens(statement)|
 * ```
 *
 * - un token qui touche le `subject` (clé d'entité curée : e-mail, projet,
 *   personne…) pèse **deux fois** un token qui touche le texte libre — même
 *   logique que la « spécificité » de `preference-matcher.ts` (une
 *   correspondance sur un champ précis prime une correspondance sur du texte) ;
 * - `score = 0` ⇒ l'entrée n'est **pas** pertinente : elle est écartée ;
 * - `kind`, `provenance.origin` et `provenance.confidence` **n'entrent pas**
 *   dans le score : rien dans le contrat actuel ne justifie de pondérer par
 *   l'origine — la provenance reste une information descriptive.
 *
 * Classement : score décroissant ; **à égalité**, position d'origine dans
 * `candidates` croissante (l'ordre rendu par `MemoryStore.list()`, soit l'ordre
 * d'insertion pour `InMemoryMemoryStore`). Jamais de recours à l'heure, à
 * `Math.random()` ni à `createdAt`.
 */
export class LexicalMemorySelector implements MemorySelector {
  private readonly maxEntries: number;

  constructor(options: LexicalMemorySelectorOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_MEMORY_ENTRIES;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('LexicalMemorySelector : « maxEntries » doit être un entier >= 1.');
    }
    this.maxEntries = max;
  }

  select(query: MemoryQuery, candidates: readonly MemoryEntry[]): readonly MemoryEntry[] {
    const queryTokens = new Set(tokenize(query.text));
    if (queryTokens.size === 0) {
      return [];
    }

    return candidates
      .map((entry, index) => ({ entry, index, score: scoreEntry(queryTokens, entry) }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, this.maxEntries)
      .map((scored) => scored.entry);
  }
}

function scoreEntry(queryTokens: ReadonlySet<string>, entry: MemoryEntry): number {
  const subjectScore =
    entry.subject !== undefined
      ? SUBJECT_TOKEN_WEIGHT * overlapCount(queryTokens, entry.subject)
      : 0;
  const statementScore = STATEMENT_TOKEN_WEIGHT * overlapCount(queryTokens, entry.statement);
  return subjectScore + statementScore;
}
