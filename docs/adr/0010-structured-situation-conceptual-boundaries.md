# ADR-0010: Frontières conceptuelles d'une future « Situation structurée »

Date: 2026-09-14
Status: Accepted

Cette ADR formalise des **frontières conceptuelles**, pas un contrat
technique. Elle n'introduit, ne renomme et ne modifie **aucun** code,
package, modèle TypeScript de production, ni migration. Elle fait suite à
deux études strictement read-only (audit de la vision produit, puis étude
architecturale ciblée d'`EmailAnalysis`/`MemoryCandidate`/ADR-0001 à 0005)
menées avant toute décision.

## Context

La vision produit de JARVIS dépasse le simple aller-retour question/réponse :
comprendre une situation en cours, en extraire les faits, les points
d'attention et les questions ouvertes, puis proposer des actions — avant de
les exécuter de façon sûre si l'utilisateur confirme. Le code existant ne
fournit aujourd'hui **aucune** représentation générique de cette notion de
« situation ».

Deux familles de structures existent, chacune insuffisante seule :

- **`EmailAnalysis`** (`packages/inbox/src/email-analysis.ts`) : le
  prototype structurel le plus proche — schéma fermé, distinction
  `stated`/`inferred`, jamais d'exception. Mais câblé en dur sur
  `EmailMessage` (prompt et parseur), scopé à **un seul document**, sans
  notion de plusieurs sources ni d'évolution dans le temps.
- **`MemoryCandidate`/`MemoryEntry`** (`packages/memory`) : mécanisme mature
  de mémoire **durable** sur l'utilisateur, avec provenance à 5 niveaux et
  gouvernance de promotion (`ADR-0007`). Pensé pour des faits atomiques
  retenus dans la durée — pas pour représenter une situation composite,
  ponctuelle, éventuellement jamais mémorisée.

`EmailReplyWorkflow` (`packages/inbox/src/email-reply-workflow.ts`) est
aujourd'hui le seul endroit du dépôt qui compose déjà, de bout en bout et
testé, compréhension → mémoire (lecture seule) → proposition — sans jamais
fusionner ces responsabilités. C'est le patron d'orchestration le plus
proche de la boucle produit visée, bien que fermé sur Gmail.

Il manque donc une représentation **passive** d'un contexte métier composite
— qui ne soit ni un document d'email, ni une mémoire durable, ni un
mécanisme d'exécution.

Cette décision ne fige **pas** un contrat technique définitif : les deux
études préalables ont établi qu'`EmailAnalysis` reste, à ce jour, le seul
cas d'usage réel prouvé. Généraliser sans un deuxième cas d'usage
non-email reviendrait à répéter l'erreur qu'`ADR-0006` a explicitement
évitée pour `ConfirmationVerifier` (généralisation prématurée, avant qu'un
second consommateur réel n'en démontre le besoin).

## Decision

### 1. Définition proposée

Une **Situation structurée** est une représentation **passive, bornée et
validée** d'un contexte métier à un instant donné, issue d'une ou
plusieurs sources, qui structure des faits, des contraintes, des
incertitudes, des points importants et des actions candidates — sans
jamais décider ni exécuter quoi que ce soit elle-même.

### 2. Ce qu'est une Situation structurée

- Un **objet de compréhension**, au même niveau conceptuel qu'`EmailAnalysis`
  aujourd'hui — pas un objet de mémoire, pas un objet d'exécution.
- Une **représentation d'un instantané** : elle décrit un contexte tel qu'il
  se présente à un moment donné, pas un flux continu ni un journal.
- **Potentiellement multi-source** : à la différence d'`EmailAnalysis`
  (un seul document), elle peut agréger plusieurs entrées (message, email,
  contexte mémoire déjà sélectionné, résultat d'un outil en lecture seule).
- **Structurée et validée** : même discipline que l'existant — schéma
  fermé, champs bornés, sortie de modèle jamais exploitée sans validation
  runtime, jamais d'exception (`status: 'ok'|'invalid'|'error'`, comme
  `EmailAnalysis`/`MemoryCandidate`/`EmailReplyDraft` aujourd'hui).
- **Passive** : elle décrit et peut suggérer — elle ne décide, n'autorise
  ni n'exécute jamais rien par elle-même.
- **Indépendante du canal autant que possible** : contrairement à
  `EmailAnalysis`, la forme visée ne doit pas dépendre structurellement
  d'`EmailMessage` ; à charge de chaque domaine (inbox, et plus tard
  d'autres) de fournir l'adaptateur qui l'alimente — dans le même esprit
  que `CommunicationStyleProvider` (`packages/memory/src/communication-profile.ts`),
  déjà pensé comme point d'extension neutre.

### 3. Ce qu'une Situation structurée n'est pas

- **Pas une `MemoryEntry`** : elle n'a pas vocation à être un fait retenu
  durablement sur l'utilisateur ; elle peut au mieux en *produire*, jamais
  s'y substituer.
- **Pas un `MemoryCandidate`** : `MemoryCandidate` a une forme et un
  vocabulaire (`kind: fact|preference|decision|learning`) calibrés pour la
  mémoire durable, pas pour les éléments d'une situation ponctuelle (point
  de vigilance, question ouverte, action candidate).
- **Pas un profil de communication** (`UserCommunicationProfile`) : le
  style est transversal aux situations, il ne fait pas partie d'une
  situation particulière.
- **Pas une session conversationnelle** : aucune notion de session ou de
  conversation multi-tours persistante n'existe aujourd'hui dans le dépôt
  (vérifié par recherche exhaustive lors de l'étude préalable) ; une
  Situation n'introduit pas cette notion par la bande.
- **Pas un outil (`Tool`)** : elle n'a ni `action: ActionLevel`, ni
  `execute()`, ni entrée dans un `ToolRegistry`.
- **Pas un mécanisme d'autorisation** : elle ne se substitue jamais à
  `PermissionManager.decide()`.
- **Pas un mécanisme d'exécution** : elle n'appelle jamais `ToolExecutor.run()`
  elle-même.
- **Pas un second système de confirmation** : elle ne réplique jamais
  `ConfirmationService` (fingerprint, ticket, TTL, usage unique) ; toute
  action qu'elle suggère qui deviendrait réellement exécutable doit
  transiter par le mécanisme existant, inchangé.
- **Pas une vérité durable automatiquement acceptée** : au même titre
  qu'un `MemoryCandidate` n'est jamais promu sans passer par une
  `MemoryPromotionPolicy`, aucun élément d'une Situation ne devient une
  mémoire durable sans repasser explicitement par ce mécanisme existant.

### 4. Frontières avec les composants existants

| Composant | Relation avec une future Situation |
|---|---|
| `EmailAnalysis` | Prototype structurel de référence pour le *pattern* (schéma fermé, `stated`/`inferred`, bornes) — reste **intact et inchangé** par cette décision ; n'est ni remplacé ni généralisé immédiatement. |
| `MemoryCandidate` / `MemoryEntry` | Restent le **seul** chemin vers une mémoire durable. Une Situation peut, en aval, produire des `MemoryCandidate` — elle ne les remplace jamais et ne contourne jamais `MemoryPromotionPolicy`/`MemoryPromoter`. |
| `MemorySelector` | Réutilisable **tel quel** comme mécanisme d'enrichissement en lecture seule d'une Situation par le contexte mémoire existant — même rôle que dans `EmailReplyWorkflow` aujourd'hui, sans modification de son contrat. |
| `CommunicationProfile` (`UserCommunicationProfile`) | Reste orthogonal : un profil de style transversal, jamais un champ d'une Situation. |
| `EmailReplyPlanner` | Exemple de **consommateur potentiel** d'une Situation généralisée (aujourd'hui, il consomme directement `EmailAnalysis`) — aucune modification décidée ici. |
| `AgentLoop` | **Non modifié par cette décision**, et non modifié tant qu'une future décision explicite ne le prévoit pas. Si un jour une Situation doit être injectée en contexte, ce serait une option facultative de même nature que `memoryExtractor` — hors périmètre de cet ADR. |
| `ToolExecutor` / `PermissionManager` / `ConfirmationService` | Restent les **seuls** points de décision et d'exécution (`ADR-0005`, `ADR-0006`). Une Situation ne les contourne, ne les duplique et ne les remplace jamais. |

### 5. Provenance

Cette décision ne tranche **pas** un système de provenance définitif pour
une Situation — la question reste ouverte, documentée ici pour mémoire :

- `EmailAnalysis` porte un vocabulaire **local et binaire**,
  `EmailClaimBasis = 'stated' | 'inferred'`, pertinent pour un **seul**
  document source : « littéralement présent » vs « déduit ».
- `Provenance` (`@jarvis/memory`) porte un vocabulaire à **5 niveaux**
  (`user_stated` > `user_confirmed` > `email_extracted` > `inferred` >
  `llm_proposed`), pensé pour tracer la fiabilité d'un **fait retenu
  durablement**, pas l'origine d'un élément au sein d'un instantané
  composite.
- Une Situation **multi-source** a vraisemblablement besoin d'un troisième
  vocabulaire — ou d'une extension de l'un des deux existants — capable de
  répondre à une question que ni l'un ni l'autre ne couvre aujourd'hui :
  *« de quelle source, parmi plusieurs, provient cet élément, et avec quel
  degré de certitude à l'intérieur de cette source ? »*
- Questions explicitement laissées ouvertes par cette décision : faut-il
  étendre `Provenance` de la mémoire pour couvrir ce besoin, garder
  `stated`/`inferred` comme système strictement local à chaque analyseur de
  source, ou introduire un troisième vocabulaire dédié aux situations
  composites ? Cette ADR ne répond à aucune de ces trois options.

### 6. Temporalité et persistance

Une Situation structurée est, à ce stade, considérée comme une
**représentation calculée ou reconstruite à un instant donné** — au même
titre qu'`EmailAnalysis` aujourd'hui, qui n'est jamais persistée et est
recalculée à chaque appel.

Cette décision **ne tranche pas** si une Situation doit un jour être
persistée (fichier local, à l'image de `FileMemoryStore` ; base de
données ; ou autre mécanisme). Une éventuelle persistance :

- devra faire l'objet d'une décision **séparée**, avec ses propres
  questions (versionnement, durée de vie, droit à l'oubli, chiffrement au
  repos le cas échéant) ;
- ne doit pas être présumée nécessaire par défaut — l'absence de
  persistance (recalcul à la demande) reste une option pleinement valide
  et est, pour l'instant, le comportement par défaut implicite de cette
  décision, par cohérence avec `EmailAnalysis`.

### 7. Actions candidates

Une Situation peut décrire des **actions candidates** — au même titre
qu'`EmailAnalysis` décrit déjà `pointsRequiringReply` ou qu'`EmailReplyDraft`
propose un brouillon jamais envoyé. Elle ne les exécute **jamais**
elle-même, et ne porte aucune autorité de décision sur elles.

Toute action candidate qui doit devenir réellement exécutable est
transformée, par une couche séparée, en une **demande d'action distincte**
qui repasse intégralement par les mécanismes de sécurité déjà actés :
`PermissionManager.decide()`, puis, pour toute action `execute`, la
confirmation fingerprintée d'`ADR-0006` via `ConfirmationService`. Une
Situation ne fournit jamais elle-même une preuve de confirmation, et
aucune action qu'elle décrit ne doit pouvoir être interprétée comme
pré-autorisée du seul fait d'avoir été identifiée par elle.

### 8. Mémoire

Une Situation peut, en aval de son analyse, **produire** des
`MemoryCandidate` — exactement comme `AgentLoop` en extrait déjà via un
`MemoryExtractor` après un tour de conversation. Elle ne **remplace** ni
`MemoryCandidate`, ni `MemoryPromotionPolicy`, ni `MemoryPromoter`.

Le seul chemin vers une mémoire durable reste, sans exception :

```
MemoryCandidate → MemoryPromotionPolicy.decide() → MemoryPromoter.promote() → MemoryStore
```

Une Situation ne doit jamais introduire un second mécanisme de promotion
parallèle, même partiel, même limité à un sous-ensemble de cas.

### 9. Stratégie de validation avant tout contrat technique

Conformément à la discipline déjà appliquée par `ADR-0006` pour
`ConfirmationVerifier` (refus de généraliser avant un deuxième cas d'usage
réel), cette décision retient la stratégie suivante :

1. **`EmailAnalysis` reste intact** dans l'immédiat — aucune extraction,
   aucun renommage, aucune modification de son schéma actuel n'est décidée
   ici.
2. **Aucune abstraction générique complète n'est créée immédiatement.**
   Cette ADR fixe des frontières conceptuelles, pas un package, pas une
   interface TypeScript de production.
3. **Un deuxième cas d'usage non-email doit être identifié** avant toute
   tentative de généralisation du pattern d'`EmailAnalysis`. Sans lui,
   toute forme technique proposée resterait une supposition sur des
   besoins non encore observés.
4. **Ce deuxième cas d'usage servira à valider les frontières** décrites
   ci-dessus (sections 2 à 8) avant qu'un contrat technique ne soit figé
   par une future ADR.

## Consequences

**Positives** : fixe un vocabulaire et des frontières partagées avant tout
code, évitant qu'une future implémentation ne redécouvre par erreur les
mêmes questions que celles déjà tranchées pour la mémoire et la
confirmation (`ADR-0005`, `ADR-0006`, `ADR-0007`). Réduit le risque qu'une
future « Situation » duplique silencieusement `MemoryCandidate` ou
réintroduise un mécanisme de confirmation parallèle. Garde `EmailAnalysis`
et `EmailReplyWorkflow` totalement stables : aucune régression possible
puisqu'aucun code n'est touché.

**Négatives** : ne fournit encore aucune capacité utilisateur nouvelle —
c'est un investissement en clarté conceptuelle, pas en fonctionnalité
livrée. Une future implémentation devra composer avec des frontières déjà
contraignantes (jamais de second mécanisme de confirmation, jamais de
contournement de `MemoryPromotionPolicy`) plutôt que de partir d'une page
blanche.

**Risques de duplication identifiés** :
- entre un futur vocabulaire de provenance multi-source et `Provenance`
  (mémoire) ou `EmailClaimBasis` (email) si les trois ne sont pas
  clairement articulés dès la prochaine décision ;
- entre une éventuelle catégorisation des éléments d'une Situation et
  `MemoryKind`, si l'un est confondu avec l'autre par simplicité plutôt que
  par nécessité démontrée.

**Risques de sur-abstraction** : introduire un contrat technique générique
avant le deuxième cas d'usage requis par la section 9 produirait une
abstraction fondée sur un seul exemple (`EmailAnalysis`) — insuffisant pour
distinguer ce qui est réellement générique de ce qui est accidentellement
spécifique à l'email. Cette ADR retarde délibérément cette étape.

**Impacts potentiels sur les workspaces** (aucun n'est décidé ici, tous
restent à trancher par une ADR ultérieure) :
- `packages/memory` : point d'ancrage probable pour un futur vocabulaire de
  provenance partagé, ou pour la production de `MemoryCandidate` en aval
  d'une Situation.
- `packages/inbox` : détenteur actuel du seul prototype réel
  (`EmailAnalysis`), probable point de départ de toute extraction future.
- `packages/core` : aucun changement anticipé à ce stade ; `AgentLoop`
  reste hors périmètre de cette décision.
- `apps/api`, `apps/desktop` : aucun impact avant qu'une décision
  d'exposition ne soit prise séparément.

## Alternatives Considered

- **Créer immédiatement un package `@jarvis/situation` avec un contrat
  TypeScript complet** — rejeté : reviendrait à généraliser sur la base
  d'un seul cas d'usage réel (`EmailAnalysis`), contraire à la discipline
  déjà retenue par `ADR-0006`.
- **Étendre directement `EmailAnalysis` pour le rendre multi-canal** —
  rejeté pour l'instant : modifierait un composant existant, stable et
  testé, avant qu'un deuxième cas d'usage ne confirme quelles parties de
  son schéma sont réellement génériques.
- **Ne rien documenter et attendre le deuxième cas d'usage avant toute
  décision** — rejeté : sans frontières conceptuelles actées maintenant,
  une implémentation ultérieure risquerait de redécouvrir plus tard, sous
  pression, les mêmes arbitrages déjà résolus ici (relation avec la
  mémoire, non-exécution, non-substitution à la confirmation).

## Implementation Scope

**Créé par cette décision** : uniquement ce document,
`docs/adr/0010-structured-situation-conceptual-boundaries.md`. Aucun code
modifié, aucun package créé, aucun modèle TypeScript de production ajouté,
aucune migration.

**Fichiers que cette décision ne doit pas faire modifier** :
`packages/core/src/agent-loop.ts` et tout autre fichier de `packages/core` ;
`packages/inbox/src/email-analysis.ts`, `email-reply-planner.ts`,
`email-reply-workflow.ts` ; tout fichier de `packages/memory` ; tout fichier
de `apps/api` et `apps/desktop`.

## Questions différées

Ces questions sont explicitement **hors périmètre** de cette décision et
devront faire l'objet d'une ou plusieurs ADR ultérieures, après
identification du deuxième cas d'usage requis par la section 9 :

1. Package propriétaire : nouveau package feuille dédié, extension de
   `@jarvis/memory`, ou extraction depuis `@jarvis/inbox` ?
2. Contrat TypeScript définitif (champs exacts, noms, structure des listes
   d'éléments).
3. Provenance exacte : extension de `Provenance`, conservation d'un
   vocabulaire `stated`/`inferred` local par source, ou troisième
   vocabulaire dédié au multi-source.
4. Persistance : recalcul systématique à la demande, ou stockage durable
   avec ses propres questions de versionnement et de cycle de vie.
5. Versionnement du schéma d'une Situation dans le temps, si la
   persistance est un jour retenue.
6. Mécanisme de déclenchement : option d'`AgentLoop` (à l'image de
   `memoryExtractor`), orchestrateur applicatif dédié par domaine (à
   l'image d'`EmailReplyWorkflow`), ou autre.
7. Articulation précise avec `AgentLoop` — si et comment une Situation
   serait un jour injectée en contexte, sans reproduire les compromis déjà
   actés pour la mémoire (`ADR-0007`).
8. Identification concrète du deuxième cas d'usage non-email qui
   validera (ou invalidera) les frontières posées ici.
