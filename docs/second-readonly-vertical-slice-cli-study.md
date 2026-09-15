# VS-02e — Étude de branchement CLI minimal

Date : 2026-09-15. Document **conceptuel et documentaire uniquement**. Il ne
modifie aucun code, aucune ADR existante, aucun contrat de production —
aucun fichier n'est touché par cette étude. Il prolonge
[`docs/second-readonly-vertical-slice-integration-study.md`](./second-readonly-vertical-slice-integration-study.md)
en précisant la forme d'interface CLI la plus sûre pour exposer
`runReadNaturalLanguageFlow` (VS-02d), sans encore l'implémenter.

**Convention de lecture**, reprise des études précédentes :
**[fait démontré]** = observé dans le code (fichier:ligne cité) ;
**[absent]** = recherché et non trouvé ; **[proposition]** = idée de ce
document ; **[décision ouverte]** = à arbitrer.

## 1. Objectif et périmètre

VS-02d fournit une orchestration complète et testée
(`apps/desktop/src/read-natural-language-flow.ts`), non branchée au CLI.
Cette étude détermine **comment** l'exposer plus tard via une commande
dédiée (`read-natural`), sans encore écrire ce code : forme d'interface,
réutilisation exacte des paramètres déjà disponibles, adaptations
minimales, garanties de sécurité déjà acquises vs à démontrer, et plus
petit lot d'implémentation possible.

## 2. État actuel du CLI

**Lancement** [fait démontré] : `apps/desktop/package.json` déclare
`"dev": "tsx watch src/main.ts"` — aucun champ `bin`, aucun script
`start` [absent, recherché explicitement]. Le point d'entrée réel est
gardé par `if (require.main === module)` (`main.ts:759-764`) : `main()`
n'exécute que si `main.ts` est le fichier directement invoqué (jamais au
simple import, ce qui permet aux tests d'importer `dispatch` sans
déclencher d'exécution).

**Récupération des arguments** [fait démontré] : `main()` appelle
`dispatch(process.argv.slice(2), defaultDesktopDeps())` (`main.ts:749-750`)
— `process.argv.slice(2)` retire le binaire node et le chemin du script,
ne laissant que les arguments utilisateur.

**Fonctionnement de `dispatch()`** [fait démontré] (`main.ts:694-747`) :
```ts
export async function dispatch(
  argv: readonly string[],
  deps: DesktopDeps,
  io: DesktopIo = {},
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<void>
```
- `const command = argv[0]` — **premier élément seul**, reconnu par
  égalité stricte de chaîne (`'send'`, `'disconnect'`, `'read'`,
  `'inbox'`, `'prepare-reply'`, `undefined`/`'connect'`) ; toute autre
  valeur lève une erreur générique (`main.ts:744-746`).
- **Séparation commande/arguments** : chaque branche retire la commande
  avec `argv.slice(1)` avant de la transmettre à son propre parseur (ex.
  `parseGmailReadArgs(argv.slice(1))`, `main.ts:722`).
- **Écriture terminal** : `const output = io.output ?? process.stdout`
  puis `const write = (line) => output.write(`${line}\n`)`
  (`main.ts:700-703`) — injecté dans chaque flux (`runReadFlow`,
  `runSendFlow`, etc.) comme callback `write`, jamais un flux direct.
- **Entrée terminal** : `io.input` n'est utilisé **que** par la branche
  `send`, transmise à `createTerminalConfirm({input: io.input, output})`
  (`main.ts:708-711`) — aucune autre branche ne lit `io.input`
  aujourd'hui.

**Gestion des erreurs et code de sortie** [fait démontré]
(`main.ts:759-764`) : `main().catch((err) => { console.error(...); 
process.exit(1); })` — un échec de `dispatch()` (exception propagée) sort
avec le code `1` et un message d'erreur générique sur `stderr`. Aucun code
de sortie explicite en cas de succès (défaut Node : `0`).

