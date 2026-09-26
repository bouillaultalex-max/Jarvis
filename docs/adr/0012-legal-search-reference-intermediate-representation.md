# ADR-0012: `SearchReference` — représentation intermédiaire d'un candidat de recherche

Date: 2026-09-23
Status: Accepted (champs à sémantique non confirmée signalés) — mis à jour après LEGAL-03B (règle de l'identifiant de résultat)

Référence de travail : ADR-LEGAL-03-02.

## Contexte

Entre un résultat de recherche brut (`unknown`, propre au fournisseur) et une
`LegalSource` canonique (ADR-0011) il faut une représentation intermédiaire
qui porte ce que la recherche sait réellement, sans rien fabriquer.

## Problème

Quels champs cette représentation peut-elle porter, et lesquels ne doivent
**pas** être déduits ?

## Décision

`SearchReference` (`search-types.ts`) porte :

| Champ                                                                                                            | Statut                                                                |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `authority`, `collection` (fond), `candidateId`                                                                  | nécessaires ; `candidateId` est opaque                                |
| `provenance` (requête, provider, fond, page, position, `resultId`, `sectionIndex`, `extractIndex`, `executedAt`) | nécessaire (explique pourquoi une source est retenue)                 |
| `title`, `legalStatus`, `excerpt`                                                                                | utiles, tels que fournis                                              |
| `effectiveFrom`, `effectiveTo`                                                                                   | seulement si fournis ; `effectiveTo` absent = aucune borne connue     |
| `dateVersion`                                                                                                    | **sémantique variable, non confirmée** (voir ci-dessous)              |
| `containerNature`                                                                                                | informatif (ex. `code`), jamais recopié dans `LegalSource.sourceType` |
| `parentTextId`                                                                                                   | **seulement** si fourni de façon structurée                           |

Règles :

- Une `SearchReference` ne porte ni `identifier`, ni `version`, ni
  `contentHash`, ni texte : ce ne sont pas des `LegalSource`.
- `dateVersion` **n'est pas** `effectiveFrom`. **[OBSERVÉ]** Pour une version
  en vigueur il égale `dateDebut` ; pour une version abrogée il égale
  `dateFin` (article L3121-27). Il ne peut donc pas être lu comme début de
  validité sans décision explicite (ADR-0014).
- `legalStatus` est une chaîne **ouverte** (observé : `VIGUEUR`, `ABROGE`) ;
  aucun enum n'est inventé.
- `parentTextId` n'est pas extrait de l'identifiant composite d'un résultat
  (`<texte>_<date>` observé) : ce serait une déduction par découpage de
  chaîne, non une donnée fournie.
- `datePublication` d'un résultat (observé égal à `2999-01-01`) n'est reprise
  nulle part : aucune `publicationDate` n'est fabriquée.
- Les éléments sans identifiant exploitable sont tracés
  (`SearchSkippedItem`), jamais ignorés en silence.

## Alternatives écartées

- Réutiliser `LegalSource` avec des champs vides : casserait les invariants
  de `validateSource` (`effectiveFrom`, `version` obligatoires).
- Un type par fournisseur : le domaine dépendrait des formats.

## Conséquences

- La transformation d'un résultat brut en `SearchReference[]` est du ressort
  de l'adapter du fournisseur (ADR-0017).
- La déduplication se fait sur `referenceKey` (ADR-0013).

## Mise à jour (2026-09-23, LEGAL-03B)

L'implémentation de LEGAL-03B a tranché un point laissé ouvert, **sans changer
les décisions ci-dessus** :

- **Identifiant de résultat, fond `CODE_DATE`** : `SearchProvenance.resultId`
  = `titles[0].id`. **[OBSERVÉ]** Les sorties de recherche réelles n'exposent
  aucun champ `id` (ni `title`) de premier niveau sur un résultat : l'identifiant
  `<texte>_<date>` provient de `titles[0].id`. **Cette règle n'est pas
  généralisée aux autres fonds** (leur forme n'a pas été observée).
- **L'absence d'identifiant de conteneur n'est pas l'absence d'articles.** Un
  résultat sans `titles[0].id` est tracé `malformed_item` (au niveau du
  résultat), mais ses extraits dotés d'un identifiant `LEGIARTI` exploitable
  restent lus ; leur `provenance.resultId` est alors **absent** (le champ est
  déjà optionnel) — jamais remplacé par un index, par un autre champ ni par un
  identifiant d'extrait. Un extrait sans `LEGIARTI` exploitable reste tracé
  `no_candidate_id`.
- **Éléments écartés visibles dans le résultat** : les `SearchSkippedItem` d'une
  page sont reportés dans `ResearchResult.skipped` (type additif
  `ResearchSkippedItem` = `SearchSkippedItem` + `page`). Ils ne sont pas des
  références, donc pas des `ResearchRejection`. Une recherche dont tous les
  éléments sont écartés n'est pas un « aucun résultat » : la lacune
  `no_search_result` n'est émise que si le fournisseur n'a renvoyé aucun
  résultat.

## Limites — À CONFIRMER

- Identifiant de résultat : **établi pour `CODE_DATE`** (`titles[0].id`, voir
  la mise à jour ci-dessus). **À CONFIRMER** : la longueur de `titles[]` et le
  rôle de ses éléments d'index ≥ 1, les autres champs d'un élément de
  `titles`, et la valeur pour les autres fonds.
- Sémantique de `dateVersion` au-delà des deux cas observés.
- Présence, dans d'autres fonds, d'un identifiant de texte parent structuré.
