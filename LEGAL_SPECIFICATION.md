# LEGAL_SPECIFICATION — Jalon LEGAL-00 (Spécification canonique)

> Ce document est la référence normative du moteur juridique JARVIS. Toute
> implémentation ultérieure (LEGAL-01 et suivants) doit s'y conformer ou la
> faire évoluer explicitement — jamais s'en écarter silencieusement.
>
> Statut : **spécification fondatrice** (LEGAL-00), dérivée de l'audit
> `AUDIT_STATE.md`. Elle décrit l'**architecture cible / la vision** du moteur
> juridique. À sa rédaction, aucun composant juridique n'existait (voir
> `AUDIT_STATE.md §6`, état historique) ; **depuis, LEGAL-01 → LegalCase v3 en
> ont implémenté une partie** — voir §7 « État d'implémentation » pour ce qui existe
> réellement et ses limites. Les §1 à §6 restent la référence normative et ne
> sont pas réécrits pour correspondre à l'implémentation ; seules deux **notes
> d'évolution** (§2, §4) précisent, sans modifier la règle, comment le modèle
> **LegalCase v3** représente l'état des faits (voir §7.4).

## 1. Périmètre & juridiction

### 1.1 Cible géographique

- **France** est la juridiction cible prioritaire et unique pour la v1.
  Aucune autre juridiction n'est prise en charge, même partiellement — pas
  de généralisation prématurée « multi-pays » tant qu'un seul pays n'est pas
  couvert correctement (YAGNI).
- Le champ `jurisdiction` du modèle de données (LEGAL-01) est néanmoins
  typé comme littéral extensible (`'FR'` seul membre v1) plutôt que comme
  `string` libre, pour rendre une extension future explicite et vérifiée par
  le compilateur plutôt que silencieuse.

### 1.2 Source institutionnelle

- **Légifrance** (legifrance.gouv.fr) est la source primaire et de
  référence pour tout texte de loi, code, jurisprudence ou décret cités par
  le moteur. Toute affirmation juridique doit être traçable jusqu'à une
  référence Légifrance (ou un équivalent institutionnel explicite —
  service-public.fr, BOFiP pour le fiscal, Conseil d'État/Cour de
  cassation pour la jurisprudence) — jamais une source secondaire non
  vérifiée (blog, forum, résumé tiers) comme fondement d'une conclusion.
- Une **source** (voir modèle `LegalSource` en LEGAL-01) porte
  obligatoirement une date de consultation/version, car le droit change :
  une citation sans date de fraîcheur est considérée non fiable par
  construction.

### 1.3 Domaines de droit (v1)

Trois domaines seulement en v1, correspondant aux besoins réels d'un⋅e
particulier ou d'une TPE/PME, sans extension spéculative :

1. **Contrats** (rédaction, relecture, clauses, résiliation).
2. **Droit du travail** (côté employeur TPE/PME et côté salarié — contrats
   de travail, rupture, obligations).
3. **Droit commercial TPE/PME** (statuts, CGV, relations
   fournisseurs/clients, recouvrement).

Tout sujet hors de ces trois domaines (ex. droit pénal, droit de la famille,
droit international privé) est **hors périmètre v1** et doit déclencher la
règle d'escalade (§4) plutôt qu'une tentative de réponse.

## 2. Workflow à 7 étapes

Le moteur traite toute affaire (`LegalCase`) selon un pipeline strictement
séquentiel à 7 étapes. Une étape ne peut pas être court-circuitée ; l'état
courant d'une affaire porte toujours son étape active (voir `LegalCase.status`
en LEGAL-01).

```
READ → RESEARCH → ANALYZE → VERIFY → PREPARE → CONFIRMATION → EXECUTE
```

