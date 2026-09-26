import type {
  LegalSource,
  LegalSourceAuthority,
  LegalSourceReliability,
  LegalSourceType,
} from '@jarvis/legal-core';

import { computeContentHash } from './research/content-hash.js';
import { RetrievedContent } from './research/retrieved-content.js';

/**
 * Mapping technique Légifrance → `LegalSource` — jalon LEGAL-02B.3.
 *
 * Prend en entrée la sortie **brute et non fiable** (`unknown`) du Tool
 * `legifrance.get_article` (`@jarvis/connectors`) — volontairement traitée
 * comme n'importe quelle donnée externe non fiable (même discipline que
 * `legal-source-validation.ts`), sans importer le type
 * `LegifranceGetArticleOutput` : `@jarvis/legal-research` ne dépend ni de
 * `@jarvis/connectors` ni de `@jarvis/legifrance-client`, même en
 * `import type` — seule dépendance : `@jarvis/legal-core` (le modèle) et
 * `@jarvis/core` (`ToolExecutor`, voir `legifrance-source-provider.ts`).
 *
 * Fondé exclusivement sur les champs réellement observés en sandbox PISTE
 * sur deux articles distincts (LEGAL-02B.2.1/LEGAL-02B.2.2) — aucun champ
 * inventé, aucune sémantique supposée au-delà de ce qui a été vérifié.
 */

export type LegifranceMappingErrorReason =
  'invalid_shape' | 'missing_required_field' | 'unknown_nature';

/** Une réponse Légifrance ne peut pas être transformée en `LegalSource` en confiance. Ne contient jamais le contenu de l'article. */
export class LegifranceMappingError extends Error {
  constructor(
    readonly reason: LegifranceMappingErrorReason,
    detail: string,
  ) {
    super(`Mapping Légifrance → LegalSource impossible (${reason}) : ${detail}`);
    this.name = 'LegifranceMappingError';
  }
}

/**
 * Sentinelle Légifrance « pas de borne connue », observée sur `dateFin`
 * (article en vigueur) ainsi que sur `dateDebutExtension`/`dateFinExtension`
 * (LEGAL-02B.2.2). **Ne jamais** convertir cette valeur en la date
 * `2999-01-01` comme s'il s'agissait d'une date métier — c'est un marqueur
 * technique, pas une échéance réelle.
 */
export const LEGIFRANCE_NO_BOUND_SENTINEL_MS = 32472144000000;

/**
 * Table de correspondance `article.nature` → `LegalSourceType`.
 *
 * **Volontairement incomplète.** Les deux seuls échantillons sandbox
 * disponibles (LEGAL-02B.2.1/LEGAL-02B.2.2) portent tous deux
 * `nature: "Article"`, y compris pour un article appartenant à une loi
 * autonome (pas un code) — `getArticle` seul ne permet donc pas de
 * distinguer un article de code d'un article de loi. `'code_article'` est
 * la valeur retenue par défaut pour `"Article"`, en attendant qu'un champ
 * ou un appel complémentaire (`getLoda`/`getCode`, hors périmètre
 * LEGAL-02B.3) permette de lever cette ambiguïté. Toute autre valeur de
 * `nature` est délibérément refusée plutôt que devinée.
 */
const NATURE_TO_SOURCE_TYPE: Readonly<Record<string, LegalSourceType>> = {
  Article: 'code_article',
};

const AUTHORITY: LegalSourceAuthority = 'legifrance';
const RELIABILITY: LegalSourceReliability = 'primary_institutional';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * `dateFin === null` (absente) ou `dateFin === LEGIFRANCE_NO_BOUND_SENTINEL_MS`
 * ⇒ `effectiveTo` absent (article actuellement en vigueur ou fin inconnue) —
 * jamais une date littérale `2999-01-01`.
 */
function mapEffectiveTo(dateFin: unknown): string | undefined {
  if (typeof dateFin !== 'number' || !Number.isFinite(dateFin)) return undefined;
  if (dateFin === LEGIFRANCE_NO_BOUND_SENTINEL_MS) return undefined;
  return epochMsToIso(dateFin);
}

/** Historique d'une version — sous-ensemble de `article.articleVersions[]` conservé pour une future résolution temporelle (LEGAL-02B.3, décision #12). Aucun resolver construit ici. */
export interface LegifranceArticleVersionInfo {
  readonly id: string;
  readonly etat?: string;
  readonly version?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

function mapArticleVersionInfo(value: unknown): LegifranceArticleVersionInfo | undefined {
  if (!isPlainObject(value) || !isNonEmptyString(value.id)) return undefined;
  return {
    id: value.id,
    etat: optionalString(value.etat),
    version: optionalString(value.version),
    ...(typeof value.dateDebut === 'number' && Number.isFinite(value.dateDebut)
      ? { effectiveFrom: epochMsToIso(value.dateDebut) }
      : {}),
    effectiveTo: mapEffectiveTo(value.dateFin),
  };
}

/** Métadonnées conservées mais **jamais** intégrées à `LegalSource` lui-même — décisions #12/#13 (LEGAL-02B.3) : pas de nouveau champ sur `LegalSource` sans nécessité démontrée. */
export interface LegifranceArticleMetadata {
  /** Id de la version précédente de cet article, si connue. */
  readonly versionPrecedente?: string;
  /** Historique complet des versions — base d'une future résolution temporelle, non exploitée ici. */
  readonly articleVersions: readonly LegifranceArticleVersionInfo[];
}

export interface MapLegifranceArticleResult {
  readonly source: LegalSource;
  readonly metadata: LegifranceArticleMetadata;
  /**
   * Texte reçu (`article.texte`), **transitoire** et vérifié contre
   * `source.contentHash` (ADR-0021) ; opaque, jamais sérialisé. Un article sans
   * texte exploitable n'est pas mappé (`missing_required_field`).
   */
  readonly content: RetrievedContent;
}

export interface MapLegifranceArticleOptions {
  /** Injectable pour des tests déterministes. Défaut : `Date.now`. */
  readonly now?: () => number;
}

function requireNonEmptyString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    throw new LegifranceMappingError(
      'missing_required_field',
      `« article.${field} » attendu (chaîne non vide).`,
    );
  }
  return value;
}

function requireFiniteNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LegifranceMappingError(
      'missing_required_field',
      `« article.${field} » attendu (nombre).`,
    );
  }
  return value;
}

/**
 * Construit `reference` (LEGAL-02B.3, décision #8) par composition de
 * `fullSectionsTitre`/`sectionParentTitre` et `num` — jamais un champ
 * unique recopié tel quel. Absent si aucun des deux n'est disponible.
 */
function buildReference(article: Record<string, unknown>): string | undefined {
  const titlePart =
    optionalString(article.fullSectionsTitre) ?? optionalString(article.sectionParentTitre);
  const num = optionalString(article.num);
  const numPart = num !== undefined ? `art. ${num}` : undefined;
  const parts = [titlePart, numPart].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Transforme la sortie brute (`unknown`) du Tool `legifrance.get_article`
 * en {@link LegalSource} + {@link LegifranceArticleMetadata}.
 *
 * Champs `LegalSource` **délibérément non renseignés** :
 *   - `publicationDate` — aucun champ Légifrance n'a de sémantique de
 *     publication confirmée (`dateDebut`, `dateDebutCible`,
 *     `datePubliTexte` sont explicitement **exclus** de ce rôle, décision
 *     validée LEGAL-02B.3 — voir `legal-case.ts`, `LegalSource.publicationDate`,
 *     désormais optionnel pour cette raison précise) ;
 *   - `url` — non observé dans la réponse `getArticle`.
 *
 * Champs dérivés par JARVIS, jamais lus depuis l'API (décisions #9/#10) :
 * `authority` (toujours `'legifrance'` pour ce Provider), `reliability`
 * (toujours `'primary_institutional'` — appel PISTE authentifié direct).
 *
 * `contentHash` (décision #11) est calculé ici (SHA-256 du `texte` reçu, sans
 * normalisation — `computeContentHash`, ADR-0021) ; le texte lui-même est rendu
 * sous forme de `content` opaque et vérifié, jamais dans `LegalSource`.
 *
 * `lienCitations` n'est **jamais** lu par cette fonction — décision #15 :
 * ce sont des relations juridiques officielles côté Légifrance, pas des
 * `LegalCitation` JARVIS. Aucune confusion possible : ce module ne
 * référence même pas ce champ.
 *
 * @throws {LegifranceMappingError} si la valeur n'a pas la forme attendue,
 *   ou si un champ requis pour le mapping (`id`, `cid`, `nature`,
 *   `versionArticle`, `dateDebut`, `texte`) est absent/mal typé, ou si
 *   `nature` ne figure pas dans {@link NATURE_TO_SOURCE_TYPE}.
 */
export function mapLegifranceArticleToLegalSource(
  raw: unknown,
  options: MapLegifranceArticleOptions = {},
): MapLegifranceArticleResult {
  if (!isPlainObject(raw)) {
    throw new LegifranceMappingError('invalid_shape', 'objet attendu.');
  }

  const id = requireNonEmptyString(raw, 'id');
  const cid = requireNonEmptyString(raw, 'cid');
  const nature = requireNonEmptyString(raw, 'nature');
  const versionArticle = requireNonEmptyString(raw, 'versionArticle');
  const dateDebut = requireFiniteNumber(raw, 'dateDebut');
  const texte = requireNonEmptyString(raw, 'texte');

  const sourceType = NATURE_TO_SOURCE_TYPE[nature];
  if (sourceType === undefined) {
    throw new LegifranceMappingError(
      'unknown_nature',
      `« ${nature} » ne figure pas dans la table de correspondance vers LegalSourceType.`,
    );
  }

  const now = options.now ?? Date.now;
  // Hash du texte exactement tel que reçu (contrat normatif : `computeContentHash`, ADR-0021).
  const contentHash = computeContentHash(texte);
  const content = RetrievedContent.verified(texte, contentHash);
  const reference = buildReference(raw);
  const effectiveTo = mapEffectiveTo(raw.dateFin);

  const source: LegalSource = {
    id,
    sourceType,
    authority: AUTHORITY,
    reliability: RELIABILITY,
    title: reference ?? id,
    identifier: cid,
    ...(reference !== undefined ? { reference } : {}),
    version: versionArticle,
    effectiveFrom: epochMsToIso(dateDebut),
    ...(effectiveTo !== undefined ? { effectiveTo } : {}),
    consultedAt: new Date(now()).toISOString(),
    contentHash,
  };

  const versionPrecedente = optionalString(raw.versionPrecedente);
  const articleVersions = Array.isArray(raw.articleVersions)
    ? raw.articleVersions.reduce<LegifranceArticleVersionInfo[]>((acc, item) => {
        const mapped = mapArticleVersionInfo(item);
        if (mapped !== undefined) acc.push(mapped);
        return acc;
      }, [])
    : [];

  return {
    source,
    content,
    metadata: {
      ...(versionPrecedente !== undefined ? { versionPrecedente } : {}),
      articleVersions,
    },
  };
}