**Construction des dépendances** [fait démontré]
(`defaultDesktopDeps`, `main.ts:202-218`) : lit
`GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET` (obligatoires, sinon exception
immédiate), construit `FileAccountStore`/`OsCredentialSecretStore` réels,
lit optionnellement `GMAIL_ACCOUNT_ID`.

**Résolution de la connexion Gmail** [fait démontré]
(`resolveOrConnectGmailAccount`, `main.ts:355-374`) : tente
`resolveExistingGmailConnection` (compte déjà connecté), sinon lance le
consentement OAuth via `connect(deps, write)` — jamais de sélection
implicite entre plusieurs comptes (`AmbiguousAccountError` propagée telle
quelle).

**Pas de vérification de terminal interactif (`isTTY`)** [absent, recherché
explicitement — aucune occurrence dans `apps/desktop/src/*.ts`] : le CLI
ne distingue jamais explicitement un terminal interactif d'un flux
redirigé — la robustesse en environnement non interactif repose
entièrement sur le comportement de `readline` lui-même (événement
`'close'` sur un flux sans données, déjà exploité par
`createTerminalConfirm` et `requestReadInterpretationAcceptance`).

## 3. Flux actuel de lecture

```
process.argv.slice(2) = ["read", "--maxResults", "5"]
  → dispatch() reconnaît "read" (argv[0])
  → parseGmailReadArgs(argv.slice(1)) → GmailReadInput déterministe
  → runReadFlow(deps, input, write, connect)   (VS-01, inchangé)
```

Ce chemin reste **totalement séparé** du chemin VS-02d
(`interpretReadRequest → requestReadInterpretationAcceptance → 
convertReadInterpretationToToolRequest → runReadFlow`), qui n'est
aujourd'hui invoqué que par ses propres tests.

## 4. Réutilisation de VS-02d

**Signature exacte** [fait démontré]
(`read-natural-language-flow.ts:114-121`) :
```ts
export async function runReadNaturalLanguageFlow(
  naturalLanguageRequest: string,
  deps: DesktopDeps,
  acceptanceIo: ReadInterpretationAcceptanceIo = {},
  write: (line: string) => void = console.log,
  connect?: ConnectGmailFn,
  dependencies: ReadNaturalLanguageFlowDependencies = {},
): Promise<ReadNaturalLanguageFlowResult>
```

**Paramètres déjà compatibles avec `dispatch()` sans adaptation** :
- `deps: DesktopDeps` — exactement ce que `dispatch()` reçoit déjà et
  transmet à chaque flux.
- `write: (line: string) => void` — exactement le callback déjà construit
  par `dispatch()` (`main.ts:701-703`).
- `connect?: ConnectGmailFn` — exactement ce que `dispatch()` reçoit déjà
  en paramètre (`connect: ConnectGmailFn = runOAuthConnect`).
- `acceptanceIo: ReadInterpretationAcceptanceIo` — même forme exacte
  (`{input?, output?}`) que `DesktopIo` (`main.ts:633-636`) et que
  `TerminalConfirmIo` déjà utilisée pour `send` — `io.input`/`io.output`
  de `dispatch()` seraient transmis tels quels, sans conversion.
- `dependencies` — optionnel, defaults internes déjà présents ; un futur
  appel CLI n'aurait **jamais** besoin de le fournir (usage réel, pas de
  test).

**Fonctions qui doivent rester celles de `main.ts`** : `runReadFlow`
lui-même (déjà le cas — `read-natural-language-flow.ts` l'importe depuis
`./main.js`, ne le redéfinit jamais) ; `DesktopDeps`, `ConnectGmailFn`,
`DesktopIo` (types partagés, inchangés).

**Fonctions qui pourraient être injectées** : aucune injection
`dependencies` n'est nécessaire pour un usage CLI réel — ce paramètre
n'existe que pour la testabilité de VS-02d lui-même (déjà couverte par ses
propres 9 tests). Un futur code de branchement CLI n'aurait besoin
d'appeler `runReadNaturalLanguageFlow` qu'avec ses 5 premiers paramètres.

