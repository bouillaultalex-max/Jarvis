import {
  OsCredentialSecretStore,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  legifranceConnector,
  resolveLegifranceCredentials,
  type SecretStore,
} from '@jarvis/connectors';
import {
  LEGIFRANCE_ENVIRONMENTS,
  LegifranceHttpClient,
  LegifranceOAuthClient,
  createLegifranceConfig,
  type LegifranceEnvironment,
} from '@jarvis/legifrance-client';
import {
  LegifranceRetrievalAdapter,
  LegifranceSearchAdapter,
  LegifranceSourceProvider,
  ResearchEngine,
  ResearchProviderError,
  type ResearchBudget,
  type ResearchGap,
  type ResearchProviderErrorReason,
  type ResearchRejection,
  type ResearchResult,
} from '@jarvis/legal-research';
import type { VersionResolution } from '@jarvis/legal-research';

import type { LegalSearchInput } from './legal-search-args.js';

/**
 * Premier parcours utilisateur Légifrance en **lecture seule** —
 * `legal-search` (`apps/desktop`). Assemble, sur un **même** `ToolExecutor`,
 * `legifranceConnector` (Tools `read` existants, inchangés) et les
 * adaptateurs `@jarvis/legal-research` déjà implémentés et testés
 * (`LegifranceSearchAdapter`/`LegifranceRetrievalAdapter`/
 * `LegifranceSourceProvider`), puis `ResearchEngine.research()`.
 *
 * Volontairement **hors périmètre** : aucun Tool `execute`, aucun
 * `AgentLoop`, aucun HTTP direct (tout passe par `LegifranceHttpClient` via
 * `ToolExecutor`), aucun appel à `projectCitations`/
 * `attachSourcesAndCitations`/`FileLegalCaseStore` — une recherche en
 * lecture seule n'écrit jamais de dossier, même implicitement. Voir la
 * proposition qui précède cette implémentation pour la justification
 * complète de cette frontière.
 */

const SEARCH_TOOL_NAME = 'legifrance.search';
const GET_ARTICLE_TOOL_NAME = 'legifrance.get_article';

/**
 * Budget fixe de ce premier parcours — unités vérifiées contre
 * `ResearchBudget` (`@jarvis/legal-research`, `research-types.ts`) :
 * `maxSearchPages` = pages de **résultats** de recherche interrogées (pas
 * des articles, ADR-0011) ; `maxCandidates` = références dédupliquées
 * conservées ; `maxRetrievedSources` = appels `legifrance.get_article`
 * effectués. Non paramétrable par la CLI dans ce premier parcours (décision
 * volontaire, périmètre minimal) ; injectable pour les tests via
 * {@link LegalSearchDeps.budget}.
 */
const DEFAULT_BUDGET: ResearchBudget = {
  maxSearchPages: 1,
  maxCandidates: 5,
  maxRetrievedSources: 5,
};

const DEFAULT_PAGE_SIZE = 5;

const LEGIFRANCE_ENVIRONMENT_VAR = 'LEGIFRANCE_ENVIRONMENT';

/**
 * Résout l'environnement Légifrance pour `legal-search` — **délibérément
 * différent** de `resolveLegifranceEnvironment()` (`@jarvis/legifrance-client`),
 * qui exige la variable et ne choisit jamais `'sandbox'` par défaut
 * (LEGAL-02B.1, décision explicite : jamais de défaut, a fortiori jamais
 * `'production'`). Ici, l'absence de `LEGIFRANCE_ENVIRONMENT` vaut
 * explicitement `'sandbox'` — décision propre à ce premier parcours
 * (moindre risque par défaut pour une commande nouvellement exposée) ; une
 * valeur *présente* mais non reconnue reste refusée, jamais silencieusement
 * ramenée à `'sandbox'`. Réutilise `LEGIFRANCE_ENVIRONMENTS` (liste
 * autorisée unique, définie une seule fois dans `@jarvis/legifrance-client`)
 * plutôt que de dupliquer `['sandbox', 'production']`.
 */
export function resolveLegalSearchEnvironment(raw: string | undefined): LegifranceEnvironment {
  if (raw === undefined) return 'sandbox';
  if (!LEGIFRANCE_ENVIRONMENTS.includes(raw as LegifranceEnvironment)) {
    throw new Error(
      `legal-search : LEGIFRANCE_ENVIRONMENT invalide (« ${raw} ») — attendu : ${LEGIFRANCE_ENVIRONMENTS.join(' ou ')}.`,
    );
  }
  return raw as LegifranceEnvironment;
}

