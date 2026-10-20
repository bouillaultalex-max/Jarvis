# EXP-004 — Vérification indépendante d'une postcondition

Prototype isolé (pas un package, pas de `package.json` propre — même
convention que `prototypes/tool-interface-bench` et `prototypes/situation-poc`).

**Ce banc n'est pas un mécanisme VERIFY intégré à JARVIS.** Aucun mécanisme
de ce type n'existe aujourd'hui dans le dépôt — recherche exhaustive menée
par [`docs/verified-result-boundaries.md`](../../docs/verified-result-boundaries.md),
revérifiée directement dans le code pendant cette implémentation. Ce banc est
un **vérificateur expérimental**, créé pour explorer le concept, jamais une
preuve de fiabilité de JARVIS ni une preuve d'envoi externe (aucun outil ici
ne touche le réseau — voir §« Limites »).

## Principe

1. **Oracle (`oracle.ts`)** — la postcondition attendue est calculée
   **avant** l'exécution, depuis l'entrée déjà autorisée et un instantané de
   l'état initial (`InMemoryMailClient.listSent()`). La sortie de l'outil
   n'intervient jamais dans ce calcul. `runner.ts` fige cette entrée par
   `structuredClone` avant de la transmettre à l'outil : un outil qui
   muterait son entrée en place (plutôt que de la reconstruire, comme le
   fait toujours `validateInput` dans ce dépôt) ne peut jamais, après coup,
   faire apparaître la trace comme ayant autorisé autre chose que ce qui a
   réellement été demandé (voir le test « mutation en place de l'entrée »,
   `bench.test.ts`).
2. **Exécution (`runner.ts`)** — chaque étape passe par le chemin réel
   `ToolRegistry → PermissionManager → ToolExecutor`, avec une politique de
   permission explicite (`BENCH_PERMISSION_POLICY`). Aucune permission ni
   confirmation n'est contournée pour faire passer un composant.
3. **Vérificateur (`verifier.ts`)** — confronte la postcondition à l'état
   observé _après_ l'exécution, jamais à la déclaration de l'outil seule.

## Verdicts

- **`pass`** : postcondition observable satisfaite.
- **`contradicted`** : une observation **suffisante** contredit la
  postcondition — un fait positif et complet (ex. aucun nouvel
  enregistrement n'est apparu alors qu'un envoi était attendu), jamais une
  simple absence d'information.
- **`no_evidence`** : observation absente ou insuffisante. Couvre deux
  situations distinctes, jamais confondues :
  - aucun observateur approprié n'existe pour le composant (`F1`) ;
  - un champ déclaré par l'outil n'a aucune contrepartie dans le modèle
    observable (`F5`, champ `cc`) — **son absence ne démontre jamais, à elle
    seule, une contradiction.**

`executed` (statut technique de `ToolExecutor`) n'est **jamais** promu
automatiquement en réussite métier : les 5 cas `F1`-`F5` ont tous
`status: 'executed'`, et pourtant 4 verdicts sur 5 diffèrent de `pass`
(voir le test « ne transforme jamais... » dans `bench.test.ts`).

## Les 10 cas (`cases.ts`)

| Cas | Nature     | Composant                                                       | Attendu                  |
| --- | ---------- | --------------------------------------------------------------- | ------------------------ |
| V1  | production | `inmemory.send` (@jarvis/connectors, non modifié)               | `pass`                   |
| V2  | production | idem, deux envois successifs                                    | `pass`                   |
| V3  | production | idem, sujet vide (cas limite valide)                            | `pass`                   |
| V4  | production | idem, + une action non liée après coup                          | `pass`                   |
| V5  | production | idem, deux instances isolées (test dédié)                       | `pass` × 2, aucune fuite |
| F1  | **double** | substitut de `internal.fake_execute` (voir ci-dessous)          | `no_evidence`            |
| F2  | **double** | « no-op-send » : succès annoncé, aucun nouvel effet             | `contradicted`           |
| F3  | **double** | « wrong-target » : effet réel, mauvais destinataire             | `contradicted`           |
| F4  | **double** | « stale-id » : ancien identifiant réutilisé, aucun nouvel effet | `contradicted`           |
| F5  | **double** | « extra-claim » : effet correct + champ `cc` non observable     | `no_evidence`            |