**Problèmes de visibilité/export** [absent — aucun problème identifié] :
`runReadNaturalLanguageFlow`, `DesktopDeps`, `ConnectGmailFn`, `DesktopIo`
sont tous déjà `export`. `ReadInterpretationAcceptanceIo` est déjà
`export` (`read-interpretation-acceptance.ts:50-53`). Aucun symbole requis
n'est privé.

**Problèmes de type** [absent — aucun problème identifié] : la forme de
`DesktopIo` (`{input?, output?}`) et celle de `ReadInterpretationAcceptanceIo`
sont structurellement identiques (deux interfaces séparées, même forme) —
un objet `io: DesktopIo` reçu par `dispatch()` satisferait déjà
`ReadInterpretationAcceptanceIo` sans conversion, par compatibilité
structurelle TypeScript (duck typing), sans cast ni assertion.

**Problèmes liés à l'appel de `runReadFlow()`** [absent, déjà résolu par
VS-02d lui-même] : `read-natural-language-flow.ts:150-156` documente déjà
l'unique point d'attention (assertion `as GmailReadInput` sur
`conversion.toolRequest.input`, typé `unknown`) — déjà réglé dans VS-02d,
rien à refaire côté CLI.

## 5. Comparaison des options d'interface

### Option A — Texte en argument (`read-natural "Lis mes 5 derniers emails"`)
- **Compatibilité architecture** : élevée — `argv.slice(1).join(' ')` (ou
  `argv[1]` si un seul argument est exigé) fournit directement le
  `naturalLanguageRequest: string` attendu.
- **Simplicité d'implémentation** : élevée — aucune nouvelle abstraction,
  juste une branche `dispatch()` supplémentaire.
- **Testabilité** : élevée — un tableau `argv` littéral suffit, même
  patron que tous les tests CLI existants (`main-read.test.ts`).
- **Expérience utilisateur** : correcte pour un usage scripté ou rapide ;
  moins naturelle pour une phrase longue.
- **Espaces et guillemets** : nécessite que l'utilisateur guillemette sa
  phrase (`"..."`) — sans quoi le shell la découpe en plusieurs arguments
  `argv[1]`, `argv[2]`… Le futur parseur devrait donc soit exiger un seul
  argument (rejeter si `argv.length > 2`), soit rejoindre tous les
  arguments restants avec un espace (`argv.slice(1).join(' ')`) —
  décision à trancher (section 12).
- **Environnement non interactif** : fonctionne nativement (aucune saisie
  requise après le lancement) — l'acceptation reste interactive
  séparément (voir section 4).
- **Confusion avec `read`** : faible — nom de commande distinct
  (`read-natural` ≠ `read`), argument positionnel absent de `read`
  aujourd'hui (qui n'a que `--maxResults`).
- **Acceptation explicite conservée** : oui — `runReadNaturalLanguageFlow`
  l'appelle toujours en interne, indépendamment de la source du texte.
- **Risques de sécurité/contournement** : aucun nouveau — le texte reste
  une donnée non fiable interprétée par `interpretReadRequest`, jamais
  exécutée directement.
- **Impact sur le périmètre** : minimal — une branche `dispatch()`, un
  parseur d'arguments trivial (pas de réutilisation de
  `parseGmailReadArgs`, incompatible par nature avec du texte libre).

### Option B — Saisie interactive (`read-natural` puis prompt)
- **Compatibilité architecture** : élevée — un second `readline`
  (ou réutilisation du même patron que `createTerminalConfirm`) précède
  simplement l'appel à `runReadNaturalLanguageFlow`.
- **Simplicité d'implémentation** : légèrement supérieure à A pour la
  saisie elle-même, mais ajoute **une deuxième interaction `readline`**
  avant celle déjà interne à l'acceptation — deux invites successives
  (« Demande de lecture : » puis « Est-ce bien ce que tu souhaites ? »),
  à ne pas confondre l'une avec l'autre dans les tests ni pour
  l'utilisateur.
