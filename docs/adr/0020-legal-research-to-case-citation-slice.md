# ADR-0020: Vertical slice Research → Case — citations de niveau source

Date: 2026-09-24
Status: Accepted (implémenté dans `@jarvis/legal-core` et `@jarvis/legal-research`) — la pertinence, l'usage dans un raisonnement et le contenu textuel restent NON établis

Complète ADR-0013 (identité), ADR-0018 (resolver) et ADR-0019 (version résolue).
Implémentation : `legal-research/src/research/citation-projection.ts`
(`projectCitations`), `legal-core/src/legal-case-citations.ts`
(`attachSourcesAndCitations`), types et validation dans `legal-case.ts` et
`legal-citation-validation.ts`.

## Contexte

Le pipeline produisait un `ResearchResult` entièrement transitoire ; `LegalCase`
existait sans aucun producteur. Constats du code :

- **[EXISTANT]** `LegalCitation` = `{ id, sourceId, sourceVersion, pinpoint?, quotedText?, consultedAt }`.
  Rien n'y disait pour quelle question, à quelle date, ni avec quel statut de
  résolution la version avait été retenue.
- **[EXISTANT]** Les validateurs d'entités ignorent les clés inconnues : des champs
  optionnels additifs restent lisibles en format v2, sans migration.
- **[EXISTANT]** `ResearchResult` **ne consignait pas** l'exhaustivité de l'historique
  fournie au resolver : « resolved + unknown » n'aurait pu être qu'un défaut supposé.

## Décision

