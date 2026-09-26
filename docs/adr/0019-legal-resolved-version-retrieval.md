# ADR-0019: Récupération bornée de la version résolue (un saut)

Date: 2026-09-24
Status: Accepted (implémenté dans `@jarvis/legal-research`) — la résolution reste « au mieux » : aucune preuve de complétude n'existe

Complète ADR-0015 (ports), ADR-0016 (budget) et ADR-0018 (resolver). Implémentation :
`research/research-engine.ts` (`attachResolvedRetrievals`), types dans
`research/retrieval-types.ts`, `research/research-types.ts`, `research/ports.ts` ;
adaptateur `legifrance-retrieval-adapter.ts`.

## Contexte

Le moteur résolvait la version applicable à `asOf` (ADR-0018) mais, quand la
version résolue différait de la version récupérée
(`resolved.version.id !== retrieval.source.id`), il ne la récupérait pas : le
décalage restait seulement lisible dans les données. Un consommateur pouvait donc
prendre `retrieval` (mauvaise version) pour la version applicable.

- **[EXISTANT]** `RetrievalRequest` exige une `SearchReference` ; une cible issue du
  resolver n'est pas une découverte (ADR-0012 : aucune référence fabriquée).
- **[EXISTANT]** La cible est un `SourceVersionRef` de l'historique assemblé
  (version récupérée + `articleVersions`), jamais une source.
- **[EXISTANT]** `maxRetrievedSources` compte des appels, échecs compris (ADR-0016).

## Décision

**1. Un seul saut.** `retrieval initial → resolver → version cible → un éventuel
appel → STOP`. Après la récupération cible : ni nouvel historique, ni nouvel appel
au resolver, ni nouvelle cible, même si le résultat cible apporte un `versions`
différent (ignoré). Un saut au plus **par groupe** d'article (`identifierKey`), la
résolution étant identique pour tous ses candidats.

