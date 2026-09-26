# ADR-0018: Contrat du `VersionResolver` (résolution de version à une date)

Date: 2026-09-23
Status: Accepted (contrat et convention conservatrice implémentés) — inclusivité réelle des bornes et fuseau de Légifrance NON établis

Complète ADR-0014 (concepts temporels). Implémentation :
`packages/legal-research/src/research/version-resolver.ts` (`resolveVersion`,
`versionResolver`), types dans `temporal-types.ts`.

## Contexte

ADR-0014 a défini les concepts (`SourceVersionRef`, `VersionResolution`,
`VersionResolver`) sans résolution. Les échantillons réels déjà présents dans le
dépôt (Sandbox PISTE, LEGAL-02B.2.1/2.2, LEGAL-03.0A) établissent :

- **[OBSERVÉ]** Les bornes de versions successives peuvent **ne pas
  s'enchaîner** : L3121-27, v1.0 finit le 2008-08-22 et v2.0 commence le
  2016-08-10 (2 910 jours). Ici la chaîne `versionPrecedente` (v2.0 → v1.0, v1.0
  sans précédente) indique qu'il n'existe pas de version intermédiaire.
- **[OBSERVÉ]** **`articleVersions` peut être incomplet** : pour L36-11 demandé
  en version 14.0, la liste ne contient que les versions 1.0 et 20.0 — ni la
  version demandée ni les versions 2 à 19 ; `versionPrecedente` de la v14 pointe
  une v13 absente de la liste. Un « trou » visible dans `articleVersions` n'est
  donc **pas** une preuve d'absence de version.
- **[OBSERVÉ]** Aucune paire de versions **adjacentes réelles** n'a été observée :
  l'inclusivité de `effectiveFrom`/`effectiveTo` est inconnue. Les échantillons
  sont des minuits UTC exacts ; le fuseau appliqué par Légifrance n'est pas
  établi.
- **[OBSERVÉ]** L'adaptateur/mapping traduit la sentinelle « pas de borne » en
  `effectiveTo` absent — et traduit de la même façon une `dateFin` `null` : « ouvert »
  et « inconnu » sont confondus en amont.

## Problème

Répondre « quelle version s'applique à la date D ? » sans jamais affirmer ce que
les données n'établissent pas (règle de doute, `LEGAL_SPECIFICATION.md` §4), sans
déduire de sémantique juridique non observée et sans dépendre de l'environnement.

## Décision

**1. Fonction pure.** `resolveVersion(history, asOf)` : aucune I/O, aucune horloge
(`Date.now` n'est jamais lu), aucune mutation de l'entrée. Le résultat ne dépend
que de `history` et `asOf`, jamais de l'ordre des versions (tri par
`effectiveFrom` puis `id`). `versionResolver` l'expose sous le contrat
`VersionResolver`.

**2. Entrée.**

- `history.versions` : `SourceVersionRef[]` (type existant, réutilisé).
- `history.completeness` : `complete | unknown`, **fournie par l'appelant**.
  Le resolver **ne déduit jamais** l'exhaustivité. Pour Légifrance,
  `articleVersions` doit être déclaré `unknown` tant qu'aucune preuve (chaînage
  consécutif) n'est apportée.
- `asOf` : ISO 8601. Date seule (`2019-05-24`) ou date-heure **avec décalage
  explicite** (`Z`, `+02:00`, `+0200`). Une date-heure **sans** décalage est refusée
  (`RangeError`) : son interprétation dépendrait du fuseau de la machine. Aucun
  usage de `Date.parse`.

**3. Résultats.**

- `resolved` : exactement une version couvre `asOf`.
- `none_applicable` : **uniquement si `completeness === 'complete'`** ; raisons
  `before_first_version`, `gap_between_versions`, `after_last_version`.
- `indeterminate` : dans tous les autres cas. Un trou visible dans un historique
  `unknown` ne permet **jamais** `none_applicable`.

**4. Raisons d'`indeterminate`** (avec `versionIds` triés quand des versions sont
en cause) :
`insufficient_version_data` (liste vide, id absent, doublons contradictoires, date
de version absente ou illisible — y compris un `effectiveTo` présent mais
illisible, jamais traité comme « ouvert ») · `incomplete_history` (aucune version ne
couvre la date, historique non déclaré complet) · `ambiguous_overlap` ·
`boundary_date` · `invalid_interval` (`effectiveTo` <= `effectiveFrom`).

**5. Ordre de décision** : données inexploitables (`insufficient_version_data`, puis
`invalid_interval`) → bord (`boundary_date`) → chevauchement (`ambiguous_overlap`)
→ une version (`resolved`) → aucune (`none_applicable` si complete, sinon
`incomplete_history`). Un seul défaut de données, même sur une version sans rapport
avec `asOf`, rend l'historique inexploitable : on ne résout pas sur un historique
dont on ne peut pas se fier à l'ordre.

**Politique globale des anomalies (justification).** Toute anomalie structurelle
détectée dans l'historique entraîne une résolution globale `indeterminate` dans
cette première version, même si l'anomalie semble hors de la période demandée.
Cette politique est volontairement conservatrice et pourra être assouplie
ultérieurement si une résolution partielle sûre est architecturalement justifiée.
Raisons de ce choix :

- Le tri, la détection de bords et de chevauchements portent sur **toutes** les
  versions : une version illisible, contradictoire ou à intervalle invalide peut
  cacher un chevauchement ou un bord qui concerne précisément la date demandée. Or
  la version défectueuse ne peut pas être évaluée, donc on ne peut pas affirmer
  qu'elle est « hors période ».
