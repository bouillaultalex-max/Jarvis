# État du projet JARVIS

_Dernière mise à jour : 2026-10-21 — **vérification de postcondition opt-in**
ajoutée : `runWithVerification` (`@jarvis/core`), vérificateur `inmemory.send`
(`@jarvis/connectors`) et démonstration CLI `verify-demo` (`apps/desktop`) —
voir « Vérification de postcondition (opt-in) » ci-dessous et la section
dédiée dans `MASTER_ROADMAP.md`. 76 tests ciblés verts (détail dans la
section dédiée et dans « Vérifications »). Checkpoint local `5478144` —
`main` est **3 commits en avance sur `origin/main`** : `748b7a0` est le
dernier commit publié ; `f463033`, `f474cd8` et `5478144` ne sont pas
poussés. Aucune application de production (`AgentLoop`, `apps/api`,
`gmail.send`) n'est concernée : seule une démonstration locale sur un
connecteur fictif l'utilise. N'affecte ni les composants ni les priorités
décrits par la mise à jour précédente._

_Mise à jour précédente (2026-10-19) — **synchronisation documentaire jusqu'au checkpoint
`a92cca3`** (publié, `main` = `origin/main`). Ajout des composants livrés depuis le
2026-09-30 (voir « Composants livrés depuis 2026-09-30 ») : Légifrance CLI et
provisionnement, banc d'interfaces d'outils, canal WhatsApp (simulé par défaut, mode
réel opt-in : serveur et tunnel lancés puis arrêtés, aucun échange réel rapporté), chat local sans outils, fiches projet /
export / entretien interactif. Ce sont des **composants**, pas des jalons achevés.
Étapes Product Builder PB-01 à PB-06 (Notion, séquencement proposé) : PB-01 et PB-02
partiellement couverts, PB-03 à PB-06 non démontrés (`MASTER_BACKLOG.md` →
« Product Builder »). Suite complète **historique** : 3111 tests /
181 fichiers (rapportée, non rejouée ici) ; rejoué le 2026-10-19 à la clôture de
l'entretien : 91 tests / 11 fichiers, `tsc --noEmit`, ESLint, hooks pre-commit, essai
CLI fictif. Rien n'est validé en production._

_Mise à jour précédente (2026-09-26, état **historique**) — **domaine juridique : LEGAL-04.1 (Fact & Case
Engine, premier jalon) implémentée et validée pour commit.** Nouveau package
`@jarvis/legal-case-engine` (dépendance runtime unique : `@jarvis/legal-core`, **non
modifié**), livré dans un commit dédié (`feat(legal): add legal case engine`) ; son état
de publication se lit dans Git et n'est pas figé ici. Il fournit l'ajout d'une question
ouverte, l'enregistrement atomique d'un fait rapporté (fait, pièce non documentaire et
liens de question), des contrôles chronologiques à l'écriture et la recherche
**consultative** de faits équivalents ; il ne fait ni persistance, ni validation humaine,
ni correction de faits, ni projection des faits écartés, ni proposition LLM (voir
« LEGAL-04.1 » dans « Domaine juridique »). Résultats vérifiés par exécution le
2026-09-26 avant le commit : package **285 tests / 10 fichiers**, suite complète
**2481 tests / 135 fichiers** dans l'arbre de travail (dont 3 tests du POC
`situation-poc`, non commité), `tsc --noEmit`, `eslint .` et Prettier verts. **Rien
n'est validé en production** et aucune application ne consomme ce package._

_Mise à jour précédente (2026-09-26, baseline Git, état **historique** — LEGAL-04.1 l'a
remplacée) — **domaine juridique : baseline Git établie,
LEGAL-04.0 terminé.** Le domaine légal est désormais **versionné** :
`@jarvis/legal-core` (LegalCase v3), `ToolExecutor.runTracked` et
`LEGAL_SPECIFICATION.md` sont dans `85e7e6e` (présent sur `origin/main`) ;
`@jarvis/legifrance-client`, `packages/connectors/src/legifrance/`,
`@jarvis/legal-research`, les règles ESLint de frontières et le `package-lock.json`
synchronisé sont dans `979fa19` ; les ADR `0011` à `0021` sont dans `8407ac0` ; un
correctif CI du scan de secrets (fixtures de `memory-promotion.test.ts`) est dans
`e9b3357` ; la synchronisation documentaire correspondante est dans `38fb0fc`.
**Ces quatre commits sont publiés sur `origin/main`** (poussés le 2026-09-26) :
`main` est synchronisée avec `origin/main` (0 commit d'avance, 0 de retard).
Vérification sur un clone propre de `HEAD` (`e9b3357`, avant le push et le commit
documentaire, qui ne touche que des documents) : **2193 tests / 125 fichiers verts**, `tsc --noEmit` PASS,
`eslint .` PASS ; l'arbre de travail local en compte 2196 (les 3 tests
supplémentaires viennent du POC `situation-poc`, non commité). « Terminé » =
implémenté, versionné et testé ; **aucune de ces capacités n'est validée en
production** et aucune application ne les consomme. **LEGAL-04.1 est la prochaine
étape : elle n'a pas commencé, son package n'existe pas.** `AUDIT_STATE.md` et les
autres documents de cadrage (slices, situation) restent non suivis._