**1. Trois notions, jamais fusionnées.** _Retrouvée_ (une source a été récupérée) ·
_applicable_ (la résolution l'a désignée pour `asOf`) · _éligible à la citation_
= retrouvée **et** applicable, vérifiée structurellement. Une `LegalCitation` de
niveau source représente une source **éligible**, pas une source _pertinente_, ni
_utilisée comme preuve_ : ces jugements appartiennent à ANALYZE et ne sont pas
représentés. `LegalSource` ≠ `LegalCitation` ≠ `LegalArgument`. Aucun score, aucun
champ de pertinence, de confiance numérique ou de force de preuve.

**2. Éligibilité déterministe** (`projectCitations`) : candidat hydraté +
`versionResolution` `resolved` + `resolvedRetrieval` présent + source valide
(`validateSource`) et cohérente (`source.id` = version résolue ; mêmes `authority`
et `identifier` que la source initiale ; `authority` de la référence). Sinon aucune
citation, avec une raison résumée (`ineligible`). `indeterminate`, `none_applicable`,
échecs de récupération, budget épuisé, cible non récupérable : jamais de citation.
Ces éléments **restent dans `ResearchResult`** (`rejections`, `gaps`, `skipped`) ;
aucune « citation négative », aucun détail technique dans `LegalCase`.

**3. Résolution « au mieux » admise, incertitude conservée.**
`ResearchCandidate.historyCompleteness` (ajout additif dans `legal-research`)
consigne ce que le moteur a réellement fourni au resolver — `unknown` en
production. Le resolver n'est pas modifié. La citation porte
`eligibility.historyCompleteness` (`complete | unknown`) : VERIFY pourra distinguer
« résolu sur un historique établi » de « résolu au mieux ». Une exhaustivité non
consignée se lit `unknown`, **jamais** `complete`. Dans un groupe dédupliqué,
`complete` exige que tous les candidats le déclarent.

**4. Modèle : ajouts optionnels sur `LegalCitation`, format v2 inchangé.**
`contentHash?` (empreinte épinglée, cohérente avec celle de la source si elle en a
une) et `eligibility?` = `{ questionId, asOf, resolution: 'resolved',
historyCompleteness }`. `asOf` est la date juridique explicite de la résolution
(jamais « aujourd'hui »). Le validateur exige que `questionId` désigne une
`LegalQuestion` **du dossier** : c'est le lien `LegalCase → LegalQuestion →
LegalCitation`. `LegalQuestion`, `LegalCase` et le format de fichier ne changent pas :
`asOf` est une propriété d'une _résolution_ (une question peut en avoir plusieurs),
pas de la question. Ne pas confondre : la provenance juridique minimale est
conservée, pas un journal d'audit.

**5. Déduplication par identité logique** `authority` + `identifier` + `version`
(`sourceKey`, ADR-0013), jamais par `source.id` seul. Plusieurs candidats, `id`
techniques distincts ou `consultedAt` différents donnent **une** source et **une**
citation. Source retenue : la plus anciennement consultée (à égalité, l'`id` le plus
petit) — indépendante de l'ordre d'entrée. Deux empreintes de contenu différentes
pour une même identité = contradiction : aucune citation
(`conflicting_source_content`).

**6. `id` de citation déterministe** : empreinte de (`questionId`, `asOf`, identité
logique). Il inclut la question et l'`asOf` car ils font partie de l'affirmation
« cette version est applicable à cette date, pour cette question » ; au sein d'une
projection ils sont constants, la déduplication reste donc `authority` +
`identifier` + `version`.

**7. Rattachement au dossier** (`attachSourcesAndCitations`) : pur, immuable,
idempotent. Une source déjà présente sous la même identité logique est réutilisée
(les citations sont redirigées) ; une citation de même `id` identique **hors
`consultedAt`** est ignorée (première consultation conservée) ; le dossier est
**revalidé** — question absente, empreinte incohérente, `id` de source en conflit :
erreur, jamais contournée. Le statut du dossier n'est pas modifié.

**8. Pas de `LegalResearchItem`.** Son rôle, son lien à la question et son niveau de
synthèse ne sont pas stabilisés. Le type est inchangé ; il pourra consommer les
citations produites (`citationIds`).

**9. Pas de contenu textuel.** Le texte reste perdu après le mapping Légifrance ;
`pinpoint` et `quotedText` sont absents des citations de ce bloc. La citation
représente une source/version, pas un passage.

## Alternatives écartées

- **`asOf` sur `LegalQuestion`** : une question peut nécessiter plusieurs dates ; le
  champ n'aurait pas de consommateur et créerait une seconde source de vérité.
- **Défaut `unknown` figé dans la projection** : ne distinguerait plus jamais un
  historique déclaré complet ; c'est le moteur qui consigne.
- **Dédup par `source.id`** : deux identifiants techniques d'une même version
  donneraient deux citations.
- **Id de citation aléatoire** : rejouer une recherche créerait des doublons.
- **Refuser tout `resolved` sur historique `unknown`** : bloquerait toute citation,
  l'exhaustivité n'étant jamais prouvée en production.
- **v3 du format** : inutile, les ajouts sont optionnels.

## Conséquences

- Une citation de ce bloc **ne prouve rien** sur le fond. Un consommateur ne doit pas
  la lire comme « source pertinente » ni « source qui soutient une conclusion ».
- `asOf` est validé comme les autres dates du modèle (`Date.parse`), plus permissif
  que le resolver ; il provient de `query.asOf`, que le resolver a déjà accepté.
- Des fichiers écrits par cette version sont lisibles par l'ancien code (clés
  inconnues ignorées) mais celui-ci n'appliquerait pas les nouveaux invariants.

## Limites — hors de ce bloc

- Pertinence, `LegalArgument`/analyse/conclusion, `LegalResearchItem`, VERIFY, PREPARE.
- **Contenu** : dépendance future explicite (stockage transitoire / rechargement /
  artefact) ; sans lui, aucune citation de passage.
- **Applicabilité non revérifiée** : la validation ne compare pas `asOf` aux bornes de
  la source ; c'est le rôle du resolver puis de VERIFY.
- Une même version citée pour une question à deux `asOf` donne deux citations
  (affirmations distinctes) ; leur fusion éventuelle est une décision future.
- Transitions de statut, chiffrement au repos, query planning, faits : inchangés.
