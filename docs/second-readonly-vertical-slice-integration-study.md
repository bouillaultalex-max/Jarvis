# VS-02d — Étude de faisabilité : branchement minimal à VS-01

Date : 2026-09-15. Document **conceptuel et documentaire uniquement**. Il ne
modifie aucun code, aucune ADR existante, aucun contrat de production —
aucun fichier applicatif n'est touché par cette étude, y compris les trois
modules VS-02 déjà validés. Il prolonge
[`docs/second-readonly-vertical-slice.md`](./second-readonly-vertical-slice.md)
en étudiant comment relier ses trois briques isolées
(`read-intent-parser.ts`, `read-intent-to-tool-request.ts`,
`read-interpretation-acceptance.ts`) à `runReadFlow` (VS-01), sans encore
l'implémenter.

**Convention de lecture**, reprise des études précédentes :
**[fait démontré]** = observé dans le code (fichier:ligne cité) ;
**[absent]** = recherché et non trouvé ; **[proposition]** = idée de ce
document ; **[décision ouverte]** = à arbitrer.

## 1. Objectif

VS-01 fournit une lecture Gmail CLI déterministe et testée. VS-02a/b/c
fournissent, isolément, un parser d'intention, une conversion contrôlée
vers `ToolRequest`, et une acceptation explicite — aucun des trois n'est
relié à quoi que ce soit d'exécutable. Cette étude détermine **le plus
petit branchement possible** entre ces briques et `runReadFlow`, sans
dégrader VS-01, sans créer de nouveau mécanisme de permission ou de
confirmation, et sans encore écrire ce code.

## 2. État existant

**VS-01, inchangée, réutilisable telle quelle [fait démontré]** :
- `runReadFlow(deps, input: GmailReadInput, write, connect)`
  (`apps/desktop/src/main.ts:413-440`) : résout le compte, construit
  `GmailApiClient`, `ToolRegistry`, `PermissionManager` (défaut
  `{rules:{'gmail.read':'allow'}}`), `ToolExecutor`, puis appelle
  **littéralement** `executor.run({tool: 'gmail.read', input})` — le nom de
  l'outil est **codé en dur dans le corps de la fonction**, jamais dérivé
  d'un paramètre. `input` est le **seul** paramètre variable transmis.
- `describeReadResult(result)` (`main.ts:385-400`) : restitution minimale,
  déjà partagée par tous les statuts de `ToolExecutionResult`.
- `dispatch(argv, deps, io, connect)` (`main.ts:694-747`) : aiguillage par
  nom de commande, chaque branche indépendante.
