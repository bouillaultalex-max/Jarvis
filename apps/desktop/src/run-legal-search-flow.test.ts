import { describe, expect, it } from 'vitest';
import {
  InMemorySecretStore,
  OsCredentialSecretStore,
  PermissionManager,
} from '@jarvis/connectors';
import type { ResearchBudget } from '@jarvis/legal-research';

import type { LegalSearchInput } from './legal-search-args.js';
import {
  EMPTY_SEARCH_OUTPUT,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  articleResponse,
  buildFetchFn,
  buildLegifranceSecretStore,
  extract,
  searchOutput,
  searchResult,
} from './legal-search-test-fixtures.js';
import {
  defaultLegalSearchDeps,
  describeLegalSearchResult,
  resolveLegalSearchEnvironment,
  runLegalSearchFlow,
  type LegalSearchDeps,
} from './run-legal-search-flow.js';

/**
 * Tests de `runLegalSearchFlow` — exclusivement avec des doubles (`fetchFn`
 * mocké, `InMemorySecretStore`) : **aucun** appel réseau réel. Traverse les
 * adaptateurs (`LegifranceSearchAdapter`/`LegifranceRetrievalAdapter`) et le
 * `ToolExecutor` réels — même discipline que
 * `packages/connectors/src/legifrance/legifrance-connector.test.ts` et
 * `packages/legal-research/src/legifrance-search-adapter.test.ts`.
 */

const INPUT: LegalSearchInput = { text: 'préavis licenciement économique', asOf: '2026-01-01' };

describe('runLegalSearchFlow — succès, de bout en bout (adaptateurs et ToolExecutor réels)', () => {
  it('résultat hydraté : présentation correcte, secrets jamais affichés, contenu transitoire jamais sérialisé', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn();
    const deps: LegalSearchDeps = { secretStore, environment: 'sandbox', fetchFn };

    const flowResult = await runLegalSearchFlow(INPUT, deps);

    expect(flowResult.status).toBe('result');
    if (flowResult.status !== 'result') throw new Error('unreachable');
    expect(flowResult.result.candidates).toHaveLength(1);
    expect(flowResult.result.candidates[0]?.retrieval?.source.identifier).toBe(
      'LEGIARTI000006901174',
    );

    const lines = describeLegalSearchResult(flowResult).join('\n');
    expect(lines).toContain('1 résultat(s)');
    expect(lines).toContain('LEGIARTI000006901174');
    expect(lines).toContain('L1237-1');
    expect(lines).not.toContain(FAKE_CLIENT_SECRET);
    expect(lines).not.toContain(FAKE_CLIENT_ID);
    expect(lines).not.toContain('Texte factice'); // contenu transitoire (ADR-0021), jamais affiché
    expect(lines).toContain(
      "Cette liste n'est ni exhaustive, ni une analyse juridique, ni une conclusion de droit applicable vérifiée",
    );
  });

  it('assemble un unique ToolExecutor (recherche puis récupération)', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn();
    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
    });
    expect(flowResult.status).toBe('result');
    expect(fetchFn).toHaveBeenCalled();
  });
});

describe('runLegalSearchFlow — aucun résultat', () => {
  it('page de recherche vide → candidats vides, gap `no_search_result`, présentation distincte', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn({ searchOutput: EMPTY_SEARCH_OUTPUT });

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
    });

    expect(flowResult.status).toBe('result');
    if (flowResult.status !== 'result') throw new Error('unreachable');
    expect(flowResult.result.candidates).toHaveLength(0);
    expect(flowResult.result.gaps).toContainEqual({ kind: 'no_search_result' });

    const lines = describeLegalSearchResult(flowResult).join('\n');
    expect(lines).toContain('Aucun résultat Légifrance');
  });
});

