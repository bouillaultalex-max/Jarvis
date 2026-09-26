import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';
import {
  LegifranceMalformedResponseError,
  type LegifranceHttpClient,
} from '@jarvis/legifrance-client';

import type { Connector } from '../connector.js';
import { createLegifranceSearchTool } from './legifrance-search-tool.js';

/**
 * Connecteur Légifrance — jalon LEGAL-02B.2.
 *
 * Strictement en lecture : chaque `Tool` a `action: 'read'`. Aucune `Tool`
 * `prepare`/`execute` — Légifrance est une source de consultation, jamais
 * un service que JARVIS modifie.
 *
 * Ne gère jamais lui-même l'authentification : `createTools` reçoit un
 * `LegifranceHttpClient` déjà authentifié (`@jarvis/legifrance-client`,
 * LEGAL-02B.1) — mêmes responsabilités que `gmailConnector`/`GmailApiClient`.
 * Ce module ne connaît ni `AccessTokenProvider`, ni `SecretStore`, ni
 * `client_id`/`client_secret`, ni sandbox/production (porté par la
 * configuration déjà encapsulée dans le `LegifranceHttpClient` reçu).
 *
 * Les erreurs `@jarvis/legifrance-client` (`LegifranceNetworkError`,
 * `LegifranceHttpError`, `LegifranceOAuthError`, `LegifranceMalformedResponseError`)
 * ne sont **jamais interceptées ni ré-enveloppées** ici : elles se propagent
 * telles quelles depuis `execute()` jusqu'à `ToolExecutor.run()`, qui les
 * transforme déjà en `{ status: 'error', reason }` — leur `.message` est
 * déjà garanti sans secret (LEGAL-02B.1). Créer une seconde couche de
 * traduction d'erreurs ici dupliquerait ce qui existe déjà, ce que
 * LEGAL-02B.2 interdit explicitement.
 */

/** `GET /list/ping` — endpoint de santé documenté par la FAQ officielle Légifrance (voir rapport LEGAL-02B.2 §4). */
const PING_PATH = '/list/ping';
/** `POST /consult/getArticle` — endpoint documenté par la FAQ officielle Légifrance (voir rapport LEGAL-02B.2 §4). */
const GET_ARTICLE_PATH = '/consult/getArticle';

/** Identifiant Légifrance d'un article — `LEGIARTI` + 12 chiffres, seul format observé dans tous les exemples officiels/documentés trouvés. */
const ARTICLE_ID_PATTERN = /^LEGIARTI\d{12}$/;

/** Entrée du Tool `legifrance.ping` — délibérément vide, aucun paramètre inutile. */
export type LegifrancePingInput = Record<string, never>;

export interface LegifrancePingOutput {
  /**
   * Corps brut renvoyé par `/list/ping`. Forme volontairement non
   * interprétée : la documentation disponible ne confirme pas s'il s'agit
   * de JSON ou de texte brut selon l'environnement PISTE (voir rapport
   * LEGAL-02B.2 §16, risque documenté plutôt que supposé).
   */
  readonly raw: unknown;
}

function createLegifrancePingTool(
  client: LegifranceHttpClient,
): Tool<LegifrancePingInput, LegifrancePingOutput> {
  return {
    name: 'legifrance.ping',
    description:
      'Vérifie que la chaîne JARVIS → LegifranceConnector → legifrance-client → API Légifrance répond (lecture seule, aucun effet de bord).',
    action: 'read',

    inputSchema: { type: 'object', properties: {}, additionalProperties: false },

    validateInput(input: unknown): ToolValidationResult<LegifrancePingInput> {
      if (input === undefined || input === null) {
        return valid({});
      }
      if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0) {
        return invalid('legifrance.ping : aucun paramètre attendu.');
      }
      return valid({});
    },

    async execute(): Promise<LegifrancePingOutput> {
      const raw = await client.request({ method: 'GET', path: PING_PATH });
      return { raw };
    },
  };
}

export interface LegifranceGetArticleInput {
  readonly id: string;
}

/** Un élément de `article.articleVersions` — forme réellement observée en sandbox PISTE (LEGAL-02B.2.2). */
export interface LegifranceArticleVersionSummary {
  readonly id: string;
  readonly etat: string | null;
  readonly version: string | null;
  /** Epoch millisecondes, tel que renvoyé par l'API — jamais converti ici (voir note de classe). */
  readonly dateDebut: number | null;
  /** Epoch millisecondes, tel que renvoyé par l'API — peut valoir la sentinelle `32472144000000` (« pas de borne connue »), jamais interprétée ici. */
  readonly dateFin: number | null;
}

/** Un élément de `article.lienModifications` — forme réellement observée en sandbox PISTE (LEGAL-02B.2.2). */
export interface LegifranceModificationLink {
  readonly textCid: string | null;
  readonly textTitle: string | null;
  readonly linkType: string | null;
  readonly linkOrientation: string | null;
  readonly articleNum: string | null;
  readonly articleId: string | null;
  readonly natureText: string | null;
  /** Chaîne `"YYYY-MM-DD"` telle qu'observée — format différent des dates epoch de l'article lui-même, jamais harmonisé ici. */
  readonly datePubliTexte: string | null;
  readonly dateSignaTexte: string | null;
  readonly dateDebutCible: string | null;
}

