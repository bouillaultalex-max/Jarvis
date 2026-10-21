# JARVIS — Roadmap synthétique

Vue d'ensemble condensée. Le détail (raisons, invariants, tests) vit dans
`PROJECT_STATE.md` ; le détail actionnable vit dans `MASTER_BACKLOG.md`.
Cette page ne fait que positionner chaque élément dans le temps.

_Dernière mise à jour : 2026-10-21 (réconciliation documentaire : vérification de
postcondition opt-in ajoutée — `runWithVerification`, voir « Composants livrés depuis
2026-09-30 » ci-dessous ; checkpoint local `5478144`, `main` 3 commits en avance sur
`origin/main`. N'affecte ni les priorités Product Builder ni la suite juridique)._

_Mise à jour précédente : 2026-10-19 (synchronisation documentaire : composants livrés du
2026-09-30 au checkpoint `a92cca3` — Légifrance CLI, banc d'interfaces d'outils, canal
WhatsApp, chat local, fiches projet ; étapes Product Builder PB-01 à PB-06 reprises de
Notion comme séquencement proposé, correspondance partielle établie)._

_Mise à jour précédente : 2026-09-26 (domaine juridique : LEGAL-04.1 — Fact & Case Engine, premier jalon — implémentée et validée pour commit ; suite non planifiée)._

## DONE

**Jalons fonctionnels**
- M4 — Tool / permissions / executor / agent loop (`f836375`)
- M5 — Connecteur Gmail réel, lecture seule (`fd13ffa`)
- M6 — Intégration Gmail ↔ classification (`b5d82df`)
- M7.1–7.4 — Triage, résumé, préparation de réponse Gmail, composition
  attention + résumé (`84e2955`, `938d71c`)
- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`), terminé :
  - M8-B2 — OAuth Google Authorization Code + PKCE (`2d088b7`)
  - M8-B3 — `SecretStore` de production via trousseau OS (`b5db57e`)
  - M8-B4 — boucle d'envoi Gmail confirmée (`a811027`)
  - M8-B5 — câblage CLI desktop `connect`/`send` (`309bbfb`)
  - M8-B6 — couverture des erreurs réseau/provider post-confirmation (`2faf205`)

**Surface CLI desktop post-M8** (hors numérotation fonctionnelle — exposition
CLI de briques déjà existantes, aucun nouveau jalon)
- `apps/desktop` expose désormais six commandes :
  `connect` / `read` / `inbox` / `prepare-reply` / `send` / `disconnect`.
  _(État au 2026-09-26. Commandes ajoutées depuis : `legal-search`, `chat`,
  `project` — voir « Composants livrés depuis 2026-09-30 » ci-dessous.)_
- `disconnect` — câblage CLI de `disconnectGmailAccount()` (`cc2e8a4`).
- `read` — câblage CLI du Tool `gmail.read` (`9c24cb7`).
- `inbox` — câblage CLI de `fetchAndClassifyEmails` (`@jarvis/inbox`) ;
  s'arrête volontairement à la classification (`996d716`).
- `prepare-reply` — câblage CLI du Tool `gmail.prepare_reply`, aucun effet de
  bord Gmail réel (`753f4d0`).
- Toutes réutilisent le noyau M8 (`resolveAccount` → `resolveGmailApiClient`
  → `gmailConnector.createTools()` → `ToolRegistry`/`PermissionManager`/
  `ToolExecutor`), sans le modifier.

**VS-02 — Lecture naturelle contrôlée (`read-natural`, committé `8fb7ff4`)**
- VS-02 est validé comme vertical slice CLI readonly contrôlé.
- Commande explicite `read-natural "<texte>"` — texte fourni
  obligatoirement en argument (pas de mode interactif pour la saisie).
- Périmètre limité à `gmail.read` ; aucune action d'écriture accessible.
- Pas d'`AgentLoop`, pas d'`apps/api`, pas de mémoire.
- Pas de vérification métier avancée du résultat (le statut brut de
  `ToolExecutor` est restitué tel quel, jamais présenté comme un succès
  vérifié).
- Implémenté, testé et committé (`8fb7ff4`) — 82 tests ciblés verts,
  `typecheck`/`lint` propres.

**Fondation architecturale** (hors numérotation fonctionnelle)
- Connector Architecture Foundation — `ConnectorRegistry`, `AccountStore`,
  `SecretStore`, `Capability` (`8506792`)

**Domaine juridique (LEGAL)** — implémenté, **versionné** et testé (« terminé » ≠
validé en production). `legal-core` : `85e7e6e` ; fondations Légifrance/recherche :
`979fa19` ; ADR 0011 à 0021 : `8407ac0` ; correctif CI : `e9b3357` ; synchronisation
documentaire : `38fb0fc` — **tous publiés sur `origin/main`** (2026-09-26). Détail :
`PROJECT_STATE.md` → « Domaine juridique », `LEGAL_SPECIFICATION.md`,
`docs/adr/0011` à `0021`.
- LEGAL-00 — spécification canonique et gouvernance — terminé
- LEGAL-01 — modèle `LegalCase` (`@jarvis/legal-core`) — terminé
- LEGAL-01REV — revue d'architecture du modèle — terminé
- LEGAL-02A — `LegalSource` versionnée/temporelle, `LegalCitation`, chaîne d'audit — terminé
- LEGAL-02B.1 — client PISTE/Légifrance (`@jarvis/legifrance-client`) — terminé
- LEGAL-02B.2 — connecteur Légifrance en lecture seule (`legifrance.ping`, `legifrance.get_article`) — terminé
- LEGAL-02B.2.1 — vérification réelle du contrat Sandbox — terminé
- LEGAL-02B.2.2 — exploration Sandbox / résilience — terminé
- LEGAL-02B.3 — `LegifranceSourceProvider` + mapping vers `LegalSource` — terminé
- LEGAL-03A — architecture du Research Engine : types, ports, ADR — terminé
- LEGAL-03B — Tool `legifrance.search`, `LegifranceSearchAdapter`,
  `LegifranceRetrievalAdapter`, `ResearchEngine` borné — terminé / clôturé
- VersionResolver — résolution temporelle pure (ADR-0018) — **CLOSED**
- Version Resolution Integration — résolution par article dans le `ResearchEngine`
  (`versionResolution`, `historyCompleteness`) (ADR-0018) — **CLOSED**
- Resolved Version Retrieval — `resolvedRetrieval`, un seul saut, budget partagé
  (ADR-0019) — **CLOSED**
- Research → Case — `projectCitations`, `attachSourcesAndCitations`,
  `LegalCitation.eligibility` : une citation = source retrouvée **et** applicable
  (ADR-0020) — **CLOSED**
- Content Exposure — contenu juridique (`texte`) transitoire et vérifié,
  `RetrievedContent`, hash normatif SHA-256/UTF-8 sans normalisation (ADR-0021)
  — **CLOSED**
- **LegalCase v3 — Fact / Provenance / Evidence / Temporal** (`@jarvis/legal-core`) —
  **CLOSED / COMPLETED** (2026-09-25). Décisions d'architecture Q1–Q10, B1–B4 et U1
  **CLOSED** (gelées avant implémentation) ; modèle **implémenté** :
  - `LegalFact` **immuable** (`id`, `statement`, `temporal`, `provenance`,
    `recordedAt`) ; **aucun état stocké** — l'état épistémique
    (`established` / `alleged` / `contradictory` / `unknown`) est **dérivé** par
    `deriveFactEpistemicState` (pure, R1 → R7) ;
  - provenance `origin` ∈ `human` / `tool` / `deterministic` / `llm` (`document` n'est
    **pas** un origin : c'est une `inputReference`) ; références d'entrée
    **substantielles** : `evidence`, `document`, `tool_invocation`, `source`, `fact`
    (`fact` inconditionnellement, sans récursion) ; `question` non substantielle ;
  - temporalité `point` / `interval` / `unknown` (précision `day` / `month` / `year`
    par borne, intervalles fermés, parseur strict, aucune conversion de précision) ;
  - `LegalDocument` et `LegalEvidence` (documentaire / non documentaire) ;
  - relations `fact_question` (N:N) et `fact_correction` ; `LegalFactValidation`
    (`confirm` / `reject`) ; conflits, propositions LLM, exécutions de règles
    déterministes, résolutions (`retain` / `discard` / `retain_multiple`) ;
  - empreintes (canonicalisation versionnée, SHA-256) et **append-only** ciblé ;
  - **v2 legacy** (lecteur et validateur figés, lecture seule) / **v3 strict**
    (lecteur, validateur, écrivain) ; **aucune migration implicite**.
- **`ToolExecutor.runTracked`** (`@jarvis/core`) — **implémenté** : renvoie
  `{ invocationId, result }` pour fournir une origine traçable aux
  `ToolProvenance`. Ajout non invasif : `run` et `ToolExecutionResult` inchangés ;
  ce n'est **pas** une refonte de `ToolExecutor`.
- **Post-Implementation Review LegalCase v3** — **CLOSED**, verdict
  **PASS WITH ATTENTION** : aucune violation architecturale, LegalCase v3 conforme.
  Quatre attentions **non bloquantes** (A1–A4, détail : `MASTER_BACKLOG.md`).
- **LEGAL-04.0 — baseline Git et décisions d'architecture** — **terminé**
  (2026-09-26) : audit Git, trois commits (`979fa19`, `8407ac0`, `e9b3357`, **publiés
  sur `origin/main`**), décisions D1–D10 validées (détail : `PROJECT_STATE.md`).
- **LEGAL-04.1 — Fact & Case Engine, premier jalon** — **implémentée, validée pour commit**
  (2026-09-26) : package `@jarvis/legal-case-engine` (dépend uniquement de
  `@jarvis/legal-core`, inchangé) — question ouverte, enregistrement atomique d'un fait
  rapporté, contrôles chronologiques à l'écriture, faits équivalents **consultatifs**,
  `createdAt` non instant refusé sans conversion, aucune restriction READ-only ; frontières
  ESLint volontairement strictes (aucun chargement dynamique). Hors périmètre : faits
  proposés par un LLM, validation humaine, correction, projection des faits écartés,
  persistance (détail : `PROJECT_STATE.md` → « LEGAL-04.1 »).
- **Non implémenté à ce jour** : production de faits (**Fact & Case Engine** : LEGAL-04.1
  n'enregistre que des faits rapportés par un humain ; aucun extracteur ni proposition LLM) ; query planning ; `LegalResearchItem`
  (production) ; ANALYZE, VERIFY, PREPARE ; `LegalArgument` / `LegalAnalysisNote` /
  `LegalConclusion` (types et validation existent, **aucun producteur**) ; pertinence,
  « evidence-used » ; persistance de la provenance de recherche ;
  persistance / chiffrement / rechargement du contenu et du dossier (aucun Case
  Store) ; `texteHtml` ; transitions de workflow ; composition root et permissions
  de production complètes ; multi-source ; intégration LLM dans le domaine
  juridique (`@jarvis/llm` n'expose pas fournisseur, modèle ni identifiant d'appel) ;
  producteurs d'`actorId` / `interactionId`.

Détail complet de M8 (contexte, invariants, tests) : `PROJECT_STATE.md` →
« Envoi Gmail confirmé (M8) » et `docs/adr/0001` à `0005`.

2481 tests / 135 fichiers dans l'arbre de travail (vérifié le 2026-09-26 avant le commit LEGAL-04.1 ; dont 3 tests d'un POC non commité, soit 2478 sans eux ; inclut le domaine juridique), tous verts ; `eslint .` et `tsc --noEmit` propres ; tests d'architecture verts. Un test préexistant
instable dans `legifrance-source-mapping.test.ts` est connu (voir `PROJECT_STATE.md`). _(Historique : 1719 tests / 112 fichiers au 2026-09-24, avant LegalCase v3 ; 530 tests / 50 fichiers à l'issue de M8/VS-02.)_

**Composants livrés depuis 2026-09-30** (hors numérotation de jalon — chaque
commit est un **composant**, pas un jalon achevé ; aucun ne clôt à lui seul un
chantier). Légende : _livré_ = code versionné et testé ; _validation simulée_ =
tests ou essais sans service réel (doubles, simulateurs, données fictives) ;
_usage réel_ = utilisation documentée sur un service ou des données réels ;
_chantier global_ = objectif plus large, qui reste ouvert.

| Capacité | Commits | Livré | Validation simulée | Usage réel | Chantier global |
|---|---|---|---|---|---|
| Recherche Légifrance CLI `legal-search` (lecture seule) et provisionnement interactif des secrets Légifrance | `17e5297`, `b58780a`, `682455c`, `f6c1ea5`, `adca17b` | oui | doubles uniquement (`fetchFn` mocké, `InMemorySecretStore`) | rapport externe transmis par Alexandre (essai Sandbox du 2026-10-02 : cinq résultats partiels, puis collecte ciblée de deux articles pour expliquer `invalid_interval`) — preuve non archivée dans le dépôt | domaine juridique — suite non planifiée (voir NEXT) |
| Banc d'évaluation des interfaces d'outils (`prototypes/tool-interface-bench/`, hors workspaces) | `7719baa` | oui (prototype) | 20 missions synthétiques, `ScriptedLlmProvider`, chemin réel `ToolRegistry` → `AgentLoop` | aucun pilote réel documenté (`run-live.ts` manuel, payant, jamais lancé par `npm test`) | aucun chantier rattaché dans ces documents |
| Canal WhatsApp : prototype webhook, canal simulé local, transport Graph API inactif, réception durable SQLite, mode réel opt-in, provisionnement des secrets | `70a4c3b`, `1d2c9f7`, `5e48873`, `c50039a`, `5dae0f2`, `e7cd02e`, `5e5453e`, `880553a`, `5508767`, `adca17b` | oui | canal simulé par défaut, `SimulatedLlmProvider`, tests SQLite multi-process | provisionnement et mode opt-in implémentés ; serveur et tunnel lancés puis arrêtés ; aucun échange réel rapporté — rapport externe transmis par Alexandre, non archivé dans le dépôt ; activité reportée par Alexandre | **reporté** (voir LATER) ; ADR-0022 et ADR-0023 restent `Proposed` |
| Chat local multi-tour, historique en RAM borné, **sans outils** (`chat`) | `370159e`, `1bfd518` | oui | `LlmProvider` factice uniquement | non documenté dans le dépôt (chaque message est un appel Anthropic réel, potentiellement facturé) | aucun outil branché ; aucune suite décidée dans ces documents |
| Fiches projet persistantes (`@jarvis/project-briefs`), export Markdown, entretien interactif à règle fixe (`project ...`) | `fc92fab`, `be0d670`, `a92cca3` | oui | tests ciblés et essai CLI sur projet fictif (2026-10-19, répertoire temporaire) | fiche réelle `boutique-asiatique` créée (révision 11 : 5 faits, 5 questions ouvertes, aucune réponse) et un export Markdown — rapporté 2026-10-16 ; **entretien réel pas encore lancé** | Product Builder — PB-01 et PB-02 partiellement couverts, PB-03 à PB-06 non démontrés (voir NEXT) |
| Vérification de postcondition opt-in — `runWithVerification` (`@jarvis/core`), vérificateur `inmemory.send` (`@jarvis/connectors`), démonstration CLI `verify-demo` (`apps/desktop`) | `64702a2`, `748b7a0` (publiés), `f463033`, `f474cd8`, `5478144` (locaux) | oui (bibliothèque + une démonstration) | 76 tests ciblés verts (+ 17 sur un banc exploratoire séparé, non intégré) ; entrée synthétique fixe, `InMemoryMailClient` jetable | aucun — `inmemory.send` est un connecteur fictif, aucune livraison externe ; `gmail.send`, `AgentLoop`, `apps/api` restent non vérifiés | qui déclenche une vérification hors démonstration reste une décision ouverte (`docs/verified-result-boundaries.md` §9) ; aucun vérificateur pour `gmail.send` |

Checkpoint publié sur `origin/main` : **`748b7a0`** (2026-10-19/20). Checkpoint
local (non publié) : **`5478144`** — `main` est 3 commits en avance sur
`origin/main` (`f463033`, `f474cd8`, `5478144`). Suite
complète **historique** : 3111 tests / 181 fichiers (rapportée, non rejouée pour
cette synchronisation documentaire). Rejoué lors de la clôture de l'entretien
interactif (2026-10-19) : 91 tests / 11 fichiers ciblés, `tsc --noEmit`, ESLint,
hooks pre-commit, essai CLI fictif. Rejoué pour la vérification de
postcondition (2026-10-21) : 76 tests ciblés verts (détail :
`PROJECT_STATE.md` → « Vérifications »).

## NEXT

- **Domaine juridique — suite du Fact & Case Engine** : **non planifiée**. LEGAL-04.0 et
  LEGAL-04.1 sont terminés ; aucun sous-ticket suivant n'est documenté (les éléments
  hors périmètre de LEGAL-04.1 — propositions LLM, validation humaine, corrections,
  projection des faits écartés, persistance — attendent une décision). Aucun LEGAL-03C
  n'est planifié.
- **Product Builder — chantier ouvert.** Étapes **PB-01 à PB-06** tenues dans Notion
  (« Chantier Product Builder » : https://app.notion.com/p/3f0ba52b3dae819898f6da141fb7e30b — page
  modifiée le 2026-10-05, lue par ChatGPT le 2026-10-19 et transmise par Alexandre).
  C'est un **séquencement proposé**, pas six jalons validés ou terminés :
  - PB-01 — modèle du dossier produit et traçabilité besoin → source → décision → exigence ;
  - PB-02 — entretien guidé, extraction documentaire et détection des contradictions ;
  - PB-03 — comparaison des solutions et génération du cahier des charges ;
  - PB-04 — évaluation V1 avec dossiers de référence et revue humaine ;
  - PB-05 — maquettes, backlog et gestion des changements après validation V1 ;
  - PB-06 — construction assistée et validation du produit après maîtrise des
    permissions, outils et preuves.
  Correspondance avec les travaux inspectés : PB-01 **partiellement couvert**
  (`@jarvis/project-briefs`, sans les liens de traçabilité) ; PB-02 **partiellement
  couvert** (`project interview`, sans extraction documentaire ni détection des
  contradictions) ; PB-03 à PB-06 **non démontrés** dans les travaux inspectés.
  Matrice et critères V1 proposés : `MASTER_BACKLOG.md` → « Product Builder ». Aucune
  numérotation parallèle n'est créée. La priorité actuelle donnée par Alexandre au
  rôle product builder ne vaut pas validation des prérequis de la roadmap.
  - **Proposition de preuve utilisateur — non validée, non historique** :
    entretien réel `project interview boutique-asiatique` avec au moins une
    réponse confirmée, suivi d'un `project export-markdown` daté. À rattacher à
    un jalon PB existant après vérification dans Notion.
- L'ordre relatif entre Product Builder et la suite juridique n'est pas établi par
  ces documents. Aucune phase « chat avec outils » n'y est planifiée.

## LATER

- Autres connecteurs réels (Calendar, Drive, Slack, GitHub…) — aucun
  n'existe encore, même en ébauche ; la fondation générique
  (`Connector Architecture Foundation`) les rend possibles sans toucher
  au cœur (`ToolExecutor`/`PermissionManager`), mais aucun n'est planifié
  à une date précise.
- Interface conversationnelle / NLU (piloter `recordFeedbackForEmail` /
  `applyUserRule` en langage naturel) — non commencé.
- Branchement de `@jarvis/inbox` dans `apps/api` (route HTTP) — non
  commencé, non priorisé face aux autres pistes.
- Branchement `AgentLoop` → `ToolExecutor` pour une action `execute`
  (ex. `gmail.send` piloté par le LLM) — non commencé ; conditions
  préalables actées par `docs/adr/0006-confirmation-fingerprint-for-execute-actions.md`.
- Activation de la promotion mémoire (`@jarvis/memory`) dans une
  application — non commencé ; policy de référence actée par
  `docs/adr/0007-memory-promotion-policy.md`.
- **Canal conversationnel WhatsApp** — idée à étudier, **non engagée**.
  Objectif utilisateur envisagé : envoyer une demande à Jarvis depuis
  WhatsApp et recevoir sa réponse dans la même conversation. Positionné
  après la stabilisation des fondations et la livraison d'un premier
  parcours utilisateur fonctionnel — déjà le cas aujourd'hui (fondations
  M4–M8, VS-02 livré). Nécessite une étude de faisabilité préalable avant
  tout MVP ; aucune bibliothèque ni fournisseur n'est choisi à ce stade.
  Détail, périmètre envisagé et questions ouvertes : `MASTER_BACKLOG.md` →
  « Pistes non encore validées ».
  - **État au 2026-10-19** : des composants techniques existent (voir DONE →
    « Composants livrés depuis 2026-09-30 » ; `apps/whatsapp-channel`, simulé par
    défaut). Ils ne valent ni clôture de l'étude de faisabilité ni MVP : ADR-0022 et
    ADR-0023 restent `Proposed`. Serveur et tunnel ont été lancés puis arrêtés ; aucun
    échange réel n'est rapporté (rapport externe, non archivé dans le dépôt).
    **Activation WhatsApp et tests payants restent reportés** par Alexandre.
- **Domaine juridique — autres points ouverts** (non planifiés, non décidés ;
  l'ordre relatif à LEGAL-04 n'est pas établi) : query planning, `LegalResearchItem` (rôle, lien à la question,
  synthèse), ANALYZE / VERIFY / PREPARE, pertinence et « evidence-used », stockage
  durable / rechargement / chiffrement du contenu et du dossier, `texteHtml`, autres
  fonds Légifrance, multi-source, cache, composition root et permissions de
  production, `reliability` Sandbox/production, erreurs structurées, correctif du
  test instable préexistant. Liste complète, **11 points d'attention** des blocs
  Research → Case / Content Exposure et **attentions A1–A4** de LegalCase v3 :
  `PROJECT_STATE.md` → « Domaine juridique → Points OUVERTS » et
  `MASTER_BACKLOG.md`.

## Essais d'outils et de skills (registre externe)

Les essais issus des veilles sont tenus dans la **Roadmap outillage** Notion
(https://app.notion.com/p/3ebba52b3dae81118b91f7b97afc278c) : objectif, phase, protocole, coût, réussite,
statut, source. Ce document **ne duplique pas** ce catalogue. Une entrée du
registre ne vaut ni adoption ni planification ; un essai se rattache à sa phase
et ne remplace pas une mission produit. Journal Notion :
https://app.notion.com/p/3ebba52b3dae81f3b404d61c8aeb57c1. _(Registre rapporté le 2026-10-19,
non consulté lors de cette synchronisation.)_