| # | Étape | Objectif | Sortie |
|---|---|---|---|
| 1 | **READ** | Lire/ingérer les faits, documents et pièces fournis par l'utilisateur. Aucune interprétation juridique à ce stade — uniquement extraction factuelle. | `facts` (établis/allégués), `documents`, `evidence` peuplés |
| 2 | **RESEARCH** | Rechercher les textes, jurisprudences et sources applicables (Légifrance en priorité — §1.2). | `sources`, `research` peuplés |
| 3 | **ANALYZE** | Construire les arguments et contre-arguments à partir des faits et des sources ; identifier les questions ouvertes. | `arguments`, `counterArguments`, `questions` peuplés |
| 4 | **VERIFY** | Vérifier la cohérence et la fraîcheur des sources, détecter les contradictions dans les faits, appliquer la règle de doute (§4). | `analysis`, `conclusions` (avec niveau de confiance) |
| 5 | **PREPARE** | Rédiger tout document, réponse ou recommandation destinée à l'utilisateur. **Étape terminale par défaut** — voir §3. | `actions` de type `PREPARE` |
| 6 | **CONFIRMATION** | Présenter explicitement à l'utilisateur ce qui est sur le point d'être exécuté et obtenir une confirmation non ambiguë. | confirmation horodatée, liée à l'action précise (même mécanisme d'empreinte que `ConfirmationService`, voir `AUDIT_STATE.md §2`) |
| 7 | **EXECUTE** | Exécuter l'action confirmée (envoi, dépôt, signature déléguée, etc.). Ne s'exécute **jamais** sans une `CONFIRMATION` valide et non expirée pour cette action précise. | `actions` de type `EXECUTE`, horodatées |

> **Note d'évolution (LegalCase v3, 2026-09-25).** À l'étape READ, « `facts`
> (établis/allégués) » désigne désormais une liste **plate** de `LegalFact`
> immuables, chacun avec sa **provenance** et sa **temporalité**. Le caractère
> établi / allégué / contradictoire / inconnu n'est **plus stocké** : il est
> **dérivé** (`deriveFactEpistemicState`, §7.4). La règle de l'étape (extraction
> factuelle, aucune interprétation juridique) est inchangée.

## 3. Règles de gouvernance

- **Toute analyse ou rédaction de document reste strictement en `PREPARE`.**
  Produire un contrat, une lettre de mise en demeure, une réponse à un
  courrier, une analyse de risque : tout ceci est une action `PREPARE`, non
  `EXECUTE`, quel que soit le degré de finition apparent du document produit.
- **Le passage en `EXECUTE` est soumis à une confirmation utilisateur
  explicite**, obtenue à l'étape `CONFIRMATION`, et qui doit :
  - porter sur l'action précise à exécuter (pas une confirmation générique
    « oui, vas-y ») ;
  - être vérifiable/non-rejouable (même principe d'empreinte que
    `ConfirmationService` — un payload modifié après confirmation invalide
    la confirmation) ;
  - ne jamais être présumée à partir d'un silence, d'une action passée
    similaire, ou d'une configuration par défaut.
- Aucune action `EXECUTE` n'est déclenchée par le moteur de lui-même
  (pas d'automatisation « si confiance > X alors exécute »). L'humain reste
  systématiquement le déclencheur de `EXECUTE`.

## 4. Règles d'incertitude & escalade

- **Règle de doute** : si, pour une conclusion donnée, une source
  Légifrance pertinente est absente, non retrouvée, ou dont la fraîcheur ne
  peut être établie (texte potentiellement abrogé/modifié, absence de date
  de consultation fiable), le moteur :
  1. ne formule **aucune conclusion affirmative** sur le point concerné ;
  2. classe la question comme `unknown` dans `facts`/`questions` plutôt que
     de l'omettre silencieusement (*note LegalCase v3 : pour un fait, `unknown`
     est un état **dérivé** — aucune base référentielle substantielle — voir §7.4 ;
     la règle de doute elle-même est inchangée et non implémentée, ANALYZE/VERIFY
     n'existant pas*) ;
  3. le formule explicitement à l'utilisateur comme incertitude, jamais
     comme fait établi.
- **Obligation de réponse documentaire** : toute conclusion doit être
  accompagnée de sa ou ses sources (`sources`), de sorte que l'utilisateur
  puisse vérifier indépendamment. Une conclusion sans source associée est
  un état invalide du modèle, pas une simplification acceptable.
- **Réorientation vers un professionnel humain** : le moteur doit
  explicitement recommander la consultation d'un avocat/juriste qualifié
  dès que :
  - le sujet sort du périmètre v1 (§1.3) ;
  - un contentieux est déjà engagé ou imminent (procédure judiciaire en
    cours, délai de forclusion proche) ;
  - l'enjeu financier ou humain est significatif (ex. licenciement,
    rupture de contrat commercial structurant) ;
  - la règle de doute (ci-dessus) s'applique de façon répétée sur les
    points déterminants de l'affaire.
  Cette réorientation n'est jamais un aveu d'échec du moteur — c'est un
  comportement attendu et correct dans ces situations.

