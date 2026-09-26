# ADR-0014: Temporalité et résolution de version

Date: 2026-09-23
Status: Accepted (concepts) — resolver implémenté par ADR-0018 ; sémantique réelle des bornes NON établie

Référence de travail : ADR-LEGAL-03-04.

## Contexte

`LegalSource` distingue déjà `effectiveFrom`/`effectiveTo` (force de droit),
`publicationDate` (optionnelle) et `consultedAt` (acte de consultation, sans
valeur juridique). Observations LEGAL-03.0A :

- **[OBSERVÉ]** Formats différents : `getArticle` renvoie des **epoch ms**,
  `/search` des **chaînes** `"2016-08-10T00:00:00.000+0000"`.
- **[OBSERVÉ]** Sentinelle « pas de borne connue » : `32472144000000` (epoch)
  côté `getArticle`, `"2999-01-01T00:00:00.000+0000"` côté `/search`.
- **[OBSERVÉ]** `datePublication` d'un résultat de recherche vaut la
  sentinelle `2999-01-01` : elle n'a aucun sens de publication.
- **[OBSERVÉ]** `dateVersion` d'un extrait = `dateDebut` (version en
  vigueur) mais = `dateFin` (version abrogée).
- **[OBSERVÉ]** Les bornes de versions successives peuvent **ne pas
  s'enchaîner** : L3121-27 v1.0 finit le 2008-08-22, v2.0 commence le
  2016-08-10 (trou de 2 910 jours).

## Problème

Comment représenter le temps sans fabriquer de dates et sans figer trop tôt
la résolution « quelle version à la date D » ?

## Décision

1. Concepts (`temporal-types.ts`) : `EffectivePeriod`, `SourceVersionRef`
   (version, état, bornes — générique, indépendant du fournisseur),
   `VersionResolution`, `VersionResolver`.
2. **`VersionResolution` a trois issues** : `resolved`, `none_applicable`
   (avec raison : avant la première version, trou entre versions, après la
   dernière) et `indeterminate` (données de version insuffisantes). « Aucune
   version applicable » est une réponse légitime, jamais une erreur.
3. **Le resolver est un composant séparé** du `SearchPort` et du
   `RetrievalPort` : aucun des deux ne résout de version, et `getArticle` ne
   reçoit aucune logique temporelle.
4. `effectiveTo` absent = aucune fin connue ; **la sentinelle 2999 est
   convertie en absence par l'adapter**, jamais propagée comme date.
5. Interdits : `datePublication = 2999-01-01` comme date juridique ;
   `dateVersion` comme `effectiveFrom` sans décision explicite ;
   `consultedAt` dans tout raisonnement de validité.
6. `SearchQuery.asOf` est une date **juridique** de référence ; elle n'est
   jamais `consultedAt`.

## Alternatives écartées

- Resolver dans `getArticle` ou dans le provider : mélange retrieval et
  raisonnement juridique, et impose une sémantique de bornes non décidée.
- Supposer des versions contiguës : contredit le trou observé.

## Conséquences

- Le resolver s'appliquera à `articleVersions` (`SourceVersionRef[]`) après
  récupération ; un `ResearchGap`/`ResearchRejection` `no_applicable_version`
  exprime le résultat « aucune version ».

## Mise à jour (2026-09-23, VersionResolver)

Le resolver est implémenté ; son contrat, sa convention de bords conservatrice, sa
granularité UTC et sa politique de chevauchement sont fixés par
**ADR-0018**. Deux précisions par rapport aux concepts ci-dessus :

- **`articleVersions` peut être incomplet** (L36-11 : 2 versions listées, la
  version récupérée et les versions intermédiaires absentes). Un trou visible dans
  une liste de versions n'est donc pas une preuve d'absence de version : le resolver
  reçoit une déclaration d'exhaustivité **fournie par l'appelant** et ne conclut
  `none_applicable` que si l'historique est `complete`.
- Le type `indeterminate` compte désormais cinq raisons (`insufficient_version_data`,
  `incomplete_history`, `ambiguous_overlap`, `boundary_date`, `invalid_interval`) ;
  les points « bornes inclusives ou exclusives » et « chevauchement » ci-dessous
  restent **ouverts** en réalité (l'implémentation adopte une convention
  conservatrice, sans les trancher).

## Limites — OUVERT

- Bornes **inclusives ou exclusives** ; fuseau horaire réel des dates
  Légifrance (les fixtures observées sont à minuit UTC).
- Comportement en cas de **chevauchement** de versions (non observé).
- Rôle éventuel de `dateVersion`.
- Un seul article multi-version observé.