- `parseGmailReadArgs` (`main.ts:653-691`) : spécifique à la commande
  `read` existante, non concerné par cette étude (le nouveau flux
  n'analyse pas `--maxResults`, il dérive un nombre du texte libre).

**VS-02, isolée, jamais appelée depuis `main.ts` [fait démontré]** —
recherche exhaustive (`grep`) confirmant qu'aucun des trois modules n'est
importé par `main.ts` ni par aucun autre fichier hors de leurs propres
tests :
- `interpretReadRequest(text): ReadInterpretation`
  (`read-intent-parser.ts:177`).
- `convertReadInterpretationToToolRequest(interpretation): ReadToolRequestConversionResult`
  (`read-intent-to-tool-request.ts:107`) — accepte `ReadInterpretation`,
  renvoie `{ok:true, toolRequest: ToolRequest}` ou `{ok:false, reason}`.
- `describeReadInterpretationProposal(interpretation): readonly string[] | undefined`
  et `requestReadInterpretationAcceptance(interpretation, io): Promise<InterpretationAcceptanceResult>`
  (`read-interpretation-acceptance.ts:71, 102`).

**Constat central, déjà entrevu dans les études précédentes, confirmé ici
avec précision** : la forme produite par `convertReadInterpretationToToolRequest`
(`{tool:'gmail.read', input:{maxResults?: number}}`) a un `input` de forme
**structurellement identique** à `GmailReadInput`
(`packages/connectors/src/gmail/gmail-connector.ts:23-25`), le paramètre
que `runReadFlow` attend déjà. Aucune adaptation de forme n'est nécessaire.

## 3. Flux actuel VS-01

```
argv (« read --maxResults 5 »)
  → parseGmailReadArgs (déterministe, --maxResults uniquement)
  → runReadFlow(deps, input, write, connect)
      → resolveOrConnectGmailAccount
      → resolveGmailApiClient
      → ToolRegistry ← gmailConnector.createTools(client)
      → PermissionManager (gmail.read → allow)
      → ToolExecutor.run({tool:'gmail.read', input})
      → describeReadResult → write
```

## 4. Flux cible VS-02d

```
texte libre (« affiche mes 5 derniers mails »)
  → interpretReadRequest(texte) → ReadInterpretation
      status !== 'understood' OU proposedRead absent
        → arrêt immédiat, AUCUN compte résolu, AUCUN ToolExecutor construit
      status === 'understood' ET proposedRead présent
        → requestReadInterpretationAcceptance(interpretation, io)
            accepted === false → arrêt, AUCUN outil atteint
            accepted === true
              → convertReadInterpretationToToolRequest(interpretation)
                  ok === false → arrêt, AUCUN outil atteint
                  ok === true
                    → runReadFlow(deps, toolRequest.input, write, connect)
                        (VS-01, strictement inchangée, réutilisée telle quelle)
```

**Propriété structurelle centrale** : entre « acceptation obtenue » et
« `ToolExecutor` réellement invoqué », le nouveau code n'a **jamais** à
nommer `'gmail.read'` lui-même — c'est `runReadFlow` qui le fait, en dur,
à son unique ligne d'appel (`main.ts:435`). Le nouveau code ne transmet
qu'un `input`, jamais un nom d'outil. Cette propriété répond, à elle
seule, à la question « comment garantir qu'aucun autre outil que
`gmail.read` — en particulier `gmail.send` — ne peut être atteint par ce
flux » (section 9).

## 5. Surfaces inspectées

- `apps/desktop/src/main.ts` — `DesktopDeps` (`:159-190`), `dispatch`
  (`:694-747`), `runReadFlow` (`:413-440`), `describeReadResult`
  (`:385-400`), `parseGmailReadArgs` (`:653-691`), `ConnectGmailFn`
  (`:197-200`).
- `apps/desktop/src/main-read.test.ts` — relu intégralement (6 cas), patron
  `fetchFn`/`DesktopDeps`/`forbiddenConnect`.
- `apps/desktop/src/read-intent-parser.ts` et son test (20 cas).
- `apps/desktop/src/read-intent-to-tool-request.ts` et son test (15 cas).
- `apps/desktop/src/read-interpretation-acceptance.ts` et son test (19 cas).
- `apps/desktop/src/terminal-confirm.ts` — patron d'injection `readline`
  déjà réutilisé par `read-interpretation-acceptance.ts`.
- `packages/connectors/src/gmail/gmail-connector.ts` — contrat exact de
  `GmailReadInput`.

## 6. Options d'intégration

1. **Nouvelle commande CLI dédiée** (ex. `read-natural <texte>`) —
   **[recommandé]**. Isole complètement le nouveau chemin dans `dispatch`,
   sans toucher à la branche `read` existante ni à `parseGmailReadArgs`.
2. **Mode distinct sur la commande existante** (ex. `read --natural
   "texte"`) — rejeté : mélangerait deux grammaires d'entrée (arguments
   structurés vs texte libre) dans une seule commande, risque de confusion
   et de régression accidentelle sur `parseGmailReadArgs`.
3. **Fonction d'orchestration séparée, non branchée à `dispatch`
   pour l'instant** — **[recommandé]**, complémentaire à l'option 1 : la
   logique de séquencement (interprétation → acceptation → conversion →
   `runReadFlow`) vit dans une fonction exportée testable indépendamment,
   que `dispatch` appellera plus tard (implémentation hors de cette étude).
4. **Module dédié, par exemple `read-natural-flow.ts`** —
   **[recommandé]**, nom à ajuster aux conventions (`read-*-flow.ts`
   n'existe pas encore comme motif, mais `main.ts` nomme déjà ses fonctions
   `run*Flow` — un module séparé portant `runNaturalLanguageReadFlow`
   resterait cohérent sans dupliquer le nom `runReadFlow`).
