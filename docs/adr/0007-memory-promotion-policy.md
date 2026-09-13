# ADR-0007: Promotion mémoire conservatrice par défaut

Date: 2026-09-13
Status: Accepted

## Context

`@jarvis/memory` fournit deux `MemoryPromotionPolicy` (`memory-promotion.ts`) :
`createDefaultMemoryPromotionPolicy`, qui accepte automatiquement tout
`MemoryCandidate` structurellement valide ne ressemblant ni à une
instruction ni à un contenu sensible, et
`createConservativeMemoryPromotionPolicy`, qui applique le même filtre mais
ne promeut jamais automatiquement un candidat propre — elle exige toujours
une confirmation utilisateur explicite (`MemoryPromoter.promote` renvoie
alors un `PendingMemoryConfirmation`, jamais constructible depuis
l'extérieur du package). Rien dans le code ni dans un ADR ne tranchait
jusqu'ici laquelle de ces deux policies doit être utilisée en production.

**Aucune promotion mémoire n'est actuellement activée en production.**
`apps/api/src/server.ts` construit `AgentLoop` sans aucune option mémoire ;
`apps/desktop` n'utilise jamais `AgentLoop`. Le seul chemin qui invoque
`MemoryPromoter` est `AgentLoop.promoteMemoryCandidates()`
(`packages/core/src/agent-loop.ts`), elle-même inactive tant qu'aucun
appelant ne fournit `memoryPromoter` (ou `memory` + une policy). Cette
décision est donc prise **avant** tout branchement réel, dans le même
esprit que l'ADR-0006 pour la confirmation des actions `execute`.

Le code offre déjà des garanties structurelles fortes indépendantes de la
policy choisie : une sortie LLM ne peut jamais se déclarer `user_stated`
(verrouillé au niveau du parseur d'extraction, pas seulement au niveau du
prompt) ; la hiérarchie de provenance (`user_stated` > `user_confirmed` >
`email_extracted` > `inferred` > `llm_proposed`) est validée et ne peut pas
être falsifiée par un candidat entrant ; le filtrage instruction-like et
sensible (regex) est un premier filet documenté comme non exhaustif.
`packages/memory` reste une feuille sans dépendance (cf. `ADR-0001` sur les
frontières de workspace) ; cette décision ne les modifie pas. `ADR-0005` a
établi qu'une action `execute` exige toujours une confirmation utilisateur
irremplaçable par une politique de permission — cette décision applique un
principe analogue à la promotion mémoire, sans dupliquer ce mécanisme : la
mémoire n'a pas de notion d'« action » ni de `PermissionManager`.

Limites connues, non résolues par cette décision : le filtre de contenu
sensible ne couvre que des formes credential-shaped (clé API, jeton, mot de
passe) et ne détecte pas des données personnelles, financières ou médicales
formulées autrement ; le système ne détecte aucune contradiction entre une
mémoire existante et un nouveau candidat (choix délibéré documenté dans
`memory-store.ts`) ; `MemoryStore.supersede()` ne compare aujourd'hui jamais
la provenance de l'entrée remplacée à celle de la remplaçante.

## Decision

1. `createConservativeMemoryPromotionPolicy` est la policy de référence en
   production, pour toutes les applications (`apps/api`, `apps/desktop`, et
   toute application future) et tous les modes d'exécution, y compris
   autonome.
2. Toute proposition de provenance `llm_proposed` nécessite une confirmation
   humaine explicite avant de devenir une `MemoryEntry` durable — aucune
   promotion automatique d'une proposition du LLM.
3. En l'absence de canal de confirmation utilisateur disponible (ex. un mode
   autonome ou une application sans interface de confirmation câblée), une
   proposition non confirmée est refusée par défaut et ne doit jamais être
   promue automatiquement, même après un délai : rester `pending`
   indéfiniment est le comportement sûr, une promotion silencieuse par
   défaut d'absence de réponse ne l'est pas et n'est jamais autorisée par
   cette décision.
4. `createDefaultMemoryPromotionPolicy` reste disponible dans le code, mais
   uniquement pour les tests ou un usage explicitement maîtrisé et
   documenté par l'intégrateur — elle ne doit jamais être le choix implicite
   d'une nouvelle intégration.
5. Une promotion automatique restreinte à des catégories de faible risque
   est reportée à un chantier ultérieur explicite, conditionné à :
   l'extension du filtrage de sensibilité au-delà des formes
   credential-shaped ; une catégorisation par niveau de risque (inexistante
   aujourd'hui dans `MemoryKind`) ; des tests dédiés à cette catégorisation ;
   et le garde-fou du point 6 sur `supersede()`. Cette décision n'introduit
   aucune de ces briques — elle en fait des conditions préalables.
6. `MemoryStore.supersede()` ne doit jamais dégrader silencieusement la
   provenance d'une mémoire existante : remplacer une entrée par une autre
   de provenance strictement moins fiable doit être refusé, sauf validation
   humaine explicite équivalente à `user_confirmed`. Aucun appelant de
   production n'existe aujourd'hui pour `supersede()` ; cette règle s'applique
   au premier appelant qui sera écrit.
7. Cette policy ne juge jamais la véracité d'un souvenir. Elle contrôle
   uniquement si une promotion est *autorisée* (structure valide, provenance
   éligible, absence de motif instruction/sensible) — jamais si le contenu
   est vrai, à jour, ou pertinent. Cette distinction reste inchangée par
   cette décision.

Ce qui est déjà garanti par le code, sans action supplémentaire :
`user_stated`/`user_confirmed` non falsifiables depuis une sortie LLM ;
aucune écriture mémoire en cours de tour `AgentLoop`, uniquement après ;
aucune mémoire jamais traitée comme message système, y compris un contenu
instruction-like promu sous une policy permissive.

Ce qui reste à construire avant toute extension au-delà de cette décision :
catégorisation par risque, filtrage de sensibilité étendu (PII/finance/santé),
détection de contradiction, garde-fou effectif sur `supersede()` (point 6
ci-dessus n'est pour l'instant qu'une règle documentée, pas un contrôle codé).

## Consequences

Positif : élimine, tant qu'elle est respectée, le risque de mémorisation
automatique d'une hallucination, d'une donnée sensible non filtrée, ou d'un
contenu injecté indirectement via un email ou un outil — aucun de ces
scénarios ne peut aboutir à une écriture durable sans confirmation humaine.
Cohérent avec l'ADR-0006 : les deux mécanismes (confirmation d'exécution
d'outil, confirmation de promotion mémoire) partagent désormais le même
principe par défaut. Aucune modification de code n'est nécessaire pour se
conformer à cette décision, puisqu'aucune promotion n'est câblée aujourd'hui.

Négatif : toute intégration future qui active la mémoire devra composer
avec la friction d'une confirmation systématique pour chaque proposition
`llm_proposed`, y compris dans un contexte où l'utilisateur n'est pas
disponible pour confirmer — dans ce cas, cette décision préfère une absence
de mémorisation à une mémorisation non supervisée. Les limites déjà connues
(filtre de sensibilité non exhaustif, absence de détection de contradiction,
absence de garde-fou codé sur `supersede()`) ne sont pas résolues par cette
décision et restent des risques latents documentés jusqu'à ce que le
chantier du point 5 soit engagé.