- **Testabilité** : correcte, mais exige de simuler **deux** flux
  `readline` séquentiels dans un même test (texte, puis acceptation) —
  patron déjà éprouvé isolément (`read-interpretation-acceptance.test.ts`)
  mais jamais enchaîné deux fois.
- **Expérience utilisateur** : la plus naturelle pour une phrase longue ou
  un usage conversationnel.
- **Espaces et guillemets** : non pertinent — la ligne entière tapée au
  prompt est le texte, aucun découpage shell.
- **Environnement non interactif** : un flux d'entrée fermé/vide produit
  un texte vide ou EOF dès la première invite — comportement à définir
  explicitement (section 7), mais cohérent avec le défaut sûr déjà
  pratiqué par `readline` dans ce dépôt.
- **Confusion avec `read`** : très faible — aucun argument positionnel du
  tout, expérience clairement distincte.
- **Acceptation explicite conservée** : oui, identique à l'option A.
- **Risques de sécurité/contournement** : aucun nouveau.
- **Impact sur le périmètre** : légèrement supérieur à A (un prompt
  supplémentaire à construire et tester), toujours minimal.

### Option C — Les deux modes (argument optionnel, sinon interactif)
- **Compatibilité architecture** : élevée, mais **combine** les deux
  chemins précédents — une branche qui teste `argv.slice(1).length > 0`
  pour choisir entre lecture directe de `argv` et prompt interactif.
- **Simplicité d'implémentation** : la plus faible des trois — cumule les
  deux logiques (parsing d'argument **et** prompt), plus un
  aiguillage entre elles.
- **Testabilité** : cumule les cas de test des options A et B, plus un
  test de l'aiguillage lui-même.
- **Expérience utilisateur** : la meilleure des trois (flexible), au prix
  de la complexité de conception la plus élevée.
- **Autres critères** : identiques à A/B selon le chemin emprunté.

### Tableau récapitulatif

| Critère | A (argument) | B (interactif) | C (les deux) |
|---|---|---|---|
| Simplicité d'implémentation | **Élevée** | Moyenne | Faible |
| Testabilité | **Élevée** | Moyenne | Moyenne |
| Risque de confusion avec `read` | Faible | **Très faible** | Faible |
| Complexité conceptuelle ajoutée | **Minimale** | Faible | Moyenne |
| Couverture d'usage | Scripté | Conversationnel | Les deux |

## 6. Recommandation

**Option A — texte en argument** est recommandée pour un premier
branchement minimal, avec la règle suivante pour le découpage des
guillemets : **exiger un seul argument après le nom de la commande**
(`argv.slice(1).length === 1`), rejeté sinon avec un message explicite
invitant à guillemetter la phrase — plutôt que de deviner en joignant les
arguments avec des espaces (qui perdrait la ponctuation exacte si
l'utilisateur oublie les guillemets, et masquerait une erreur d'usage
plutôt que de la signaler). Ce choix reste cohérent avec la discipline
déjà pratiquée par `parseGmailReadArgs`/`parseGmailSendArgs` : ne jamais
deviner, toujours rejeter explicitement une forme non prévue.

L'option B reste une **évolution ultérieure raisonnable** une fois
l'option A validée à l'usage — non retenue comme premier pas, pour garder
le plus petit lot d'implémentation possible (section 11). L'option C est
**prématurée** tant qu'aucun besoin réel des deux modes n'est démontré —
cohérent avec la discipline déjà appliquée ailleurs dans ce dépôt (`ADR-0010`
§9, `ADR-0006`) de ne pas généraliser avant un second besoin réel.

## 7. Entrées et erreurs

| Cas | Comportement proposé |
|---|---|
| Texte fourni en argument (un seul, guillemetté) | Transmis tel quel à `runReadNaturalLanguageFlow` |
| Texte vide (`read-natural ""`) | **[proposition]** Rejeté avant même d'appeler `interpretReadRequest` — message explicite (« texte vide »), cohérent avec `parseGmailSendArgs`/`parseGmailReadArgs` qui rejettent déjà les formes vides comparables |
| Texte absent (`read-natural` seul) | Selon l'option retenue (A : rejeté avec message d'usage ; B/C : bascule vers le prompt) |
| Texte à plusieurs mots | Cas nominal — aucun traitement spécial, `interpretReadRequest` le reçoit tel quel |
| Demande ambiguë | Propagé par `runReadNaturalLanguageFlow` (`status: 'ambiguous'`) — le futur branchement afficherait `interpretation.explanation` via `write`, sans jamais construire de `ToolRequest` |
| Demande non supportée | Identique, `status: 'unsupported'` |
| Demande comprise | Poursuite normale du flux (acceptation, conversion, lecture) |
| Refus de l'acceptation | `status: 'declined'` — afficher un message de refus, code de sortie `0` (un refus n'est pas une erreur technique) |
| Erreur de saisie / EOF | `status: 'acceptance_error'` — afficher un message générique, code de sortie à trancher (section 12) |
| Environnement non interactif | Le prompt d'acceptation reçoit un flux fermé → `input-error` par le comportement déjà existant de `requestReadInterpretationAcceptance` (`read-interpretation-acceptance.ts:117-124`), sans code additionnel nécessaire |