5. **Étendre `runReadFlow` lui-même** pour accepter un texte libre en plus
   d'un `GmailReadInput` — rejeté : violerait la règle « ne pas modifier
   les trois modules VS-02 existants » par extension logique (VS-01 en
   fait strictement partie et ne doit pas non plus être modifiée d'après
   les règles impératives de cette étape) et mélangerait deux
   responsabilités déjà bien séparées.

## 7. Option recommandée

Un **nouveau module isolé** (ex. `apps/desktop/src/read-natural-language-flow.ts`,
nom à confirmer) exportant une fonction d'orchestration
(ex. `runNaturalLanguageReadFlow`), **non branchée à `dispatch`/`main.ts`
dans l'implémentation qui suivra cette étude** tant qu'une décision
explicite n'aura pas validé la commande CLI dédiée (option 1). Cette
fonction :
- importe `interpretReadRequest`, `requestReadInterpretationAcceptance`,
  `convertReadInterpretationToToolRequest` (les trois modules VS-02) ;
- importe `runReadFlow` depuis `main.ts` (déjà exporté,
  `export async function runReadFlow`) — **aucune extraction n'est
  nécessaire** (section 2) ;
- n'importe **jamais** `gmailConnector`, `ToolRegistry`, `ToolExecutor`,
  `PermissionManager`, `ConfirmationService` directement — ces
  responsabilités restent exclusivement dans `runReadFlow`, inchangé.

## 8. Contrat d'orchestration proposé

Aucun type TypeScript définitif — description conceptuelle, à affiner au
moment de l'implémentation.

```
runNaturalLanguageReadFlow(
  deps: DesktopDeps,
  naturalLanguageRequest: string,
  acceptanceIo: ReadInterpretationAcceptanceIo,
  write: (line: string) => void,
  connect: ConnectGmailFn,
) → Promise<NaturalLanguageReadFlowResult>
```

`NaturalLanguageReadFlowResult` — union fermée, à l'image des autres
résultats du dépôt (`RunGmailSendResult`, `ToolExecutionResult`) :
- `{ status: 'not_understood' }` — interprétation `ambiguous`/`unsupported`/
  sans `proposedRead` ; aucun outil atteint.
- `{ status: 'declined'; reason: InterpretationAcceptanceRefusalReason }` —
  acceptation refusée ; aucun outil atteint.
- `{ status: 'conversion_failed'; reason: string }` — cas défensif,
  normalement inatteignable si l'acceptation ne porte que sur une
  interprétation déjà `understood` valide, mais **jamais supposé
  impossible** (même discipline que la « défense en profondeur » déjà
  documentée dans `read-intent-to-tool-request.ts`).
- `{ status: 'executed'; result: ToolExecutionResult }` — délégation
  intégrale au résultat de `runReadFlow`, jamais réinterprété.