export interface LegalSearchDeps {
  readonly secretStore: SecretStore;
  readonly environment: LegifranceEnvironment;
  /** Injectable pour les tests : jamais d'appel réseau réel. */
  readonly fetchFn?: typeof fetch;
  /**
   * Injectable pour les tests. Absent en production ⇒ politique dédiée,
   * n'autorisant explicitement que `legifrance.search` et
   * `legifrance.get_article` (`default: 'deny'`) — jamais une autorisation
   * générale de tous les outils `read` du connecteur (`legifrance.ping`
   * compris). Une politique injectée — y compris une politique de refus —
   * est **toujours** utilisée telle quelle, jamais remplacée par ce défaut.
   */
  readonly permissionManager?: PermissionManager;
  /** Injectable pour les tests (budget fixe ci-dessus sinon). */
  readonly budget?: ResearchBudget;
  /** Injectable pour les tests déterministes (horodatages `provenance.executedAt`/OAuth). Défaut : `Date.now`. */
  readonly now?: () => number;
}

/**
 * Dépendances de production : `SecretStore` réel (trousseau OS, même
 * instance conceptuelle que pour Gmail — aucun nouveau mécanisme de
 * stockage), environnement résolu depuis `LEGIFRANCE_ENVIRONMENT`. Construite
 * **tardivement** : appelée uniquement depuis la branche `legal-search` du
 * dispatch, jamais avant, donc jamais lue ni construite pour une autre
 * sous-commande — et surtout jamais avant que `resolveLegalSearchEnvironment`
 * (synchrone, sans I/O) n'ait validé la variable d'environnement.
 *
 * Clés `SecretStore` attendues (jamais affichées, voir
 * `legifranceClientIdSecretKey`/`legifranceClientSecretSecretKey`,
 * `@jarvis/legifrance-client`) : `legifrance.<sandbox|production>.clientId`
 * et `legifrance.<sandbox|production>.clientSecret`. Aucun script de
 * provisionnement n'est ajouté par cette mission — leur absence produit un
 * `configuration_error` contrôlé (voir {@link runLegalSearchFlow}), jamais
 * un succès vide ni une trace brute.
 */
export function defaultLegalSearchDeps(): LegalSearchDeps {
  return {
    secretStore: new OsCredentialSecretStore(),
    environment: resolveLegalSearchEnvironment(process.env[LEGIFRANCE_ENVIRONMENT_VAR]),
  };
}

export type LegalSearchFlowResult =
  | { readonly status: 'result'; readonly result: ResearchResult }
  | { readonly status: 'configuration_error'; readonly reason: string }
  | {
      readonly status: 'provider_error';
      readonly reason: ResearchProviderErrorReason;
      readonly detail: string;
    };

/**
 * Code de sortie CLI pour `legal-search`, dérivé du **statut structuré** du
 * flow — jamais d'une détection de texte affiché (`describeLegalSearchResult`
 * reste uniquement destinée à l'humain).
 *
 * Convention volontaire : `'result'` vaut toujours `0`, **y compris des
 * résultats partiels** (candidats rejetés par le budget, référence non
 * récupérée…) — un résultat partiel reste un résultat exploitable, présenté
 * avec ses limites visibles (`describeLegalSearchResult`), pas un échec total
 * de la commande. Seuls `'configuration_error'` (configuration absente ou
 * invalide) et `'provider_error'` (fournisseur en échec **ou** permission
 * refusée — `reason: 'denied'`, voir `LegifranceSearchAdapter`) valent un
 * code non nul : dans ces deux cas, aucune recherche exploitable n'a eu
 * lieu.
 */
export function legalSearchExitCode(result: LegalSearchFlowResult): number {
  switch (result.status) {
    case 'result':
      return 0;
    case 'configuration_error':
    case 'provider_error':
      return 1;
    default: {
      const exhaustive: never = result;
      throw new Error(
        `legalSearchExitCode : statut inattendu (${(exhaustive as { readonly status: string }).status}).`,
      );
    }
  }
}