**Le module d'orchestration doit-il rester agnostique du terminal ?**
**Oui — déjà le cas** [fait démontré] : `runReadNaturalLanguageFlow` ne
lit ni n'écrit jamais directement `process.stdin`/`process.stdout` — tout
transite par les paramètres `write`/`acceptanceIo` déjà injectables
(`read-natural-language-flow.ts:114-120`). Le futur code CLI resterait le
seul responsable de la lecture du terminal réel (argument ou prompt).

## 8. Connexion Gmail et dépendances

Tous les éléments cités sont **réutilisables sans duplication** :
- `DesktopDeps` — déjà le type exact attendu par
  `runReadNaturalLanguageFlow` (section 4).
- `resolveOrConnectGmailAccount`/`ConnectGmailFn` — jamais appelés
  directement par le futur code CLI : ils restent internes à
  `runReadFlow`, lui-même appelé en interne par
  `runReadNaturalLanguageFlow`. Aucune duplication de cette logique.
- `runReadFlow`/`describeReadResult` — déjà réutilisés tels quels par
  VS-02d (section 4) ; le futur branchement CLI n'a besoin d'appeler ni
  l'un ni l'autre directement.
- **Fonctions d'écriture existantes** (`write`, `main.ts:701-703`) —
  directement compatibles, sans adaptation (section 4).

**Adaptation minimale identifiée, non implémentée** : la seule nécessité
concrète serait une nouvelle fonction de parsing d'arguments pour
`read-natural` (comparable à `parseGmailReadArgs`, mais pour du texte
libre plutôt que `--maxResults`) — un petit ajout local à `main.ts`, pas
une modification des fichiers VS-02 ni de `runReadFlow`.

## 9. Analyse de sécurité

