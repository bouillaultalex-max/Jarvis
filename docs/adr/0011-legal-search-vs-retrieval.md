# ADR-0011: Recherche juridique — découverte (Search) et récupération (Retrieval) sont deux étapes

Date: 2026-09-23
Status: Accepted (points ouverts listés en fin de document)

Référence de travail : ADR-LEGAL-03-01. Cette ADR ne modifie aucun code
existant ; elle fixe le contrat des types et ports ajoutés par LEGAL-03A
(`packages/legal-research/src/research/`).

## Contexte

`@jarvis/legal-research` sait aujourd'hui **récupérer par identifiant**
(`LegifranceSourceProvider.getArticle`, LEGAL-02B.3) mais pas chercher. Les
explorations réelles LEGAL-03.0A (Sandbox PISTE, `POST /search`, fond
`CODE_DATE`) ont établi :

- **[OBSERVÉ]** `results[0].text = null` : un résultat de recherche ne porte
  aucun texte, donc aucun `contentHash` ne peut en être calculé.
- **[OBSERVÉ]** Un résultat est un **conteneur** (`nature=code`) : structure
  `results → sections → extracts`, avec au plus 3 extraits observés par
  résultat et un compteur `moreArticlesCount` d'articles non exposés.
- **[OBSERVÉ]** Sans filtre de date, les mêmes identifiants d'articles se
  répètent dans tous les résultats et toutes les pages, et l'ordre change
  d'un appel identique à l'autre (voir ADR-0017).
- **[OBSERVÉ]** `getArticle(id)` accepte l'identifiant tiré d'un extrait et
  renvoie le contenu complet, les versions et les dates.

## Problème

Où s'arrête la recherche et où commence la source canonique ? Si un résultat
de recherche devenait directement une `LegalSource`, celle-ci serait bâtie
sur une donnée incomplète (pas de texte, pas d'empreinte, version non
garantie) et la règle « une conclusion cite une source vérifiable »
(`LEGAL_SPECIFICATION.md` §4) serait affaiblie.

## Décision

1. **Search = découverte.** Elle produit des `SearchReference` (ADR-0012),
   jamais des `LegalSource`.
2. **Retrieval = hydratation.** Elle transforme une `SearchReference` en
   `LegalSource` canonique, via un `RetrievalPort` (ADR-0015). Pour
   Légifrance : `legifrance.get_article`.
3. Une `LegalSource` n'est **jamais** construite à partir d'un extrait de
   recherche.
4. La pagination d'un `SearchPort` pagine des **résultats du fournisseur**,
   non des articles. `SearchMetadata.resultCount`/`totalResults` sont dans
   cette unité ; les articles non exposés sont comptés à part
   (`unexposedArticleCount`) et signalés comme lacune (`ResearchGap`).
5. Search ne classe pas et ne conclut pas : aucun ranking propre, aucun
   argument, aucune conclusion (la recherche s'arrête avant ANALYZE).

## Alternatives écartées

- **Construire `LegalSource` depuis Search** : impossible sans texte ni
  version certaine ; violerait l'invariant de traçabilité.
- **Un seul port « search + retrieve »** : masque le budget de récupération
  (ADR-0016) et empêche de tester chaque étape séparément.

## Conséquences

- Deux ports distincts, chacun testable sans réseau avec un fake.
- Le coût d'une recherche est `pages de search + récupérations`, borné par un
  `ResearchBudget` (ADR-0016).
- Le domaine ne dépend d'aucun format Légifrance.

## Limites — points OUVERTS (non décidés ici)

- Stabilité exacte du ranking d'un fournisseur.
- Accès aux articles au-delà des extraits exposés (`moreArticle`).
- **Stockage du texte** d'une source récupérée : `RetrievalResult` ne porte
  volontairement pas le texte (le `LegifranceSourceProvider` actuel le jette
  après calcul du hash). Où et comment le conserver (chiffrement, hors
  `LegalCase`) reste à décider.
  - **[SUPERSÉDÉ sur ce point par ADR-0021, 2026-09-24]** — énoncé conservé
    comme historique. Depuis ADR-0021, le texte est porté de façon
    **transitoire** par `RetrievalResult.content` (et
    `VersionTargetResult.content`) : capturé pendant l'appel existant, vérifié
    contre `source.contentHash`, opaque et absent de toute sérialisation. Il
    n'est toujours **pas** un champ de `LegalSource`. **Reste ouvert et non
    traité** : le stockage **durable** du texte (persistance, chiffrement,
    rechargement, artefact).
- Ranking métier, cache, multi-source complet.