function buildPermissionManager(deps: LegalSearchDeps): PermissionManager {
  return (
    deps.permissionManager ??
    new PermissionManager({
      rules: {
        [SEARCH_TOOL_NAME]: 'allow',
        [GET_ARTICLE_TOOL_NAME]: 'allow',
      },
      default: 'deny',
    })
  );
}

/**
 * Exécute une recherche juridique Légifrance en lecture seule, de bout en
 * bout : résolution des credentials → client HTTP → `legifranceConnector` →
 * `ToolExecutor` → `LegifranceSearchAdapter`/`LegifranceRetrievalAdapter` →
 * `ResearchEngine`. Ne lève jamais pour un échec « métier » attendu
 * (credentials absents, permission refusée, échec fournisseur, réponse
 * malformée) — ces cas sont renvoyés comme {@link LegalSearchFlowResult}
 * structuré. Une exception inattendue (bug, `RangeError` de budget/requête —
 * structurellement impossible ici, budget et `asOf` étant déjà valides à cet
 * appel) se propage telle quelle, comme toute autre sous-commande desktop.
 */
export async function runLegalSearchFlow(
  input: LegalSearchInput,
  deps: LegalSearchDeps,
): Promise<LegalSearchFlowResult> {
  const now = deps.now ?? Date.now;

  let credentials;
  try {
    credentials = await resolveLegifranceCredentials(deps.secretStore, deps.environment);
  } catch (err) {
    return {
      status: 'configuration_error',
      reason:
        err instanceof Error
          ? `configuration Légifrance absente ou incomplète (${err.message}).`
          : 'configuration Légifrance absente ou incomplète.',
    };
  }

  const config = createLegifranceConfig(deps.environment);
  const accessTokenProvider = new LegifranceOAuthClient({
    config,
    credentials,
    now,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
  });
  const client = new LegifranceHttpClient({
    config,
    accessTokenProvider,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
  });

  const registry = new ToolRegistry();
  for (const tool of legifranceConnector.createTools(client)) {
    registry.register(tool);
  }
  const toolExecutor = new ToolExecutor(registry, buildPermissionManager(deps));

  const search = new LegifranceSearchAdapter({ toolExecutor, now });
  const sourceProvider = new LegifranceSourceProvider({ toolExecutor, now });
  const retrieval = new LegifranceRetrievalAdapter({ provider: sourceProvider });
  const engine = new ResearchEngine({ search, retrieval });

  try {
    const result = await engine.research(
      {
        text: input.text,
        matchMode: 'all_terms',
        asOf: input.asOf,
        page: { number: 1, size: DEFAULT_PAGE_SIZE },
      },
      deps.budget ?? DEFAULT_BUDGET,
    );
    return { status: 'result', result };
  } catch (err) {
    if (err instanceof ResearchProviderError) {
      return { status: 'provider_error', reason: err.reason, detail: err.message };
    }
    throw err;
  }
}

function describeVersionResolution(resolution: VersionResolution): string {
  switch (resolution.status) {
    case 'resolved':
      return `résolue (version ${resolution.version.id})`;
    case 'none_applicable':
      return `aucune version applicable (${resolution.reason})`;
    case 'indeterminate':
      return `indéterminée (${resolution.reason})`;
    default: {
      const exhaustive: never = resolution;
      return `inconnue (${(exhaustive as { readonly status: string }).status})`;
    }
  }
}

function summarizeByReason<T extends { readonly reason: string }>(items: readonly T[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => `${reason} (${count})`).join(', ');
}

function summarizeGaps(gaps: readonly ResearchGap[]): string {
  return gaps
    .map((gap) => {
      const count = gap.count !== undefined ? ` [${gap.count}]` : '';
      const budget = gap.budget !== undefined ? ` (budget: ${gap.budget})` : '';
      return `${gap.kind}${count}${budget}`;
    })
    .join(', ');
}

/**
 * Traduit un {@link LegalSearchFlowResult} en lignes humaines — mêmes
 * conventions que `describeSendResult`/`describeReadResult` (`main.ts`).
 * N'affiche **que** les métadonnées portées par `ResearchResult`/
 * `LegalSource` (jamais de référence, URL, date ou champ inventé) ; ne
 * sérialise jamais `RetrievedContent` (protégé par ADR-0021) ; ne qualifie
 * jamais une source de « droit applicable » ni de conclusion vérifiée.
 */