| Garantie | Statut |
|---|---|
| Ne permet pas de choisir un outil arbitraire | **[garantie déjà démontrée par le code]** — `runReadNaturalLanguageFlow` ne transmet jamais `toolRequest.tool` à `runReadFlow`, uniquement `toolRequest.input` (`read-natural-language-flow.ts:156-162`, vérifié par test dédié VS-02d) |
| Ne transmet pas le nom d'outil depuis le texte utilisateur | **[garantie déjà démontrée]** — `interpretReadRequest` ne produit jamais qu'un `proposedRead.tool` figé à la valeur littérale `'gmail.read'` (`read-intent-parser.ts`), jamais dérivé du texte |
| Ne peut appeler que le chemin de lecture prévu | **[garantie déjà démontrée]** — `runReadFlow` code en dur `'gmail.read'` en interne (`main.ts:435`), indépendamment de tout paramètre |
| Ne permet pas d'atteindre `gmail.send` | **[garantie déjà démontrée]** — même raisonnement ; aucun chemin de VS-02d ni du futur branchement CLI ne construit ni ne transmet ce nom |
| Conserve l'acceptation explicite | **[garantie déjà démontrée]** — `runReadNaturalLanguageFlow` l'appelle systématiquement avant toute conversion (section 4) ; **dépendra du futur branchement** uniquement pour s'assurer qu'aucun code CLI ne contourne `runReadNaturalLanguageFlow` en appelant directement `convertReadInterpretationToToolRequest` |
| Ne contourne pas `PermissionManager` | **[garantie déjà démontrée]** — `runReadFlow`, inchangé, reste seul à le construire |
| Ne contourne pas `ToolExecutor` | **[garantie déjà démontrée]**, même raisonnement |
| Ne contourne pas `ConfirmationService` | **[garantie déjà démontrée]** — non pertinent pour `gmail.read` (action `read`, jamais `require_confirmation`) ; non importé nulle part dans la chaîne VS-02 |
| Ne transforme pas l'acceptation utilisateur en autorisation système | **[garantie déjà démontrée]** — documenté explicitement dans `read-interpretation-acceptance.ts:11-22` ; le futur branchement CLI n'a aucune raison d'altérer cette séparation tant qu'il se contente d'appeler `runReadNaturalLanguageFlow` |
| Ne prétend pas vérifier le résultat métier | **[garantie déjà démontrée]** — `status: 'read_result'` propage le `ToolExecutionResult` brut sans le qualifier (`read-natural-language-flow.ts`) ; **dépendra du futur branchement** pour que sa restitution terminale (affichage du résultat) n'invente pas non plus un vocabulaire de succès vérifié — point à surveiller à l'implémentation, pas garanti par un mécanisme automatique |

**Garanties non démontrées par cette étude** (car le branchement n'existe
pas encore) : le comportement réel du futur code CLI face à des entrées
malformées (ex. plusieurs arguments non guillemetés) ne peut être vérifié
qu'une fois ce code écrit et testé — cette étude ne fait que recommander
une règle (section 6), elle ne la prouve pas encore.

## 10. Stratégie de tests future

**Tests unitaires** (mêmes patrons que VS-02d, doubles injectés, aucun
réseau) :
- Commande avec texte inline → `dispatch(['read-natural', 'texte'], ...)`
  appelle bien `runReadNaturalLanguageFlow` avec le texte attendu.
- Texte vide → rejeté avant tout appel à `runReadNaturalLanguageFlow`.
- Demande ambiguë / non supportée / acceptation positive / refus / erreur
  d'acceptation / conversion échouée / résultat de lecture propagé — tous
  déjà couverts **au niveau de `runReadNaturalLanguageFlow` lui-même**
  (VS-02d, 9 tests existants) ; au niveau CLI, un test de fumée par cas
  suffirait (vérifier que `dispatch` relaie correctement le résultat vers
  `write`, sans dupliquer la couverture déjà faite).
- Absence de compte Gmail / compte ambigu → héritées sans changement de
  VS-01 (`main-read.test.ts:152-165, 167-194`), à re-vérifier une fois
  pour la nouvelle commande avec le même patron `fetchFn`/`AccountStore`.
- Absence de réseau — patron `fetchFn` injecté déjà établi
  (`buildFakeGmail`, `main-read.test.ts:62-92`).

