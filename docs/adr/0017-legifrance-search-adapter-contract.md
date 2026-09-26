# ADR-0017: Contrat de l'adaptateur Légifrance (recherche et récupération)

Date: 2026-09-23
Status: Accepted (contrat) — implémenté en LEGAL-03B (Tool, adaptateurs, parseur, orchestrateur) ; les points OUVERT / À CONFIRMER restent ouverts

Référence de travail : complément d'ADR-LEGAL-03-05.

## Contexte

Comportement **réellement observé** (Sandbox PISTE, LEGAL-03.0A) de
`POST /search`, fond `CODE_DATE` :

- **[OBSERVÉ]** Sans filtre, l'ordre de deux appels **identiques** diffère ;
  les mêmes identifiants d'articles se répètent dans tous les résultats.
- **[OBSERVÉ]** Filtre `DATE_VERSION` avec `singleDate` (epoch ms) : le
  total passe de 5143 à 7 ; un résultat **par code**, chacun à l'instantané
  en vigueur à la date demandée ; pages disjointes ; `p1` de taille 5 est un
  préfixe de `p1` de taille 10.
- **[OBSERVÉ]** `pageNumber`/`pageSize` paginent des **résultats** (codes
  instantanés), jamais des articles.
- **[OBSERVÉ]** `typePagination: "ARTICLE"` est accepté (HTTP 200) mais la
  réponse annonce `"DEFAUT"`, `totalArticleResultNumber` reste 0 et
  `pageNumber=2` renvoie le contenu de la page 1.
- **[OBSERVÉ]** Recherche `typeChamp: NUM_ARTICLE`, `EXACTE` : retrouve les
  versions distinctes d'un même numéro d'article.

## Problème

Où placer la traduction requête → API et réponse → références, sans que
`legal-research` connaisse le réseau, `legifrance-client` ou `connectors` ?

## Décision

**Répartition des responsabilités.**

- **Connecteur** (`packages/connectors`, ajouté en LEGAL-03B) : un Tool
  `legifrance.search`, `action: 'read'`, à **entrée structurée** (fond,
  critères, date de version, page/taille), qui valide, **construit le payload
  `/search`** et renvoie une sortie technique proche de la réponse brute (même
  discipline que `legifrance.get_article`). Aucun changement de connecteur
  n'est fait dans LEGAL-03A.
- **Adaptateur `legal-research`** (LEGAL-03B) : `LegifranceSearchAdapter`
  (`SearchPort`) construit l'entrée du Tool, l'exécute via `ToolExecutor`
  (nom en chaîne, sans import du connecteur) et **parse** la sortie
  `unknown` en `SearchReference[]`. `LegifranceRetrievalAdapter`
  (`RetrievalPort`) enveloppe `LegifranceSourceProvider.getArticle`.

**Règles de l'adaptateur de recherche** (reflétant le comportement observé) :

1. `CODE_DATE` **exige** `asOf` → filtre `DATE_VERSION`. Sans `asOf`,
   l'adaptateur refuse (`invalid_request`) : une pagination sans filtre est
   non déterministe et redondante.
2. `typePagination` est toujours `DEFAUT` ; `ARTICLE` n'est **jamais**
   utilisé ni supposé fonctionnel.
3. `page`/`size` → `pageNumber`/`pageSize` ; l'unité paginée est le
   résultat. `totalResults` = `totalResultNumber` ; `unexposedArticleCount`
   = somme de `moreArticlesCount`.
4. Parsing `results → sections → extracts` ; `candidateId` = `extract.id`
   s'il a la forme d'un identifiant récupérable (`LEGIARTI` + 12 chiffres),
   sinon l'élément est tracé (`SearchSkippedItem`).
5. Dates de recherche (chaînes) converties en ISO ; **une date `2999-01-01…`
   est convertie en absence** (`effectiveTo`). `datePublication` et le champ
   `date` d'un résultat (date du code) **ne sont jamais** repris.
6. **Pas de déduplication dans l'adaptateur** : l'ordre reçu est exposé ; la
   déduplication est celle de l'orchestrateur (`referenceKey`, ADR-0013).
7. Récupération : `canRetrieve` = identifiant `LEGIARTI\d{12}` ; `retrieve` =
   `getArticle`, sans logique temporelle (ADR-0014).

## Alternatives écartées

- L'adaptateur construit le payload brut et le Tool le relaie : le Tool
  deviendrait un proxy sans validation d'entrée.
- Interroger `/search` sans `DATE_VERSION` : voir constats ci-dessus.

## Conséquences

- LEGAL-03B a ajouté un Tool `read` au connecteur et deux adaptateurs ; les
  fixtures de LEGAL-03A (`testing/fixtures.ts`) verrouillent les formes
  observées pour leurs tests, sans réseau.