**2. Capacité optionnelle de `RetrievalPort`** (pas de nouveau port) :
`canRetrieveVersion?(VersionTargetRequest)` et `retrieveVersion?(VersionTargetRequest)`.
Un port qui n'implémente pas **les deux**, ou dont `canRetrieveVersion` renvoie
`false`, donne un rejet `not_retrievable` sans appel ni budget consommé.
`VersionTargetRequest` = `{ targetId, authority, identifier }` : aucune
`SearchReference`, ni résolution, ni `asOf` (le port n'en a pas besoin).

**3. Résultat distinct.** `VersionTargetResult` = `{ source, versions,
previousVersionId? }`, **sans** `reference` : réutiliser la référence du candidat
d'origine ferait désigner à `RetrievalResult.reference` autre chose que ce qu'elle
décrit. `RetrievalResult` est inchangé.

**4. Rattachement : `ResearchCandidate.resolvedRetrieval`.**
`retrieval` reste la source **initialement récupérée** ; `versionResolution` reste
le diagnostic du resolver ; `resolvedRetrieval` est la source de la version
résolue, avec un **mode explicite** (jamais déduit) :

| Mode        | Cas                                             | Appel | Objet                                   |
| ----------- | ----------------------------------------------- | ----- | --------------------------------------- |
| `initial`   | version résolue = celle du candidat             | aucun | **même objet** que `retrieval`          |
| `shared`    | déjà récupérée pour un autre candidat du groupe | aucun | **même objet** que ce `RetrievalResult` |
| `retrieved` | sinon                                           | un    | `VersionTargetResult`                   |

Présent si et seulement si `versionResolution.status === 'resolved'` **et** la
source de la version est disponible. Absent pour `indeterminate`, `none_applicable`,
`asOf` absent, échec de la cible, budget épuisé.

**5. Déduplication.** Avant tout appel : recherche de `source.id === targetId`
parmi les `retrieval` **du même groupe** (`identifierKey`). Le regroupement garantit
la cohérence `authority` + `identifier`. `sourceKey` n'est pas utilisée
(`SourceVersionRef.version` est optionnelle).

**6. Budget partagé.** Le saut consomme le **même** `maxRetrievedSources`, après
toutes les récupérations primaires : reste = `maxRetrievedSources − tentatives
primaires`. Aucun champ de budget, aucune réservation. Un saut en échec consomme du
budget ; une cible non supportée n'en consomme pas. Ordre des sauts : première
apparition du groupe.

**7. Identité vérifiée par le moteur.** La source reçue doit avoir `source.id ===
targetId`, et l'`authority` et l'`identifier` du groupe. Sinon : `retrieval_failed`
avec `errorReason: malformed_response`, aucun rattachement. La `version`
textuelle n'est pas comparée (format de `articleVersions` non garanti identique).

**8. Rejets existants, un par candidat du groupe, avec `targetVersionId`** (champ
optionnel ajouté à `ResearchRejection`, aucun nouveau type de rejet) :
`not_retrievable` (capacité absente/refusée) · `retrieval_failed` + `errorReason`
(échec d'appel) · `retrieval_failed` + `malformed_response` (mauvaise version /
identifiant / autorité) · `over_retrieval_budget` (plus de budget, aucun appel).
**Aucun nouveau `ResearchGap`** ; la sémantique de `budget_truncated` est inchangée.

**9. Provenance transitoire, non persistée.** Candidat et `SearchReference`
initiale (`candidate.reference`), source initiale (`candidate.retrieval`),
résolution (`candidate.versionResolution`), `asOf` (`ResearchResult.query`), mode
(`resolvedRetrieval.mode`). `LegalCase` et `@jarvis/legal-core` ne changent pas.

## Alternatives écartées

- **Nouveau port dédié** : deux ports pour un même fournisseur et un collaborateur
  de plus dans le moteur.
- **Union sur `RetrievalRequest`** : ferait fuir la distinction découverte / cible
  dans tous les appelants.
- **`RetrievalResult.reference` = référence du candidat d'origine** : `candidateId`
  ≠ `source.id`, sémantique de `reference` brouillée.
- **Réserver du budget pour les sauts** : budget caché, exclu.
- **Nouveau gap ou nouvelle raison de rejet** : les raisons existantes suffisent ;
  seule manquait l'identité de la version visée (`targetVersionId`).
- **Remplacer `retrieval` par la source résolue** : perdrait la source initialement
  récupérée et la lisibilité du décalage.

## Conséquences

- `resolvedRetrieval` est le seul champ à lire pour obtenir « la source de la
  version résolue » ; lire `retrieval` n'en est pas un substitut.
- Le saut passant après les récupérations primaires, il peut être privé de budget
  si celles-ci l'épuisent ; l'appelant doit prévoir de la marge (aucune réservation).
- Comportement modifié (volontairement) : une version résolue différente est
  désormais récupérée. Les tests qui figeaient « aucune récupération supplémentaire »
  ont été adaptés (`research-engine-version-resolution.test.ts`,
  `research-pipeline.test.ts`).
- L'adaptateur Légifrance réutilise `LegifranceSourceProvider.getArticle` via
  `ToolExecutor` ; mapping, connecteur, client et `legal-core` sont inchangés.

## Limites — OUVERT / NON TRAITÉ

- **Complétude** : `resolved` sur un historique `unknown` reste « au mieux ».
  `resolvedRetrieval` n'est pas une preuve d'exhaustivité ; la complétude utilisée
  n'est pas portée par `VersionResolution`. Aucune déduction (`versionPrecedente`).
- **Versions absentes de `articleVersions`** : inatteignables et jamais inventées
  (L36-11 : date dans un trou → `indeterminate` → aucun saut).
- **Récursion** : aucune. Le `versions` d'un résultat cible n'est pas exploité.
- **Texte** : non récupéré ni conservé (décision D2 inchangée). Pas de
  `LegalCitation`, `LegalResearchItem`, cache, retry, ranking, query planning.
- **`version`** de la cible non comparée à celle de la source reçue.
- **Deux ids distincts de même `sourceKey`** : cas théorique jamais observé, non traité.