describe('runLegalSearchFlow — résultats partiels (budget atteint)', () => {
  it('budget de candidats inférieur aux résultats disponibles → gap `budget_truncated`, rejet explicite, résultat quand même présenté', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const twoResultsOutput = searchOutput([
      searchResult({
        titles: [{ id: 'LEGITEXT_A' }],
        sections: [{ extracts: [extract({ id: 'LEGIARTI000006901174' })] }],
      }),
      searchResult({
        titles: [{ id: 'LEGITEXT_B' }],
        sections: [{ extracts: [extract({ id: 'LEGIARTI000006901175', title: 'L1237-2' })] }],
      }),
    ]);
    const fetchFn = buildFetchFn({ searchOutput: twoResultsOutput });
    const tightBudget: ResearchBudget = {
      maxSearchPages: 1,
      maxCandidates: 1,
      maxRetrievedSources: 1,
    };

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
      budget: tightBudget,
    });

    expect(flowResult.status).toBe('result');
    if (flowResult.status !== 'result') throw new Error('unreachable');
    expect(flowResult.result.candidates.length).toBeGreaterThan(0);
    expect(flowResult.result.rejections.some((r) => r.reason === 'over_candidate_budget')).toBe(
      true,
    );
    expect(flowResult.result.gaps.some((g) => g.budget === 'maxCandidates')).toBe(true);

    const lines = describeLegalSearchResult(flowResult).join('\n');
    expect(lines).toContain('Limites de cette recherche');
    expect(lines).toContain('Référence(s) écartée(s)');
  });
});

describe('runLegalSearchFlow — permission refusée', () => {
  it('PermissionManager injecté en deny → provider_error/denied, aucun appel fournisseur, politique jamais remplacée par le défaut', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn();
    const denyAll = new PermissionManager({ default: 'deny' });

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
      permissionManager: denyAll,
    });

    expect(flowResult.status).toBe('provider_error');
    if (flowResult.status !== 'provider_error') throw new Error('unreachable');
    expect(flowResult.reason).toBe('denied');
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining('/search'), expect.anything());

    const lines = describeLegalSearchResult(flowResult).join('\n');
    expect(lines).toContain('échouée');
  });
});

describe('runLegalSearchFlow — configuration absente ou invalide', () => {
  it('SecretStore sans credentials Légifrance → configuration_error, aucun appel réseau', async () => {
    const emptyStore = new InMemorySecretStore();
    const fetchFn = buildFetchFn();

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore: emptyStore,
      environment: 'sandbox',
      fetchFn,
    });

    expect(flowResult.status).toBe('configuration_error');
    expect(fetchFn).not.toHaveBeenCalled();

    const lines = describeLegalSearchResult(flowResult).join('\n');
    expect(lines).toContain('impossible');
    expect(lines).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // pas de trace brute
  });

  it('resolveLegalSearchEnvironment : LEGIFRANCE_ENVIRONMENT absent → "sandbox" par défaut', () => {
    expect(resolveLegalSearchEnvironment(undefined)).toBe('sandbox');
  });

  it('resolveLegalSearchEnvironment : valeur inconnue → rejet explicite', () => {
    expect(() => resolveLegalSearchEnvironment('staging')).toThrow(/invalide/);
  });

  it('resolveLegalSearchEnvironment : valeurs autorisées acceptées telles quelles', () => {
    expect(resolveLegalSearchEnvironment('sandbox')).toBe('sandbox');
    expect(resolveLegalSearchEnvironment('production')).toBe('production');
  });

  it('defaultLegalSearchDeps : SecretStore de production réel (OsCredentialSecretStore — trousseau OS), jamais un magasin en mémoire', () => {
    // Construction seule, sans appel de méthode : le constructeur
    // d'OsCredentialSecretStore ne fait aucune E/S (voir
    // os-credential-secret-store.ts) — cette assertion reste purement locale.
    const original = process.env.LEGIFRANCE_ENVIRONMENT;
    delete process.env.LEGIFRANCE_ENVIRONMENT;
    try {
      const deps = defaultLegalSearchDeps();
      expect(deps.secretStore).toBeInstanceOf(OsCredentialSecretStore);
      expect(deps.environment).toBe('sandbox');
    } finally {
      if (original !== undefined) process.env.LEGIFRANCE_ENVIRONMENT = original;
    }
  });
});