## Implémentation (2026-09-23, LEGAL-03B)

Le contrat ci-dessus est implémenté. Décisions et faits établis à
l'implémentation (les points non confirmés sont repris dans « Limites ») :

**Tool `legifrance.search`** (`packages/connectors/src/legifrance/legifrance-search-tool.ts`,
branché dans `legifranceConnector` : capability et Tool supplémentaires).

- `action: 'read'`. Entrée : `fond`, `text`, `matchMode`, `field?`,
  `dateVersion`, `pageNumber`, `pageSize` ; toute autre clé est rejetée.
- **Un seul fond** : `CODE_DATE` (seul fond observé) ; tout autre est refusé.
- `dateVersion` **obligatoire** (ISO 8601) ; converti en `singleDate` par
  `Date.parse` (une date seule = minuit UTC, convention de l'exploration).
- Payload construit par le connecteur : `typePagination` toujours `DEFAUT`,
  `sort` toujours `PERTINENCE`, un seul filtre `DATE_VERSION`. `ARTICLE` n'est
  jamais émis.
- Traductions : `all_terms` → `TOUS_LES_MOTS_DANS_UN_CHAMP` et `exact_phrase`
  → `EXACTE` (**observés**), `any_term` → `UN_DES_MOTS` (**documenté, non
  observé**) ; `any` → `ALL` et `article_number` → `NUM_ARTICLE` (**observés**).
- Sortie technique : `totalResultNumber`, `totalArticleResultNumber`,
  `typePagination` (ou `null`) et `results` **tel que reçu**. Une racine sans
  tableau `results` lève `LegifranceMalformedResponseError`. Aucun maximum de
  `pageSize` n'est imposé.

**`LegifranceSearchAdapter`** (`SearchPort`) et parseur pur
(`legifrance-search-parser.ts`), dans `legal-research`.

- Construit l'entrée du Tool, l'exécute via `ToolExecutor` ; statuts traduits
  vers `ResearchProviderError` (`invalid_input` → `invalid_request`,
  `error` → `execution_error`) ; le message d'erreur n'est jamais analysé.
- Refus explicites, sans appel : `sourceTypes` non vide (aucun filtre de nature
  observé ; une liste vide vaut « aucune restriction ») et `asOf` absent.
- Parseur : `results → sections → extracts`. `resultId` = `titles[0].id`
  (voir ADR-0012, non généralisé). Un résultat sans `titles[0].id` est tracé
  `malformed_item` **sans perdre ses extraits exploitables**. Un extrait dont
  l'`id` n'est pas `LEGIARTI` + 12 chiffres est tracé `no_candidate_id`.
- Dates de recherche (chaînes, décalage `+0000` inclus) converties en ISO ;
  `dateFin` égale à la sentinelle 2999-01-01 ⇒ `effectiveTo` absent ;
  `datePublication` et le champ `date` d'un résultat ne sont jamais repris ;
  l'extrait de recherche est la concaténation de `values` (séparateur `…`).
- `SearchMetadata` : `resultCount` (résultats/conteneurs), `totalResults`
  (`totalResultNumber`) et `unexposedArticleCount` (somme de
  `moreArticlesCount`).

**`LegifranceRetrievalAdapter`** (`RetrievalPort`) : enveloppe
`LegifranceSourceProvider.getArticle` inchangé ; aucun texte (`contentHash` reste
la seule preuve d'intégrité) ; versions rendues sous forme générique
(`SourceVersionRef`), sans résolution temporelle.

## Limites — À CONFIRMER / OUVERT

- Identifiant de résultat : `titles[0].id` **établi pour `CODE_DATE`** ; **À
  CONFIRMER** : la longueur de `titles[]`, le rôle de ses éléments d'index ≥ 1
  et la valeur pour les autres fonds.
- `any_term` → `UN_DES_MOTS` : documenté, **jamais observé**.
- Conversion `dateVersion` → epoch : convention UTC ; le **fuseau réellement
  appliqué** par Légifrance n'est pas établi (ADR-0014).
- Critères d'arrêt de pagination (page courte, total atteint) : observés sur un
  jeu de 7 résultats seulement.
- Stabilité de l'ordre **sous filtre** sur appels répétés.
- `pageSize` maximal, comportement après la dernière page.
- Accès aux articles au-delà des extraits (`moreArticle`).
- **Autres fonds** (`LODA_DATE`, `JURI`, `KALI`, `CETAT`) : non testés, donc
  non couverts par ce contrat.
- Le Sandbox contient des données qui ressemblent à du droit réel : la
  fiabilité (`reliability`) selon Sandbox ou production reste à décider
  (aujourd'hui fixée à `primary_institutional` pour toute source Légifrance).