- Un cas d'historique **incomplet** a déjà été observé (`articleVersions` de
  L36-11) : une anomalie de données est un indice de fiabilité dégradée de
  l'ensemble, pas un défaut local prouvé.
- Répondre `resolved` sur un historique dont l'ordre n'est pas fiable serait une
  affirmation juridique sans preuve ; la règle de doute
  (`LEGAL_SPECIFICATION.md` §4) impose de ne pas conclure.
- Le coût est borné : un `indeterminate` de trop est une réponse sûre (l'appelant
  garde la main), alors qu'un `resolved` erroné ne l'est pas.
- Une résolution partielle sûre (ignorer une anomalie prouvée sans effet sur la
  date) exigerait de définir quand une anomalie est « sans effet » : décision
  reportée, non prise ici.

**6. Convention de bords : conservatrice.** Une date **exactement égale** à un
`effectiveFrom` ou `effectiveTo` de n'importe quelle version donne
`indeterminate / boundary_date` ; « couvre » = strictement à l'intérieur. Cette
politique a priorité sur `ambiguous_overlap`. Elle est **conventionnelle** : elle
n'affirme rien sur l'inclusivité réelle des bornes (non observée).

**7. Granularité UTC.** Toutes les dates sont comparées comme des instants UTC ;
une date seule vaut minuit UTC. **Cette normalisation est purement technique : elle
ne constitue PAS une affirmation sur la sémantique juridique ni sur le fuseau des
dates de Légifrance.**

**8. Intervalles.** `effectiveTo` absent = intervalle **ouvert**. La sentinelle
2999-01-01 n'arrive pas au resolver (l'adaptateur la convertit en absence) : une
date `effectiveTo` fournie, y compris `2999-01-01`, est une date ordinaire.

**9. Champs ignorés.** `state` (vocabulaire ouvert ; seuls `VIGUEUR`, `ABROGE`,
`MODIFIE` observés — aucune sémantique n'est déduite) ; `dateVersion`,
`consultedAt`, `publicationDate` (absents de `SourceVersionRef`, donc inutilisables
par construction, et sans effet même si présents sur l'objet).

**10. Chevauchements.** Plusieurs versions couvrant strictement la date :
`indeterminate / ambiguous_overlap`. Jamais de choix selon l'état, le numéro de
version, les dates ou l'ordre d'entrée. Une version ouverte suivie d'une autre
n'est détectée que là où les deux couvrent la date (aucune règle supplémentaire).

**11. Doublons.** Un même `id` avec des données identiques (`version`, `state`,
bornes, comparées après normalisation des instants) est dédupliqué ; des données
contradictoires donnent `indeterminate / insufficient_version_data`.

**12. Erreurs.** `RangeError` pour `asOf` non interprétable, `history.versions`
non tableau ou `completeness` inconnue (erreur de l'appelant, pas une réponse
juridique).

## Alternatives écartées

- Déduire l'exhaustivité (chaîne `versionPrecedente`, numéros de version) dans le
  resolver : logique d'adaptateur, et fausse sécurité tant qu'un cas d'incomplétude
  a été observé.
- `[from, to[` ou `[from, to]` : chacune fabrique une réponse affirmative aux bords
  sur une inclusivité non observée (faux trou d'un jour, ou faux chevauchement).
- Départager les chevauchements par état, numéro de version ou ordre d'entrée :
  règle juridique non observée et dépendance à des champs non fiables.
- `Date.parse` : les formes sans décalage dépendent du fuseau de la machine.

## Conséquences

- Le futur adaptateur devra transporter, pour alimenter le resolver : la version
  récupérée et son intervalle (absente de `articleVersions` dans le cas L36-11), et
  la preuve de chaînage permettant de déclarer `complete`. **Non traité ici** : le
  mapping et le connecteur Légifrance ne sont pas modifiés.
- `VersionResolver.resolve` prend désormais un `VersionHistory` (le type
  `VersionResolver` n'avait aucune implémentation ni consommateur).
- Les raisons ajoutées et les types d'entrée restent dans `legal-research`
  (`legal-core` inchangé).

## Limites — OUVERT / À CONFIRMER

- Inclusivité réelle des bornes ; fuseau appliqué par Légifrance : la convention
  conservatrice pourra être resserrée après observation d'une paire de versions
  adjacentes réelles.
- Sur un historique `unknown`, `resolved` repose sur les seules versions listées :
  une version absente de la liste ne peut pas être détectée.
- Distinction « ouvert » / « inconnu » pour `effectiveTo` : confondus par le mapping
  actuel ; le resolver applique la règle « absent = ouvert ».
- **Divergence connue — dates sans décalage.** `SearchQuery.asOf` n'impose aucun
  format (simple chaîne) et le Tool `legifrance.search` accepte certaines dates sans
  décalage horaire (validation et conversion par `Date.parse` : une date-heure sans
  décalage y dépend du fuseau de la machine), alors que `VersionResolver` **refuse**
  les date-heures sans décalage (`RangeError`). Cette divergence est connue ; elle
  devra être harmonisée dans le futur contexte de recherche. **Aucune
  harmonisation n'est effectuée dans ce jalon** (ni la recherche ni le resolver ne
  sont modifiés).
- Origine métier de `asOf` (date des faits, date courante…) : hors de ce contrat, le
  resolver reçoit la date de l'appelant.