**Point d'implémentation à noter, non résolu ici** : `ToolRequest.input`
est typé `unknown` (`tool-executor.ts:10`) ; le passer à `runReadFlow`
(qui attend `GmailReadInput`) nécessitera soit une assertion de type
documentée (sûre, car `convertReadInterpretationToToolRequest` garantit la
forme à l'exécution), soit une revalidation structurelle légère avant
l'appel. Détail d'implémentation, pas une décision bloquante.

## 9. Frontières de sécurité

Réponses précises aux six garanties demandées :

| Garantie demandée | Comment elle est assurée |
|---|---|
| `ambiguous`/`unsupported` s'arrêtent avant tout outil | `describeReadInterpretationProposal`/`requestReadInterpretationAcceptance` renvoient un refus **avant** tout appel à `resolveOrConnectGmailAccount` — aucune ligne du flux cible (section 4) n'atteint `runReadFlow` avant l'acceptation |
| Un refus s'arrête avant tout outil | `runReadFlow` n'est appelé **qu'après** `acceptance.accepted === true` — jamais avant, jamais en parallèle |
| Seule une interprétation acceptée devient `ToolRequest` | `convertReadInterpretationToToolRequest` n'est appelée qu'après l'acceptation — jamais avant, jamais sur un refus |
| Le `ToolRequest` passe toujours par `PermissionManager`/`ToolExecutor` | Assuré **par construction** : le nouveau code ne construit jamais lui-même de `ToolExecutor` — il délègue entièrement à `runReadFlow`, qui les construit déjà (`main.ts:427-433`) |
| Aucun appel direct à `gmail.read` n'est ajouté | Le nouveau code n'importe jamais `gmailConnector` — seul `runReadFlow` le fait, inchangé |
| VS-01 reste inchangée | `runReadFlow`, `dispatch`, `parseGmailReadArgs`, `describeReadResult` ne sont ni modifiés ni redéfinis — seulement **appelés**, à l'identique de ce que fait déjà la commande `read` existante |

**Garantie supplémentaire, découverte durant cette étude (section 4)** :
`gmail.send` est **structurellement inatteignable** par ce flux, non
seulement parce que le nouveau code ne l'importe jamais, mais parce que
`runReadFlow` lui-même ne construit jamais de requête pour un autre outil
que `'gmail.read'` — cette chaîne littérale est écrite en dur dans son
corps (`main.ts:435`), indépendamment de tout paramètre reçu.

## 10. Stratégie d'injection

Aucune nouvelle capacité d'injection n'est nécessaire — toutes existent déjà :
- **Entrée utilisateur** (texte libre) : simple paramètre `string` de la
  fonction d'orchestration — pas de flux à simuler.
- **Sortie terminal** : le paramètre `write` déjà utilisé par tous les
  flux de `main.ts`, plus `acceptanceIo.output` déjà défini par
  `ReadInterpretationAcceptanceIo` (`read-interpretation-acceptance.ts:50-53`).
- **Réponse d'acceptation simulée** : `acceptanceIo.input`, déjà testé par
  `read-interpretation-acceptance.test.ts` (patron `Readable.from([...])`).
- **Compte Gmail** : `DesktopDeps.accountStore`/`secretStore` déjà
  substituables (`InMemoryAccountStore`/`InMemorySecretStore`, déjà
  utilisés par `main-read.test.ts`), `connect` déjà substituable
  (`ConnectGmailFn`, patron `forbiddenConnect` déjà éprouvé).
- **`ToolExecutor`/résultats/erreurs** : `DesktopDeps.fetchFn` (déjà
  substituable, patron `buildFakeGmail` de `main-read.test.ts`) et
  `DesktopDeps.permissionManager` (déjà substituable) — aucune nouvelle
  seam requise, puisque `runReadFlow` est réutilisé sans modification.

## 11. Scénarios de test (proposés, non implémentés)

Tous réalisables sans réseau réel, en composant les patrons déjà éprouvés
par `main-read.test.ts` et `read-interpretation-acceptance.test.ts` :

1. **Demande claire + acceptation + lecture simulée réussie** —
   `interpretReadRequest` → `understood`, réponse `oui` simulée,
   `fetchFn` renvoyant des messages fictifs → `status: 'executed'`,
   restitution identique à VS-01.
2. **Demande claire + refus** — réponse `non` simulée → `status:
   'declined'`, `fetchFn` **jamais appelé** (assertion cruciale,
   transposée de `main-read.test.ts:193`).
3. **Demande ambiguë** — `interpretReadRequest` → `ambiguous` → `status:
   'not_understood'`, aucun compte résolu, `fetchFn` jamais appelé.
4. **Demande `unsupported`** — même vérification, y compris pour un texte
   évoquant explicitement une écriture (« lis mes mails et réponds à
   Paul ») — `fetchFn` jamais appelé, en particulier jamais de requête
   `POST` vers l'API Gmail.
5. **Demande claire sans compte Gmail** — après acceptation, `runReadFlow`
   propage l'erreur de résolution de compte **exactement** comme VS-01
   (`main-read.test.ts:152-165`), sans changement de comportement.
6. **Demande claire avec compte Gmail ambigu** — après acceptation,
   `AmbiguousAccountError` propagée à l'identique
   (`main-read.test.ts:167-194`).
7. **Échec contrôlé de `ToolExecutor`** — ex. `fetchFn` renvoyant une
   erreur HTTP → `status: 'executed'` avec un `ToolExecutionResult` de
   statut `error`, restitué par `describeReadResult` inchangé — aucune
   réinterprétation par le nouveau code.
8. **Vérification que VS-01 reste inchangée** — ré-exécution de
   `main-read.test.ts` sans modification, 6/6 toujours verts (déjà une
   pratique systématique des sessions précédentes).
9. **Vérification que `gmail.send` ne peut pas être atteint** — assertion
   qu'aucun appel `fetchFn` avec `method: 'POST'` vers
   `/messages/send` n'a lieu, quel que soit le texte fourni, y compris un
   texte contenant explicitement des mots-clés d'écriture.

## 12. Risques

- **Confusion possible entre `status: 'declined'` (acceptation) et
  `status: 'denied'` (`ToolExecutionResult`, permission)** — deux échecs de
  nature différente, à ne jamais fusionner dans la restitution finale ;
  déjà distingués par construction (deux champs de statut différents dans
  `NaturalLanguageReadFlowResult` proposé), mais à surveiller à
  l'implémentation.
- **Tentation d'ajouter un raccourci** (ex. sauter l'acceptation si
  `maxResults` est absent) — explicitement à éviter, romprait la garantie
  « seule une interprétation acceptée devient `ToolRequest` ».