/**
 * Un élément de `article.lienCitations` — forme réellement observée en
 * sandbox PISTE (LEGAL-02B.2.2). **Ne pas confondre avec `LegalCitation`**
 * (`@jarvis/legal-core`) : ceci décrit une relation juridique officielle
 * entre deux textes côté Légifrance (quel texte cite/est cité par quel
 * autre), pas l'usage qu'une analyse JARVIS ferait d'une source — les deux
 * concepts partagent un nom proche mais ne se recouvrent pas.
 */
export interface LegifranceCitationLink {
  readonly textCid: string | null;
  readonly textTitle: string | null;
  readonly linkType: string | null;
  readonly linkOrientation: string | null;
  readonly articleNum: string | null;
  readonly articleId: string | null;
  readonly natureText: string | null;
  readonly parentCid: string | null;
  readonly numTexte: string | null;
  /** Epoch millisecondes, tel que renvoyé par l'API — format distinct de celui de `LegifranceModificationLink`. */
  readonly datePubli: number | null;
  readonly dateDebut: number | null;
}

/**
 * Sortie **technique**, pas encore un `LegalSource`/`LegalCitation` —
 * reprend telle quelle la forme de l'objet `article` documenté par l'API,
 * sans renommage ni conversion : les dates restent des epoch millisecondes
 * (jamais converties en ISO 8601 ici), `nature`/`type` restent le
 * vocabulaire Légifrance brut (jamais mappés vers `LegalSourceType` ici).
 * Cette étendue de champs (LEGAL-02B.3) reprend exactement ceux réellement
 * observés sur deux articles distincts en sandbox PISTE (LEGAL-02B.2.1/
 * LEGAL-02B.2.2) — aucun champ inventé. La normalisation vers le modèle
 * juridique canonique (conversion de dates, mapping de vocabulaire,
 * construction de `reference`, dérivation d'`authority`/`reliability`/
 * `contentHash`) est la responsabilité de `@jarvis/legal-research`
 * (`LegifranceSourceProvider`, LEGAL-02B.3) — jamais de ce module.
 */
export interface LegifranceGetArticleOutput {
  readonly id: string;
  /** Identifiant stable à travers les versions — identique à `id` pour un article jamais modifié (observé empiriquement). */
  readonly cid: string | null;
  readonly idTexte: string | null;
  readonly cidTexte: string | null;
  readonly type: string | null;
  readonly nature: string | null;
  readonly num: string | null;
  readonly texte: string | null;
  readonly versionArticle: string | null;
  readonly etat: string | null;
  readonly dateDebut: number | null;
  readonly dateFin: number | null;
  readonly versionPrecedente: string | null;
  readonly isMultipleVersions: boolean | null;
  readonly sectionParentTitre: string | null;
  readonly fullSectionsTitre: string | null;
  readonly articleVersions: readonly LegifranceArticleVersionSummary[];
  readonly lienModifications: readonly LegifranceModificationLink[];
  readonly lienCitations: readonly LegifranceCitationLink[];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Ne conserve un élément que s'il porte au moins un `id` de version exploitable — un élément sans id ne peut jamais être référencé, donc ne peut rien apporter. */
function mapArticleVersionSummary(value: unknown): LegifranceArticleVersionSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return undefined;
  return {
    id: v.id,
    etat: toNullableString(v.etat),
    version: toNullableString(v.version),
    dateDebut: toNullableNumber(v.dateDebut),
    dateFin: toNullableNumber(v.dateFin),
  };
}

function mapModificationLink(value: unknown): LegifranceModificationLink | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  return {
    textCid: toNullableString(v.textCid),
    textTitle: toNullableString(v.textTitle),
    linkType: toNullableString(v.linkType),
    linkOrientation: toNullableString(v.linkOrientation),
    articleNum: toNullableString(v.articleNum),
    articleId: toNullableString(v.articleId),
    natureText: toNullableString(v.natureText),
    datePubliTexte: toNullableString(v.datePubliTexte),
    dateSignaTexte: toNullableString(v.dateSignaTexte),
    dateDebutCible: toNullableString(v.dateDebutCible),
  };
}

function mapCitationLink(value: unknown): LegifranceCitationLink | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  return {
    textCid: toNullableString(v.textCid),
    textTitle: toNullableString(v.textTitle),
    linkType: toNullableString(v.linkType),
    linkOrientation: toNullableString(v.linkOrientation),
    articleNum: toNullableString(v.articleNum),
    articleId: toNullableString(v.articleId),
    natureText: toNullableString(v.natureText),
    parentCid: toNullableString(v.parentCid),
    numTexte: toNullableString(v.numTexte),
    datePubli: toNullableNumber(v.datePubli),
    dateDebut: toNullableNumber(v.dateDebut),
  };
}