export function describeLegalSearchResult(flowResult: LegalSearchFlowResult): readonly string[] {
  if (flowResult.status === 'configuration_error') {
    return [`Recherche Légifrance impossible : ${flowResult.reason}`];
  }
  if (flowResult.status === 'provider_error') {
    return [`Recherche Légifrance échouée (${flowResult.reason}) : ${flowResult.detail}`];
  }

  const { result } = flowResult;
  const hydrated = result.candidates.filter(
    (
      candidate,
    ): candidate is typeof candidate & { retrieval: NonNullable<typeof candidate.retrieval> } =>
      candidate.retrieval !== undefined,
  );

  const lines: string[] = [];
  const asOfLabel = result.query.asOf ?? '(date non précisée)';

  if (hydrated.length === 0 && result.candidates.length === 0) {
    lines.push(`Aucun résultat Légifrance pour « ${result.query.text} » au ${asOfLabel}.`);
  } else if (hydrated.length === 0) {
    // Distinct du cas ci-dessus : la recherche a trouvé des candidats, mais
    // aucun n'a pu être récupéré (voir `result.rejections` ci-dessous) — dire
    // « Aucun résultat » ici laisserait croire à tort que la recherche
    // elle-même n'a rien trouvé.
    lines.push(
      `${result.candidates.length} candidat(s) trouvé(s) pour « ${result.query.text} » au ${asOfLabel}, mais aucun n'a pu être récupéré (voir les références écartées ci-dessous).`,
    );
  } else {
    lines.push(
      `${hydrated.length} résultat(s) Légifrance pour « ${result.query.text} » au ${asOfLabel} :`,
      '',
    );
    hydrated.forEach((candidate, index) => {
      const { source } = candidate.retrieval;
      const title = source.title.length > 0 ? ` — ${source.title}` : '';
      lines.push(`${index + 1}. ${source.identifier}${title}`);
      lines.push(
        `   Provenance : ${candidate.reference.provenance.providerId}/${candidate.reference.provenance.collection}, recherché le ${candidate.reference.provenance.executedAt}`,
      );
      lines.push(`   Consulté le ${source.consultedAt}`);
      if (candidate.versionResolution !== undefined) {
        lines.push(
          `   Résolution de version à la date demandée : ${describeVersionResolution(candidate.versionResolution)} — historique ${candidate.historyCompleteness ?? 'unknown'} (jamais garanti exhaustif).`,
        );
        // `retrieval` (ci-dessus) est la source INITIALEMENT trouvée — jamais
        // un substitut de la version résolue (ADR-0019, conséquences). Si la
        // résolution désigne une version différente, le lecteur doit le
        // savoir explicitement plutôt que de supposer que le contenu
        // affiché est celui résolu pour la date demandée. Formulation
        // volontairement non assertive : une résolution reste « au mieux »
        // (jamais une preuve d'exhaustivité, jamais une conclusion de droit
        // applicable vérifiée — voir l'avertissement final de cette fonction).
        if (candidate.versionResolution.status === 'resolved') {
          const resolvedSource = candidate.resolvedRetrieval?.result.source;
          if (resolvedSource === undefined) {
            lines.push(
              `   Version résolue (${candidate.versionResolution.version.id}) non récupérée : le contenu ci-dessus ne correspond pas à cette version (voir références écartées).`,
            );
          } else if (resolvedSource.id !== source.id) {
            const resolvedTitle =
              resolvedSource.title.length > 0 ? ` — ${resolvedSource.title}` : '';
            lines.push(
              `   Source de la version résolue (au mieux, à la date demandée) : ${resolvedSource.identifier}${resolvedTitle}, consultée le ${resolvedSource.consultedAt} — distincte de la source ci-dessus, initialement trouvée.`,
            );
          }
        }
      }
      lines.push('');
    });
  }

  if (result.rejections.length > 0) {
    lines.push(
      `Référence(s) écartée(s) : ${summarizeByReason(result.rejections as readonly ResearchRejection[])}.`,
    );
  }
  if (result.gaps.length > 0) {
    lines.push(`Limites de cette recherche : ${summarizeGaps(result.gaps)}.`);
  }
  lines.push(
    "Cette liste n'est ni exhaustive, ni une analyse juridique, ni une conclusion de droit applicable vérifiée — chaque source doit être relue indépendamment.",
  );

  return lines;
}