## 5. Sécurité & isolation

- **Étanchéité totale entre General Memory et Legal Case Memory.** La
  mémoire générale de JARVIS (préférences utilisateur, historique de
  communication — voir `@jarvis/memory` dans `AUDIT_STATE.md`) et la
  mémoire propre à un dossier juridique (`LegalCase` et son contenu) sont
  des espaces de stockage **distincts et non partagés** :
  - aucune lecture croisée automatique (un `MemorySelector` général ne doit
    jamais retourner du contenu de `LegalCase`, et réciproquement) ;
  - aucune promotion automatique d'un fait de dossier juridique vers la
    mémoire générale (le pipeline `MemoryPromoter` existant reste hors
    périmètre des `LegalCase`) ;
  - toute exception à cette étanchéité doit être un acte explicite de
    l'utilisateur, jamais un comportement par défaut du moteur.
- **Chiffrement des dossiers** : toute persistance sur disque d'un
  `LegalCase` (documents, pièces, analyse) doit être chiffrée au repos. Le
  mécanisme concret de chiffrement est un détail d'implémentation de
  LEGAL-02+ (hors périmètre du modèle de données LEGAL-01), mais le modèle
  ne doit jamais supposer un stockage en clair.
- **Absence de secrets dans les logs** : aucun contenu de dossier
  (faits, documents, analyse) ni aucun identifiant permettant de
  ré-identifier une affaire ne doit apparaître dans un journal
  applicatif — même convention que `SecretStore` existant
  (`AUDIT_STATE.md §2`) : un secret/donnée sensible lu ne doit jamais être
  transmis au LLM sans contrôle, journalisé, ou renvoyé tel quel dans une
  réponse d'erreur.

## 6. Non-objectifs explicites (v1)

Pour éviter toute dérive de périmètre lors de l'implémentation :

- Pas de génération automatique de conclusions juridiques opposables sans
  intervention humaine.
- Pas de dépôt/soumission automatique auprès d'une juridiction ou d'une
  administration.
- Pas de gestion multi-juridiction, multi-langue, ou de droit autre que
  français en v1.
- Pas de facturation/gestion de mandat d'avocat — JARVIS ne se substitue
  jamais à un professionnel du droit, il prépare et documente.

## 7. État d'implémentation (mise à jour 2026-09-26)

Ce paragraphe distingue explicitement la **vision** (§1 à §6 ci-dessus), les
**composants actuellement implémentés** et les **limites actuelles**. Il ne
modifie aucune règle normative. Détail : `PROJECT_STATE.md` → « Domaine
juridique » ; décisions : `docs/adr/0011` à `0021` (ADR-0018 VersionResolver,
ADR-0019 version résolue, ADR-0020 Research → Case, ADR-0021 Content Exposure) et,
pour LegalCase v3, les décisions d'architecture Q1–Q10, B1–B4 et U1 (**CLOSED**,
résumées au §7.4 ; aucun ADR dédié n'a été créé).