function mapArray<T>(value: unknown, mapItem: (item: unknown) => T | undefined): readonly T[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<T[]>((acc, item) => {
    const mapped = mapItem(item);
    if (mapped !== undefined) acc.push(mapped);
    return acc;
  }, []);
}

/**
 * Traduit la réponse brute (déjà JSON-désérialisée par `LegifranceHttpClient`)
 * de `/consult/getArticle` en {@link LegifranceGetArticleOutput}. Réutilise
 * `LegifranceMalformedResponseError` (`@jarvis/legifrance-client`) plutôt
 * que d'introduire une classe d'erreur parallèle : une réponse 2xx dont la
 * forme est inexploitable relève exactement de la même catégorie,
 * seulement à un point différent de la chaîne HTTP → OAuth. Seul
 * `article.id` est obligatoire (comme avant LEGAL-02B.3) ; tout autre champ
 * absent ou mal typé devient `null`/`[]` plutôt que de faire échouer tout
 * le mapping — ces champs additionnels sont un enrichissement, pas une
 * garantie structurelle du contrat minimal.
 */
function mapGetArticleResponse(raw: unknown): LegifranceGetArticleOutput {
  if (typeof raw !== 'object' || raw === null) {
    throw new LegifranceMalformedResponseError('réponse de /consult/getArticle : objet attendu.');
  }
  const { article } = raw as { article?: unknown };
  if (typeof article !== 'object' || article === null) {
    throw new LegifranceMalformedResponseError(
      'réponse de /consult/getArticle : champ « article » attendu.',
    );
  }
  const a = article as Record<string, unknown>;
  if (typeof a.id !== 'string' || a.id.length === 0) {
    throw new LegifranceMalformedResponseError(
      'réponse de /consult/getArticle : « article.id » attendu.',
    );
  }
  return {
    id: a.id,
    cid: toNullableString(a.cid),
    idTexte: toNullableString(a.idTexte),
    cidTexte: toNullableString(a.cidTexte),
    type: toNullableString(a.type),
    nature: toNullableString(a.nature),
    num: toNullableString(a.num),
    texte: toNullableString(a.texte),
    versionArticle: toNullableString(a.versionArticle),
    etat: toNullableString(a.etat),
    dateDebut: toNullableNumber(a.dateDebut),
    dateFin: toNullableNumber(a.dateFin),
    versionPrecedente: toNullableString(a.versionPrecedente),
    isMultipleVersions: toNullableBoolean(a.isMultipleVersions),
    sectionParentTitre: toNullableString(a.sectionParentTitre),
    fullSectionsTitre: toNullableString(a.fullSectionsTitre),
    articleVersions: mapArray(a.articleVersions, mapArticleVersionSummary),
    lienModifications: mapArray(a.lienModifications, mapModificationLink),
    lienCitations: mapArray(a.lienCitations, mapCitationLink),
  };
}

function createLegifranceGetArticleTool(
  client: LegifranceHttpClient,
): Tool<LegifranceGetArticleInput, LegifranceGetArticleOutput> {
  return {
    name: 'legifrance.get_article',
    description:
      "Récupère le contenu technique brut d'un article Légifrance par son identifiant stable (lecture seule, aucun effet de bord).",
    action: 'read',

    // Seul `id` est accepté, requis, au format LEGIARTI observé dans la
    // documentation officielle — `additionalProperties: false` : jamais de
    // clé inconnue silencieusement ignorée pour un appel API réel.
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          pattern: ARTICLE_ID_PATTERN.source,
          description: 'Identifiant Légifrance de l’article, ex. « LEGIARTI000006307920 ».',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },

    validateInput(input: unknown): ToolValidationResult<LegifranceGetArticleInput> {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return invalid('legifrance.get_article : objet attendu.');
      }
      const record = input as Record<string, unknown>;

      const unknownKeys = Object.keys(record).filter((key) => key !== 'id');
      if (unknownKeys.length > 0) {
        return invalid(
          `legifrance.get_article : propriété(s) inconnue(s) : ${unknownKeys.join(', ')}.`,
        );
      }

      const { id } = record;
      if (typeof id !== 'string' || !ARTICLE_ID_PATTERN.test(id)) {
        return invalid(
          'legifrance.get_article : « id » doit être un identifiant Légifrance valide (ex. « LEGIARTI000006307920 »).',
        );
      }
      return valid({ id });
    },

    async execute(input: LegifranceGetArticleInput): Promise<LegifranceGetArticleOutput> {
      const raw = await client.request({
        method: 'POST',
        path: GET_ARTICLE_PATH,
        body: { id: input.id },
      });
      return mapGetArticleResponse(raw);
    },
  };
}

export const legifranceConnector: Connector<LegifranceHttpClient> = {
  id: 'legifrance',
  name: 'Connecteur Légifrance (lecture seule)',
  capabilities: ['legifrance.ping', 'legifrance.get_article', 'legifrance.search'],

  createTools(client: LegifranceHttpClient): readonly Tool[] {
    return [
      createLegifrancePingTool(client),
      createLegifranceGetArticleTool(client),
      createLegifranceSearchTool(client),
    ];
  },
};