**« production »** = composant réel de `@jarvis/connectors`, importé tel
quel, **jamais modifié** par ce banc. **« double »** = composant fabriqué
pour ce seul banc (`faulty-doubles.ts`), explicitement commenté comme tel,
jamais présenté comme un comportement réel de JARVIS.

### Décision documentée — F1

`internal.fake_execute` (`apps/api/src/tools/internal-fake-tool.ts`,
ADR-0009) est un exemple **réel et déjà existant** dans le dépôt d'un succès
auto-déclaré sans preuve externe. Il n'est toutefois **pas importé
directement** : le faire traverserait, pour un seul cas de test, les
frontières de workspace qu'ADR-0001 établit (aucune autre brique du dépôt ne
dépend d'une app). `buildFakeExecuteAlikeTool()` (`faulty-doubles.ts`)
reproduit fidèlement son comportement documenté — même absence totale de
backing store — sans cet import disproportionné. Le cas `F1` reste donc
`fault_double`, pas `production`, et le dit explicitement dans sa
`componentNote`.

### Pourquoi `tool-interface-bench/capabilities.ts` n'est pas réutilisé ici

Ses capacités simulées (`search_notes`/`draft_note`/`publish_note`/
`delete_note`) reposent sur `SIMULATED_NOTES`, un tableau figé jamais muté.
Aucune trace indépendante du statut d'une note n'y existe — ce banc a donc
besoin d'un état mutable et observable séparément, que seul
`InMemoryMailClient` (`#sent` + `listSent()`) fournit dans le dépôt
aujourd'hui.

## Tests et vérification

```bash
npx vitest run prototypes/verify-postcondition-bench/
npm run typecheck:verify-postcondition-bench
```

Aucun réseau, aucun LLM : `bench.test.ts` est entièrement déterministe et
inclus dans `npm test` comme n'importe quel autre test du dépôt.

## Limites assumées

- Un enregistrement dans `listSent()` prouve un effet **simulé local**,
  jamais une livraison Gmail ni aucun effet externe.
- Ce banc ne couvre que des appels **uniques et synchrones** : les fautes de
  **redelivery, duplication ou corruption d'état** (deux confirmations
  indépendantes aboutissant à deux envois réels, un effet qui se
  matérialiserait après le retour de `execute()`…) sont **délibérément
  différées** à une expérience ultérieure — les inclure ici aurait élargi le
  périmètre au-delà d'un protocole minimal.
- `confirmed: true` sur une étape simule une confirmation déjà acquise,
  exactement comme `tool-interface-bench` le fait pour ses missions M05/M06.
  Cela exerce la branche de `ToolExecutor` qui accepte une confirmation déjà
  autorisée — cela ne teste ni `ConfirmationService` ni son cycle de vie réel.
- Aucune modification de `ToolExecutor`, `PermissionManager`,
  `InMemoryMailClient`, `inMemoryConnector`, ni d'aucun contrat de
  production. Seul code nouveau : ce répertoire.

## Fichiers

| Fichier             | Rôle                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `oracle.ts`         | Postcondition calculée avant exécution, et instantané de l'état observable.   |
| `faulty-doubles.ts` | Les 5 doubles de faute (dont le substitut de `internal.fake_execute`).        |
| `verifier.ts`       | Confronte postcondition + état observé + déclaration technique → verdict.     |
| `cases.ts`          | Les 10 cas du protocole.                                                      |
| `runner.ts`         | Exécute un cas via le chemin réel `ToolExecutor`, produit une trace complète. |
| `bench.test.ts`     | Tests déterministes.                                                          |
| `tsconfig.json`     | Typecheck dédié (`npm run typecheck:verify-postcondition-bench`).             |