**Versionnement (2026-09-26).** Le domaine légal est **versionné**. `legal-core`,
`runTracked` et cette spécification sont dans `85e7e6e` (présent sur `origin/main`) ;
`legifrance-client`, le connecteur Légifrance, `legal-research` et les règles ESLint
sont dans `979fa19`, les ADR 0011 à 0021 dans `8407ac0`, plus un correctif CI dans
`e9b3357` ; ces commits sont **publiés sur `origin/main`** (2026-09-26).
« Implémenté » signifie implémenté, versionné et testé : 2193 tests / 125 fichiers verts, `eslint` et `tsc` propres sur un clone propre
de `HEAD` à la baseline (2196 dans l'arbre de travail, +3 tests d'un POC non commité) ; **rien n'est
validé en production**. `AUDIT_STATE.md` reste non suivi. **LEGAL-04.1** est livrée dans un
commit dédié (`feat(legal): add legal case engine`, état de publication : voir Git) ;
vérifiée par exécution avant ce commit : 2481 tests / 135 fichiers dans l'arbre de travail
(2478 sans les 3 tests du POC non commité), `eslint` et `tsc` propres.

**Blocs CLOSED** : LEGAL-00 → LEGAL-03B ; VersionResolver ; Version Resolution
Integration ; Resolved Version Retrieval ; Research → Case ; Content Exposure ;
**LegalCase v3 (Fact / Provenance / Evidence / Temporal)** ; `ToolExecutor.runTracked` ;
Post-Implementation Review (**PASS WITH ATTENTION**) ; **LEGAL-04.0** (baseline Git et
décisions d'architecture D1–D10, voir `PROJECT_STATE.md`) ; **LEGAL-04.1** (Fact & Case
Engine, premier jalon : `@jarvis/legal-case-engine`, voir §7.2). Suite du Fact & Case
Engine : non planifiée (aucun sous-ticket documenté).

### 7.1 Architecture cible (vision)

Workflow à 7 étapes (§2) : `READ → RESEARCH → ANALYZE → VERIFY → PREPARE →
CONFIRMATION → EXECUTE`. Pour l'étape RESEARCH, la chaîne cible est :

```
LegalQuestion → Query planning → SearchQuery → SearchPort → SearchResultPage
→ SearchReference → déduplication / budget → ResearchCandidate → RetrievalPort
→ RetrievalResult → VersionResolver → LegalResearchItem / LegalCitation
```

### 7.2 Composants implémentés

- **Modèle** (`@jarvis/legal-core`, LEGAL-01/02A, ADR-0020, **LegalCase v3**) :
  `LegalCase` **v3** (format courant, voir §7.4) et ses entités, `LegalSource`
  versionnée et temporelle, `LegalCitation` (avec `contentHash?` et `eligibility?`),
  chaîne d'audit, validation runtime stricte. La règle « toute conclusion cite une
  source » (§4) est appliquée par la validation. `attachSourcesAndCitations`
  rattache sources et citations à un dossier (pur, idempotent, revalidé).
  **Aucun contenu textuel** dans `LegalSource` ni `LegalCitation`. Le format
  **v2** est **legacy** (lecteur et validateur figés, lecture seule).