describe('runLegalSearchFlow — erreur fournisseur', () => {
  it('HTTP 500 sur /search → provider_error (execution_error), message sans détail brut de réponse', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn({
      searchStatus: 500,
      searchOutput: { error: 'panne interne PISTE' },
    });

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
    });

    expect(flowResult.status).toBe('provider_error');
    if (flowResult.status !== 'provider_error') throw new Error('unreachable');
    expect(flowResult.reason).toBe('execution_error');
    expect(flowResult.detail).not.toContain('panne interne PISTE');
  });
});

describe('runLegalSearchFlow — réponse malformée', () => {
  it('racine /search sans `results` → provider_error (execution_error) : rejetée par le connecteur lui-même, jamais un succès vide', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn({ searchOutput: { totalResultNumber: 0 } });

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
    });

    // Le connecteur (packages/connectors) rejette une racine sans `results`
    // avant même que l'adaptateur legal-research ne voie la réponse
    // (ADR-0017) : ToolExecutor renvoie `error`, traduit en `execution_error`
    // par LegifranceSearchAdapter — jamais un `ResearchResult` vide présenté
    // comme un succès.
    expect(flowResult.status).toBe('provider_error');
    if (flowResult.status !== 'provider_error') throw new Error('unreachable');
    expect(flowResult.reason).toBe('execution_error');
  });

  it("réponse d'article incomplète (dateDebut absente) → recherche toujours réussie, candidat écarté (rejet retrieval_failed/malformed_response), jamais un faux succès hydraté", async () => {
    const secretStore = await buildLegifranceSecretStore();
    // Passe le contrat minimal du connecteur (article.id présent) mais pas
    // celui, plus strict, de `mapLegifranceArticleToLegalSource`
    // (`dateDebut` requis, nombre fini — `legifrance-source-mapping.ts`,
    // `requireFiniteNumber`). Un échec de RÉCUPÉRATION (à la différence d'un
    // échec de RECHERCHE, voir le test précédent) n'interrompt jamais la
    // recherche (`ResearchEngine.research()`, documenté explicitement) : il
    // devient un `ResearchRejection`, le flow reste `status: 'result'`.
    const incompleteArticle = articleResponse({ dateDebut: null });
    const fetchFn = buildFetchFn({ articleOutput: incompleteArticle });

    const flowResult = await runLegalSearchFlow(INPUT, {
      secretStore,
      environment: 'sandbox',
      fetchFn,
    });

    expect(flowResult.status).toBe('result');
    if (flowResult.status !== 'result') throw new Error('unreachable');
    expect(flowResult.result.candidates.every((c) => c.retrieval === undefined)).toBe(true);
    expect(flowResult.result.rejections).toContainEqual(
      expect.objectContaining({ reason: 'retrieval_failed', errorReason: 'malformed_response' }),
    );

    const lines = describeLegalSearchResult(flowResult).join('\n');
    // Distinct du cas « aucun résultat » (recherche vide) : ici la recherche
    // a bien trouvé un candidat, seule sa récupération a échoué — le message
    // doit le dire, jamais « Aucun résultat » (qui laisserait croire que la
    // recherche elle-même n'a rien trouvé).
    expect(lines).not.toContain('Aucun résultat Légifrance');
    expect(lines).toContain('candidat(s) trouvé(s)');
    expect(lines).toContain("aucun n'a pu être récupéré");
    expect(lines).toContain('Référence(s) écartée(s)');
  });
});

describe('runLegalSearchFlow — fonctionnement sans configuration Gmail ni clé LLM', () => {
  it("n'accède jamais à GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/ANTHROPIC_API_KEY", async () => {
    const originalGmailId = process.env.GMAIL_CLIENT_ID;
    const originalGmailSecret = process.env.GMAIL_CLIENT_SECRET;
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const secretStore = await buildLegifranceSecretStore();
      const fetchFn = buildFetchFn();
      const flowResult = await runLegalSearchFlow(INPUT, {
        secretStore,
        environment: 'sandbox',
        fetchFn,
      });
      expect(flowResult.status).toBe('result');
    } finally {
      if (originalGmailId !== undefined) process.env.GMAIL_CLIENT_ID = originalGmailId;
      if (originalGmailSecret !== undefined) process.env.GMAIL_CLIENT_SECRET = originalGmailSecret;
      if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });
});
