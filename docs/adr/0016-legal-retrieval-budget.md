# ADR-0016: Limitation du retrieval — budget de recherche

Date: 2026-09-23
Status: Accepted (principe) — VALEURS des seuils non décidées

Référence de travail : ADR-LEGAL-03-06.

## Contexte

**[OBSERVÉ]** Une recherche `CODE_DATE` expose au plus quelques extraits par
résultat mais peut porter sur des milliers de résultats (5143, 7671 observés
sans filtre de date). Chaque référence retenue coûte un `getArticle`
(appel réseau via `ToolExecutor`, quotas Légifrance non documentés).

## Problème

Empêcher `Search → centaines de résultats → centaines de getArticle` sans
contrôle, sans choisir de seuils arbitraires.

## Décision

1. Toute recherche est appelée avec un **`ResearchBudget` explicite** :
   `maxSearchPages`, `maxCandidates`, `maxRetrievedSources`.
2. **Aucune valeur par défaut n'est définie** : les seuils ne sont pas
   mesurés (quotas, latence, taille de réponse). L'appelant les fournit.
3. Ce qui dépasse le budget n'est pas perdu en silence : il devient une
   `ResearchRejection` (`over_candidate_budget`, `over_retrieval_budget`) et
   une `ResearchGap` `budget_truncated` avec le nombre concerné.
4. La déduplication (`referenceKey`) précède la récupération : on ne
   récupère jamais deux fois la même référence dans une recherche.
5. Le budget porte sur le nombre d'**appels**, pas sur le nombre de pages
   comme substitut d'un nombre d'articles (une page pagine des résultats,
   voir ADR-0011).

## Alternatives écartées

- Seuils par défaut « raisonnables » : arbitraires, non justifiés.
- Récupération paresseuse non bornée : coût imprévisible.

## Conséquences

- L'orchestrateur (LEGAL-03B) est testable avec des budgets minuscules et
  des fakes, sans réseau.
- Les résultats tronqués sont explicites (règle de doute,
  `LEGAL_SPECIFICATION.md` §4).

## Mise à jour (2026-09-23, LEGAL-03B)

L'orchestrateur (`ResearchEngine`) applique ce principe ainsi — précisions
d'implémentation, aucune valeur de seuil n'est fixée :

- **Budget obligatoire et validé** : `maxSearchPages` entier ≥ 1,
  `maxCandidates` et `maxRetrievedSources` entiers ≥ 0 ; sinon `RangeError`
  avant tout appel. Aucune valeur par défaut.
- **Ordre** : pages de recherche → déduplication (`referenceKey`) → références
  non récupérables écartées (`not_retrievable`, avant tout budget) → budget de
  candidats → récupérations sous budget.
- **Une tentative de récupération est un appel** : un échec (`retrieval_failed`)
  consomme du budget. Les candidats non récupérés faute de budget restent
  candidats, sans source, avec un rejet `over_retrieval_budget`.
- **Arrêt de la pagination** : page vide, page plus courte que `pageSize`
  (forme observée sur un jeu de 7 résultats) ou total annoncé atteint. Ces
  critères reposent sur des observations limitées (ADR-0017).
- **Lacunes `budget_truncated`** : `ResearchGap.budget` (type additif) nomme la
  borne qui a coupé la recherche, et `count` s'exprime dans son unité —
  résultats non interrogés (`maxSearchPages`, absent si le total est inconnu),
  candidats non retenus (`maxCandidates`) ou candidats non récupérés
  (`maxRetrievedSources`).
- Les doublons ne sont **pas** des rejets : ils sont conservés dans
  `ResearchCandidate.sightings` ; la raison `duplicate_reference` de
  `ResearchRejection` n'est donc pas émise.
- Une erreur du `SearchPort` est propagée (une recherche qui échoue n'est pas un
  résultat vide) ; seule une `ResearchProviderError` de récupération devient un
  rejet.

## Limites — OUVERT

- Valeurs des seuils ; quotas réels de l'API ; pagination maximale
  (`pageSize` maximal non testé) ; stratégie de sélection des candidats à
  hydrater quand le budget est inférieur au nombre de candidats (ranking
  métier, non décidé).
