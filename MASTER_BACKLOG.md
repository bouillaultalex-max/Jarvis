# JARVIS — Backlog

Backlog minimal, dérivé strictement de l'état réel du dépôt (voir
`PROJECT_STATE.md` pour le détail complet). Aucune fonctionnalité listée
ici n'est inventée : chaque entrée correspond à un commit existant ou à
une décision explicitement ouverte dans `PROJECT_STATE.md`.

Voir aussi `MASTER_ROADMAP.md` pour la vue synthétique DONE / LATER.

_Dernière mise à jour : 2026-10-19 (synchronisation documentaire jusqu'au checkpoint
`a92cca3` ; Product Builder PB-01 à PB-06 repris de Notion, correspondance partielle)._

_Mise à jour précédente : 2026-09-26 (domaine juridique : LEGAL-04.1 — Fact & Case Engine, premier jalon — implémentée et validée pour commit ; suite non planifiée)._

## Jalons fonctionnels terminés

- **M4** — Contrat `Tool`, `ToolRegistry`, `PermissionManager`,
  `ToolExecutor`, `AgentLoop` (boucle d'agent bornée). (`f836375`)
- **M5** — `gmailConnector` réel, lecture seule (`gmail.read`,
  `action: 'read'`). (`fd13ffa`)
- **M6** — Intégration Gmail ↔ classification (`@jarvis/inbox` :
  `fetchEmailsViaTool`, `classifyEmails`, `fetchAndClassifyEmails`).
  (`b5d82df`)
- **M7.1–M7.3** — Identification des emails nécessitant l'attention,
  résumé LLM (`email.summarize`, `action: 'read'`), préparation de
  réponse Gmail (`gmail.prepare_reply`, `action: 'prepare'`). (`84e2955`)
- **M7.4** — Composition attention + résumé
  (`summarizeEmailsNeedingAttention`, `triage.ts`). (`938d71c`)
- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`), terminé,
  5 sous-jalons :
  - **M8-B2** — OAuth Google Authorization Code + PKCE (`gmail-oauth-flow.ts`). (`2d088b7`)
  - **M8-B3** — `SecretStore` de production via trousseau OS (`OsCredentialSecretStore`). (`b5db57e`)
  - **M8-B4** — Boucle d'envoi Gmail confirmée (`runGmailSend`). (`a811027`)
  - **M8-B5** — Câblage CLI desktop `connect`/`send`. (`309bbfb`)
  - **M8-B6** — Couverture des erreurs réseau/provider post-confirmation. (`2faf205`)

  Détail : `PROJECT_STATE.md` → « Envoi Gmail confirmé (M8) »,
  `docs/adr/0001` à `0005`.

## Surface CLI desktop post-M8 (hors numérotation de jalon)

Exposition en ligne de commande de capacités **déjà écrites et testées** dans
`@jarvis/connectors` / `@jarvis/inbox`. Ne constituent pas de nouveaux jalons
fonctionnels : aucune nouvelle brique de bibliothèque, seulement du câblage
CLI réutilisant le noyau M8.

- **`disconnect`** — câblage CLI de `disconnectGmailAccount()` (révocation
  OAuth réelle + statut de compte). (`cc2e8a4`)
- **`read`** — câblage CLI du Tool `gmail.read` (lecture seule, `--maxResults`
  transmis tel quel). (`9c24cb7`)
- **`inbox`** — câblage CLI de `fetchAndClassifyEmails` (`@jarvis/inbox`) :
  lit puis classe (`important` / `not_important` / `uncertain`). S'arrête
  **volontairement** à la classification — résumé, triage et feedback restent
  hors périmètre. (`996d716`)
- **`prepare-reply`** — câblage CLI du Tool `gmail.prepare_reply`
  (`--messageId`/`--body`, aucun effet de bord Gmail réel, n'appelle jamais
  `gmail.send`). (`753f4d0`)

`apps/desktop` expose donc six commandes : `connect` / `read` / `inbox` /
`prepare-reply` / `send` / `disconnect`. _(État au 2026-09-26. Commandes ajoutées
depuis : `legal-search`, `chat`, `project` — voir « Composants livrés depuis
2026-09-30 ».)_

## VS-02 — Lecture naturelle contrôlée, readonly (`apps/desktop`, committé `8fb7ff4`)

Septième commande CLI, **implémentée, testée et committée**
(`8fb7ff4` — `feat(desktop): add controlled natural-language readonly flow`).
Validée dans un périmètre strictement délimité :

- **parser déterministe** (`read-intent-parser.ts`) — reconnaît un
  vocabulaire fermé de demandes de lecture Gmail en langage naturel ;
- **acceptation explicite** (`read-interpretation-acceptance.ts`) —
  confirmation de compréhension au terminal, distincte d'une confirmation
  d'exécution ;
- **conversion contrôlée vers `gmail.read`** (`read-intent-to-tool-request.ts`)
  — jamais un autre outil, jamais un champ d'autorisation ;
- **orchestration** (`read-natural-language-flow.ts`) — compose les trois
  étapes ci-dessus puis `runReadFlow` (VS-01, inchangé) ;
- **branchement CLI minimal** : `read-natural "<texte>"`, exactement un
  argument requis, aucun assemblage automatique de plusieurs arguments.

`PermissionManager` et `ToolExecutor` sont **conservés tels quels** (aucune
modification) ; ce chemin ne rend accessible **aucun outil d'écriture** —
`gmail.send` reste structurellement inatteignable (le nom d'outil n'est
jamais dérivé du texte utilisateur ni transmis par ce chemin).

**Ne constitue pas** une conversation naturelle générale de Jarvis, ni une
intégration à `AgentLoop`, à `apps/api`, ni à la mémoire (`@jarvis/memory`)
— périmètre strictement lecture Gmail, CLI uniquement.

82 tests ciblés verts, `typecheck`/`lint` propres. Détail complet :
`docs/second-readonly-vertical-slice.md`,
`docs/second-readonly-vertical-slice-integration-study.md`,
`docs/second-readonly-vertical-slice-cli-study.md`.

## Fondations architecturales terminées

- **Connector Architecture Foundation** (alias technique `M5.ARCH`, hors
  numérotation fonctionnelle) — `ConnectorRegistry`, `AccountStore`
  (multi-compte par provider, `resolve()` sans jamais de sélection
  implicite), `SecretStore`/`InMemorySecretStore` (dev/test uniquement),
  `Capability` (description déclarative, ne contourne jamais
  `PermissionManager`). Additive : ne modifie ni `gmailConnector`, ni
  `inMemoryConnector`, ni `PermissionManager`/`ToolExecutor`. (`8506792`)
  Doc : `docs/connectors-architecture.md`.
- **`@jarvis/memory`** (fondation architecturale, hors numérotation
  fonctionnelle) — mémoire contrôlée : provenance à 5 niveaux,
  `MemoryPromoter`/`MemoryPromotionPolicy`, stockage non destructif
  (`InMemoryMemoryStore`/`FileMemoryStore`). **Disponible et testé, non
  câblé dans `apps/api` ni `apps/desktop`.** Policy de production actée par
  `docs/adr/0007-memory-promotion-policy.md`
  (`createConservativeMemoryPromotionPolicy` de référence ;
  `createDefaultMemoryPromotionPolicy` réservée aux tests/usages
  explicitement maîtrisés). (`acf57c7`)

## Domaine juridique (LEGAL-00 → LegalCase v3) — terminé

Implémenté, **versionné** et testé (`legal-core` : `85e7e6e` ; Légifrance/recherche :
`979fa19`, ADR : `8407ac0`, correctif CI : `e9b3357`, synchronisation documentaire :
`38fb0fc` — **tous publiés sur `origin/main`**, 2026-09-26). Pas validé en production. Détail :
`PROJECT_STATE.md` → « Domaine juridique », `LEGAL_SPECIFICATION.md`,
`docs/adr/0011` à `0021`. Cocher = **effectivement implémenté**.

- [x] **LEGAL-00** — spécification canonique et gouvernance (`LEGAL_SPECIFICATION.md`).
- [x] **LEGAL-01 / 01REV** — modèle `LegalCase` et revue d'architecture (`@jarvis/legal-core`).
- [x] **LEGAL-02A** — modèle de source : `LegalSource` versionnée/temporelle,
  `LegalCitation`, chaîne d'audit, format de fichier v2 (**historique** : la v2 est
  désormais le format **legacy**, voir LegalCase v3 ci-dessous).
- [x] **LEGAL-02B.1** — client PISTE/Légifrance (config, OAuth, HTTP, erreurs).
- [x] **LEGAL-02B.2** — connecteur Légifrance en lecture seule : `legifrance.ping`,
  `legifrance.get_article`.
- [x] **LEGAL-02B.2.1 / 02B.2.2** — vérification et exploration réelles du contrat
  Sandbox (aucun script ni rapport archivé dans le dépôt).
- [x] **LEGAL-02B.3** — `LegifranceSourceProvider` + mapping vers `LegalSource`.
- [x] **Explorations de la recherche Légifrance (LEGAL-03.0 / 03.0A)** — pagination,
  `DATE_VERSION`, article multi-version ; conclusions dans les ADR 0011–0017
  (sorties brutes non archivées).
- [x] **LEGAL-03A — architecture Search/Retrieval** : types, ports, clés d'identité,
  ADR 0011 à 0017.
- [x] **Tool `legifrance.search`** (connecteur, `read`, fond `CODE_DATE` seul,
  `DATE_VERSION` obligatoire, `typePagination` = `DEFAUT`).
- [x] **`LegifranceSearchAdapter`** (`SearchPort`, parseur pur).
- [x] **`LegifranceRetrievalAdapter`** (`RetrievalPort` ; depuis ADR-0021, capture le
  texte pendant l'appel existant et l'expose comme `content` vérifié, jamais dans
  `LegalSource`).
- [x] **`ResearchEngine` borné** (déduplication, budgets, rejets, lacunes, `skipped`).
- [x] **VersionResolver** — résolution temporelle pure, convention de bords
  conservatrice, complétude d'historique déclarée par l'appelant (ADR-0018). **CLOSED**.
- [x] **Version Resolution Integration** — résolution par article dans le
  `ResearchEngine` (`versionResolution`, `assembleVersionHistory`, rejet
  `no_applicable_version`) (ADR-0018). **CLOSED**.
- [x] **Resolved Version Retrieval** — `resolvedRetrieval` (`initial` | `shared` |
  `retrieved`), capacité optionnelle `retrieveVersion?`, un seul saut, budget
  `maxRetrievedSources` partagé, identité contrôlée (ADR-0019). **CLOSED**.
- [x] **Research → Case** — `projectCitations`, `attachSourcesAndCitations`,
  `LegalCitation.contentHash?` / `eligibility?`, `historyCompleteness` ; format
  de fichier v2 inchangé **à cette date** (ADR-0020, historique) ; une citation =
  source retrouvée **et** applicable. **CLOSED**.
- [x] **Content Exposure** — contenu (`texte`) transitoire et vérifié
  (`RetrievedContent`), hash normatif SHA-256/UTF-8 sans normalisation,
  recontrôle d'intégrité, aucun appel réseau de plus, aucune persistance
  (ADR-0021). **CLOSED**.
- [x] **LegalCase v3 — Fact / Provenance / Evidence / Temporal** (`@jarvis/legal-core`)
  — **CLOSED / COMPLETED** (2026-09-25). Décisions Q1–Q10, B1–B4, U1 **CLOSED**.
  Implémenté :
  - [x] `LegalFact` immuable, sans état stocké ; état épistémique **dérivé** par
    `deriveFactEpistemicState` (pure, R1 → R7) ;
  - [x] provenance `human` / `tool` / `deterministic` / `llm` (`document` n'est pas un
    origin) ; références d'entrée substantielles `evidence` / `document` /
    `tool_invocation` / `source` / `fact` (`fact` inconditionnel, sans récursion) ;
    `question` non substantielle ;
  - [x] temporalité `point` / `interval` / `unknown` (précision par borne, intervalles
    fermés, parseur strict) ;
  - [x] `LegalDocument`, `LegalEvidence` (documentaire / non documentaire) ;
  - [x] relations `fact_question` (N:N) et `fact_correction` ;
  - [x] `LegalFactValidation` (`confirm` / `reject`) ;
  - [x] conflits, propositions LLM, exécutions de règles déterministes (catalogue
    whitelisté et versionné, contrat), résolutions (`retain` / `discard` /
    `retain_multiple`, `supersedesResolutionId`) ;
  - [x] empreintes (canonicalisation versionnée, SHA-256) et append-only ciblé
    (`checkAppendOnly`, `assertAppendOnly`, `appendToLegalCase`) ;
  - [x] **v2 legacy** (lecteur et validateur figés, lecture seule) / **v3 strict**
    (lecteur, validateur, écrivain) ; **aucune migration implicite**.
- [x] **`ToolExecutor.runTracked`** (`@jarvis/core`) — renvoie `{ invocationId, result }`
  pour fournir une origine traçable aux `ToolProvenance`. Ajout non invasif (`run`
  et `ToolExecutionResult` inchangés) ; **pas** une refonte de `ToolExecutor`.
  **CLOSED**.
- [x] **Post-Implementation Review LegalCase v3** — **CLOSED**, verdict
  **PASS WITH ATTENTION** (aucune violation architecturale ; LegalCase v3 conforme).
  Validation : 125 fichiers / 2196 tests verts, `tsc` et `eslint` propres, tests
  d'architecture verts. Attentions **A1–A4 non bloquantes** : voir « Domaine
  juridique — points ouverts ».
- [x] **LEGAL-04.0 — baseline Git et décisions d'architecture** (2026-09-26) — audit
  Git, commits `979fa19`, `8407ac0`, `e9b3357` (**publiés sur `origin/main`**), décisions
  D1–D10 validées (détail : `PROJECT_STATE.md`). Validation sur un clone propre de
  `HEAD` : 125 fichiers / 2193 tests verts, `tsc` et `eslint` propres (2196 dans
  l'arbre de travail, +3 tests d'un POC non commité).
- [x] **LEGAL-04.1 — Fact & Case Engine, premier jalon** (2026-09-26) — package
  `@jarvis/legal-case-engine` (dépend uniquement de `@jarvis/legal-core`, **inchangé**) :
  `addOpenQuestion` (question `open`, statuts existants inchangés), `recordReportedFact`
  (fait + pièce non documentaire + liens de question, atomiques), `findEquivalentFacts`
  (consultatif, aucune fusion) ; contexte d'acteur et horloge injectés ; chronologie
  contrôlée à l'écriture ; `createdAt` non instant refusé sans conversion ; aucune
  restriction READ-only ; frontières ESLint volontairement strictes (aucun chargement
  dynamique). Validé pour commit après revue contradictoire et corrections I1–I5 ; 285
  tests du package, 2481 tests au total dans l'arbre de travail (dont 3 d'un POC non
  commité), `tsc`, `eslint`, Prettier verts. Dette : M1–M8 (voir `PROJECT_STATE.md`).
- [ ] **Suite du Fact & Case Engine** — **non planifiée**, aucun sous-ticket documenté.

Dette technique connue (non planifiée) : test préexistant instable
`legifrance-source-mapping.test.ts` (« 14. lienCitations… », horloge non
injectée) ; `LegalSourceProvider` typé Légifrance. Le cycle de packages
`connectors` ↔ `legifrance-client` a été corrigé (voir `PROJECT_STATE.md`).
Les points d'attention des derniers blocs sont conservés dans « Domaine
juridique — points ouverts » ci-dessous.

## Composants livrés depuis 2026-09-30 (composants, pas jalons)

Tableau détaillé (livré / validation simulée / usage réel / chantier global) :
`MASTER_ROADMAP.md` → DONE → « Composants livrés depuis 2026-09-30 ». Détail
technique : `PROJECT_STATE.md` → « Composants livrés depuis 2026-09-30 ».

- Légifrance CLI `legal-search` + provisionnement interactif (`17e5297`, `b58780a`,
  `682455c`, `f6c1ea5`, `adca17b`) — tests avec doubles ; usage réel : rapport externe transmis par Alexandre (essai Sandbox du 2026-10-02 : cinq résultats partiels, puis collecte ciblée de deux articles pour expliquer `invalid_interval`) — preuve non archivée dans le dépôt.
- Banc d'interfaces d'outils (`7719baa`) — déterministe ; pilote réel non documenté.
- Canal WhatsApp simulé, réception durable SQLite, mode réel opt-in (`70a4c3b` →
  `adca17b`) — provisionnement et mode opt-in implémentés ; serveur et tunnel lancés puis arrêtés ; aucun échange réel rapporté — rapport externe transmis par Alexandre, non archivé dans le dépôt ; activité reportée par Alexandre ; ADR-0022/0023 `Proposed`.
- Chat local multi-tour sans outils (`370159e`, `1bfd518`).
- Fiches projet, export Markdown, entretien interactif (`fc92fab`, `be0d670`,
  `a92cca3`) — essai CLI fictif validé le 2026-10-19 ; entretien réel non lancé.

Commits du 2026-09-26 au 2026-09-30 **pas encore réconciliés** dans ces documents
(sujet de commit uniquement, statut à documenter, rien n'est affirmé au-delà) :
`8cdeb2e` feat(legal): add legal case engine (LEGAL-04.1) ;
`94f6f53` refactor: extract shared array bounds validation ;
`b10c248` test(legal): stabilize Legifrance source mapping ;
`3cd0643` feat(desktop): show summaries in inbox ;
`5ef8d44` feat(legal): add file-based legal case store ;
`ed4d778` feat(legal): project research items into cases ;
`2ee2381` fix(legal): remove circular package dependency ;
`ab9b6d6` fix(confirmation): bind execution to verified payload ;
`b590120` docs(roadmap): add WhatsApp conversational channel.

## Product Builder — chantier ouvert (étapes tenues dans Notion)

Source : « Chantier Product Builder », https://app.notion.com/p/3f0ba52b3dae819898f6da141fb7e30b — page
modifiée le 2026-10-05, lue par ChatGPT le 2026-10-19, transmise par Alexandre.
**Séquencement proposé**, pas six jalons validés ou terminés. Priorité actuelle
donnée par Alexandre au rôle product builder ; elle ne vaut pas validation des
prérequis de la roadmap.

| Étape (libellé Notion) | Correspondance avec les travaux inspectés |
|---|---|
| PB-01 — modèle du dossier produit et traçabilité besoin → source → décision → exigence | **Partiellement couvert** par `@jarvis/project-briefs` (`fc92fab`, puis `b985e1c` et `fca94db`) : dossier persistant, faits / hypothèses / décisions (`proposed` → `validated` / `obsolete`) / questions séparés, identifiants stables, compteur de révision. **Couvert depuis** (`project-brief.ts`, format v2, tests `project-brief-file-store.links.test.ts` et `project-brief-file-format.v2.test.ts`) : entité « source » déclarée par l'utilisateur, jamais vérifiée (`Source`, l. 53 ; `addSource`, store l. 203) ; lien fait / hypothèse → source (`sourceIds`, l. 57 ; `linkSource`, store l. 218) ; lien décision → faits / hypothèses (`basis`, l. 69 ; `justifyDecision`, store l. 252), figé dès que la décision n'est plus `proposed` ; date de validation d'une décision (`validatedAt`, l. 71 ; posée par `validateDecision`, store l. 168). Références orphelines ou répétées refusées à la lecture et à l'écriture. **Toujours absents** (grep `requirement` / `need` / `besoin` / `exigence` : aucune entité dans le package ; le README l'indique) : entité « besoin » ; entité « exigence » ; liens besoin → source, source → décision explicite (le chemin n'existe qu'indirectement via fait / hypothèse) et décision → exigence ; lien réponse → fait (répondre à une question ne crée ni fait ni lien, test l. 293) ; auteur de la validation ; suppression de lien et historique des changements au-delà du compteur. La traçabilité besoin → source → décision → exigence n'est donc pas complète. |
| PB-02 — entretien guidé, extraction documentaire et détection des contradictions | **Partiellement couvert** par `project interview` (`a92cca3`) : entretien guidé à règle fixe, confirmation explicite, refus `already_answered`. Extraction documentaire et détection des contradictions **non démontrées**. |
| PB-03 — comparaison des solutions et génération du cahier des charges | Non démontré dans les travaux inspectés. |
| PB-04 — évaluation V1 avec dossiers de référence et revue humaine | Non démontré dans les travaux inspectés. |
| PB-05 — maquettes, backlog et gestion des changements après validation V1 | Non démontré dans les travaux inspectés. |
| PB-06 — construction assistée et validation du produit après maîtrise des permissions, outils et preuves | Non démontré dans les travaux inspectés. |

« Non démontré » signifie seulement qu'aucune preuve n'apparaît dans les travaux
inspectés (`@jarvis/project-briefs`, `apps/desktop project`) — pas une inexistence
vérifiée sur tout le dépôt.

**Critères V1 proposés dans Notion** (recopiés tels quels, aucun n'est déclaré
atteint) :
- exigence sourcée ou marquée hypothèse ;
- contradictions et informations manquantes visibles ;
- aucune fonctionnalité approuvée sans validation humaine ;
- comparaison d'une automatisation lorsque le problème réel est une double saisie ;
- impacts des changements de besoin visibles ;
- absence de fuite entre dossiers ;
- revue humaine de trois dossiers : complet, incomplet, contradictoire.
- **Proposition de preuve utilisateur (non validée)** : entretien réel
  `project interview boutique-asiatique` avec au moins une réponse confirmée,
  puis `project export-markdown` daté. Reste une proposition tant qu'elle n'est
  ni rattachée à un PB ni validée.
- Absence de lien entre `chat` et les fiches : constat, aucune décision.

## Prérequis pour M8 — tous résolus

Ces points étaient explicitement non tranchés lors de `Connector
Architecture Foundation` (`8506792`, qui posait seulement l'abstraction
générique). Ils sont désormais tous résolus et implémentés par M8 :

1. **Flux de connexion initiale du compte Gmail** — ~~non implémenté~~
   **résolu par M8-B2** : consentement OAuth interactif + PKCE
   (`gmail-oauth-flow.ts`, `2d088b7`).
2. **Stockage sécurisé du refresh token en production** — ~~aucune
   implémentation~~ **résolu par M8-B3** : `OsCredentialSecretStore`,
   trousseau natif de l'OS (`b5db57e`). `InMemorySecretStore` reste
   dev/test uniquement.
3. **Modèle de confirmation utilisateur pour une action `execute`
   réelle** — **résolu par M8-B4/B5** : `ConfirmationService` +
   confirmation au terminal (`apps/desktop`, `a811027`/`309bbfb`). Une
   politique `'allow'` sur `gmail.send` reste refusée sans confirmation
   explicite.
4. **Desktop ou serveur pour le flux de connexion** — **tranché : desktop**
   (`apps/desktop`, CLI `connect` / `read` / `inbox` / `send` / `disconnect`).

## Décisions d'architecture — résolues par M8

- Brancher `gmailConnector` sur `ConnectorRegistry`/`AccountStore`/
  `SecretStore` : **fait**, via `resolveGmailApiClient` (M8).
- Mécanisme de `SecretStore` de production : **tranché — trousseau OS**
  (`@napi-rs/keyring`, `OsCredentialSecretStore`). Voir
  `docs/adr/0003-os-credential-backend.md`.
- Forme d'un `Account` Gmail concret : **en usage en production** via
  `connectGmailAccount`/`FileAccountStore` (`accountIdentifier` = adresse
  email, aucun credential dans `metadata`).

## Domaine juridique — points ouverts (NON planifiés, NON décidés)

Aucune de ces entrées n'est une tâche planifiée ni une décision. La prochaine
étape légale établie a été **LEGAL-04.1** (Fact & Case Engine, premier jalon, terminé ;
LEGAL-04.0 terminé ; pas de LEGAL-03C) : la suite n'est pas planifiée et l'ordre relatif des
points ci-dessous n'est pas établi.

**NON IMPLÉMENTÉS** (à ne pas présenter comme faits) :

- Query planning (`LegalQuestion` → `SearchQuery`) — `SearchQuery` est construite
  à la main.
- `LegalResearchItem` (production) — rôle, lien à la question et niveau de
  synthèse non stabilisés.
- ANALYZE, VERIFY, PREPARE ; production de `LegalArgument` / `LegalAnalysisNote` /
  `LegalConclusion` (types et validation existent, **aucun producteur**).
- **Production de faits** (Fact & Case Engine) : LEGAL-04.1 n'enregistre que des faits
  rapportés par un humain ; aucun extracteur de faits, aucune proposition LLM, ni
  validation humaine, ni correction, ni projection des faits écartés, ni persistance ;
  `actorId` / `interactionId` sans producteur (fournis par l'appelant au moteur) ; `@jarvis/llm` n'expose ni
  fournisseur, ni modèle, ni identifiant d'appel ; `connectorId` obtenable par
  `describeCapabilities` (non câblé).
- Pertinence et « evidence-used » — aucun marqueur, aucun producteur (la relation
  « pièce → fait » de LegalCase v3 signifie « produit à partir de », pas « prouve »).
- Persistance de la provenance de recherche ; persistance, chiffrement,
  rechargement ou artefact du contenu et du dossier (aucun Case Store) ;
  `texteHtml`.
- Transitions de workflow ; composition root et permissions de production
  complètes pour les Tools `legifrance.*` (aucune application ne consomme les
  packages légaux) ; multi-source ; intégration LLM dans le domaine juridique.

**Points ouverts hérités**

- Autres fonds Légifrance (`LODA_DATE`, `JURI`, `KALI`, `CETAT`…) et multi-source —
  non testés / non implémentés.
- Longueur et rôle de `titles[]` ; stabilité du ranking sous filtre ; `pageSize`
  maximal ; articles au-delà des extraits exposés ; fuseau et bornes exactes de
  `DATE_VERSION` (et inclusivité réelle des bornes du resolver) — à confirmer.
- `sourceTypes` : refus explicite décidé ; support ouvert. `any_term`
  (`UN_DES_MOTS`) documenté, jamais observé.
- `reliability` Sandbox/production ; cache ; erreurs structurées
  (`ToolFailed.reason` est une chaîne) ; origine de `asOf` d'une question ; une
  même version citée à deux `asOf` donne deux citations (fusion non décidée).
- Correctif du test instable préexistant — non autorisé à ce jour.

**Points d'attention des derniers blocs** (Research → Case, Content Exposure ;
conservés, **NON résolus**, aucun n'est bloquant) :

1. **`RetrievedContent`** : garantie « vérifiée par construction » vraie au typage
   seulement, contournable à l'exécution ; `assertMatches` requis, ne pas se fier
   au champ `contentHash`.
2. **Lien contenu ↔ source** non imposé universellement (moteur, type) ; seul
   l'adaptateur Légifrance le contrôle — à renforcer pour de futurs providers.
3. **Hash** : surrogates Unicode isolés (encodés comme U+FFFD) et absence de
   marqueur d'algorithme dans la valeur.
4. **Rétention transitoire** du contenu (toutes les versions récupérées, y compris
   non applicables) jusqu'à la fin du run.
5. **Exposition via `AgentLoop`** : `JSON.stringify` de la sortie brute d'un Tool
   Légifrance, s'il était branché, enverrait `texte` au modèle.
6. **Articles à texte vide** (`malformed_response`, irrécupérables) et **format
   réel de `texte` non caractérisé** (stabilité du hash au rechargement non
   vérifiée).
7. **JSDoc de `LegalCitation`** à aligner avec « source éligible » (ADR-0020) :
   il évoque encore une « mobilisation dans un raisonnement ».
8. **Collisions de vocabulaire** : `LegalEvidence` (pièce du dossier) vs
   « evidence-used » ; `resolvedRetrieval.mode = 'retrieved'` vs état « retrouvée ».
9. **Exhaustivité** : `unknown` ne doit jamais être promu en `complete` ; l'absence
   de donnée n'est pas `unknown`.
10. **Doublons dans `attachSourcesAndCitations`** : réutilisation de la **dernière**
    source parmi des doublons d'identité logique déjà présents.
11. **Test instable préexistant** `legifrance-source-mapping.test.ts` (n°14) :
    maintenu, non corrigé.

**Attentions de LegalCase v3** (Post-Implementation Review : **PASS WITH ATTENTION**,
**NON bloquantes**, conservées, non corrigées) :

- **A1 — Protection des documents `drafted`.** Une `LegalEvidence` documentaire bloque
  un document `drafted` comme fondement ; mais une `inputReference` directe de kind
  `document` peut encore référencer un document `drafted`.
- **A2 — Comportements vérifiés par sonde, sans test dédié** : une référence
  `question` sans relation `fact_question` ne crée aucune pertinence (la dérivation
  lève `RangeError`) ; `discard` combiné à `confirm` donne `established` (R5,
  ordre R1 → R7 appliqué à la lettre).
- **A3 — Couverture dédiée du legacy v2 limitée** : les anciens tests de validation
  ciblent désormais le validateur v3 (les validateurs d'entités communs restent
  couverts) ; le validateur et le lecteur legacy ont peu de tests dédiés.
- **A4 — Limites préexistantes** : certaines entités conservées de la v2 (sources,
  citations, arguments…) ont des clés ouvertes ; `createdAt` / `updatedAt` du dossier
  ne sont validés que comme chaînes non vides ; `tool_invocation` n'est vérifié qu'en
  forme (aucun journal d'appels) ; l'append-only n'est pas imposé directement par le
  lecteur ni l'écrivain (fonctions d'ajout et `assertAppendOnly`).

## Pistes non encore validées (ne pas commencer sans validation explicite)

- Brancher `@jarvis/inbox` (`fetchAndClassifyEmails` /
  `summarizeEmailsNeedingAttention`) dans `apps/api` via une route HTTP.
- Construire une interface conversationnelle / NLU pour piloter
  `recordFeedbackForEmail` / `applyUserRule` (actuellement des contrats
  fins, non branchés à du langage naturel).
- Ajouter un connecteur non-Gmail réel (Calendar, Drive, Slack, GitHub…)
  au-delà du `Connector Architecture Foundation` générique — aucun de ces
  connecteurs n'existe encore, même en ébauche.
- Brancher `AgentLoop` à un `ToolExecutor` réel pour une action `execute`
  (ex. `gmail.send` piloté par le LLM) — gated par
  `docs/adr/0006-confirmation-fingerprint-for-execute-actions.md`.
- Activer une `MemoryPromotionPolicy` dans `apps/api` ou `apps/desktop` —
  gated par `docs/adr/0007-memory-promotion-policy.md`
  (`createConservativeMemoryPromotionPolicy` de référence ;
  `createDefaultMemoryPromotionPolicy` réservée aux tests/usages
  explicitement maîtrisés).

- **Canal conversationnel WhatsApp — étude de faisabilité préalable** (idée à
  étudier, **non engagée** ; positionnement roadmap : `MASTER_ROADMAP.md` →
  LATER). Objectif utilisateur : envoyer une demande à Jarvis depuis
  WhatsApp et recevoir sa réponse dans la même conversation. Aucune réponse
  technique n'est présentée comme acquise : la faisabilité reste entièrement
  à vérifier auprès de la documentation officielle actuelle au moment de
  l'étude — aucune bibliothèque ni fournisseur n'est choisi ici.
  Questions ouvertes à trancher par l'étude :
  - Quelle voie d'intégration officielle répond au besoin ?
  - Peut-elle utiliser le compte personnel souhaité, ou exige-t-elle un
    numéro/compte distinct ?
  - Quelles contraintes de disponibilité, coût, confidentialité et
    hébergement ?
  - Comment présenter et recueillir une confirmation explicite liée à une
    action précise, cohérent avec le protocole de confirmation existant
    (`ConfirmationService`, `docs/adr/0006`, `docs/adr/0008`) ?
- **Canal conversationnel WhatsApp — MVP** (**conditionné aux résultats** de
  l'étude de faisabilité ci-dessus ; non engagé, aucune date). Périmètre
  envisagé :
  - réception d'un message de l'utilisateur autorisé ;
  - transmission au parcours conversationnel de Jarvis ;
  - réponse dans la même conversation WhatsApp ;
  - identification de l'utilisateur et refus des interlocuteurs non
    autorisés ;
  - conservation intégrale des règles de permissions et de confirmation
    existantes (`PermissionManager`/`ConfirmationService`) — un message
    entrant ne vaut en aucun cas autorisation générale ;
  - gestion minimale du contexte, des doublons et des erreurs.

  Hors périmètre initial, explicitement exclu :
  - lecture générale de l'historique WhatsApp ;
  - surveillance des conversations, groupes ou messages de tiers ;
  - envoi autonome à d'autres contacts ;
  - toute connexion effective, création de compte ou manipulation de
    secrets.

  _Note 2026-10-19 : des composants techniques ont été livrés depuis (canal simulé,
  réception durable SQLite, transport Graph inactif, mode réel opt-in borné à une
  tentative d'envoi, script de provisionnement des secrets — voir « Composants
  livrés depuis 2026-09-30 »). Cela ne clôt ni l'étude ni le MVP : ADR-0022/0023
  restent `Proposed`, et l'**activation reste reportée**, comme les tests payants.
  L'exclusion « manipulation de secrets » ci-dessus est le **périmètre historique**
  du MVP ; il a ensuite été étendu par autorisation pour implémenter le
  provisionnement et le mode opt-in. Cette extension ne vaut pas autorisation
  générale future. Serveur et tunnel ont été lancés puis arrêtés ; aucun échange
  réel n'est rapporté (rapport externe transmis par Alexandre, non archivé dans le
  dépôt) ; activité reportée par Alexandre._

- **Essais d'outils et de skills issus des veilles** : registre tenu dans la
  Roadmap outillage Notion (https://app.notion.com/p/3ebba52b3dae81118b91f7b97afc278c) — objectif,
  phase, protocole, coût, réussite, statut, source. Non dupliqué ici ; aucune
  entrée n'est adoptée ou planifiée du seul fait d'y figurer.

Ces pistes sont mentionnées dans `PROJECT_STATE.md` comme décisions
ouvertes ; aucune n'est priorisée par rapport aux autres à ce stade. La
surface CLI desktop post-M8 (ci-dessus) est déjà livrée et ne préempte
aucune de ces pistes.

Capacités de bibliothèque encore **non exposées** à l'utilisateur, à noter
pour mémoire (ne constituent pas des pistes priorisées) : les fonctions
`summarizeEmailsNeedingAttention` / `recordFeedbackForEmail` / `applyUserRule`
(`@jarvis/inbox`, M7) — testées, mais câblées dans aucune commande CLI
`apps/desktop` ni route `apps/api`. (Le Tool `gmail.prepare_reply` figurait
ici jusqu'à `753f4d0` ; il est désormais câblé via la commande
`prepare-reply`. `disconnectGmailAccount()` figurait ici jusqu'à `cc2e8a4` ;
elle est désormais câblée via la commande `disconnect`.)
