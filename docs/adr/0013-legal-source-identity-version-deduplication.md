# ADR-0013: Identité, version et déduplication des sources

Date: 2026-09-23
Status: Accepted (clés) — règles de fusion de contenu NON décidées

Référence de travail : ADR-LEGAL-03-03.

## Contexte

Faits observés en Sandbox (LEGAL-03.0A, article L3121-27) :

- **[OBSERVÉ]** Deux versions : `id` `LEGIARTI000006902466` (v1.0) et
  `LEGIARTI000033020376` (v2.0). `cid` = `LEGIARTI000006902466` pour les
  deux (= `id` de la première version).
- **[OBSERVÉ]** `versionArticle` change (1.0 → 2.0) ; `versionPrecedente` de
  v2.0 pointe v1.0 ; `articleVersions` liste les deux.
- **[OBSERVÉ]** `getArticle(cid)` renvoie la version **1.0**, pas la version
  courante : `cid` n'est pas un pointeur vers « la version en vigueur ».
- **[OBSERVÉ]** L'identifiant d'un extrait de recherche désigne une version
  précise (deux extraits pour le même numéro, deux identifiants distincts).
- **[OBSERVÉ]** Sans filtre de date, les mêmes identifiants reviennent dans
  chaque résultat de chaque page (100 % de recouvrement).

## Problème

Quelle clé identifie « la même chose » avant et après récupération, sans
fusionner des versions juridiquement distinctes ?

## Décision

Quatre notions, jamais confondues :

| Notion                                   | Champ                                                  | Rôle                                         |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Identité technique d'une version         | `id` (`LegalSource.id`, `SearchReference.candidateId`) | distingue les versions                       |
| Identifiant stable de la chaîne observée | `cid` → `LegalSource.identifier`                       | regroupe les versions                        |
| Version juridique                        | `versionArticle` → `LegalSource.version`               | distingue les états juridiques               |
| Empreinte du contenu                     | `contentHash`                                          | calculée côté JARVIS ; **hors de toute clé** |

Deux clés (`source-key.ts`), car l'information diffère avant/après :

- **Avant récupération** : `referenceKey` = `authority` + `candidateId`.
  Une `SearchReference` ne porte ni `identifier` ni `version`.
- **Après récupération** : `sourceKey` = `authority` + `identifier` +
  `version`.

**Pourquoi `cid`/`identifier` seul est incorrect** : il est identique pour
toutes les versions d'un article ; l'utiliser comme clé fusionnerait v1.0 et
v2.0 (test `source-key.test.ts`). **Pourquoi le contenu n'entre pas dans la
clé** : deux versions au texte identique restent deux versions ; aucune
fusion automatique sur `contentHash`.

La déduplication est faite par l'orchestrateur (LEGAL-03B) sur
`referenceKey` et **conserve toutes les occurrences** (`sightings`) dans
`ResearchCandidate`. Le `SearchPort` ne déduplique pas silencieusement.

## Alternatives écartées

- Clé sur `cid` seul (fusion de versions) ; clé sur `contentHash` (fusion
  de versions identiques, perte de la version juridique) ; dédupliquer dans
  le provider (perte de la trace des occurrences).

## Conséquences

- Une source consultée deux fois à des instants différents garde la même
  `sourceKey` (seul `consultedAt` change).
- Les composantes sont sérialisées en JSON : aucune ambiguïté de séparateur.

## Limites — À CONFIRMER / OUVERT

- Un **seul** article multi-version a été observé : « `cid` = `id` de la
  première version » n'est pas établi comme règle générale.
- Unicité de `versionArticle` par chaîne : non prouvée.
- Un même `candidateId` dans deux fonds différents : non observé.
- Règle de coexistence de plusieurs versions d'une source dans un dossier.