**Tests d'intégration CLI** (plus larges, toujours sans réseau réel) :
- Commande interactive (si l'option B/C est un jour retenue) — nécessite
  de simuler deux flux `readline` séquentiels (section 5).
- Vérification bout-en-bout que `dispatch(['read-natural', ...])` produit
  la même sortie terminale qu'un appel direct à
  `runReadNaturalLanguageFlow` avec les mêmes doubles.

**Conservation des tests VS-01** : `main-read.test.ts` ne devrait requérir
**aucune modification** — une nouvelle branche `dispatch()` n'affecte pas
les branches existantes (chaque commande est un `if` indépendant,
`main.ts:706-742`).

## 11. Plus petit lot d'implémentation future

- **Fichiers à modifier** : `apps/desktop/src/main.ts` uniquement (une
  nouvelle branche dans `dispatch()`, un petit parseur d'arguments local
  comparable à `parseGmailReadArgs`).
- **Fichiers à créer** : un fichier de test dédié (ex.
  `main-read-natural.test.ts`, à l'image de `main-read.test.ts`) — pas de
  nouveau module de logique métier, puisque VS-02d fournit déjà tout.
- **Fonctions à ajouter** : un petit parseur d'arguments (`parseReadNaturalArgs`
  ou nom équivalent) ; une branche `dispatch()` ; éventuellement une petite
  fonction de restitution finale si le résultat structuré de
  `runReadNaturalLanguageFlow` a besoin d'un affichage dédié au-delà de ce
  que `runReadFlow`/`describeReadResult` fait déjà pour `read_result`.
- **Fonctions à ne pas modifier** : `runReadNaturalLanguageFlow`,
  `interpretReadRequest`, `convertReadInterpretationToToolRequest`,
  `requestReadInterpretationAcceptance`, `runReadFlow`,
  `describeReadResult`, `resolveOrConnectGmailAccount` — tous déjà
  suffisants tels quels.
- **Tests à ajouter** : voir section 10.
- **Commande recommandée** : `read-natural <texte>`, un seul argument
  positionnel obligatoire (section 6).
- **Confirmations explicites** : aucune modification d'`AgentLoop` ;
  aucune modification du backend API (`apps/api`) — cette étude, comme
  toutes les précédentes de VS-02, reste strictement `apps/desktop` ;
  aucune modification des connecteurs (`packages/connectors`).

## 12. Décisions ouvertes

- **[décision ouverte]** Règle exacte de découpage argument/guillemets —
  cette étude recommande d'exiger un seul argument (section 6), mais ne
  tranche pas définitivement.
- **[décision ouverte]** Code de sortie process pour `status: 'declined'`
  et `status: 'acceptance_error'` — cette étude propose `0` pour un refus
  utilisateur normal (section 7), mais ne tranche pas pour une erreur de
  saisie (`acceptance_error`), qui pourrait légitimement justifier `1`.
- **[décision ouverte]** Faut-il, à terme, une option B/C (saisie
  interactive) — reportée (section 6), non fermée définitivement.
- **[décision ouverte]** Nom exact du futur parseur d'arguments et de la
  fonction de restitution dédiée, si nécessaire.

## 13. Non-objectifs

Cette étude :
- ne modifie aucun fichier, y compris `main.ts` et les modules VS-02 ;
- ne crée aucun fichier temporaire ni aucun code ;
- ne branche pas `runReadNaturalLanguageFlow` à `dispatch()` ;
- ne crée aucune nouvelle commande CLI ;
- n'a impliqué aucun appel réseau, LLM, Gmail réel, OAuth ou mémoire ;
- ne propose pas de refonte générale du CLI — seulement l'ajout minimal
  d'une commande, isolée des commandes existantes ;
- ne tranche pas les décisions ouvertes de la section 12.

## 14. Conclusion

Le branchement de VS-02d au CLI est **structurellement simple** : les cinq
premiers paramètres de `runReadNaturalLanguageFlow` correspondent déjà
exactement à ce que `dispatch()` construit et transmet à chaque commande
existante (section 4) — aucune adaptation de type, aucun export manquant,
aucune modification de `runReadFlow` nécessaire. L'option recommandée
(texte en argument unique, section 6) réduit le futur lot d'implémentation
à une seule nouvelle branche dans `dispatch()` et un petit parseur
d'arguments local, sans toucher à aucun des modules VS-01/VS-02 déjà
validés. Les garanties de sécurité examinées (section 9) sont, pour
l'essentiel, **déjà démontrées par le code existant** et ne dépendent pas
du choix d'interface CLI — seule la restitution finale du résultat mérite
une vigilance explicite au moment de l'implémentation, pour ne jamais
présenter un `ToolExecutionResult` non `executed` comme un succès.
