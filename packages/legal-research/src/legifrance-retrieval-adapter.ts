import { isLegifranceArticleId } from './legifrance-identifiers.js';
import { LegifranceProviderError, type LegalSourceProvider } from './legifrance-source-provider.js';
import { LegifranceMappingError } from './legifrance-source-mapping.js';
import { ContentIntegrityError } from './research/retrieved-content.js';
import { LEGIFRANCE_PROVIDER_ID } from './legifrance-search-parser.js';
import {
  ResearchProviderError,
  type ResearchProviderErrorReason,
  type RetrievalPort,
} from './research/ports.js';
import type {
  RetrievalRequest,
  RetrievalResult,
  VersionTargetRequest,
  VersionTargetResult,
} from './research/retrieval-types.js';
import type { SearchReference } from './research/search-types.js';
import type { SourceVersionRef } from './research/temporal-types.js';

/**
 * Adaptateur Légifrance de {@link RetrievalPort} — jalon LEGAL-03B (ADR-0015).
 *
 * Enveloppe `LegalSourceProvider.getArticle` **tel quel** : il ne fait aucun
 * HTTP, n'utilise ni `SecretStore` ni `@jarvis/legifrance-client`, ne duplique
 * ni le mapping `LegalSource` ni l'appel au Tool. Le texte est capturé pendant
 * l'appel **existant** (aucun appel de plus) et exposé comme `content` vérifié
 * contre `source.contentHash` (ADR-0021) — jamais dans `LegalSource`.
 * Aucune logique temporelle : les versions sont seulement rendues dans une
 * forme générique (ADR-0014).
 */

/** Raisons de `LegifranceProviderError` traduites vers le contrat des ports. */
const PROVIDER_REASON_TO_PORT_REASON: Readonly<Record<string, ResearchProviderErrorReason>> = {
  unknown_tool: 'unknown_tool',
  invalid_input: 'invalid_request',
  denied: 'denied',
  awaiting_confirmation: 'awaiting_confirmation',
  execution_error: 'execution_error',
};

export interface LegifranceRetrievalAdapterOptions {
  readonly provider: LegalSourceProvider;
}

export class LegifranceRetrievalAdapter implements RetrievalPort {
  readonly providerId = LEGIFRANCE_PROVIDER_ID;

  private readonly provider: LegalSourceProvider;

  constructor(options: LegifranceRetrievalAdapterOptions) {
    this.provider = options.provider;
  }

  /** Pur, sans I/O : seule une référence Légifrance à identifiant `LEGIARTI…` est récupérable. */
  canRetrieve(reference: SearchReference): boolean {
    return reference.authority === 'legifrance' && isLegifranceArticleId(reference.candidateId);
  }

  /** Pur, sans I/O : seule une version d'article Légifrance à identifiant `LEGIARTI…` est récupérable par id. */
  canRetrieveVersion(request: VersionTargetRequest): boolean {
    return request.authority === 'legifrance' && isLegifranceArticleId(request.targetId);
  }

  /**
   * @throws {ResearchProviderError} `invalid_request` (référence non
   *   récupérable, sans aucun appel), les raisons du provider traduites, ou
   *   `malformed_response` si le mapping de la réponse échoue. Toute autre
   *   erreur (bug) est propagée telle quelle.
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const { reference } = request;
    if (!this.canRetrieve(reference)) {
      throw new ResearchProviderError(
        LEGIFRANCE_PROVIDER_ID,
        'invalid_request',
        `référence non récupérable : « ${reference.candidateId} ».`,
      );
    }
    return { ...(await this.fetchArticle(reference.candidateId)), reference };
  }

  /**
   * Récupération directe d'une version cible (ADR-0019) : **même** appel
   * `getArticle` que `retrieve`, sur l'id de la version. Ne vérifie pas que la
   * source reçue est bien la cible : cette vérification appartient au moteur, pour
   * tout fournisseur.
   *
   * @throws {ResearchProviderError} mêmes raisons que `retrieve` ; `invalid_request`
   *   (sans aucun appel) si la cible n'est pas récupérable.
   */
  async retrieveVersion(request: VersionTargetRequest): Promise<VersionTargetResult> {
    if (!this.canRetrieveVersion(request)) {
      throw new ResearchProviderError(
        LEGIFRANCE_PROVIDER_ID,
        'invalid_request',
        `version cible non récupérable : « ${request.targetId} ».`,
      );
    }
    return this.fetchArticle(request.targetId);
  }

  /** Appel `getArticle` + rendu générique des versions ; traduit les erreurs du provider et du mapping. */
  private async fetchArticle(id: string): Promise<VersionTargetResult> {
    try {
      const { source, metadata, content } = await this.provider.getArticle(id);
      // Intégrité (ADR-0021) : le contenu exposé doit avoir exactement le hash de la source.
      // Un fournisseur incohérent est refusé, jamais exposé comme vérifié.
      content.assertMatches(source.contentHash);
      const versions: readonly SourceVersionRef[] = metadata.articleVersions.map((version) => ({
        id: version.id,
        ...(version.version !== undefined ? { version: version.version } : {}),
        ...(version.etat !== undefined ? { state: version.etat } : {}),
        ...(version.effectiveFrom !== undefined ? { effectiveFrom: version.effectiveFrom } : {}),
        ...(version.effectiveTo !== undefined ? { effectiveTo: version.effectiveTo } : {}),
      }));
      return {
        source,
        versions,
        content,
        ...(metadata.versionPrecedente !== undefined
          ? { previousVersionId: metadata.versionPrecedente }
          : {}),
      };
    } catch (error) {
      if (error instanceof LegifranceProviderError) {
        const reason = PROVIDER_REASON_TO_PORT_REASON[error.reason] ?? 'execution_error';
        throw new ResearchProviderError(LEGIFRANCE_PROVIDER_ID, reason, error.message);
      }
      if (error instanceof ContentIntegrityError) {
        // Le message ne contient que des hash, jamais le texte.
        throw new ResearchProviderError(
          LEGIFRANCE_PROVIDER_ID,
          'malformed_response',
          error.message,
        );
      }
      if (error instanceof LegifranceMappingError) {
        throw new ResearchProviderError(
          LEGIFRANCE_PROVIDER_ID,
          'malformed_response',
          error.message,
        );
      }
      throw error;
    }
  }
}