_Mise à jour précédente (2026-09-25, état **historique** — la baseline Git ci-dessus
l'a remplacée) — **domaine juridique : LegalCase v3
(Fact / Provenance / Evidence / Temporal) clôturé** (voir « Domaine juridique →
LegalCase v3 » ci-dessous). **LegalCase v3 : COMPLETED / CLOSED.** Décisions
d'architecture Q1–Q10, B1–B4 et U1 : **CLOSED**. `ToolExecutor.runTracked`
(`{ invocationId, result }`) : **IMPLEMENTED / CLOSED**. Post-Implementation
Review : **CLOSED — PASS WITH ATTENTION** (aucune violation architecturale ;
attentions A1–A4 **non bloquantes**). Suite complète vérifiée le 2026-09-25 :
**2196 tests / 125 fichiers verts**, `tsc --noEmit` PASS, `eslint .` PASS, tests
d'architecture PASS. **Prochaine étape du domaine juridique : LEGAL-04 — Fact &
Case Engine** (périmètre détaillé non décidé). **Le domaine légal reste non suivi
par git** (et `packages/core/src/tool-executor.ts` est modifié, non committé) :
« terminé » = implémenté et validé dans l'environnement de travail, **pas
committé**._

_Mise à jour précédente (2026-09-24, état **historique**) — **domaine juridique :
Content Exposure clôturé** (voir la section « Domaine juridique » ci-dessous). Blocs **CLOSED** :
LEGAL-00 → LEGAL-03B, VersionResolver, Version Resolution Integration, Resolved
Version Retrieval, Research → Case, Content Exposure (ADR 0011 à 0021).
À cette date, prochaine étape **alors à déterminer** (établie depuis :
LEGAL-04 ; aucun LEGAL-03C n'est planifié). **Le domaine légal est non suivi par git** :
« terminé » signifie implémenté et validé dans l'environnement de travail,
**pas committé**. Suite complète vérifiée le 2026-09-24 (**historique, avant LegalCase v3**) :
**1719 tests / 112 fichiers verts**, `eslint .` et `tsc --noEmit` propres. Les sections
antérieures de ce document (M4 → VS-02) restent l'état historique à leur
date, sauf indication contraire. Mise à jour précédente du domaine juridique :
2026-09-23 (jusqu'à LEGAL-03B)._

_Mise à jour précédente : 2026-09-08 — M8 (Gmail Send) committé et terminé,
sous-jalons M8-B2 à M8-B6 : OAuth Google Authorization Code + PKCE
(`2d088b7`), `SecretStore` de production via trousseau OS (`b5db57e`),
boucle d'envoi confirmée (`a811027`), câblage CLI desktop `connect`/`send`
(`309bbfb`), couverture des erreurs réseau/provider post-confirmation
(`2faf205`). Voir section dédiée ci-dessous. `apps/api` reste non branché
(aucun outil connecteur dans son `ToolRegistry`)._

_Après M8, **surface CLI desktop post-M8** (hors numérotation de jalon —
exposition CLI de briques déjà existantes) : commande `disconnect`
(`cc2e8a4`), commande `read` (`9c24cb7`), commande `inbox` (`996d716`,
`fetchAndClassifyEmails`, s'arrête à la classification), commande
`prepare-reply` (`753f4d0`, câblage du Tool `gmail.prepare_reply`).
`apps/desktop` expose donc six commandes : `connect` / `read` / `inbox` /
`prepare-reply` / `send` / `disconnect`. `apps/api` toujours non branché._

_Entre M7.4 et M8, une **fondation architecturale transversale** —
`Connector Architecture Foundation` (commit `8506792`, voir « Functional
milestones vs Architectural foundations » ci-dessous) — a été ajoutée :
elle ne constitue PAS un nouveau jalon fonctionnel et ne remplace pas le M5
Gmail historique (`fd13ffa`)._

_Après la surface CLI desktop post-M8, **VS-02 — Lecture naturelle
contrôlée** ajoute une septième commande, `read-natural "<texte>"`
(lecture Gmail en langage naturel, périmètre readonly strictement
contrôlé — voir « Lecture naturelle contrôlée — VS-02 » ci-dessous).
**Implémentée, testée et committée** (`8fb7ff4` — 82 tests ciblés verts)._

## Vue d'ensemble

JARVIS est un assistant IA personnel organisé en monorepo npm workspaces
(TypeScript strict, exécution via `tsx`, tests via Vitest).

## Functional milestones vs Architectural foundations

Deux catégories d'entrées cohabitent dans ce document et dans l'historique
Git — ne pas les confondre :

- **Functional milestones** (`M4`, `M5`, `M6`, `M7.1`–`M7.4`, `M8`…) :
  livrent une capacité utilisateur visible (lire Gmail, classer un email,
  préparer une réponse, envoyer un email…). Numérotés séquentiellement,
  chacun correspond à un ou plusieurs commits précis. C'est la chronologie
  de référence, détaillée en fin de document (« Commits clés »).
- **Architectural foundations** : refactorent ou généralisent une brique
  déjà existante **sans livrer de nouvelle capacité utilisateur**. Elles ne
  portent pas de numéro de jalon fonctionnel — leur donner un `Mx` créerait
  une collision avec la chronologie ci-dessus. Elles sont documentées par
  leur libellé et le commit qui les introduit.

  - `Connector Architecture Foundation` (alias technique `M5.ARCH` —
    volontairement hors de la suite `M4…M8` pour éviter toute confusion
    avec le M5 fonctionnel `fd13ffa`) : commit `8506792`. Généralise
    l'architecture connecteurs posée en amont de M5 (`Connector<TClient>`,
    déjà existant) avec `ConnectorRegistry`, `AccountStore` (multi-compte
    par provider) et `SecretStore`/`InMemorySecretStore`. Voir
    `docs/connectors-architecture.md` et la section dédiée plus bas. Ne
    modifie ni `gmailConnector`, ni `inMemoryConnector`, ni
    `PermissionManager`/`ToolExecutor` : additive, se situe
    chronologiquement entre M7.4 et le prochain jalon fonctionnel (M8),
    sans en faire partie.

En résumé : si une entrée de ce document ne livre aucune nouvelle capacité
utilisateur observable, elle appartient à la seconde catégorie — même si
elle est substantielle en volume de code ou en tests.

## Workspaces & dépendances

```
@jarvis/types           (aucune dépendance interne)
@jarvis/llm             → @anthropic-ai/sdk
@jarvis/memory          (aucune dépendance interne)
@jarvis/core            → @jarvis/llm (types uniquement), @jarvis/types, @jarvis/memory
@jarvis/tools           → @jarvis/core, @jarvis/types
@jarvis/connectors      → @jarvis/core, @jarvis/types, @jarvis/legifrance-client (depuis LEGAL-02B.2 ; versionné depuis `979fa19`, publié sur `origin/main`)
@jarvis/classification  → @jarvis/llm (types uniquement), @jarvis/types
@jarvis/inbox           → @jarvis/core, @jarvis/classification, @jarvis/llm (types uniquement), @jarvis/types
                           (+ @jarvis/connectors en devDependency, tests uniquement)
apps/api                → @jarvis/core, @jarvis/llm, @jarvis/tools, fastify
apps/desktop            → @jarvis/connectors, @jarvis/legal-research, @jarvis/legifrance-client
                           (depuis `legal-search`, lecture seule — voir « Domaine juridique »
                           et `apps/desktop` ci-dessous)
                           + @jarvis/core, @jarvis/llm (`chat`, `370159e`), @jarvis/project-briefs
                           (`project`, `fc92fab`), @jarvis/classification, @jarvis/inbox
apps/whatsapp-channel   → @jarvis/core, @jarvis/connectors, fastify (Node ≥ 24.20.0)
@jarvis/project-briefs  (aucune dépendance interne ; feuille)

Domaine juridique (LEGAL-01 → Content Exposure ; `legal-core` versionné depuis `85e7e6e`, le reste depuis `979fa19` — publié sur `origin/main`) :
@jarvis/legal-core      (aucune dépendance interne ; feuille imposée par ESLint)
@jarvis/legal-research  → @jarvis/core, @jarvis/legal-core
@jarvis/legal-case-engine → @jarvis/legal-core (seule dépendance, LEGAL-04.1 ; imposée par ESLint et tests)
@jarvis/legifrance-client (aucune dépendance interne ; feuille imposée par ESLint et test — cycle de packages avec connectors corrigé)
```

`@jarvis/connectors` ne dépendait que de `@jarvis/core` + `@jarvis/types`
jusqu'à M8 ; **depuis LEGAL-02B.2 il dépend aussi de `@jarvis/legifrance-client`**
(voir « Domaine juridique »). `@jarvis/core` ne connaît, et ne connaîtra
jamais, Gmail/Discord/etc.

`@jarvis/classification` ne dépend ni de `@jarvis/connectors` ni de
`@jarvis/core` : uniquement de `@jarvis/types` (pour `EmailMessage`) et des
**types** de `@jarvis/llm` (`LlmProvider`/`LlmMessage`, `import type` — aucune
dépendance d'exécution sur `@anthropic-ai/sdk`).

`@jarvis/inbox` (M6, étendu en M7) est la **couche d'orchestration** qui
relie connecteurs et classification : son code livré (`dependencies`) ne
connaît **aucun fournisseur** — il fonctionne avec n'importe quel `Tool` de
lecture déjà enregistré dans un `ToolExecutor`. `@jarvis/connectors`
n'apparaît qu'en `devDependency`, utilisé uniquement par le test
d'intégration qui démontre le flux avec le `gmailConnector` réel.
`@jarvis/llm` n'est importé qu'en `import type` (même garantie que
`@jarvis/classification` : aucune dépendance d'exécution sur
`@anthropic-ai/sdk`). `ClassificationEngine` n'est ni modifié ni sous-classé.

| Workspace | Rôle | État |
|---|---|---|
| `@jarvis/types` | Types partagés (`JarvisMessage`, `EmailMessage`) | stable, minimal |
| `@jarvis/llm` | Abstraction LLM + `AnthropicProvider` | fonctionnel ; clé lue en lazy au 1er appel ; `LlmResponse.toolCall?` défini mais jamais émis par `AnthropicProvider` |
| `@jarvis/memory` | Mémoire contrôlée : `MemoryEntry`/`MemoryCandidate`, provenance à 5 niveaux, `MemoryPromoter`/`MemoryPromotionPolicy`, `InMemoryMemoryStore`/`FileMemoryStore` | package feuille, disponible et testé ; **aucune promotion n'est câblée en production** (ni `apps/api` ni `apps/desktop` ne fournissent d'option mémoire à `AgentLoop`) ; policy de référence pour toute future intégration : `ADR-0007` |
| `@jarvis/core` | `AgentLoop`, `Tool`, `ToolRegistry`, `PermissionManager`, `ToolExecutor` (+ `ToolExecutor.runTracked`, 2026-09-25 : renvoie `{ invocationId, result }` — origine traçable des `ToolProvenance` juridiques ; ajout non invasif, `run` et `ToolExecutionResult` inchangés, **pas** une refonte) | Tools + Permissions branchés dans `AgentLoop` (inchangé depuis M4) ; intègre désormais en option `@jarvis/memory` (lecture contextuelle, extraction et promotion post-tour) — voir section dédiée « Mémoire contrôlée » |
| `@jarvis/tools` | Outils locaux ; `echoTool` de démonstration | 1 outil de démo, sans réseau ni effet de bord |
| `@jarvis/connectors` | Contrat `Connector` + `InMemoryConnector` (fake) + `gmailConnector` (**réel**) : `gmail.read` (`action: 'read'`) + `gmail.prepare_reply` (`action: 'prepare'`, M7.3) + `gmail.send` (`action: 'execute'`, M8) ; + `ConnectorRegistry`/`AccountStore`/`SecretStore`/`Capability` ; + `OsCredentialSecretStore` (M8-B3, production) ; + `GmailOAuthFlow` PKCE (M8-B2) ; + `ConfirmationService`/`proposeConfirmation`/`confirmAndExecute` (M8) ; + `legifranceConnector` (LEGAL-02B.2/03B, **lecture seule**, dépend de `@jarvis/legifrance-client`) : `legifrance.ping`, `legifrance.get_article`, `legifrance.search` (`action: 'read'`) | `gmail.modify`/`gmail.delete` toujours inexistants ; `gmailConnector` utilise `ConnectorRegistry`/`AccountStore`/`SecretStore` via `resolveGmailApiClient` (M8) |
| `@jarvis/classification` | `ClassificationEngine`, `PreferenceStore`, `EmailLlmClassifier` | inchangé depuis M4.5 ; toujours aucun connecteur ni LLM réel branché en interne |
| `@jarvis/inbox` | `fetchEmailsViaTool`, `classifyEmails`, `fetchAndClassifyEmails`, `recordFeedbackForEmail`, `applyUserRule`, `needsAttention`/`filterEmailsNeedingAttention` (M7.1), `createSummarizeEmailTool`/`EmailSummarizer` (M7.2), `summarizeEmailsNeedingAttention` (M7.4) | flux complet Gmail → classification → attention → résumé validé par tests (Gmail/LLM mockés) ; **non branché dans `apps/api`** |
| `@jarvis/legal-core` | Modèle juridique pur : **LegalCase v3** (2026-09-25) — `LegalFact` immuable sans état stocké, provenance `human`/`tool`/`deterministic`/`llm`, références d'entrée typées, temporalité `point`/`interval`/`unknown`, `LegalDocument`/`LegalEvidence`, relations `fact_question`/`fact_correction`, `LegalFactValidation`, conflits/résolutions/règles, `deriveFactEpistemicState` (R1 → R7), empreintes, append-only, lecteur/validateur/écrivain v3 **strict** et lecteur/validateur **legacy v2** ; plus `LegalSource` (versionnée, temporelle), `LegalCitation` (ADR-0020), `LegalResearchItem`…, `attachSourcesAndCitations` (sur dossier v3) | versionné (`85e7e6e`, présent sur `origin/main`) ; feuille (aucune dépendance interne) ; aucun réseau ; aucun chiffrement ; **aucun contenu textuel** ; aucune migration v2 → v3 ; consommé par aucune application |
| `@jarvis/legal-research` | `LegifranceSourceProvider`/mapping (LEGAL-02B.3) ; types et ports du Research Engine (LEGAL-03A) ; `LegifranceSearchAdapter`, `LegifranceRetrievalAdapter`, `ResearchEngine` borné (LEGAL-03B) ; `VersionResolver` pur et son intégration au moteur (ADR-0018) ; récupération bornée de la version résolue, `resolvedRetrieval` (ADR-0019) ; projection pure `projectCitations` ResearchResult → sources + citations (ADR-0020) ; contenu transitoire vérifié `RetrievedContent` et contrat de hash `computeContentHash` (ADR-0021) | versionné (`979fa19`, publié sur `origin/main`) ; dépend de `@jarvis/core` + `@jarvis/legal-core` uniquement ; n'importe ni `connectors` ni `legifrance-client` (ESLint + test) ; **consommé par `apps/desktop`** (`legal-search`, lecture seule) — `projectCitations`/`attachSourcesAndCitations`/`@jarvis/legal-case-store` restent non câblés (aucune écriture de dossier) |
| `@jarvis/legal-case-engine` | Moteur de faits et de dossiers (LEGAL-04.1) : `addOpenQuestion`, `recordReportedFact`, `findEquivalentFacts`, `LegalCaseEngineError`, contexte et horloge injectés (`systemClock` explicite) | commit dédié (LEGAL-04.1) ; dépend **uniquement** de `@jarvis/legal-core` (ESLint + tests) ; pas de réseau, de persistance, de LLM ni d'horloge cachée ; aucune application ne le consomme |
| `@jarvis/legifrance-client` | Client PISTE/Légifrance (LEGAL-02B.1) : configuration sandbox/production, OAuth `client_credentials`, `LegifranceHttpClient`, erreurs typées | versionné (`979fa19`, publié sur `origin/main`) ; feuille (aucune dépendance `@jarvis/*`, ESLint + test) ; résolution des credentials via `SecretStore` déplacée dans `@jarvis/connectors` (`resolveLegifranceCredentials`, cycle de packages corrigé) |
| `@jarvis/project-briefs` | Fiches projet persistantes (faits / hypothèses / décisions / questions / sources / besoins déclarés `need-n` liables à des sources, format v3 à la première création d'un besoin, identifiants stables), verrou coopératif par fichier, `pickNextQuestion` (règle fixe), rendu Markdown pur | `fc92fab`, `be0d670`, `a92cca3` ; feuille ; aucun LLM ; consommé par `apps/desktop` (`project`) |
| `apps/whatsapp-channel` | Canal conversationnel WhatsApp local (ADR-0022/0023, `Proposed`) : simulé par défaut, réception durable SQLite, transport Graph API, mode réel opt-in borné | `70a4c3b` → `adca17b` ; `SimulatedLlmProvider`, `AgentLoop` sans `ToolExecutor` ; **activation reportée** |
| `apps/api` | Serveur HTTP Fastify, `POST /chat` | fonctionnel ; `AgentLoop` sans `ToolExecutor` (le provider réel n'émet pas de `toolCall`) ; connecteurs/inbox **non branchés** |
| `apps/desktop` | Client CLI (`connect`, `read`, `read-natural`, `inbox`, `prepare-reply`, `send`, `disconnect`, `legal-search`, `chat`, `project`) — `chat` et `project` : voir « Composants livrés depuis 2026-09-30 » | fonctionnel — connexion OAuth PKCE + persistance trousseau OS + envoi Gmail confirmé (M8-B2→B6) ; + lecture (`read`), lecture&classification (`inbox`, s'arrête à la classification), préparation de réponse (`prepare-reply`, câblage du Tool `gmail.prepare_reply`) et déconnexion/révocation (`disconnect`) — surface CLI desktop post-M8 (`cc2e8a4`/`9c24cb7`/`996d716`/`753f4d0`). **`legal-search`** (premier parcours Légifrance, lecture seule) : `--asOf <YYYY-MM-DD> "<texte>"` → `legifranceConnector` (`legifrance.search`/`legifrance.get_article`, seuls Tools autorisés, `default: 'deny'`) → `ToolExecutor` → `LegifranceSearchAdapter`/`LegifranceRetrievalAdapter` → `ResearchEngine` (budget fixe : 1 page, 5 candidats, 5 récupérations) ; présente candidats/rejets/lacunes, jamais le contenu transitoire (ADR-0021), jamais une conclusion de droit applicable ; aucun Tool `execute`, aucun `AgentLoop`, aucune écriture de dossier (`projectCitations`/`attachSourcesAndCitations`/`@jarvis/legal-case-store` non appelés). Prérequis : `SecretStore` peuplé (`legifrance.<sandbox\|production>.clientId`/`clientSecret` ; script de provisionnement interactif fourni depuis `682455c`, erreurs assainies par `adca17b`) ; `LEGIFRANCE_ENVIRONMENT` optionnelle (défaut `sandbox`, valeur reconnue sinon rejet). N'exige ni configuration Gmail ni `ANTHROPIC_API_KEY`. Testé exclusivement avec doubles (`fetchFn` mocké) — **aucun test automatisé contre la Sandbox PISTE réelle n'a été exécuté** ; un essai manuel en Sandbox (2026-10-02) est rapporté hors dépôt (voir « Composants livrés depuis 2026-09-30 »). |

## Ce qui fonctionne

- `POST /chat { message }` → `{ content }` : Fastify → `AgentLoop` → `LlmProvider`. Validation 400. Démarrage sans clé ; `/chat` sans clé → 503 contrôlée.
- `AgentLoop.process(message): Promise<string>` — comportement historique inchangé.
- **Contrat d'outil** (`@jarvis/core`) :
  - `Tool<TInput, TOutput>` : `name`, `description`, `action: ActionLevel`, `validateInput(unknown) → ToolValidationResult<TInput>`, `execute(TInput) → Promise<TOutput>`. Aucun `any`.
  - `ActionLevel = 'read' | 'prepare' | 'execute'`.
  - `ToolRegistry` : `register` / `get` / `has` / `list` ; noms uniques ; erreurs explicites.
- **Permissions** (`PermissionManager`) :
  - `decide(toolName, action) → 'allow' | 'deny' | 'require_confirmation'`.
  - Résolution : `rules[nom]` → `actionDefaults[action]` → `default` → **`deny`** (`SAFE_DEFAULT_DECISION`).
  - Aucun nom de service codé en dur. Sans règle ⇒ `deny` (jamais « allow everything »).
- **Exécution centralisée** (`ToolExecutor.run`) — **point de contrôle unique** :
  - 6 issues : `executed` / `denied` / `awaiting_confirmation` / `unknown_tool` / `invalid_input` / `error`.
  - `error` (exception technique dans `execute`) est **distinct** d'un refus de permission et n'est jamais un succès.
  - Une confirmation (`confirmed: true`) ne peut **pas** outrepasser un `deny`.
  - `allow` ⇒ exécution ; `deny` ⇒ rien ; `require_confirmation` ⇒ rien sans `confirmed: true`.
- **Boucle d'agent** (`AgentLoop`) :
  - `new AgentLoop(llm, { toolExecutor?, maxIterations = 5 })` ; `run(message, { confirmedTools? }) → AgentResult`.
  - `AgentResult { content, iterations, stopReason: 'llm_final' | 'tool_blocked' | 'max_iterations', toolOutcomes[] }`.
  - Boucle **bornée** : `LLM → (toolCall ?) → ToolExecutor → résultat réinjecté (texte) → LLM …`, ≤ `maxIterations` appels modèle.
  - `AgentLoop` n'appelle **jamais** `tool.execute()` — uniquement `ToolExecutor`.
  - `confirmedTools` est **par nom d'outil** : confirmer `A` n'autorise pas `B`.
  - Un outil bloqué (deny / confirmation / inconnu / entrée invalide / erreur) arrête le tour (`stopReason: 'tool_blocked'`).
  - `AgentLoopOptions` accepte aussi, en option, `memory`/`memoryContextFilter`/
    `memorySelector`/`memoryExtractor`/`memoryPromoter` (ou
    `memoryPromotionPolicy`) (`@jarvis/memory`) — comportement historique
    strictement inchangé en leur absence.
  - `AgentResult` porte aussi `memoryCandidates`/`memoryPromotions`, toujours
    `[]` si aucune option mémoire n'est fournie. Extraction best-effort après
    la fin du tour, jamais pendant ; promotion déléguée à `MemoryPromoter`,
    jamais décidée par `AgentLoop` lui-même (voir « Mémoire contrôlée »).
  - **Aucune application ne fournit ces options aujourd'hui** — voir section
    dédiée « Mémoire contrôlée » et `docs/adr/0007-memory-promotion-policy.md`.

## Invariants de sécurité vérifiés par les tests

- Un outil inconnu n'est jamais exécuté.
- Un outil `deny` n'est jamais exécuté (même si le modèle insiste en boucle).
- `require_confirmation` exige une confirmation explicite.
- Une confirmation ne vaut que pour l'outil nommé (`confirmedTools: ['A']` ne débloque pas `B`).
- Une confirmation n'outrepasse jamais un `deny`.
- Une erreur technique d'outil ne devient jamais un `allow` / un succès.
- `AgentLoop` ne dépasse jamais `maxIterations`.
- `AgentLoop` passe toujours par `ToolExecutor` (les cas deny/inconnu/invalide laissent le compteur d'exécution à 0).
- Aucun test ne nécessite de clé API ni de réseau (vérifié : suite relancée avec un hook `require` qui échoue si `@anthropic-ai/sdk` ou `undici` est chargé → 59/59 passent).

## Mémoire contrôlée (`@jarvis/memory`)

Package `packages/memory` (commit `acf57c7`), **feuille** : aucune
dépendance interne. Fournit à `AgentLoop` une mémoire contextuelle
optionnelle — lecture avant chaque appel modèle, extraction de candidats
après la conversation, promotion conditionnelle vers un stockage durable.

**A. Le package existe** et est testé indépendamment d'`AgentLoop`.

**B. La promotion est disponible dans le code**, mais **la décision
d'accepter, refuser ou exiger une confirmation appartient exclusivement à
la `MemoryPromotionPolicy` configurée — `AgentLoop` ne décide jamais
lui-même de l'acceptation d'une mémoire.** `AgentLoop` se contente
d'appeler `MemoryPromoter.promote()` sur chaque candidat extrait, après la
fin du tour :

```
Message + réponse finale de l'assistant
      ↓  MemoryExtractor.extract()          — une seule fois, après le tour
MemoryCandidate { kind, subject, statement, provenance }
      ↓  validateMemoryCandidate()          — schéma fermé
      ↓  promoteMemoryCandidate()           — exige provenance='llm_proposed' par défaut
      ↓  MemoryPromotionPolicy.decide()     — accept / reject / confirm
      ↓  MemoryPromoter.promote()           — applique la décision, jamais AgentLoop
MemoryEntry (InMemoryMemoryStore ou FileMemoryStore)
```

- **Provenance à 5 niveaux**, de la plus fiable à la moins fiable :
  `user_stated` > `user_confirmed` > `email_extracted` > `inferred` >
  `llm_proposed`. Une sortie LLM ne peut **jamais** se déclarer
  `user_stated` — verrouillé au niveau du parseur d'extraction, pas
  seulement au niveau du prompt.
- **Deux `MemoryPromotionPolicy` fournies** : `createDefaultMemoryPromotionPolicy`
  (accepte automatiquement tout candidat structurellement propre) et
  `createConservativeMemoryPromotionPolicy` (même filtre, mais un candidat
  propre devient toujours `confirm` — aucune promotion automatique).
  **`docs/adr/0007-memory-promotion-policy.md` retient
  `createConservativeMemoryPromotionPolicy` comme policy de référence en
  production**, pour toute application et tout mode ;
  `createDefaultMemoryPromotionPolicy` reste réservée aux tests ou à un
  usage explicitement maîtrisé et documenté par l'intégrateur — jamais le
  choix implicite d'une nouvelle intégration.
- **Stockage non destructif** : `invalidate`/`supersede` marquent ou
  remplacent, ne suppriment jamais ; lignée traçable dans les deux sens.
  Aucune expiration automatique.
- Le contenu d'un email, d'un outil ou d'un document n'est jamais promu
  directement — seule la réponse finale de l'assistant est source
  d'extraction. Ce contenu est marqué comme donnée non fiable au niveau du
  prompt (`AgentLoop`, extraction, résumé/réponse email) : **cette défense
  reste fondée principalement sur la consigne donnée au modèle, pas sur un
  contrôle structurel** — un filtre regex instruction-like/sensible
  constitue un premier filet, pas une garantie d'exhaustivité. Aucune
  promotion, même sous la policy conservatrice, ne contourne l'exigence de
  confirmation humaine pour une proposition `llm_proposed` : c'est cette
  confirmation, pas le filtrage de contenu, qui reste la garantie
  déterminante contre une injection indirecte réussie.

**C. Aucune promotion n'est câblée en production aujourd'hui.** `apps/api`
construit `AgentLoop` sans `memory`/`memoryExtractor`/`memoryPromoter`.
`apps/desktop` n'utilise jamais `AgentLoop`. Le seul autre consommateur,
`EmailReplyWorkflow` (`@jarvis/inbox`), ne fait que **lire** la mémoire
(`list()`), jamais écrire, et n'est câblé dans aucune commande CLI ni route
API. Le mécanisme complet n'est aujourd'hui exercé que par les tests.

**D. Garanties déjà présentes dans le code** : verrouillage de provenance
(ci-dessus) ; aucune écriture mémoire en cours de tour, uniquement après ;
aucune réinjection d'une mémoire fraîchement promue dans le tour courant ;
aucune mémoire jamais traitée comme message système, y compris un contenu
instruction-like promu sous une policy permissive ; jeton `user_confirmed`
non falsifiable depuis l'extérieur du package.

**E. Travaux encore nécessaires avant toute extension de l'autonomie** :
- filtre de sensibilité limité à des formes credential-shaped (clé API,
  jeton, mot de passe) — aucune classification dédiée aux données
  personnelles, financières ou médicales ;
- aucune détection de contradiction entre une mémoire existante et un
  nouveau candidat, aucune déduplication ;
- `MemoryStore.supersede()` n'a aujourd'hui **aucun garde-fou codé**
  empêchant de dégrader silencieusement la provenance d'une mémoire
  existante — seule une règle documentée (`ADR-0007`) l'interdit, rien ne
  l'empêche encore techniquement ;
- `FileMemoryStore` persiste en JSON **non chiffré**, sans restriction de
  permissions dédiée ;
- aucun chemin utilisateur (CLI/API) pour corriger ou supprimer une mémoire
  promue.

Décisions d'architecture : `docs/adr/0006-confirmation-fingerprint-for-execute-actions.md`
(confirmation des actions `execute`, prérequis avant tout branchement
`AgentLoop` → `ToolExecutor` autonome) et
`docs/adr/0007-memory-promotion-policy.md` (policy de promotion de
référence, conditions préalables à toute promotion automatique élargie).

## Vérification de postcondition (opt-in) (`runWithVerification`)

Package `packages/core/src/verification.ts` (commits `64702a2`, `748b7a0` —
publiés sur `origin/main`). Répond à la lacune documentée par
`docs/verified-result-boundaries.md` (2026-09-15) : « exécuté » ne prouvait
jusqu'ici que « n'a pas levé d'exception », jamais un effet métier réel.

**A. Le package existe** et est testé indépendamment (`verification.test.ts`,
11 tests) sans modifier `ToolExecutor`, `ToolExecutionResult` ni
`PermissionManager` — additif, usage strictement opt-in (`verifier` absent =
comportement identique à un appel direct à `ToolExecutor.run()`). Capture de
la demande par `structuredClone`, **synchrone et avant le premier `await`**,
pour qu'une mutation de l'appelant pendant une préparation suspendue ne
puisse jamais faire exécuter une demande différente de celle vérifiée. Trois
issues : `verdict` `satisfied` / `contradicted` / `insufficient_evidence`, ou
`kind: 'preparation_failed'` si la préparation échoue **avant** tout appel à
`ToolExecutor.run()` — jamais de verdict par défaut, jamais un
`ToolExecutionResult` inventé.

**B. Un seul vérificateur concret existe**, pour un seul outil fictif :
`createInMemorySendVerifier` (`packages/connectors/src/in-memory/in-memory-send-verification.ts`,
même commits, 10 tests) — compare l'état observable
(`InMemoryMailClient.listSent()`) avant/après, jamais la sortie déclarée par
l'outil. Trois hypothèses explicites (complétude du store, observation
immédiate, append-only) qui ne tiennent que pour ce connecteur simulé et
local ; un verdict `satisfied` ne prouve **jamais** une livraison externe
réelle.

**C. Une seule utilisation applicative, opt-in et locale** : `apps/desktop
verify-demo` (`apps/desktop/src/run-verify-demo.ts` + `verify-demo-trace.ts`,
commits `f463033`, `f474cd8`, `5478144` — **locaux, non publiés sur
`origin/main`** ; 28 + 11 + 7 = 46 tests). Entrée entièrement fixe et
synthétique, `InMemoryMailClient` jetable créé à neuf à chaque invocation :
aucune donnée réelle, aucun secret, aucun LLM, aucun réseau. Câble
`proposeConfirmation` → confirmation utilisateur réelle →
`ConfirmationService.verify` → `runWithVerification`, sur le chemin de
confirmation réel de `@jarvis/connectors`. Une trace structurée **en
mémoire** (RAM, `VerifyDemoTraceRecorder`) est renvoyée dans le résultat du
flux — phases et statuts contrôlés uniquement, aucune donnée libre ; **aucune
persistance, aucun fichier** ; ce n'est ni une intégration avec
`@jarvis/memory` (le package de mémoire contrôlée, section précédente), ni
une garantie d'audit durable.

**D. Ce qui n'est PAS branché** : `AgentLoop` n'appelle jamais
`runWithVerification` ; `apps/api` non plus ; `gmail.send`
(`apps/desktop/src/gmail-send.ts`) n'a aucun vérificateur et continue de
renvoyer le résultat brut de `confirmAndExecute()` — l'écart documenté par
`docs/verified-result-boundaries.md` pour `gmail.send` (preuve d'acceptation
API, jamais de livraison) reste entier. Aucune autre commande de
`apps/desktop` n'est concernée.

**E. Banc exploratoire séparé** : `prototypes/verify-postcondition-bench/`
(commit `64702a2`, hors workspaces, pas un package — même convention que
`prototypes/tool-interface-bench`) explore le même concept de façon isolée
(17 tests, `oracle`/`runner`/`verifier` propres au banc). Son propre README
le dit explicitement : « pas un mécanisme VERIFY intégré à JARVIS ». Il n'est
ni un prérequis ni une dépendance de `runWithVerification`.

**Travaux encore nécessaires** (voir `docs/verified-result-boundaries.md`
§9, décisions ouvertes, non modifiées par cette implémentation) : aucun
vérificateur pour `gmail.send` ou tout autre outil réel ; qui déclenche une
vérification en dehors d'une démonstration explicite (un mécanisme générique
dans `ToolExecutor`, une responsabilité par outil, ou une orchestration
applicative) reste **non tranché** ; aucune génération de `MemoryCandidate`
à partir d'un verdict de vérification.

## Architecture connecteurs (`@jarvis/connectors`)

Package `packages/connectors`, dépendance unique vers `@jarvis/core`. But :
permettre à un futur connecteur (Gmail, Discord, Calendar…) de fournir des
`Tool` à JARVIS **sans que `@jarvis/core` connaisse ces services**, et sans
qu'un credential ne transite jamais par le modèle.

- **Contrat `Connector<TClient>`** (`packages/connectors/src/connector.ts`) :
  `{ id, name, capabilities: readonly string[], createTools(client: TClient): readonly Tool[] }`.
  - `capabilities` est purement déclaratif (noms des `Tool` que le connecteur
    peut produire, ex. `['gmail.read', 'gmail.prepare_reply', 'gmail.send']`) —
    ne requiert aucun client, ne construit rien.
  - `createTools(client)` reçoit un client **déjà authentifié** et construit
    les `Tool` en le capturant par fermeture. Le connecteur ne construit
    jamais lui-même ce client : pas de logique OAuth, pas de stockage de
    token dans ce package.
- **Séparation credential / Tool** : le client authentifié (`TClient`)
  n'apparaît jamais comme propriété d'un `Tool` retourné, ni dans son
  input/output. Vérifié par test (`Object.keys(tool)` ne contient que le
  contrat générique `name/description/action/validateInput/execute`).
- **Un outil = une capacité, un `ActionLevel`.** Un connecteur qui expose
  `service.read`, `service.prepare_reply`, `service.send` produit **trois
  `Tool` distincts** avec des `action` différents (`read` / `prepare` /
  `execute`). `service.read` ne peut jamais envoyer : ce n'est pas la même
  fonction, ni le même nom, ni le même niveau de permission.
- **`ToolExecutor` / `PermissionManager` restent les seuls points de
  contrôle**, inchangés et toujours génériques (aucun nom de service codé en
  dur). Un connecteur ne contourne rien : il produit des `Tool` ordinaires,
  enregistrés dans le `ToolRegistry` comme n'importe quel autre outil.

### Connecteur fake : `InMemoryConnector`

`packages/connectors/src/in-memory/` — connecteur de validation, **100%
local et fictif**, sans réseau ni OAuth :

- `InMemoryMailClient` : "client déjà authentifié" simulé (boîte de
  réception en dur, méthode `send()` qui mute un état en mémoire). Porte un
  marqueur fictif privé (`#fakeAuthMarker`, jamais un vrai secret) utilisé
  uniquement par les tests pour prouver qu'il ne fuit jamais dans un `Tool`.
- Trois `Tool` produits par `inMemoryConnector.createTools(client)` :
  - `inmemory.read` (`action: 'read'`) — lecture seule.
  - `inmemory.prepare_reply` (`action: 'prepare'`) — construit un brouillon,
    **aucune mutation** de l'état du client.
  - `inmemory.send` (`action: 'execute'`) — seule opération qui mute
    réellement l'état (`listSent()`).

Cela démontre bout en bout, sans rien de réel à connecter : l'injection d'un
client authentifié, la lecture, la préparation, l'exécution, le passage par
`PermissionManager`/`ToolExecutor`, et l'absence de fuite de credential.

### Connecteur réel : `gmailConnector` (M5 — lecture seule)

`packages/connectors/src/gmail/` — premier connecteur **réel** (OAuth 2.0
Google, appels HTTP effectifs en production), mais strictement limité à la
lecture pour ce jalon :

```
Google OAuth credentials → GmailApiClient (Gmail API) → GmailRawMessage
                                                              ↓  mapGmailMessageToEmailMessage (frontière stricte)
                                                          EmailMessage → ClassificationEngine (déjà existant, non modifié)
```

- **`gmail-auth.ts`** — couche d'authentification, séparée du client Gmail :
  - `GmailCredentials { clientId, clientSecret, refreshToken }` — jamais
    manipulé par `GmailApiClient`, un `Tool` ou un connecteur.
  - `AccessTokenProvider` : interface dont dépend `GmailApiClient` (« fournis
    un access token », sans savoir comment).
  - `GoogleOAuthAccessTokenProvider` : implémentation **réelle** — échange le
    refresh token contre un access token via l'endpoint OAuth de Google,
    cache le résultat avec marge de sécurité, **renouvelle automatiquement**
    à expiration, et `revoke()` (déconnexion réelle). Appels HTTP via un
    `fetchFn` **injectable** (tests : mock, zéro réseau réel).
  - `RefreshTokenStore` : interface posée pour un futur stockage sécurisé du
    refresh token — **non implémentée**, et **supplantée en pratique** par
    `SecretStore` / `OsCredentialSecretStore` (M8-B3), qui assurent ce rôle
    en production. Placeholder obsolescent conservé (aucune suppression de
    code) ; `resolveGmailCredentials` n'en dépend pas
    (`gmail-auth.test.ts` le prouve explicitement).
  - `loadGmailCredentialsFromEnv()` : lit `GMAIL_CLIENT_ID` /
    `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (voir
    `packages/connectors/.env.example`, placeholders uniquement) ; erreur
    explicite si absent, ne cite jamais de valeur.
- **`gmail-api-client.ts`** — `GmailApiClient` : le `TClient` reçu par
  `gmailConnector.createTools(client)`. Seulement `listMessageIds()` et
  `getMessage()` — **aucune méthode d'écriture n'existe sur la classe** (pas
  une question de permission : la capacité n'existe pas). Manipule
  exclusivement des types `GmailRaw*` (forme brute Gmail), qui ne sortent
  jamais de ce module.
- **`gmail-message-mapper.ts`** — `mapGmailMessageToEmailMessage(raw)` :
  fonction pure, **frontière stricte** entre l'API Gmail et le domaine
  JARVIS. Extrait expéditeur/destinataires depuis les en-têtes `From`/`To`,
  décode le corps `text/plain` (recherche récursive dans les parties
  `multipart`, `''` si seul du HTML est disponible — jamais de HTML brut en
  guise de corps), convertit `internalDate` en ISO 8601. Au-delà de cette
  fonction, plus aucun objet brut Gmail ne remonte.
- **`gmail-connector.ts`** — `gmailConnector: Connector<GmailApiClient>` :
  à l'origine (M5) `capabilities: ['gmail.read']`, un seul `Tool`
  (`action: 'read'`). **Depuis M7.3/M8, étendu** à trois `Tool` :
  `gmail.read` (`'read'`), `gmail.prepare_reply` (`'prepare'`, M7.3),
  `gmail.send` (`'execute'`, M8 — voir section dédiée ci-dessous). Toujours
  pas de `gmail.modify` ni `gmail.delete` — ni comme `Tool`, ni comme
  méthode sur `GmailApiClient`.
- **`ClassificationEngine` non modifié** : consomme l'`EmailMessage` produit
  par le mapper exactement comme n'importe quel autre `EmailMessage`.

Aucun secret réel dans le dépôt : `packages/connectors/.env.example` ne
contient que des placeholders (`GMAIL_CLIENT_ID=your-gmail-oauth-client-id`,
etc.), couvert par `.gitignore` (`.env` / `.env.*` ignorés, `.env.example`
explicitement autorisé).

### Fondation architecturale : ConnectorRegistry / AccountStore / SecretStore (`Connector Architecture Foundation`, commit `8506792`)

**Ceci n'est pas un jalon fonctionnel.** Ne livre aucune nouvelle capacité
utilisateur (pas de nouveau `Tool`, aucun connecteur réel supplémentaire) —
généralise, pour un futur `CalendarConnector`/`DriveConnector`/
`SlackConnector`/`GitHubConnector`, ce que `gmailConnector` fait déjà
manuellement. `gmailConnector` et `inMemoryConnector` ne sont pas modifiés
et n'utilisent pas encore ces abstractions.

- **`ConnectorRegistry`** (`connector-registry.ts`) — enregistrement/lookup
  de `Connector` par id, symétrique à `ToolRegistry`. Aucune logique
  métier spécifique à un provider.
- **`AccountStore`** (`account.ts`) — un utilisateur peut avoir plusieurs
  comptes pour un même provider (ex. Google perso + pro).
  `resolve({ provider, accountId? })` est le seul point de sélection d'un
  compte : `AmbiguousAccountError` si plusieurs comptes existent et
  qu'aucun `accountId` n'est fourni — **jamais** de sélection implicite.
- **`SecretStore`** (`secret-store.ts`) — interface indépendante du
  mécanisme de stockage ; **`InMemorySecretStore`** est la seule
  implémentation fournie, **dev/test uniquement**, jamais utilisable en
  production (stockage non chiffré, non persistant, champ JS réellement
  privé `#secrets` pour qu'aucune valeur ne fuite via
  `JSON.stringify`/`console.log`).
- **`Capability`** (`capability.ts`) — description déclarative (id,
  connectorId, action, description) dérivée des `Tool` réels d'un
  connecteur via `describeCapabilities()`. **Ne décide jamais d'une
  autorisation** : `action` n'est qu'une recopie de `Tool.action`. Seul
  `PermissionManager` autorise ou refuse — vérifié explicitement par
  `security.test.ts`.
- **Erreurs métier typées** (`errors.ts`) : `UnknownConnectorError`,
  `ConnectorUnavailableError`, `UnknownCapabilityError`,
  `UnsupportedCapabilityError`, `UnknownAccountError`,
  `AmbiguousAccountError`, `SecretNotFoundError` — jamais de secret dans un
  message. Un refus de permission reste représenté par
  `ToolExecutionResult` côté `@jarvis/core`, jamais dupliqué ici.

Documentation détaillée : `docs/connectors-architecture.md`. Tests :
`connector-registry.test.ts` (9), `account.test.ts` (10),
`capability.test.ts` (5), `in-memory-secret-store.test.ts` (7),
`security.test.ts` (10) — 41 tests, tous dans `packages/connectors/src/`.

À l'époque de son introduction (`8506792`), cette fondation ne résolvait
encore aucune des décisions listées dans « Prochaine étape prévue
(connecteurs) » (flux de connexion OAuth initiale, stockage sécurisé de
production du refresh token, modèle de confirmation UI pour `gmail.send`).
**Ces trois décisions sont désormais tranchées et implémentées par M8**
(voir section suivante) : `InMemorySecretStore` reste dev/test uniquement,
mais `gmailConnector` utilise maintenant `AccountStore`/`SecretStore` en
production via `resolveGmailApiClient`.

## Envoi Gmail confirmé (M8 — `gmail.send`, terminé)

Jalon fonctionnel M8, décomposé en 5 sous-étapes toutes committées. Ferme
le dernier point resté ouvert depuis M5 : `gmail.send` (`action: 'execute'`,
effet de bord réel et irréversible), avec confirmation utilisateur
obligatoire.

- **M8-B2 — OAuth Google Authorization Code + PKCE** (`2d088b7`,
  `packages/connectors/src/gmail/gmail-oauth-flow.ts`) : flux de connexion
  initiale du compte, `code_challenge`/`code_verifier` (méthode `S256`,
  RFC 7636). `gmail-oauth-callback-server.ts` écoute strictement sur
  `127.0.0.1` (jamais `0.0.0.0`).
- **M8-B3 — `SecretStore` de production** (`b5db57e`,
  `packages/connectors/src/os/os-credential-secret-store.ts`) :
  `OsCredentialSecretStore` délègue entièrement au trousseau natif de l'OS
  (Windows Credential Manager / macOS Keychain / Linux Secret Service) via
  `@napi-rs/keyring` — aucun fichier, aucune clé de chiffrement gérée par
  JARVIS. `FileAccountStore` (déjà existant) assure la persistance des
  comptes entre deux lancements. Voir `docs/adr/0003-os-credential-backend.md`.
- **M8-B4 — Boucle d'envoi confirmée** (`a811027`,
  `apps/desktop/src/gmail-send.ts`, `runGmailSend`) : compose
  `resolveAccount()` → `resolveGmailApiClient()` →
  `gmailConnector.createTools()` → `ToolExecutor` → `proposeConfirmation()`
  → confirmation utilisateur → `confirmAndExecute()`. Une politique
  `'allow'` sur `gmail.send` est refusée (`confirmation_required`) plutôt
  qu'exécutée. Voir `docs/adr/0004-resolve-account-single-point.md` et
  `docs/adr/0005-tool-executor-and-confirmation.md`.
- **M8-B5 — Câblage CLI desktop** (`309bbfb`,
  `apps/desktop/src/{main,gmail-send-args,terminal-confirm}.ts`) :
  sous-commandes `connect` et `send` de `apps/desktop`, confirmation au
  terminal (`createTerminalConfirm`), OAuth non relancé si un compte est
  déjà connecté. (Les commandes `read`, `inbox` et `disconnect` ont été
  ajoutées **après** M8 — voir « Surface CLI desktop post-M8 » ci-dessous.)
- **M8-B6 — Couverture des erreurs post-confirmation** (`2faf205`,
  `gmail-send.test.ts`, `main-send.test.ts`) : preuve par test que
  `runGmailSend` renvoie `status: 'error'` (jamais un faux succès) si le
  refresh token est rejeté (`invalid_grant`) ou si l'API Gmail refuse
  l'envoi, jusqu'au message affiché par la CLI.

**530 tests / 50 fichiers** au total à l'issue de M8 (état historique ; total courant vérifié le 2026-09-25 : **2196 tests / 125 fichiers**, domaine juridique et LegalCase v3 inclus — voir « Vérifications » ci-dessous).
Décisions architecturales de M8 formalisées dans `docs/adr/0001` à `0005`.

`disconnectGmailAccount()` (`packages/connectors/src/gmail/gmail-connection.ts`)
existe, est testée, et **est câblée** dans `apps/desktop` depuis `cc2e8a4`
(`dispatch()` → `runDisconnectFlow` → `disconnectGmailAccount`, révocation
OAuth réelle) — voir « Surface CLI desktop post-M8 » ci-dessous. Aucun
numéro de jalon ne lui est attribué : c'est une exposition CLI d'une brique
existante, pas un jalon fonctionnel.

### Surface CLI desktop post-M8 (`cc2e8a4`, `9c24cb7`, `996d716`, `753f4d0`)

Quatre commits postérieurs à M8 étendent la CLI `apps/desktop` (fichier
`apps/desktop/src/main.ts`, `dispatch()`) **sans ajouter aucune brique de
bibliothèque** : ils câblent des capacités déjà écrites et testées dans
`@jarvis/connectors` / `@jarvis/inbox`, en réutilisant tel quel le noyau de
confiance M8 (`resolveAccount`/`resolveOrConnectGmailAccount` →
`resolveGmailApiClient` → `gmailConnector.createTools()` →
`ToolRegistry`/`PermissionManager`/`ToolExecutor`). **Ce ne sont pas de
nouveaux jalons fonctionnels** — aucun numéro `M8-B7`/`M9`/`OUT-07`.

- **`disconnect`** (`cc2e8a4`) — câblage de `disconnectGmailAccount()` :
  révocation OAuth réelle côté Google + passage du compte à `disconnected`.
  `resolveAccount()` reste l'unique point de sélection ; aucune confirmation
  interactive (`disconnectGmailAccount` n'est pas un `Tool` `execute`).
- **`read`** (`9c24cb7`) — câblage du Tool `gmail.read` (`action: 'read'`,
  lecture seule). `--maxResults` transmis tel quel au Tool (jamais réécrit
  par la CLI). Affiche uniquement expéditeur + objet, jamais le corps.
- **`inbox`** (`996d716`) — câblage de `fetchAndClassifyEmails`
  (`@jarvis/inbox`) : lit via `gmail.read` (strictement par `ToolExecutor`)
  puis classe chaque email (`important` / `not_important` / `uncertain`) via
  `ClassificationEngine`. LLM branché uniquement si `ANTHROPIC_API_KEY` est
  présente ; sans clé ou sur erreur LLM, repli contrôlé vers `uncertain`.
  Affiche uniquement expéditeur, objet, libellé, raison, provenance.
  **`inbox` s'arrête volontairement à la classification** : le résumé
  (`email.summarize` / `summarizeEmailsNeedingAttention`), le triage
  (`filterEmailsNeedingAttention`) et le feedback (`recordFeedbackForEmail` /
  `applyUserRule`) **restent hors de son périmètre actuel**. Aucune
  persistance de préférences introduite (`InMemoryPreferenceStore`, toujours
  vide en production).
- **`prepare-reply`** (`753f4d0`) — câblage du Tool `gmail.prepare_reply`
  (`action: 'prepare'`, aucun effet de bord Gmail réel) : `--messageId`/
  `--body` transmis tels quels (`parsePrepareReplyArgs`), validation de fond
  déléguée à `gmail.prepare_reply.validateInput` via `ToolExecutor`.
  N'appelle jamais `gmail.send`.

`apps/desktop` expose donc six commandes : `connect` / `read` / `inbox` /
`prepare-reply` / `send` / `disconnect`.

### Lecture naturelle contrôlée — VS-02 (`read-natural`, committé `8fb7ff4`)

Septième commande, **implémentée, testée et committée** (`8fb7ff4` —
`apps/desktop/src/main.ts` et les nouveaux fichiers
`apps/desktop/src/read-intent-parser.ts`,
`read-intent-to-tool-request.ts`, `read-interpretation-acceptance.ts`,
`read-natural-language-flow.ts` et leurs tests). Pipeline :

```
texte libre → parser (read-intent-parser.ts)
  → acceptation explicite (read-interpretation-acceptance.ts)
  → conversion contrôlée en ToolRequest (read-intent-to-tool-request.ts)
  → runReadFlow (VS-01, inchangé)
  → PermissionManager / ToolExecutor (inchangés)
  → gmail.read
```

Restitue distinctement six états (`ambiguous`, `unsupported`, `declined`,
`acceptance_error`, `conversion_failed`, `read_result`) — jamais un succès
artificiel : un `ToolExecutionResult` non `executed` reste affiché comme
tel (délégation à `describeReadResult`, inchangée).

`PermissionManager`/`ToolExecutor` **conservés sans modification** ; aucun
outil d'écriture accessible par ce chemin (`gmail.send` structurellement
inatteignable — le nom d'outil n'est jamais dérivé du texte utilisateur).
Aucune intégration `AgentLoop`, `apps/api`, ni mémoire (`@jarvis/memory`) :
**ne constitue pas** une conversation naturelle générale de Jarvis.

82 tests ciblés verts (`read-intent-parser.test.ts` 20,
`read-intent-to-tool-request.test.ts` 15,
`read-interpretation-acceptance.test.ts` 19,
`read-natural-language-flow.test.ts` 9, `main-read.test.ts` 6 — non
régressé —, `main-read-natural.test.ts` 13), `typecheck`/`lint` propres.
Aucun appel LLM, réseau réel, Gmail réel ou OAuth réel dans ces tests.

Détail complet : `docs/second-readonly-vertical-slice.md`,
`docs/second-readonly-vertical-slice-integration-study.md`,
`docs/second-readonly-vertical-slice-cli-study.md`,
`docs/first-readonly-vertical-slice.md`.

### Limites connues (héritées de M4, inchangées)

- Le résultat d'outil est réinjecté au LLM en **texte** (`chat(messages)` n'a pas
  encore de bloc `tool_result` structuré).
- Une entrée dans `confirmedTools` vaut pour **tout le tour** : si le modèle
  rappelle le même outil confirmé plusieurs fois dans un tour, chaque appel passe.
  Décision actée pour toute future action `execute` : voir
  `docs/adr/0006-confirmation-fingerprint-for-execute-actions.md`.
- `apps/api` n'expose pas encore outils / confirmations via HTTP.

### Volontairement repoussé (décisions à trancher plus tard)

- **Discord/Calendar/autres fournisseurs** : `InMemoryConnector` reste le
  seul exemple non-Gmail.
- **Modification/suppression Gmail** : toujours pas de `gmail.modify`, pas
  de `gmail.delete`. `gmail.read`, `gmail.prepare_reply` et `gmail.send`
  existent tous les trois depuis M8 (voir section dédiée ci-dessus).
- **Connexion initiale du compte** : ~~non implémentée~~ **résolue par
  M8-B2** (flux OAuth interactif + PKCE, `gmail-oauth-flow.ts`).
- **Stockage sécurisé du refresh token** : ~~aucune implémentation~~
  **résolu par M8-B3** (`OsCredentialSecretStore`, trousseau OS).
- **`apps/connectors` non branché dans `apps/api`** : **toujours vrai** —
  le `ToolRegistry` de `apps/api` reste vide de tout outil connecteur ;
  seul `apps/desktop` consomme `@jarvis/connectors` à ce stade.
- **`apps/desktop`** : ~~aucun flux de connexion Gmail~~ **résolu par
  M8-B2/B5** (`connect`/`send` en CLI ; étendu depuis à
  `read`/`inbox`/`prepare-reply`/`disconnect` — voir « Surface CLI desktop
  post-M8 »).

### Prochaine étape prévue (connecteurs)

Les trois décisions listées ci-dessus au moment de `Connector Architecture
Foundation` (flux de connexion initiale, stockage sécurisé du refresh
token, modèle de confirmation utilisateur) sont **toutes tranchées et
implémentées par M8** (voir section dédiée ci-dessus). Point encore ouvert,
non prioritaire : `apps/api` reste sans aucun outil connecteur branché.

## Composants livrés depuis 2026-09-30 (après LEGAL-04.1)

Chaque entrée est un **composant** livré (code versionné et testé), pas un jalon
achevé. Pour chacune : validation simulée, usage réel documenté, chantier global
restant ouvert.

- **Légifrance CLI** — `legal-search` lecture seule (`17e5297`), codes de sortie
  dérivés du statut (`b58780a`), présentation temporelle clarifiée (`f6c1ea5`),
  provisionnement interactif des secrets (`682455c`), erreurs de provisionnement
  assainies (`adca17b`). Validation simulée : doubles uniquement. Usage réel :
  rapport externe transmis par Alexandre (essai Sandbox du 2026-10-02 : cinq résultats partiels, puis collecte ciblée de deux articles pour expliquer `invalid_interval`) — preuve non archivée dans le dépôt. Chantier : domaine juridique, suite non planifiée.
- **Banc d'interfaces d'outils** — `prototypes/tool-interface-bench/` (`7719baa`),
  hors workspaces : 3 représentations d'interface × 20 missions synthétiques sur le
  chemin réel `ToolRegistry` → `PermissionManager` → `ToolExecutor` → `AgentLoop`,
  piloté par `ScriptedLlmProvider`. Runner réel `run-live.ts` manuel, payant, jamais
  déclenché par `npm test` ; aucun résultat de pilote réel documenté. Chantier
  rattaché : aucun dans ces documents (essais d'outils : registre Notion, voir
  `MASTER_ROADMAP.md`).
- **Canal WhatsApp** (`apps/whatsapp-channel`) — prototype webhook isolé (`70a4c3b`),
  canal simulé local (`1d2c9f7`), transport Graph API inactif (`5e48873`),
  réception durable SQLite (`c50039a`, ADR-0023), alignement Node 24.20.0
  (`5dae0f2`, `e7cd02e`), mode réel opt-in (`WHATSAPP_CHANNEL_MODE=real`) avec budget
  durable d'une tentative d'envoi et provisionnement des secrets (`5e5453e`),
  couverture et assainissement du provisionnement (`880553a`, `5508767`, `adca17b`).
  Validation simulée : défaut simulé, `SimulatedLlmProvider`, tests SQLite
  multi-process. Usage réel : provisionnement et mode opt-in implémentés ; serveur et tunnel lancés puis arrêtés ; aucun échange réel rapporté — rapport externe transmis par Alexandre, non archivé dans le dépôt ; activité reportée par Alexandre. Chantier : **reporté** ; ADR-0022 et
  ADR-0023 restent `Proposed`.
- **Chat local** (`apps/desktop chat`) — mono-tour sans outils (`370159e`), puis
  historique multi-tour en RAM borné (20 messages, 8000 caractères, `/reset`) via le
  champ additif `history` d'`AgentLoop` (`1bfd518`). `AgentLoop` construit sans
  `ToolExecutor`. Validation simulée : `LlmProvider` factice. Usage réel : non
  documenté dans le dépôt (chaque message = appel Anthropic réel potentiellement
  facturé). Aucun outil branché ; aucune suite décidée dans ces documents.
- **Fiches projet / Product Builder** — `@jarvis/project-briefs` et `project ...`
  (`fc92fab`), export Markdown en instantané sans écrasement (`be0d670`), entretien
  interactif à règle fixe avec confirmation explicite et refus `already_answered`
  (`a92cca3`). Validation simulée : tests ciblés et essai CLI sur projet fictif
  (2026-10-19). Usage réel (rapporté 2026-10-16) : fiche `boutique-asiatique`
  révision 11 (5 faits, 5 questions ouvertes, aucune réponse) et un export ;
  entretien réel non lancé. Chantier : étapes **PB-01 à PB-06** dans Notion
  (https://app.notion.com/p/3f0ba52b3dae819898f6da141fb7e30b), séquencement proposé : PB-01 partiel
  (sources déclarées, besoins déclarés avec liens besoin → source, format v3 : livrés ;
  pas d'exigence, ni lien source → décision explicite ni décision → exigence), PB-02
  partiel (pas d'extraction documentaire ni de détection des contradictions),
  PB-03 à PB-06 non démontrés (`MASTER_BACKLOG.md` → « Product Builder »). Proposition de preuve
  utilisateur **non validée** : entretien réel avec au moins une réponse confirmée,
  suivi d'un export daté.
- **Vérification de postcondition (opt-in)** — `runWithVerification`
  (`@jarvis/core`, `64702a2`/`748b7a0`, publiés sur `origin/main`),
  vérificateur `inmemory.send` (`@jarvis/connectors`, mêmes commits) et
  démonstration CLI `verify-demo` (`apps/desktop`, `f463033`/`f474cd8`/`5478144`,
  **locaux, non publiés**). Validation simulée : 76 tests ciblés verts (+ 17
  tests sur un banc exploratoire séparé, non intégré). Usage réel : aucun —
  `inmemory.send` est un connecteur fictif, la démonstration ne touche ni
  réseau ni service externe. Chantier : `gmail.send`, `AgentLoop` et
  `apps/api` restent sans aucune vérification ; qui déclenche une
  vérification hors démonstration reste une décision ouverte (voir
  « Vérification de postcondition (opt-in) » ci-dessous et
  `docs/verified-result-boundaries.md` §9).

## Domaine juridique (LEGAL-00 → LegalCase v3)

**Statut au 2026-09-26** : blocs **CLOSED** — LEGAL-00 → LEGAL-03B ;
VersionResolver ; Version Resolution Integration ; Resolved Version Retrieval ;
Research → Case ; Content Exposure ; **LegalCase v3 (Fact / Provenance / Evidence /
Temporal)** ; **`ToolExecutor.runTracked`** ; **Post-Implementation Review**
(PASS WITH ATTENTION) ; **LEGAL-04.0 (baseline Git + décisions d'architecture)** ;
**LEGAL-04.1 (Fact & Case Engine, premier jalon)** — implémentée et validée pour commit
(voir « LEGAL-04.1 » ci-dessous). Suite du Fact & Case Engine : **non planifiée**
(aucun sous-ticket documenté ; aucun LEGAL-03C n'est planifié).
**Le domaine légal est versionné** (voir « LEGAL-04.0 » ci-dessous) : « terminé » =
implémenté, versionné et testé dans un clone propre, **pas** validé en production.
La baseline (`85e7e6e`, `979fa19`, `8407ac0`, `e9b3357`) et sa synchronisation
documentaire (`38fb0fc`) sont publiées sur `origin/main`. Spécification fondatrice :
`LEGAL_SPECIFICATION.md` (LEGAL-00). Décisions d'architecture :
`docs/adr/0011` à `0021` — ADR-0018 (VersionResolver), ADR-0019 (récupération de
la version résolue), ADR-0020 (vertical slice Research → Case), ADR-0021
(Content Exposure).

### Jalons

| Jalon | Contenu | Statut |
|---|---|---|
| LEGAL-00 | Spécification canonique et règles de gouvernance (`LEGAL_SPECIFICATION.md`) | terminé |
| LEGAL-01 | Modèle de données `LegalCase` (`@jarvis/legal-core`) | terminé |
| LEGAL-01REV | Revue d'architecture du modèle | terminé |
| LEGAL-02A | `LegalSource` versionnée/temporelle, `LegalCitation`, chaîne d'audit Conclusion → Argument → Analysis → Citation → Source, format de fichier v2 | terminé |
| LEGAL-02B.1 | Client PISTE/Légifrance : configuration, OAuth `client_credentials`, client HTTP, erreurs (`@jarvis/legifrance-client`) | terminé |
| LEGAL-02B.2 | Connecteur Légifrance en lecture seule : `legifrance.ping`, `legifrance.get_article` | terminé |
| LEGAL-02B.2.1 / 02B.2.2 | Vérification et exploration réelles du contrat `getArticle` en Sandbox (résilience) | terminés — **aucun script ni rapport archivé dans le dépôt** |
| LEGAL-02B.3 | `LegifranceSourceProvider.getArticle` + mapping vers `LegalSource` | terminé |
| LEGAL-03A | Architecture du Research Engine : types, ports, ADR 0011–0017 | terminé |
| LEGAL-03B | Tool `legifrance.search`, adaptateurs de recherche et de récupération, `ResearchEngine` borné | terminé / clôturé |
| VersionResolver | Résolution temporelle **pure** `resolveVersion`/`versionResolver` : convention de bords conservatrice, complétude d'historique `complete \| unknown` **déclarée par l'appelant** (jamais déduite), `none_applicable` seulement si `complete` (ADR-0018) | terminé / clôturé |
| Version Resolution Integration | Regroupement des candidats par article (`identifierKey`), `assembleVersionHistory`, un appel du resolver par groupe, `ResearchCandidate.versionResolution` ; `none_applicable` → rejet `no_applicable_version` ; `asOf` validé avant tout appel réseau (ADR-0018) | terminé / clôturé |
| Resolved Version Retrieval | `resolvedRetrieval` (`initial` \| `shared` \| `retrieved`) ; capacité optionnelle `canRetrieveVersion?`/`retrieveVersion?` sur `RetrievalPort` ; **un seul saut**, sans récursion ; même budget `maxRetrievedSources` ; identité contrôlée (`malformed_response`) ; rejets porteurs de `targetVersionId` ; aucune `SearchReference` fabriquée (ADR-0019) | terminé / clôturé |
| Research → Case | `projectCitations` (pure) : `ResearchResult` → `LegalSource` + `LegalCitation` de niveau source ; `LegalCitation.contentHash?` et `eligibility?` ; `ResearchCandidate.historyCompleteness?` ; `attachSourcesAndCitations` (`legal-core`) ; format de fichier v2 inchangé ; aucun `LegalResearchItem` (ADR-0020) | terminé / clôturé |
| Content Exposure | Contenu juridique (`texte`) **transitoire et vérifié** : `RetrievedContent` opaque, `content?` sur `RetrievalResult` et `VersionTargetResult`, hash normatif `computeContentHash` (SHA-256, UTF-8, sans normalisation), recontrôle d'intégrité par l'adaptateur ; aucun appel réseau de plus ; aucune persistance (ADR-0021) | terminé / clôturé |
| LegalCase v3 — Fact / Provenance / Evidence / Temporal | Décisions Q1–Q10, B1–B4, U1 **CLOSED** ; modèle **implémenté** dans `@jarvis/legal-core` (voir « LegalCase v3 » ci-dessous) : `LegalFact` immuable, état épistémique **dérivé** (R1 → R7), provenance, références d'entrée, temporalité, document/pièce, relations, validations, conflits/résolutions/règles, empreintes, append-only, lecteur legacy v2 / lecteur-validateur-écrivain v3 strict, **aucune migration implicite** | **COMPLETED / CLOSED** (2026-09-25) |
| `ToolExecutor.runTracked` | `@jarvis/core` : `{ invocationId, result }`, UUID v4 par exécution, tous statuts couverts ; `run` et `ToolExecutionResult` inchangés | **IMPLEMENTED / CLOSED** (2026-09-25) |
| Post-Implementation Review LegalCase v3 | Conformité au contrat gelé : aucune violation ; quatre attentions non bloquantes A1–A4 ; 125 fichiers / 2196 tests, `tsc` et `eslint` PASS | **CLOSED — PASS WITH ATTENTION** (2026-09-25) |
| LEGAL-04.0 | Audit Git, baseline juridique versionnée (commits `979fa19`, `8407ac0`, `e9b3357`), décisions d'architecture D1–D10 validées (voir ci-dessous) | **terminé** (2026-09-26) — commits publiés sur `origin/main` |
| LEGAL-04.1 | Premier jalon du Fact & Case Engine : `@jarvis/legal-case-engine` (dépend uniquement de `@jarvis/legal-core`) — `addOpenQuestion`, `recordReportedFact`, `findEquivalentFacts` | **implémentée, validée pour commit** (2026-09-26) — revue contradictoire « validé sous réserve », corrections I1–I5 faites |

### LEGAL-04.0 — baseline Git et décisions d'architecture (2026-09-26)

**Baseline Git.** `85e7e6e` : `legal-core`, `runTracked`, `LEGAL_SPECIFICATION.md`
(sur `origin/main`). `979fa19` : `@jarvis/legifrance-client`, connecteur
`packages/connectors/src/legifrance/`, `@jarvis/legal-research`, règles ESLint de
frontières, `package-lock.json` synchronisé (corrige aussi l'entrée `api` →
`connectors` et le lien `legal-core` qui manquaient) ; 19 fichiers reformatés par
Prettier (espaces et retours à la ligne uniquement). `8407ac0` : ADR `0011` à
`0021`. `e9b3357` : fixtures de secrets remplacées dans
`memory-promotion.test.ts` (même sémantique de test, scan de secrets de la CI
satisfait). Les commits `979fa19`, `8407ac0` et `e9b3357` ont été **poussés sur `origin/main`** le 2026-09-26 (avec `38fb0fc`). Restent **non
suivis, hors baseline** : `AUDIT_STATE.md`, les documents de cadrage des slices et
de la situation, et `prototypes/situation-poc` (modifié + `situation-manual-run.ts`).

**Décisions d'architecture LEGAL-04 validées** (aucun ADR dédié à ce jour) :
- **D1** nouveau package dépendant uniquement de `@jarvis/legal-core` ;
- **D2** `actorId` et `interactionId` fournis par l'appelant via un contexte injecté ;
- **D3** faits extraits par un LLM = propositions jusqu'à adoption humaine ;
- **D4** fait rapporté : enregistrement atomique (fait, evidence non documentaire, lien à la question) ;
- **D5** le moteur ajoute des questions ouvertes, sans modifier leur statut ;
- **D6** chronologie contrôlée à l'écriture dans le moteur, sans durcir le validateur v3 gelé ;
- **D7** identifiants fournis par l'appelant ; détection des faits équivalents, sans fusion silencieuse ;
- **D8** correction : opération atomique (nouveau fait, lien de correction, liens explicites aux questions) ;
- **D9** faits écartés visibles par une projection de résolution distincte, sans toucher R1–R7 ;
- **D10** baseline Git avant la suite (réalisée par cette étape).

### LEGAL-04.1 — Fact & Case Engine, premier jalon (2026-09-26)

**Statut** : implémentée et **validée pour commit** (revue contradictoire « validé sous
réserve », puis corrections I1–I5 effectuées et revérifiées). Package
`@jarvis/legal-case-engine` (`packages/legal-case-engine`) ; dépendance runtime unique
`@jarvis/legal-core` (décision D1) ; `packages/legal-core` **non modifié**. Aucune
application ne le consomme.

**Opérations** (pures et **atomiques** : elles renvoient un nouveau `LegalCase` v3
revalidé — `validateLegalCaseV3`, append-only — ou lèvent une `LegalCaseEngineError` de
motif typé ; l'entrée n'est jamais mutée, aucun résultat partiel n'existe) :
- `addOpenQuestion` (D5) : ajoute une question au statut `open` ; aucun statut n'est
  accepté en entrée ; le statut des questions existantes n'est **jamais** modifié ;
  identifiant opaque fourni par l'appelant, doublon refusé.
- `recordReportedFact` (D4) : ajoute **atomiquement** un `LegalFact`, une `LegalEvidence`
  **non documentaire** et un lien `fact_question` par question. Provenance humaine issue
  du contexte injecté (D2) ; le fait référence la pièce par une empreinte, ce qui donne
  l'état dérivé `alleged` (R6) — R1 à R7 de `legal-core` inchangées. La température est
  obligatoire, validée puis **copiée** (aucun aliasing avec l'entrée). Renvoie aussi les
  dérivations et les faits potentiellement équivalents.
- `findEquivalentFacts` (D7) : résultat **consultatif**, critère nommé
  `structural_text_v1` (texte identique ou identique après NFC, espaces et minuscules ;
  ni accents, ni ponctuation, ni synonymes ; température comparée à part et jamais
  fusionnée). `none_found` n'est **pas** une preuve d'absence de doublon. Aucune fusion,
  suppression ni rejet automatique : l'enregistrement a lieu dans tous les cas.

**Contexte, horloge, chronologie** : `actorId` et `interactionId` sont fournis par
l'appelant (format validé, non authentifiés) ; l'horloge est **obligatoire** et lue une
seule fois par opération (aucune horloge cachée ; `systemClock` est un helper explicite).
Les contrôles chronologiques (D6) sont appliqués **à l'écriture par le moteur**, sans
durcir le validateur v3 gelé : l'instant ne peut précéder ni `updatedAt` ni aucun objet
déjà enregistré (les neuf listes append-only). `createdAt` et `updatedAt` doivent être
des instants valides : un `createdAt` qui n'en est pas un (par exemple la date seule
`2026-09-24`, acceptée par `legal-core`) est **refusé** (`chronology`), sans conversion
silencieuse. Aucune restriction READ-only : les opérations restent autorisées à toutes
les étapes du dossier.

**Frontières (décision volontaire, propre à ce package)** : `eslint.config.js` n'autorise
que le point d'entrée public de `@jarvis/legal-core`, et interdit les sous-chemins, tout
autre `@jarvis/*`, les imports relatifs sortant de `src/` (règle par profondeur de
fichier) et **tout chargement dynamique** (`import()`, `require()`, `import x =
require()`, types `import('…')`). Cette dernière restriction est plus stricte que le
besoin minimal — elle interdit même `import('./interne')` — sans casser aucun usage
actuel ; elle n'est pas requise pour les autres packages du monorepo. Les règles
effectives sont testées par l'API ESLint, complétées par un test statique.

**Messages d'erreur** : ils ne citent que des identifiants et des noms de clés, jamais
le contenu d'un fait, d'une question ou d'une pièce.

**Hors périmètre (non implémenté)** : faits proposés par un LLM (D3, restent hors de
LEGAL-04.1), validation humaine, correction de faits (D8), projection des faits écartés
(D9), persistance / Case Store, exécution d'actions juridiques, extracteur de faits.

**Dette technique connue** (points mineurs de la revue, non traités) : M1 précision de
`Date.parse` à la milliseconde ; M2 noms de clés inconnues repris dans les erreurs ; M3
getter qui lève une erreur brute (la double lecture de la température est, elle,
corrigée) ; M4 doublons dans `sharedQuestionIds` ; M5 champs racine non comparés par
`assertValidAppend` ; M6 assertions faibles (partiellement renforcées) ; M7 convention de
l'horloge (chaîne ISO, contre des millisecondes dans `ConfirmationService`) ; M8 pas de
contrôle `createdAt` ≤ `updatedAt`.

(Explorations réelles LEGAL-03.0 / 03.0A : leurs conclusions figurent dans les
ADR 0011–0017 sous forme de faits [OBSERVÉ] ; les sorties brutes n'ont pas été
archivées.)

### Architecture

**Architecture cible** (vision) :

```
LegalQuestion
→ Query planning
→ SearchQuery
→ SearchPort
→ SearchResultPage
→ SearchReference
→ déduplication / budget
→ ResearchCandidate
→ RetrievalPort
→ RetrievalResult
→ VersionResolver
→ LegalResearchItem / LegalCitation
```

**Implémenté aujourd'hui** :

```
SearchQuery (construite à la main : aucun query planning)
→ SearchPort → SearchResultPage → SearchReference
→ déduplication / budget → ResearchCandidate
→ RetrievalPort → RetrievalResult (+ contenu transitoire vérifié)
→ regroupement authority + identifier → VersionHistory (complétude `unknown`)
→ VersionResolver → versionResolution
→ [un saut] retrieveVersion → VersionTargetResult (+ contenu) → resolvedRetrieval
→ ResearchResult                                     (transitoire, non persisté)
── projectCitations(result, question)   [pure]
→ LegalSource + LegalCitation (eligibility : questionId, asOf, resolved, historyCompleteness)
── attachSourcesAndCitations(case, …)   [pure, revalidée]
→ LegalCase (v3)
```

(Avant le 2026-09-25 le dossier était au format v2 ; la v2 est désormais **legacy**,
lecture seule — voir « LegalCase v3 ».)

Une `LegalCitation` produite ici signifie « source **retrouvée et applicable** »
(éligible), **pas** pertinente pour la question ni utilisée comme preuve dans un
raisonnement. Une résolution `resolved` sur un historique `unknown` reste une
résolution « au mieux » : l'incertitude est conservée dans la citation.

**Non implémenté** : **production de faits (Fact & Case Engine : LEGAL-04.1 n'enregistre que des faits **rapportés par un humain** via `@jarvis/legal-case-engine` ; aucun extracteur, aucune proposition LLM, ni validation humaine, ni correction, ni projection des faits écartés, ni persistance — suite non planifiée)** ; query planning ; production de `LegalResearchItem` ;
analyse juridique (ANALYZE), VERIFY, PREPARE ; production de `LegalArgument` / `LegalAnalysisNote` / `LegalConclusion` (types et validation existent, aucun producteur) ; producteurs d'`actorId` / `interactionId` ; métadonnées LLM (`@jarvis/llm` n'expose ni fournisseur, ni modèle, ni identifiant d'appel) ; **pertinence** et
**« evidence-used »** (aucun marqueur, aucun producteur) ; persistance de la
provenance de recherche (rejets, lacunes et provenance technique restent dans le
`ResearchResult`, hors `LegalCase`) ; persistance, chiffrement, rechargement ou
artefact du contenu et persistance du dossier (aucun Case Store ; le texte est transitoire) ; `texteHtml` (non exposé) ;
transitions de workflow ; composition root de production et permissions de
production complètes pour les Tools `legifrance.*` ; multi-source ; intégration
LLM dans le domaine juridique.

### Composants implémentés

- **`@jarvis/legal-core`** : modèle **LegalCase v3** (voir sous-section dédiée
  ci-dessous), validation runtime stricte, lecteur/écrivain v3, lecteur et
  validateur legacy v2. Aucun réseau, aucun chiffrement au repos, aucune
  transition de statut appliquée (la validation ne vérifie que l'appartenance à la
  liste des étapes). Depuis ADR-0020 : `LegalCitation.contentHash?` et
  `eligibility?` (`questionId` doit désigner une `LegalQuestion` du dossier ;
  `asOf` explicite ; `resolution: 'resolved'` ; `historyCompleteness: 'complete' |
  'unknown'`) et `attachSourcesAndCitations` (pur, immuable, idempotent ; dédup par
  identité logique `authority` + `identifier` + `version` ; revalide le dossier —
  **désormais un dossier v3**). **Aucun contenu textuel** dans `LegalSource` ni
  `LegalCitation`.
- **`@jarvis/legifrance-client`** : configuration sandbox/production (jamais de
  défaut), OAuth, client HTTP injectable, erreurs sans secret. Credentials via
  le `SecretStore` existant (clés `legifrance.<env>.clientId` / `clientSecret`).
- **Connecteur Légifrance** (`packages/connectors/src/legifrance/`,
  dépend de `legifrance-client`) : trois Tools `read` — `legifrance.ping`,
  `legifrance.get_article`, `legifrance.search`. Aucun Tool `prepare`/`execute`.
  - `legifrance.search` : entrée structurée ; un seul fond, `CODE_DATE` ;
    `dateVersion` obligatoire (filtre `DATE_VERSION`) ; `typePagination` =
    `DEFAUT` (jamais `ARTICLE`) ; `sort` = `PERTINENCE` ; le connecteur
    construit le payload HTTP ; sortie technique.
- **`@jarvis/legal-research`** :
  - types : `SearchQuery`, `SearchProvenance`, `SearchReference`,
    `SearchResultPage`, `SearchMetadata`, `SearchSkippedItem`,
    `RetrievalRequest`, `RetrievalResult`, `ResearchBudget`,
    `ResearchCandidate`, `ResearchRejection`, `ResearchGap`, `ResearchResult`,
    `EffectivePeriod`, `SourceVersionRef`, `VersionResolution`, `VersionHistory`,
    `VersionCompleteness` (+ `SearchMatchMode`, `SearchField`,
    `SearchPageRequest`, `ResearchProviderErrorReason`, etc.) ;
    ajouts LEGAL-03B au contrat 03A : `ResearchSkippedItem`,
    `ResearchResult.skipped`, `ResearchGap.budget` ; ajouts ADR-0019 à 0021 :
    `VersionTargetRequest`, `VersionTargetResult`, `ResolvedRetrieval`,
    `ResearchCandidate.resolvedRetrieval?` / `historyCompleteness?`,
    `ResearchRejection.targetVersionId?`, `RetrievalResult.content?`,
    `VersionTargetResult.content?`, `RetrievedContent`, `ContentIntegrityError` ;
  - ports : `SearchPort`, `RetrievalPort` (avec la capacité **optionnelle**
    `canRetrieveVersion?`/`retrieveVersion?`, ADR-0019), `VersionResolver`
    (implémenté) ; erreur `ResearchProviderError` ;
  - `LegifranceSearchAdapter` : construit l'entrée du Tool, passe **exclusivement**
    par `ToolExecutor`, parse `results → sections → extracts`. Pour `CODE_DATE`,
    `resultId` = `titles[0].id` lorsqu'il est présent ; l'absence de `resultId`
    ne détruit pas les extraits exploitables ; aucun identifiant inventé ;
    aucune `LegalSource` créée pendant Search ; `sourceTypes` non vide refusé
    explicitement ; `asOf` obligatoire ;
  - `LegifranceRetrievalAdapter` : enveloppe `LegifranceSourceProvider.getArticle` ;
    pas de HTTP, pas de `SecretStore` ; retourne `LegalSource` + versions +
    version précédente ; **capture le texte pendant l'appel existant** et
    l'expose comme `content` vérifié (`RetrievedContent`), jamais dans
    `LegalSource` ; `retrieveVersion` passe par le même `fetchArticle` ;
    un contenu dont le hash diffère de `source.contentHash` est refusé
    (`malformed_response`) ;
  - `ResearchEngine` : agrégation des pages, déduplication par `referenceKey`
    avec conservation de toutes les occurrences (`sightings`), budgets de
    recherche/candidats/récupération (obligatoires, sans valeur par défaut),
    rejets, lacunes (`no_search_result`, `unexposed_articles`,
    `budget_truncated`), éléments écartés (`skipped`), arrêt borné ; résolution
    de version par groupe d'article et récupération bornée de la version résolue
    (un saut, même budget). Pas de ranking métier, pas de query planning ;
  - **`VersionResolver`** (ADR-0018) : `resolveVersion`/`versionResolver`, pur,
    sans horloge ; `asOf` ISO 8601 (date seule ou avec décalage explicite) ;
    date sur une borne → `indeterminate`/`boundary_date` ; plusieurs versions →
    `ambiguous_overlap` ; `none_applicable` uniquement si l'historique est
    déclaré `complete`, ce que le moteur ne fait jamais par lui-même ;
  - **Resolved Version Retrieval** (ADR-0019) : voir jalons ; `resolvedRetrieval`
    présent si et seulement si la résolution est `resolved` **et** la source de
    cette version est disponible ; absent pour `indeterminate`, `none_applicable`,
    `asOf` absent, échec de la cible, budget épuisé ;
  - **`projectCitations`** (ADR-0020) : éligibilité déterministe (candidat
    hydraté + `resolved` + `resolvedRetrieval` + source valide et cohérente),
    déduplication `authority` + `identifier` + `version`, `id` de citation
    déterministe, sans réseau ni LLM ; les rejets, lacunes et éléments écartés
    restent dans le `ResearchResult` ;
  - **Contenu** (ADR-0021) : `RetrievedContent` — constructeur privé, texte en
    champ privé (`revealText()`), absent de `JSON.stringify`, du spread, de
    `structuredClone`, de `util.inspect` ; `computeContentHash`/`verifyContentHash`
    = SHA-256 des octets UTF-8 de `texte` tel que reçu, **sans normalisation** ;
    texte `null`/vide/blanc → `malformed_response` (inchangé).

### LegalCase v3 — Fact / Provenance / Evidence / Temporal (COMPLETED / CLOSED, 2026-09-25)

Décisions d'architecture **Q1–Q10, B1–B4 et U1 : CLOSED** (gelées avant
implémentation). Modèle **implémenté** dans `@jarvis/legal-core` ; **125 fichiers /
2196 tests verts** (dont `legal-core` 567, `core` 142), `tsc --noEmit` PASS,
`eslint .` PASS, tests d'architecture PASS. Post-Implementation Review : **CLOSED —
PASS WITH ATTENTION** (aucune violation ; conclusion : LegalCase v3 conforme).

**Format.** `LegalCase` v3 = 25 champs racine, **clés fermées**. Les modules du modèle
Fact sont dédiés (un module = une responsabilité) ; `legal-case.ts` ne porte que la
racine. Les listes `facts`, `documents`, `evidence`, `relations`, `factValidations`,
`conflicts`, `resolutionProposals`, `ruleExecutions`, `resolutions` sont **append-only**.

- **`LegalFact` immuable** : `id`, `statement`, `temporal`, `provenance`, `recordedAt`.
  Clés fermées ; **aucun** `status` / `certainty` / `epistemicState` / `confidence` ;
  pas de `sourceRef` (v2). Une correction crée un **nouveau** fait + une relation.
- **Provenance** : `origin` ∈ `human` / `tool` / `deterministic` / `llm` (discriminant
  unique ; **`document` n'est pas un origin**) ; variantes à clés fermées (`human` :
  `actorId`, `interactionId` ; `tool` : `toolName`, `invocationId`, `connectorId`,
  `accountId?` conditionnel — jamais `Account.accountIdentifier` ; `deterministic` :
  `operationId`, `operationVersion`, `executionId` ; `llm` : `provider`, `model`,
  `invocationId`, `instructionVersion`). Identifiants opaques (format restreint).
- **Références d'entrée** (`inputReferences`) : `evidence`, `document`,
  `tool_invocation`, `source`, `fact`, `question`. **Substantielles** : `evidence`,
  `document`, `tool_invocation`, `source`, `fact` ; **`question` ne l'est pas** ;
  **`fact` l'est inconditionnellement** (critère syntaxique sur le `kind`, aucune
  récursion Fact → Fact). Les références à un fait ou une pièce sont **épinglées** par
  empreinte ; les cycles sont refusés.
- **Temporalité** : `point` / `interval` / `unknown`, précision `day` / `month` /
  `year` **par borne**, intervalles **fermés** (aucun intervalle ouvert), parseur strict
  (jamais `Date.parse`), **aucune conversion de précision** (`2025` ≠ `2025-01-01`,
  `2025-03` ≠ `2025-03-01`), jamais un `asOf`. `start <= end` : règle du possible.
- **Document / pièce** : `LegalDocument` (`provided` / `drafted`, `contentHash?`,
  provenance) ; `LegalEvidence` **documentaire** (`documentId` + localisation,
  document `provided` seulement) ou **non documentaire** (provenance jamais `llm`).
  Relation pièce → fait uniquement par `inputReferences` (« produit à partir de »,
  pas « prouve »).
- **Relations** : `fact_question` (N:N, jamais `llm` ; seule source de la pertinence
  d'un conflit pour une question) ; `fact_correction` (humain ou déterministe).
- **`LegalFactValidation`** : événement séparé, immuable, `confirm` / `reject`,
  humain, épinglé sur le fait ; « dernière validation effective » = dernière par
  position dans la liste.
- **Conflits / résolutions / règles** : conflit **sans `questionId`** ; propositions
  LLM dans une liste et un type séparés (**aucun effet** sur l'état) ; résolutions
  `retain` / `discard` / `retain_multiple`, une seule effective par conflit
  (`supersedesResolutionId`), une résolution déterministe ne remplace pas une
  résolution humaine ; catalogue de règles versionnées, whitelistées, pures, sans
  score (contrat et registre ; aucune règle concrète définie).
- **État épistémique dérivé** : `deriveFactEpistemicState(fact, question, ctx)` —
  pure, sans I/O ni horloge ni LLM, `RangeError` si le fait n'est pas lié à la
  question. Ordre **strict** : R1 conflit non résolu pertinent → `contradictory` ;
  R2 résolution effective `retain` → `established` ; R3 fait corrigé → `alleged` ;
  R4 dernière validation `reject` → `alleged` ; R5 dernière validation `confirm` →
  `established` ; R6 référence substantielle → `alleged` ; R7 aucune → `unknown`.
  `discard` et `retain_multiple` n'ont pas de règle propre.
- **Empreintes** : canonicalisation versionnée (v1, promotion de l'ancien
  `stableStringify`), SHA-256, stockées dans l'objet qui référence ; elles ne prouvent
  **pas** l'intégrité d'un fichier externe.
- **Append-only** : `checkAppendOnly`, `assertAppendOnly`, `appendToLegalCase` (ids
  uniques, ordre conservé, aucun remplacement ni suppression silencieux ; whitelist
  des règles vérifiée à l'ajout).
- **v2 legacy / v3 strict** : `parseLegacyLegalCaseFile` + `validateLegalCaseV2`
  (figés, lecture seule, aucun écrivain v2) ; `parseLegalCaseFile` (strict),
  `validateLegalCaseV3`, `serializeLegalCaseFile` (valide avant d'écrire). Un fichier
  v2 est refusé par le lecteur strict (`legacy_version`), un fichier v3 par le lecteur
  legacy ; **aucune migration implicite**, aucune conversion v2 → v3 (elle
  inventerait provenance, temporalité et état).
- **`ToolExecutor.runTracked(request)`** (`@jarvis/core`) → `{ invocationId, result }` :
  fournit une origine traçable aux `ToolProvenance` (UUID v4 par exécution, tous
  statuts couverts). Ajout non invasif : `run` et `ToolExecutionResult` inchangés ;
  ce n'est **pas** une refonte de `ToolExecutor`.

**Frontières.** `legal-core` reste une feuille : aucun `@jarvis/*`, seul module node
`node:crypto`, modules purs sans horloge ni aléa ni I/O (test d'architecture) ;
provenance = donnée, jamais dépendance vers le producteur.

**Non fait volontairement** (hors périmètre de ce bloc) : production de faits,
métadonnées `@jarvis/llm`, producteurs d'`actorId` / `interactionId`, Case Store,
chiffrement, migration v2 → v3, ANALYZE / VERIFY / PREPARE.

### Principes établis

- Search = découverte ; Retrieval = hydratation. `SearchReference` n'est pas une
  `LegalSource` ; une `LegalSource` n'est jamais construite depuis un résultat
  de recherche.
- `dateVersion` n'est pas `effectiveFrom` ; aucune `publicationDate` n'est
  fabriquée ; `consultedAt` n'est jamais une date de validité juridique.
- Clés d'identité : `referenceKey` = `authority` + `candidateId` (avant
  récupération) ; `sourceKey` = `authority` + `identifier` + `version` (après).
  `cid` seul n'est **pas** une clé de déduplication correcte (il fusionnerait
  des versions) ; `contentHash` ne participe pas à l'identité juridique.
- `ToolExecutor` reste l'unique point d'exécution ; `legal-research` n'importe ni
  `@jarvis/connectors` ni `@jarvis/legifrance-client` ni `SecretStore`, et
  n'utilise pas `fetch` (ESLint + test exécutable).
- La résolution temporelle est implémentée (ADR-0018) ; « aucune version
  applicable » est une réponse légitime mais ne peut survenir que sur un
  historique déclaré `complete`, ce que le moteur n'établit jamais : un `resolved`
  reste « au mieux » (`historyCompleteness: 'unknown'`).
- Trois notions distinctes : *retrouvée* (récupérée), *applicable* (résolue à
  `asOf`), *éligible à la citation* = les deux, vérifiée structurellement. La
  pertinence et l'usage comme preuve appartiennent à ANALYZE et ne sont pas
  représentés.
- Le texte juridique est **transitoire** : porté par les résultats de
  récupération, jamais par `LegalSource`, `LegalCitation` ni `LegalCase`.
- Aucun appel réseau dans les tests.

### Faits observés en Sandbox PISTE (LEGAL-03.0 / 03.0A)

Observations, **pas des décisions** (détail et limites : ADR 0011–0017) :

- `/search` sur `CODE_DATE` pagine des **résultats = codes instantanés**, pas des articles ;
  sans filtre de date l'ordre est instable et les mêmes articles se répètent.
- `typePagination: ARTICLE` est accepté (HTTP 200) mais n'est pas appliqué.
- Un résultat expose peu d'extraits (3 au plus observé) et `moreArticlesCount`.
- Article multi-version observé (L3121-27) : `cid` = `id` de la version 1.0 ;
  `id` et `versionArticle` changent ; `getArticle(cid)` renvoie la 1.0 ; les
  bornes de versions peuvent laisser un trou (2 910 jours).
- Sentinelle « pas de borne » `2999-01-01` ; `datePublication` d'un résultat vaut
  cette sentinelle ; `dateVersion` d'un extrait = début (en vigueur) ou fin (abrogé).

### Dette technique connue

- **Test préexistant instable** : `packages/legal-research/src/legifrance-source-mapping.test.ts`,
  test « 14. lienCitations… ». Il appelle le mapper deux fois sans horloge
  injectée, donc `consultedAt` diffère quand l'horloge change de milliseconde
  (échec intermittent, observé d'environ 1 exécution sur 4 à 1 sur 16). **Non
  modifié, non corrigé** ; dette indépendante des blocs LEGAL.
- `LegalSourceProvider` (LEGAL-02B.3) reste typé Légifrance (retourne
  `MapLegifranceArticleResult`) ; conservé tel quel (ADR-0015).
- ~~Cycle de packages `connectors` ↔ `legifrance-client`~~ — **corrigé** :
  `resolveLegifranceCredentials` déplacé dans
  `packages/connectors/src/legifrance/legifrance-credentials.ts` ;
  `@jarvis/legifrance-client` ne dépend plus d'aucun package `@jarvis/*`
  (ESLint + `architecture-boundaries.test.ts`).
- Credentials Sandbox : sous WSL, le `SecretStore` est le trousseau noyau
  (volatile, perdu au redémarrage de la VM) ; aucun script d'initialisation
  n'existe dans le dépôt.

### Points OUVERTS (aucun n'est une décision)

Autres fonds Légifrance · longueur et rôle de `titles[]` · stabilité du ranking
sous filtre · `pageSize` maximal · articles au-delà des extraits exposés ·
fuseau et bornes exactes de `DATE_VERSION` (inclusivité réelle des bornes du
resolver non observée) · support de `sourceTypes` (le **refus explicite** est
décidé ; le support reste ouvert) · `any_term` (`UN_DES_MOTS`, documenté,
jamais observé) · composition root de production · permissions de production
(`PermissionManager` refuse par défaut) · rôle, lien à la question et niveau de
synthèse de `LegalResearchItem` (aucun producteur) · stockage durable du
contenu, rechargement ou artefact, chiffrement · `reliability`
Sandbox/production · cache · multi-source · erreurs structurées
(`ToolFailed.reason` reste une chaîne) · correctif du test instable · origine
de `asOf` d'une question (faits datés, saisie explicite) · une même version
citée à deux `asOf` pour une même question donne deux citations (fusion
éventuelle non décidée) · périmètre de la **suite du Fact & Case Engine**
(après LEGAL-04.1, non planifiée ; architecture : D1–D10, voir « LEGAL-04.0 ») · producteurs d'`actorId` / `interactionId`,
métadonnées `@jarvis/llm`, câblage de `connectorId` (`describeCapabilities`) ·
persistance et chiffrement du dossier (aucun Case Store).

### Points d'attention des derniers blocs (conservés, NON résolus)

Issus des mini-reviews de Research → Case et de Content Exposure ; aucun n'est
bloquant, aucun n'est corrigé :

1. **`RetrievedContent`** : « vérifié par construction » n'est vrai qu'au typage
   (constructeur `private` et `readonly` sont des notions TypeScript) ;
   contournable à l'exécution. Les consommateurs doivent appeler `assertMatches`
   et ne pas se fier au champ `contentHash`.
2. **Lien contenu ↔ source** : ni le moteur ni le type ne l'imposent pour un port
   autre que Légifrance ; seul l'adaptateur Légifrance le contrôle.
3. **Hash** : un surrogate Unicode isolé est encodé comme U+FFFD (deux chaînes
   distinctes peuvent avoir le même hash) ; l'algorithme n'est pas inscrit dans
   la valeur du hash.
4. **Rétention transitoire** : le contenu est retenu pour toutes les versions
   récupérées, y compris non applicables, jusqu'à la fin du run.
5. **`AgentLoop`** : si un Tool Légifrance était branché, `JSON.stringify` de sa
   sortie brute enverrait `texte` au modèle (chemin antérieur à Content
   Exposure ; rien n'est branché aujourd'hui).
6. **Articles à texte vide** : irrécupérables (`malformed_response`) ; le format
   réel de `texte` (HTML éventuel, entités, fins de ligne) n'a jamais été
   observé, donc la stabilité du hash à un rechargement est non vérifiée.
7. **JSDoc de `LegalCitation`** : le commentaire de classe parle encore d'une
   « mobilisation dans un raisonnement » ; il est à aligner avec « source
   éligible » (ADR-0020).
8. **Collisions de vocabulaire** : `LegalEvidence` désigne une pièce du dossier,
   pas l'usage comme preuve ; `resolvedRetrieval.mode = 'retrieved'` désigne un
   saut, pas l'état « retrouvée ».
9. **Exhaustivité** : `unknown` ne doit jamais être promu en `complete` ;
   l'absence de donnée n'est pas `unknown`.
10. **`attachSourcesAndCitations`** : parmi des doublons d'identité logique déjà
    présents dans un dossier, il réutilise la **dernière** source.
11. **Test instable préexistant** `legifrance-source-mapping.test.ts` (n°14),
    maintenu, non corrigé.

### Attentions de LegalCase v3 (Post-Implementation Review — PASS WITH ATTENTION, NON bloquantes)

Issues de la review post-implémentation ; **aucune n'est une violation**, aucune
n'est un blocker, aucune n'est corrigée à ce jour :

- **A1 — Protection des documents `drafted`.** Une `LegalEvidence` documentaire
  bloque un document `drafted` comme fondement, mais une `inputReference` directe de
  kind `document` peut encore référencer un document `drafted`.
- **A2 — Comportements vérifiés par sonde, sans test dédié** : une référence
  `question` sans relation `fact_question` ne crée aucune pertinence (la dérivation
  lève `RangeError`) ; `discard` combiné à `confirm` donne `established` (R5, ordre
  R1 → R7 appliqué à la lettre).
- **A3 — Couverture dédiée du legacy v2 limitée** : les anciens tests de validation
  ciblent le validateur v3 ; le validateur et le lecteur legacy ont peu de tests
  dédiés (le code legacy est le code d'origine déplacé sans modification).
- **A4 — Limites préexistantes** : certaines entités conservées de la v2 (sources,
  citations, arguments…) ont des clés ouvertes ; `createdAt` / `updatedAt` du dossier
  ne sont validés que comme chaînes non vides ; `tool_invocation` n'est vérifié qu'en
  forme (aucun journal d'appels) ; l'append-only n'est pas imposé directement par le
  lecteur ni l'écrivain.

## Moteur de classification d'emails (`@jarvis/classification`)

Package `packages/classification`. But : classer l'importance d'un email
(`important` / `not_important` / `uncertain`) **indépendamment du
fournisseur** — Gmail, Outlook ou tout autre connecteur futur produisent le
même type `EmailMessage`, consommé sans savoir d'où il vient.

```
Gmail Connector (futur)
      ↓
EmailMessage        (@jarvis/types — partagé, zéro logique)
      ↓
ClassificationEngine (@jarvis/classification)
      ↓
PreferenceStore ──┘   (stockage pur, aucune décision)
      ↓
ClassificationResult { label, source, reason, preferenceId?, confidence? }
```

### Modèle `EmailMessage` (`@jarvis/types`)

`{ id, threadId?, sender, recipients, subject, body, receivedAt }`. Aucun
credential, aucun token OAuth, aucune donnée brute spécifique à un
fournisseur (payload API, labels internes…).

### Préférences (`Preference` / `PreferenceStore`)

- **Attributs supportés** (volontairement peu nombreux) : `sender`,
  `domain`, `subject_contains`, `keyword` (objet **ou** corps).
- **Origine** (`PreferenceOrigin`) : `explicit_rule` (règle générale déclarée
  directement, ex. « les mails de mon patron sont importants ») ou
  `user_correction` (correction réactive sur un email précis). Conservée
  uniquement pour la **traçabilité** (`ClassificationResult.source`) — les
  deux origines ont le **même poids** dans la résolution.
- `InMemoryPreferenceStore` : stockage pur (`add` / `list`), **aucune
  décision** — même philosophie que `ToolRegistry` côté `@jarvis/core`. Pas
  de base de données à ce stade (non nécessaire pour ce jalon).
- Le matching et la résolution de conflit vivent dans une fonction pure
  séparée, `matchPreference` (`preference-matcher.ts`), symétrique à
  `PermissionManager` : le store ne décide jamais.

### Résolution déterministe (hiérarchie validée)

1. **Préférence utilisateur** correspond (`explicit_rule` ou
   `user_correction`, peu importe laquelle) → sa décision, **jamais
   outrepassée par le LLM**. Entre préférences contradictoires :
   - la plus **spécifique** gagne : `sender` (4) > `subject_contains` (3) >
     `domain` (2) > `keyword` (1) ;
   - à spécificité égale, la plus **récente** (`createdAt`) gagne — l'origine
     n'intervient jamais dans ce départage.
2. **Classification LLM**, uniquement si aucune préférence ne correspond, via
   l'abstraction `EmailLlmClassifier` (le moteur ne connaît aucun provider
   concret).
3. **`uncertain` (`source: 'default'`)** — LLM absent, réponse inexploitable,
   erreur technique du provider, ou aucune préférence ni classification
   disponible. Une exception du provider LLM ne remonte jamais telle quelle :
   elle se traduit toujours par `uncertain`.

Note de conception : la hiérarchie à 5 niveaux initialement envisagée
(règle explicite > correction > « règles déterministes » > LLM > uncertain)
a été simplifiée après revue — une règle explicite et une correction sont
structurellement la même chose (une `Preference`, résolue par le même
mécanisme) ; les séparer en deux niveaux de priorité aurait fait gagner à
coup sûr une règle générale ancienne sur une correction précise et récente,
ce qui contredit l'exemple d'usage attendu.

### Apprentissage par correction

`ClassificationEngine.learnFromFeedback(email, decision)` crée une
préférence `user_correction` de portée **`sender` uniquement** — jamais
`domain` ni `keyword` — pour qu'une correction ponctuelle ne se généralise
pas sans contexte explicite. `ClassificationEngine.addExplicitRule(...)`
crée une préférence `explicit_rule` sur l'attribut choisi par l'appelant
(future couche NLU, hors scope ici : ce jalon fournit le mécanisme, pas
l'extraction de règles depuis du texte libre).

### Classification par LLM (`EmailLlmClassifier`)

- Interface `classify(email) → { label, reason, confidence? } | undefined`
  (`undefined` = repli sur `uncertain`). Le moteur ne dépend que de cette
  interface, jamais d'un `LlmProvider` concret.
- `LlmProviderEmailClassifier` : implémentation basée sur `LlmProvider`
  (`@jarvis/llm`, réutilisé — pas de nouvelle abstraction LLM créée). Parsing
  JSON strict et défensif de la réponse ; toute erreur de parsing ou du
  provider → `undefined`, jamais d'exception propagée.
- **Prompt minimal et borné** (`buildClassificationPrompt`) : exclut
  délibérément `recipients` (adresses tierces sans rapport avec la décision)
  et `threadId` ; corps borné à `MAX_BODY_EXCERPT_CHARS` (500 caractères) —
  testé explicitement (email plus long → extrait tronqué à exactement cette
  taille).
- Tests avec `MockLlmProvider` uniquement ; aucun appel réseau,
  `@anthropic-ai/sdk` importé uniquement via `import type` (jamais chargé à
  l'exécution des tests).

### Volontairement repoussé (classification)

- Aucune extraction automatique de règles depuis du texte libre utilisateur
  (« les mails de mon patron sont importants » → `Preference` reste, à ce
  stade, un appel explicite à `addExplicitRule`, pas une compréhension NLU).
- Aucun renforcement de préférence par répétition (`strength`/score) : une
  correction crée une nouvelle préférence, elle ne modifie pas une existante.
- Aucune persistance (`InMemoryPreferenceStore` uniquement).
- Aucun branchement à `apps/api` ni à un vrai connecteur Gmail/Outlook.
- Aucune limite de nombre de préférences ni de nettoyage/expiration.

### Prochaine étape (classification) — faite en M6

Le branchement à un connecteur Gmail réel est fait (voir section suivante,
`@jarvis/inbox`), **sans aucune modification** de ce package.

## Intégration Gmail ↔ classification et triage (`@jarvis/inbox`, M6 + M7)

Package `packages/inbox`. Premier flux réel de bout en bout (M6) :

```
Tool de lecture déjà enregistré (ex. gmail.read)
      ↓  fetchEmailsViaTool()      — passe strictement par ToolExecutor
EmailMessage[]
      ↓  classifyEmails()          — appelle ClassificationEngine.classify(), inchangé
ClassifiedEmail[]  { email, classification }
```

- **`fetchEmailsViaTool(executor, { toolName, input? })`** — générique, ne
  connaît aucun fournisseur. Passe **exclusivement** par `ToolExecutor`
  (jamais `tool.execute()` directement) : un outil refusé, en attente de
  confirmation, inconnu, en erreur, ou dont l'entrée est invalide lève
  `EmailFetchBlockedError` — aucun email n'est renvoyé dans ces cas. Vérifie
  aussi que la sortie a bien la forme `{ messages: EmailMessage[] }`.
- **`classifyEmails(engine, emails)`** — appelle `ClassificationEngine.classify`
  pour chaque email et recompose `{ email, classification }`.
  `ClassificationEngine` n'est ni modifié, ni sous-classé, ni contourné.
- **`fetchAndClassifyEmails(executor, engine, options)`** — compose les deux
  ci-dessus. C'est la fonction qui réalise concrètement
  `GmailConnector → EmailMessage[] → ClassificationEngine → ClassificationResult[]`,
  sans jamais mentionner Gmail dans son code.
- **`ClassifiedEmail { email, classification }`** — le type de restitution
  pour une future UI : email complet, `label`, `source`, `reason`, et
  `preferenceId` quand une préférence a tranché. Aucun champ nouveau créé :
  `EmailMessage` et `ClassificationResult` portent déjà tout le nécessaire,
  et ni l'un ni l'autre ne peut structurellement contenir un credential.

### Préparation de l'interaction utilisateur (`feedback.ts`)

Contrats fins, sans interface conversationnelle :

- **`recordFeedbackForEmail(engine, batch, emailId, decision)`** — retrouve
  un email par id dans un lot déjà classifié et appelle
  `ClassificationEngine.learnFromFeedback` (portée `sender` uniquement,
  comportement inchangé). Couvre « cet email est important » / « celui-ci
  n'est pas important ».
- **`applyUserRule(engine, { attribute, value, decision, reason? })`** —
  appelle `ClassificationEngine.addExplicitRule`, avec une explication par
  défaut générée si absente. Couvre « les emails de cette adresse sont
  toujours importants » (`attribute: 'sender'`) et « les newsletters de ce
  domaine ne sont pas importantes » (`attribute: 'domain'`). Une future
  couche NLU n'aura qu'à produire un `UserRuleRequest` — aucun changement
  requis ici.

### M7.1 — Identifier les emails nécessitant l'attention (`attention.ts`)

- `AttentionPolicy { labels: readonly ClassificationLabel[] }` — défaut :
  `['important']` uniquement.
- `needsAttention(classified, policy?)` / `filterEmailsNeedingAttention(batch, policy?)`
  — fonctions **pures** : aucune E/S, aucun réseau, aucun appel LLM. Ne
  mutent jamais `batch` ; préservent l'ordre d'origine.

### M7.2 — Résumer les emails importants (`email-summarizer.ts` + `summarize-email-tool.ts`)

- `EmailSummarizer.summarize(email) → EmailSummary | undefined` —
  `LlmProviderEmailSummarizer` (basée sur `LlmProvider`, `@jarvis/llm`
  importé en `import type` uniquement) construit un prompt minimal :
  expéditeur + objet + extrait de corps borné à `MAX_BODY_EXCERPT_CHARS`
  (500, même logique et même valeur que `@jarvis/classification`, définie
  indépendamment). **`recipients` et `threadId` explicitement exclus.**
- `createSummarizeEmailTool(summarizer): Tool<SummarizeEmailInput, SummarizeEmailOutput>`
  — `name: 'email.summarize'`, **`action: 'read'`** : aucun effet de bord,
  aucune connexion Gmail, aucun appel à `GmailApiClient`. N'appelle que le
  `EmailSummarizer` injecté. Passe par `ToolExecutor` comme tout `Tool`
  (allow/deny/require_confirmation testés). Une réponse LLM inexploitable ou
  une exception du provider → jamais un faux résumé (`undefined` côté
  `EmailSummarizer`, `status: 'error'` côté `ToolExecutor`).

### M7.3 — Préparer une réponse Gmail (`gmail.prepare_reply`, `@jarvis/connectors`)

Deuxième `Tool` du `gmailConnector` (`capabilities: ['gmail.read', 'gmail.prepare_reply']`) :

- `GmailPrepareReplyInput { messageId, body }` → `GmailDraftReply { to, subject, threadId?, body }`.
- **`action: 'prepare'`**, aucun effet de bord côté Gmail : `execute()`
  appelle `client.getMessage(messageId)` (lecture seule, méthode déjà
  existante depuis M5, aucune nouvelle méthode sur `GmailApiClient`) et
  dérive `to`/`subject`/`threadId` du message **réellement lu**. Seul `body`
  vient de l'appelant. `validateInput` ne retient que `{messageId, body}` :
  toute autre clé de l'entrée brute (un `to` fourni par le modèle, par
  exemple) est structurellement ignorée — testé explicitement (« aucune
  cible de réponse fournie par l'appelant ne remplace celle du message
  réel »).
- `gmail.read` **inchangé** (aucune modification de `createGmailReadTool`).
  Permissions indépendantes entre `gmail.read` et `gmail.prepare_reply`
  (testé dans les deux sens). Une confirmation sur `gmail.prepare_reply` ne
  débloque jamais un autre nom d'outil (testé avec un `gmail.send`
  hypothétique, toujours `unknown_tool`).
- Toujours aucun `gmail.send`, `gmail.modify` ni `gmail.delete`.

### M7.4 — Composition attention + résumé (`triage.ts`)

```
ClassifiedEmail[] → filterEmailsNeedingAttention (M7.1) → EmailSummarizer (M7.2)
```

- `AttentionSummary { classified: ClassifiedEmail, summary: string | undefined }`
- `summarizeEmailsNeedingAttention(batch, summarizer, policy?)` — compose
  M7.1 + M7.2, sans toucher à `ClassificationEngine`, `ToolExecutor` ni
  `PermissionManager`. **Seuls** les emails retenus par la politique
  d'attention (par défaut : `important`) sont transmis au `summarizer` : un
  email `not_important` ou `uncertain` n'atteint jamais le LLM — vérifié
  explicitement par comptage des appels d'un `MockLlmProvider`
  (`llm.calls.length` égal au nombre d'emails retenus, jamais à la taille du
  lot). Préserve l'ordre ; ne mute ni le lot, ni les `ClassifiedEmail`.

### Volontairement repoussé (M6 + M7)

- Aucune interface conversationnelle : `feedback.ts` prépare les contrats,
  ne les branche à rien (pas de parsing de langage naturel).
- Aucun stockage ni base de données : les `ClassifiedEmail[]`/`AttentionSummary[]`
  sont des valeurs éphémères, retournées à l'appelant — rien n'est persisté
  par `@jarvis/inbox` lui-même (au-delà de `InMemoryPreferenceStore`, déjà
  existant côté `@jarvis/classification`).
- Non branché dans `apps/api` : aucune route HTTP n'expose ce flux.
- Aucune pagination/synchronisation incrémentale (pas de curseur, pas de
  détection de « nouveaux » emails depuis la dernière lecture).
- `gmail.send` : était un jalon séparé nécessitant feu vert explicite —
  **fait, voir M8 ci-dessus**.
- Aucune génération automatique du corps d'une réponse par LLM :
  `gmail.prepare_reply` structure un corps déjà fourni, il ne le rédige pas.

### Prochaine étape prévue (inbox)

La connexion initiale OAuth et `gmail.send` sont résolus (M8). Depuis,
`fetchAndClassifyEmails` (`@jarvis/inbox`) est **exposé par la CLI desktop**
via la commande `inbox` (`996d716`) — mais limité à la classification
(résumé, triage et feedback restent non exposés, voir « Surface CLI desktop
post-M8 »).

Décision **toujours ouverte, non tranchée à ce stade** — plusieurs
directions possibles, aucune priorisée ici :
- étendre la surface CLI desktop (résumé/triage via
  `summarizeEmailsNeedingAttention`, feedback via
  `recordFeedbackForEmail`/`applyUserRule` — `gmail.prepare_reply` est
  désormais câblé via la commande `prepare-reply`, voir « Surface CLI
  desktop post-M8 ») ;
- brancher `@jarvis/inbox` dans `apps/api` via une route HTTP qui déclenche
  `fetchAndClassifyEmails`/`summarizeEmailsNeedingAttention` ;
- construire l'interface conversationnelle (NLU → `UserRuleRequest`/feedback) ;
- une autre architecture.

Ce document ne tranche aucune de ces directions.

## Ce qui n'est PAS fait (volontairement)

- Discord, Calendar, Outlook, ou tout autre fournisseur réel : seul Gmail a
  un connecteur réel.
- `gmail.modify`, `gmail.delete` : n'existent pas (ni `Tool`, ni méthode sur
  `GmailApiClient`). `gmail.prepare_reply` (M7.3) et `gmail.send` (M8)
  existent tous les deux.
- Pas de tool-use Anthropic réel (`AnthropicProvider` n'émet pas de `toolCall`).
- Connecteurs non branchés dans `apps/api` (`ToolRegistry` de l'API toujours
  vide d'outil connecteur). `apps/desktop`, lui, consomme `@jarvis/connectors`
  directement (M8) **et** `@jarvis/inbox` / `@jarvis/classification` via la
  commande `inbox` (`996d716`) — `@jarvis/classification` reçoit donc de vrais
  `EmailMessage` hors tests dès qu'un compte Gmail réel est connecté en CLI.
- Aucune extraction NLU de règles depuis du texte libre — `@jarvis/inbox`
  prépare les contrats (`recordFeedbackForEmail`, `applyUserRule`) mais ne
  parse aucun langage naturel, et ils ne sont câblés dans aucune commande CLI.
  (Distinct de VS-02 « Lecture naturelle contrôlée » — voir ci-dessus —
  qui ne couvre qu'un vocabulaire fermé de demandes de lecture `gmail.read`,
  jamais `recordFeedbackForEmail`/`applyUserRule`, et ne constitue pas une
  conversation naturelle générale.)
- Aucun branchement du flux `@jarvis/inbox` dans `apps/api` : `ToolRegistry`
  de l'API reste vide de tout outil connecteur. (La commande CLI `inbox` de
  `apps/desktop`, elle, câble `fetchAndClassifyEmails` — mais s'arrête à la
  classification : ni résumé, ni triage, ni feedback.)
- ~~Pas de mémoire persistante~~ **`@jarvis/memory` existe** (mémoire
  contrôlée, `FileMemoryStore` pour la persistance locale) mais **n'est
  câblée dans aucune application** — voir « Mémoire contrôlée
  (`@jarvis/memory`) » ci-dessus et
  `docs/adr/0007-memory-promotion-policy.md`. Pas de streaming, pas de
  WebSocket.
- Pas d'outil filesystem / shell / réseau générique. (Les Tools `legifrance.*` appellent un client HTTP dédié à Légifrance, pas un outil réseau générique.)
- Domaine juridique (état au 2026-09-25, LegalCase v3 clos) : ni production de faits (Fact & Case Engine — prochaine étape LEGAL-04), ni query planning, ni production de `LegalResearchItem`, `LegalArgument`, `LegalAnalysisNote` ou `LegalConclusion`, ni analyse juridique (ANALYZE), VERIFY ou PREPARE, ni Case Store ni chiffrement du dossier, ni pertinence ou « evidence-used », ni persistance de la provenance de recherche, ni persistance, chiffrement ou rechargement du contenu (le texte est transitoire) ; aucune application (`apps/api`, `apps/desktop`) ne consomme les packages légaux ; pas de composition root de production pour Légifrance. Voir « Domaine juridique ».

## Vérifications (après M4 + connecteurs + classification + Gmail M5 + inbox M6 + M7 + Connector Architecture Foundation + M8 + surface CLI desktop post-M8)

- `npm run typecheck` : vert
- `npm test` : vert — **530 tests, 50 fichiers** au total. Détail non
  exhaustif : 225 tests / 28 fichiers à l'issue de `Connector Architecture
  Foundation` (`8506792`, voir historique ci-dessous pour le détail par
  fichier) ; puis M8 (OAuth PKCE, `OsCredentialSecretStore`,
  `ConfirmationService`/`proposeConfirmation`/`confirmAndExecute`,
  `gmail.send`, câblage CLI `apps/desktop`, et la couverture d'erreurs
  post-confirmation de M8-B6 dans `gmail-send.test.ts`/`main-send.test.ts`) ;
  puis la surface CLI desktop post-M8 (`main.test.ts` pour `disconnect`,
  `main-read.test.ts`, `main-inbox.test.ts`, `inbox-view.test.ts`).
- `npm run lint` : vert — `eslint .` (flat config ESLint 9, voir
  `eslint.config.js` à la racine), y compris les règles de frontières
  entre workspaces.
- Aucun appel réseau réel dans les tests : `GmailApiClient` (via
  `gmailConnector`) reçoit systématiquement un `fetchFn` mocké,
  `ClassificationEngine` et `LlmProviderEmailSummarizer` n'utilisent que
  `MockLlmProvider` — aucune dépendance vers
  `undici`/`node-fetch`/`googleapis`/`@anthropic-ai/sdk` chargée à
  l'exécution des tests. `InMemorySecretStore` (nouveau) ne dépend
  d'aucun mécanisme externe.
- Aucun secret réel, aucun nouveau fichier `.env`.

**Addendum LEGAL-04.1 (2026-09-26)** — résultats **vérifiés par exécution avant le
commit** (dépôt de travail, hors clone propre) : `vitest run packages/legal-case-engine` →
**285 tests / 10 fichiers verts** ; `vitest run` → **2481 tests / 135 fichiers verts**
(dont 3 tests de `situation-poc`, modification non commitée : 2478 sans elle) ;
`tsc --noEmit` exit 0 ; `eslint .` exit 0 ; Prettier conforme sur le package et
`eslint.config.js` ; frontières : `eslint-boundaries.test.ts` (**45 tests**, règles
ESLint effectives + test statique) et `architecture-boundaries.test.ts` (20 tests) verts ;
`packages/legal-core` : aucun diff. **Repris du rapport de la mission de corrections, non
relancés lors de la finalisation** : mutation testing sur une copie (32 mutants tous
détectés). Aucun appel réseau dans ces tests.

**Addendum baseline juridique (2026-09-26, vérifié par exécution)** : sur un clone
propre de `HEAD` (`e9b3357`, `node_modules` copiés, lock vérifié hors ligne :
synchronisé) — **2193 tests / 125 fichiers verts**, `tsc --noEmit` PASS,
`eslint .` PASS. Dans l'arbre de travail : 2196 tests (+3 du POC `situation-poc`,
non commité). Le hook `pre-commit` (ESLint, Prettier, `tsc`) est passé pour les trois
commits. `npm ci` avec réseau n'a **pas** été exécuté. Aucun appel réseau dans ces tests.

**Addendum LegalCase v3 (2026-09-25, vérifié par exécution — état au 2026-09-25)** : suite
complète **2196 tests / 125 fichiers verts** (`npx vitest run`), `tsc --noEmit`
PASS, `eslint .` PASS, tests d'architecture PASS (dont le garde-fou `legal-core`).
Par package : `@jarvis/legal-core` 567 (19 fichiers), `@jarvis/legal-research` 415,
`@jarvis/core` 142 (dont 6 tests de `runTracked`), `@jarvis/legifrance-client` 41.
Post-Implementation Review : **PASS WITH ATTENTION**. Aucun appel réseau dans ces
tests. Le test préexistant instable reste connu (voir « Dette technique connue »).

**Addendum domaine juridique (2026-09-24, vérifié par exécution — état historique,
avant LegalCase v3)** : suite
complète **1719 tests / 112 fichiers verts** (`npx vitest run`), `eslint .` et
`tsc --noEmit` sans erreur. Les chiffres « 530 tests / 50 fichiers » ci-dessus
sont l'état historique à l'issue de M8 et **ne sont plus le total courant**.
Domaine légal : `@jarvis/legal-core` 96, `@jarvis/legal-research` 415,
`@jarvis/legifrance-client` 41, connecteur Légifrance 66. Aucun appel réseau
réel dans ces tests (`fetchFn` factice côté connecteur ; aucun `fetch` dans
`legal-research`, vérifié par un test de frontières). **Un test préexistant est
instable** — voir « Domaine juridique → Dette technique connue ».

**Addendum VS-02 (committé `8fb7ff4`, non inclus dans le total de 530
ci-dessus, non re-vérifié par une exécution complète de `npm test` à
cette mise à jour)** : 82 tests ciblés verts (détail par fichier dans « Lecture
naturelle contrôlée — VS-02 » ci-dessus), `npm run typecheck` et
`npm run lint` propres sur l'ensemble du dépôt à l'issue de VS-02f.

**Addendum vérification de postcondition (2026-10-21, vérifié par exécution
ciblée — suite complète non rejouée à cette mise à jour)** : `npx vitest run`
sur les six fichiers concernés → **76 tests ciblés verts** —
`packages/core/src/verification.test.ts` (11),
`packages/connectors/src/in-memory/in-memory-send-verification.test.ts` (10),
`apps/desktop/src/verify-demo-trace.test.ts` (7),
`apps/desktop/src/run-verify-demo-trace.test.ts` (11),
`apps/desktop/src/run-verify-demo.test.ts` (28, dont le process réel `tsx
src/main.ts verify-demo` sur confirmation acceptée/refusée/EOF/argument
inattendu),
`apps/desktop/src/main-verify-demo.test.ts` (9). `npx vitest run
prototypes/verify-postcondition-bench/bench.test.ts` → **17 tests verts**
(banc exploratoire séparé, non intégré — voir « Vérification de
postcondition (opt-in) »). `tsc --noEmit` à la racine du monorepo non
rejoué à cette mise à jour (hors périmètre de cette vérification ciblée) ;
aucun appel réseau, LLM ni Gmail réel dans ces tests (entrée synthétique
fixe, `InMemoryMailClient` jetable).

## Commits clés

Jalons fonctionnels (`M4` → `M8`, chronologie de référence) :

- `9d4021f` scaffold monorepo workspaces
- `2b4db31` TypeScript monorepo foundations
- `c95e80f` Anthropic LLM provider
- `5aed22d` core agent loop
- `0716411` HTTP chat API
- `3bde930` tool contract, registry, permissions, executor
- `f836375` agent tool execution loop (fin M4)
- `e059601` architecture connecteurs (`@jarvis/connectors` + `InMemoryConnector`) — antérieur à M5, pose le contrat `Connector<TClient>`
- `d57e202` moteur de classification (`@jarvis/classification` + `EmailMessage`)
- `fd13ffa` connecteur Gmail réel, lecture seule — **M5**
- `b5d82df` intégration Gmail ↔ classification, `@jarvis/inbox` — **M6**
- `84e2955` triage, résumés, préparation de réponse Gmail — **M7.1 + M7.2 + M7.3**
- `938d71c` composition `summarizeEmailsNeedingAttention` (`triage.ts`) — **M7.4**, committé et terminé
- **M8 — Gmail Send**, committé et terminé :
  - `2d088b7` OAuth Google Authorization Code + PKCE — **M8-B2**
  - `b5db57e` `SecretStore` de production (trousseau OS) — **M8-B3**
  - `a811027` boucle d'envoi Gmail confirmée — **M8-B4**
  - `309bbfb` câblage CLI desktop `connect`/`send` — **M8-B5**
  - `2faf205` couverture des erreurs post-confirmation — **M8-B6**

Surface CLI desktop post-M8 (hors numérotation fonctionnelle — exposition CLI
de briques existantes, aucun numéro `M8-B7`/`M9`/`OUT-07`) :

- `cc2e8a4` commande `disconnect` — câblage CLI de `disconnectGmailAccount()`
- `9c24cb7` commande `read` — câblage CLI du Tool `gmail.read`
- `996d716` commande `inbox` — câblage CLI de `fetchAndClassifyEmails`
  (`@jarvis/inbox`), s'arrête à la classification
- `753f4d0` commande `prepare-reply` — câblage CLI du Tool `gmail.prepare_reply`

Fondations architecturales (hors numérotation fonctionnelle — voir
« Functional milestones vs Architectural foundations » en tête de
document) :

- `8506792` **Connector Architecture Foundation** — `ConnectorRegistry`,
  `AccountStore`, `SecretStore`/`InMemorySecretStore`, `Capability`. Ne
  remplace pas et ne renumérote pas le M5 fonctionnel (`fd13ffa`).

Domaine juridique (état au 2026-09-26) :

- `85e7e6e` **LegalCase v3** — `@jarvis/legal-core`, `ToolExecutor.runTracked` (+
  `tool-executor-invocation.test.ts`), `LEGAL_SPECIFICATION.md`, mise à jour des
  documents d'état. Présent sur `origin/main`.
- `979fa19` **Fondations Légifrance et recherche** — `@jarvis/legifrance-client`,
  `packages/connectors/src/legifrance/`, `@jarvis/legal-research`, règles ESLint de
  frontières, `package-lock.json`. Publié sur `origin/main`.
- `8407ac0` **ADR juridiques** `0011` à `0021`. Publié sur `origin/main`.
- `e9b3357` **Correctif CI** (fixtures de secrets, `memory-promotion.test.ts`).
  Publié sur `origin/main`.
- `38fb0fc` **Synchronisation documentaire** de la baseline (`PROJECT_STATE`,
  `LEGAL_SPECIFICATION`, roadmap, backlog). Publié sur `origin/main`.
- `59cb8db` **Synchronisation post-push** (statuts « publié sur `origin/main` »).
  Publié sur `origin/main`.
- **LEGAL-04.1** (commit dédié `8cdeb2e`, message `feat(legal): add legal case engine`) : `packages/legal-case-engine/`, `eslint.config.js` (frontières),
  `package-lock.json` (workspace) et les documents d'état. `packages/legal-core` inchangé.

Vérification de postcondition (hors numérotation fonctionnelle — capacité de
bibliothèque opt-in, voir « Vérification de postcondition (opt-in) » ;
**seuls les deux premiers sont publiés sur `origin/main`**) :

- `64702a2` banc exploratoire isolé (`prototypes/verify-postcondition-bench/`)
- `748b7a0` `runWithVerification` (`@jarvis/core`) + vérificateur `inmemory.send`
  (`@jarvis/connectors`) — **publié sur `origin/main`**
- `f463033` correctif : détachement des instantanés `InMemoryMailClient` — **local**
- `f474cd8` démonstration CLI `verify-demo` (`apps/desktop`) — **local**
- `5478144` trace en mémoire (RAM) des missions `verify-demo` — **local**

`AUDIT_STATE.md` reste **non suivi par git**, comme les documents de cadrage des
slices et de la situation et `prototypes/situation-poc` (modifié et non commité).
