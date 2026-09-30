# JARVIS — Roadmap synthétique

Vue d'ensemble condensée. Le détail (raisons, invariants, tests) vit dans
`PROJECT_STATE.md` ; le détail actionnable vit dans `MASTER_BACKLOG.md`.
Cette page ne fait que positionner chaque élément dans le temps.

_Dernière mise à jour : 2026-09-26 (domaine juridique : LEGAL-04.1 — Fact & Case Engine, premier jalon — implémentée et validée pour commit ; suite non planifiée)._

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

## NEXT

- **Domaine juridique — suite du Fact & Case Engine** : **non planifiée**. LEGAL-04.0 et
  LEGAL-04.1 sont terminés ; aucun sous-ticket suivant n'est documenté (les éléments
  hors périmètre de LEGAL-04.1 — propositions LLM, validation humaine, corrections,
  projection des faits écartés, persistance — attendent une décision). Aucun LEGAL-03C
  n'est planifié.

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