- **Risque hérité, non résolu par cette étude** : le vocabulaire fermé du
  parser (VS-02a) reste une limite connue — une formulation légitime mais
  non reconnue produira `unsupported`/`ambiguous` plutôt qu'une lecture,
  ce qui est le comportement voulu (jamais deviner), mais peut frustrer un
  usage réel si le vocabulaire n'est pas étendu prudemment plus tard.

## 13. Décisions ouvertes

- **[décision ouverte]** Nom exact du nouveau module et de la fonction
  d'orchestration (`read-natural-language-flow.ts` /
  `runNaturalLanguageReadFlow` proposés, non arrêtés).
- **[décision ouverte]** Nom exact de la nouvelle commande CLI
  (`read-natural`, `ask`, ou autre) — à trancher avant le branchement à
  `dispatch`, hors périmètre de cette étude.
- **[décision ouverte]** Faut-il un paramètre `--natural` sur la commande
  `read` existante en plus d'une commande dédiée, ou strictement l'une ou
  l'autre ? Cette étude recommande strictement une commande dédiée
  (section 6), mais ne ferme pas la question pour une évolution future.
- **[décision ouverte]** La forme exacte de `NaturalLanguageReadFlowResult`
  (section 8) reste à valider au moment de l'implémentation — proposition
  minimale, pas un contrat figé.

## 14. Périmètre exclu

- Toute modification de `main.ts`, `main-read.test.ts`, `AgentLoop`,
  `ToolExecutor`, `PermissionManager`, `ConfirmationService`, ou des trois
  modules VS-02 existants.
- Tout branchement réel à `dispatch()` — reporté à une étape
  d'implémentation distincte, après validation de cette étude.
- Tout appel réseau, LLM, Gmail réel, mémoire, ou Situation structurée.
- Toute refonte de `runReadFlow` — cette étude démontre qu'aucune
  extraction n'est nécessaire (section 2), donc aucune n'est proposée.
- La création du nouveau module lui-même — reportée à l'implémentation ;
  ce document ne contient qu'une conception, aucun code n'a été écrit dans
  le dépôt.

## 15. Critères de réussite

Pour qu'une future implémentation de VS-02d soit considérée conforme à
cette étude :
- `runReadFlow` n'est ni modifié ni dupliqué ;
- les trois modules VS-02 sont importés tels quels, sans modification ;
- aucun `ToolExecutor`/`PermissionManager`/`ConfirmationService` n'est
  instancié en dehors de `runReadFlow` ;
- les 60 tests VS-02 existants et les 6 tests VS-01 restent verts sans
  modification ;
- les scénarios 1 à 9 (section 11) sont couverts par de nouveaux tests,
  tous sans réseau réel ;
- `gmail.send` demeure structurellement inatteignable, vérifié par un test
  explicite (scénario 9) ;
- aucune nouvelle commande n'altère le comportement de la commande `read`
  existante.