- **Accès Légifrance** (LEGAL-02B) : client PISTE, connecteur en lecture seule
  (`legifrance.ping`, `legifrance.get_article`, `legifrance.search`),
  `LegifranceSourceProvider` (récupération d'un article → `LegalSource`).
- **Recherche** (LEGAL-03A/03B, `@jarvis/legal-research`) et blocs suivants :
  implémenté aujourd'hui :

```
SearchQuery (à la main) → SearchPort → SearchResultPage → SearchReference
→ déduplication / budget → ResearchCandidate
→ RetrievalPort → RetrievalResult (+ contenu transitoire vérifié)
→ VersionHistory → VersionResolver → versionResolution
→ [un saut] retrieveVersion → VersionTargetResult (+ contenu) → resolvedRetrieval
→ ResearchResult
→ projectCitations → LegalSource + LegalCitation → attachSourcesAndCitations → LegalCase (v3)
```

  - **Résolution temporelle** (ADR-0018) : `VersionResolver` pur ; `none_applicable`
    seulement sur un historique déclaré `complete`, ce que le moteur n'établit
    jamais ; un `resolved` sur historique `unknown` est « au mieux ».
  - **Version résolue** (ADR-0019) : `resolvedRetrieval` (`initial`, `shared`,
    `retrieved`), un seul saut, même budget, identité contrôlée.
  - **Research → Case** (ADR-0020) : une `LegalCitation` de niveau source = source
    **retrouvée et applicable** (éligible) ; l'incertitude d'historique est
    conservée ; **pas** de pertinence, pas de preuve d'usage.
  - **Contenu** (ADR-0021) : `texte` transitoire, vérifié (SHA-256/UTF-8 sans
    normalisation), opaque et absent de toute sérialisation ; aucun appel réseau
    de plus.

- **Moteur de faits et de dossiers** (LEGAL-04.1, `@jarvis/legal-case-engine`, dépend
  uniquement de `@jarvis/legal-core`, lui-même inchangé) : opérations pures et atomiques
  sur un `LegalCase` v3 — `addOpenQuestion` (question `open`, statuts existants jamais
  modifiés), `recordReportedFact` (fait rapporté par un humain + pièce non documentaire +
  liens `fact_question`, atomiques ; état dérivé `alleged`, R1 à R7 inchangées),
  `findEquivalentFacts` (consultatif, critère `structural_text_v1`, aucune fusion). Contexte
  d'acteur et horloge **injectés** par l'appelant ; contrôles chronologiques appliqués à
  l'écriture par le moteur (validateur v3 non durci) ; un `createdAt` qui n'est pas un
  instant est refusé sans conversion ; aucune restriction READ-only. Frontières ESLint
  volontairement strictes pour ce package (aucun chargement dynamique). **Ne réalise pas** :
  persistance, validation humaine, correction de faits, projection des faits écartés,
  propositions LLM, exécution d'actions.

### 7.3 Limites actuelles (non implémenté)

- **Production de faits (Fact & Case Engine)** : LEGAL-04.1 n'enregistre que des faits
  **rapportés par un humain** ; aucun extracteur de faits, aucune proposition LLM, ni
  validation humaine, ni correction, ni projection des faits écartés, ni persistance ;
  query planning ; production de
  `LegalResearchItem` ; production de `LegalArgument` / `LegalAnalysisNote` /
  `LegalConclusion` (types et validation existent) ; analyse juridique
  (ANALYZE) ; **pertinence** et **« evidence-used »** (aucun marqueur, aucun
  producteur) ; persistance de la provenance de recherche ; **persistance,
  chiffrement, rechargement ou artefact du contenu** ; `texteHtml` ; **Case Store et migration v2 → v3** (aucune conversion implicite
  n'existe).
- Workflow : les 7 étapes existent comme énumération ; **aucune transition n'est
  appliquée** (la validation vérifie seulement l'appartenance du statut à la
  liste), et seule l'étape RESEARCH est implémentée. ANALYZE, VERIFY, PREPARE,
  CONFIRMATION et EXECUTE ne sont pas implémentées pour le domaine juridique.
- Sécurité (§5) : **aucun chiffrement au repos** n'est implémenté (le format de
  fichier est du JSON en clair) ; aucune application ne consomme les packages
  légaux ; pas de composition root ni de politique de permissions de production
  pour les Tools `legifrance.*` ; aucune intégration LLM dans le domaine juridique (`@jarvis/llm` n'expose ni
  fournisseur, ni modèle, ni identifiant d'appel ; aucun producteur d'`actorId` /
  `interactionId`).
- Sources : un seul fond Légifrance est supporté (`CODE_DATE`, à une date de
  version donnée) ; aucun autre fond ni autre fournisseur (multi-source non
  implémenté) ; `reliability` Sandbox/production non décidée.
- Ces limites, avec les points ouverts et les points d'attention des derniers
  blocs (garantie de `RetrievedContent` au typage seulement, lien contenu ↔ source,
  hash, rétention transitoire, articles à texte vide…), sont tenues à jour dans
  `PROJECT_STATE.md` et `MASTER_BACKLOG.md`.

### 7.4 Modèle LegalCase v3 (format courant — implémenté, CLOSED)

`@jarvis/legal-core` porte le format **v3** ; la v2 est **legacy**.

**Formats.** **V2** : format legacy, `parseLegacyLegalCaseFile` + `validateLegalCaseV2`
(figés, lecture seule, aucun écrivain v2). **V3** : format courant, `parseLegalCaseFile`
(lecteur strict), `validateLegalCaseV3`, `serializeLegalCaseFile` (écrivain strict,
valide avant d'écrire). Un fichier v2 est refusé par le lecteur strict
(`legacy_version`), un fichier v3 par le lecteur legacy. **Aucune migration
implicite** : une conversion inventerait la provenance, la temporalité et l'état des
faits.

**Faits.** `LegalFact` est **immuable** (`id`, `statement`, `temporal`, `provenance`,
`recordedAt`), à clés fermées, **sans état stocké**. Une correction crée un nouveau
fait et une relation `fact_correction` (humain ou déterministe).

**Provenance.** `origin` ∈ `human` / `tool` / `deterministic` / `llm` ; **`document`
n'est pas un origin**. Les données utilisées pour produire un fait sont des
`inputReferences` : `evidence`, `document`, `tool_invocation`, `source`, `fact`
(**substantielles**, `fact` inconditionnellement) et `question` (**non
substantielle**). `accountId` n'existe que si l'outil utilise un compte. Le
producteur d'un identifiant d'invocation d'outil est `ToolExecutor.runTracked`
(`{ invocationId, result }`, ajout non invasif — pas une refonte de `ToolExecutor`).

**Temporalité.** `point` / `interval` / `unknown` ; précision `day` / `month` / `year`
par borne ; intervalles fermés ; jamais convertie (`2025` ≠ `2025-01-01`) ; distincte
d'`asOf`, de `consultedAt`, de `effectiveFrom`/`effectiveTo`, de `LegalDeadline.dueAt`.

**Documents et pièces.** `LegalDocument` (`provided` / `drafted`) ; `LegalEvidence`
documentaire (document + localisation) ou non documentaire. Chaîne
Document → Evidence → Fact par `inputReferences` (« produit à partir de », pas
« prouve » : la force probante appartient à ANALYZE).

**Relations et validations.** `fact_question` (N:N, jamais `llm`) détermine la
pertinence d'un conflit pour une question ; `LegalFactValidation` (`confirm` /
`reject`, humaine, immuable, append-only, épinglée sur le fait).

**Conflits et résolutions.** Un conflit n'a **pas** de `questionId`. Les propositions
d'un LLM sont séparées et **sans effet** sur l'état. Résolutions `retain` /
`discard` / `retain_multiple`, une seule effective par conflit ; les résolutions
automatiques n'utilisent que des règles déterministes whitelistées et versionnées
(aucune règle concrète n'est encore définie) ; une résolution déterministe ne remplace
pas une résolution humaine.

**État épistémique dérivé** — `deriveFactEpistemicState(fact, question, ctx)`, pure,
ordre strict :

| Règle | Condition | État |
|---|---|---|
| R1 | conflit non résolu pertinent pour la question | `contradictory` |
| R2 | résolution effective `retain` | `established` |
| R3 | fait corrigé | `alleged` |
| R4 | dernière validation effective `reject` | `alleged` |
| R5 | dernière validation effective `confirm` | `established` |
| R6 | au moins une `inputReference` substantielle | `alleged` |
| R7 | aucune `inputReference` substantielle | `unknown` |

**Intégrité.** Empreintes (canonicalisation versionnée, SHA-256) stockées dans l'objet
qui référence ; elles ne prouvent pas l'intégrité d'un fichier externe. Append-only
ciblé (`assertAppendOnly`, `appendToLegalCase`).

**Attentions non bloquantes (Post-Implementation Review : PASS WITH ATTENTION).**
A1 : une `inputReference` directe `document` peut référencer un document `drafted`
(seule la pièce le bloque) ; A2 : deux comportements sondés sans test dédié
(référence `question` sans `fact_question` ; `discard` + `confirm` → `established`) ;
A3 : couverture dédiée du legacy v2 limitée ; A4 : entités v2 conservées à clés
ouvertes, dates du dossier faiblement validées, `tool_invocation` vérifié en forme,
append-only non imposé par le lecteur/écrivain.
