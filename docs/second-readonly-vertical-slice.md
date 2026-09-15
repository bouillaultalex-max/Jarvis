# VS-02 — Interprétation contrôlée d'une demande de lecture

Date : 2026-09-15. Document **conceptuel et documentaire uniquement**. Il ne
modifie aucun code, aucune ADR existante, aucun contrat de production. Il
prolonge [`docs/first-readonly-vertical-slice.md`](./first-readonly-vertical-slice.md)
(VS-01, validée) en étudiant l'évolution vers une interprétation en langage
naturel, sans encore l'implémenter.

**Convention de lecture**, reprise des études précédentes :
**[fait démontré]** = observé dans le code (fichier:ligne cité) ;
**[absent]** = recherché et non trouvé ; **[proposition]** = idée de ce
document ; **[décision ouverte]** = à arbitrer ; **[hypothèse à valider]** =
plausible mais non vérifié dans cette session.

## 1. Objectif

VS-01 a établi qu'une lecture Gmail explicite, non ambiguë (une commande
CLI structurée) peut traverser `ToolRegistry`/`PermissionManager`/
`ToolExecutor`/`gmail.read` sans LLM, sans `AgentLoop`, sans API, avec une
restitution minimale déjà testée. VS-02 étudie si — et comment — une
**demande en langage naturel** pourrait être interprétée de façon
contrôlée, sans jamais glisser vers une exécution implicite, en réutilisant
strictement ce que VS-01 a déjà prouvé.

Question centrale : peut-on interposer une étape d'interprétation entre le
texte libre et le `ToolRequest` déjà éprouvé par VS-01, **sans** `AgentLoop`
complet, **sans** LLM réel, et **sans** créer un nouveau mécanisme
d'autorisation qui doublonnerait `PermissionManager`/`ConfirmationService` ?

## 2. État existant

**Ce que VS-01 fournit déjà, réutilisable tel quel [fait démontré]** :
- `ToolRegistry`, `PermissionManager`, `ToolExecutor`
  (`packages/core/src/*.ts`) — inchangés, non touchés par cette étude.
- `gmail.read` (`packages/connectors/src/gmail/gmail-connector.ts:33-90`),
  entrée `{maxResults?: number}`, action `'read'`, politique déjà
  `'allow'` par défaut dans `runReadFlow`
  (`apps/desktop/src/main.ts:431-432`).
- `runReadFlow` (`main.ts:413-440`) : composition complète et testée,
  du compte résolu jusqu'à la restitution.
- `describeReadResult` (`main.ts:385-400`) : restitution minimale, jamais
  l'objet brut.
- `parseGmailReadArgs` (`main.ts:653-691`) : **déjà** un « interprète »,
  mais strictement déterministe et non ambigu par construction (`--maxResults`
  uniquement) — pas un interprète de langage naturel.
- `main-read.test.ts` (250 lignes, 6 cas) : patron de test déjà éprouvé
  (`fetchFn` injecté, `DesktopDeps` avec dépendances substituables,
  `forbiddenConnect` prouvant l'absence de relance OAuth).

**Ce qui manque, recherché explicitement dans cette session [absent]** :
- Aucun parseur ni contrat d'intention en langage naturel n'existe dans le
  dépôt (recherche `intent`/`Intent`/`parseIntent`/`classifyIntent` —
  seules correspondances : `senderIntent` dans `packages/inbox/src/email-analysis.ts`,
  qui qualifie l'intention **du correspondant dans un email reçu**, sans
  aucun rapport avec l'interprétation d'une commande utilisateur).
- Aucune structure « proposition d'action à faire accepter avant
  conversion en `ToolRequest` » n'existe dans le code de production —
  `action-transition-boundaries.md` §3.3 l'avait déjà identifiée comme un
  concept manquant (« Demande d'action »).

**Précédent partiellement réutilisable [fait démontré]** : `createTerminalConfirm`
(`apps/desktop/src/terminal-confirm.ts:27-55`) est un patron d'acceptation
explicite au terminal (lecture `y`/`yes`/`oui`, refus par défaut sur toute
autre réponse ou EOF) — mais **couplé structurellement** à
`ConfirmationRequest` (`@jarvis/connectors`), lui-même réservé aux actions
`execute` fingerprintées (`ADR-0006`). Le **patron d'interaction**
(readline, refus par défaut) est transposable ; **le type qu'il consomme
ne l'est pas** — réutiliser `ConfirmationRequest` pour une simple
acceptation d'interprétation de lecture confondrait deux mécanismes que
`ADR-0006`/`ADR-0008` distinguent explicitement (voir section 5).

**Précédent structurel, non revérifié dans cette session
[hypothèse à valider]** : `packages/classification` implémente déjà, pour
un autre problème (classification d'emails), une hiérarchie « résolution
déterministe d'abord, LLM en repli » — un précédent architectural pour
l'option « approche hybride » (section 7), cité ici par son existence
(`packages/classification/src/classification-engine.ts`,
`llm-classifier.ts`), sans relecture de son contenu dans cette session.

## 3. Surfaces inspectées

- `apps/desktop/src/main.ts` — relu, sections `runReadFlow`,
  `describeReadResult`, `parseGmailReadArgs`, `dispatch`, `DesktopDeps`.
- `apps/desktop/src/main-read.test.ts` — relu intégralement.
- `apps/desktop/src/terminal-confirm.ts` — relu intégralement.
- `packages/core/src/agent-loop.ts` — non modifié, relu par cohérence
  (déjà entièrement inspecté lors des études précédentes).
- `packages/core/src/tool-executor.ts`, `permissions.ts` — non modifiés,
  relus par cohérence.
- `packages/connectors/src/confirmation/confirmation-service.ts` — non
  modifié, relu par cohérence.
- `packages/connectors/src/gmail/gmail-connector.ts` (`gmail.read` et ses
  types `GmailReadInput`/`GmailReadOutput`).
- Recherche exhaustive d'un parseur/contrat d'intention existant
  (`grep intent`) — voir section 2.
- `packages/classification/src/` — listé, non relu en détail (voir
  réserve ci-dessus).

## 4. Flux cible

```
Demande en langage naturel
  → Interprétation de lecture (proposition structurée, purement descriptive)
  → Action proposée (présentée à l'utilisateur, toujours révisable)
  → Acceptation explicite de l'utilisateur
  → Transformation contrôlée en ToolRequest (identique à celui de VS-01)
  → PermissionManager (inchangé — read → allow)
  → ToolExecutor (inchangé)
  → gmail.read (inchangé)
  → Restitution (identique à VS-01, describeReadResult ou équivalent)
```

**Précision impérative** (règle de cette étude) : à aucun moment une
« Interprétation de lecture » ou une « Action proposée » ne doit être
confondue avec un `ToolRequest` exécutable. Seule l'**acceptation
explicite** ouvre la transition vers la construction du `ToolRequest` —
et cette construction reste, ensuite, **exactement** celle déjà éprouvée
par VS-01, sans nouveau chemin d'exécution.

## 5. Contrat conceptuel proposé

Aucun type TypeScript définitif — description conceptuelle uniquement,
pour rester cohérente avec `action-transition-boundaries.md`.

**5.1 Demande utilisateur**
- Définition : texte libre fourni par l'utilisateur, en entrée. Donnée non
  fiable — jamais une instruction pour quoi que ce soit d'autre que
  l'interprétation elle-même (même discipline que
  `SITUATION_PROTOTYPE_INSTRUCTIONS` du POC, cohérente sans le réutiliser).
- Autorité : nulle.

**5.2 Interprétation de lecture**
- Définition : une structuration purement descriptive de ce que le texte
  semble demander — au minimum : « il s'agit d'une lecture », et si
  identifiable, un nombre de résultats souhaité. Rien de plus que ce que
  `gmail.read` sait déjà accepter (`maxResults?`) — **ne pas inventer de
  champ que l'outil ne consomme pas** (ex. pas de critère de recherche,
  absent de `gmail.read`, voir `docs/first-readonly-vertical-slice.md` §3,
  variante 1, déjà écartée).
- Autorité : nulle — c'est une lecture du texte, pas une décision.
- Peut inclure un statut « ambigu » ou « hors périmètre » explicite (voir
  section 6) plutôt que de forcer une structuration.

**5.3 Action proposée**
- Définition : la présentation, à l'utilisateur, de l'interprétation —
  ex. « Je comprends que vous voulez lire vos N derniers emails. »
- Autorité : nulle — ne déclenche rien par elle-même.
- Distincte de l'« Action candidate » du POC Situation (qui décrit un
  besoin identifié dans une Situation plus large) : ici, l'action proposée
  découle directement et uniquement de la demande explicite de
  l'utilisateur dans ce même échange, jamais d'une analyse de contexte
  élargi. Pas d'intégration du POC (hors périmètre, section 10).

**5.4 Acceptation explicite**
- Définition : une réponse affirmative univoque de l'utilisateur à l'Action
  proposée — patron déjà éprouvé par `createTerminalConfirm`
  (`terminal-confirm.ts:25`, ensemble fermé `y`/`yes`/`oui`, refus par
  défaut).
- **Distinction impérative avec la confirmation `ConfirmationService`** :
  cette acceptation porte sur la **justesse de l'interprétation**, pas sur
  une **autorisation d'effet de bord**. `gmail.read` n'a et n'aura jamais
  besoin de `require_confirmation` (action `read`) — l'acceptation ici ne
  remplace, ne duplique et n'étend **aucun** mécanisme de
  `PermissionManager`/`ConfirmationService`. C'est une confirmation de
  **compréhension**, pas une confirmation d'**exécution**.
- Un refus ou une absence de réponse ne produit **aucun** `ToolRequest` —
  aucune exécution, aucun effet.

**5.5 Transformation contrôlée en `ToolRequest`**
- Définition : une fonction pure prenant une Interprétation de lecture
  **déjà acceptée** et produisant `{tool: 'gmail.read', input}` — forme
  strictement identique à ce que `runReadFlow` construit déjà
  (`main.ts:435`).
- Autorité : nulle — ne fait que traduire une structure déjà acceptée en
  la forme d'entrée déjà attendue par `ToolExecutor`. La validation réelle
  reste, sans changement, `gmail.read.validateInput()`.
- Ne peut produire **que** des champs que `gmail.read` accepte déjà
  (`maxResults?`) — aucune extension du contrat d'entrée de l'outil.

## 6. Frontières entre interprétation, proposition, acceptation et exécution

| Étape | Purement descriptive ? | Présentable à l'utilisateur ? | Peut devenir exécutable ? | Doit être refusée/clarifiée si… |
|---|---|---|---|---|
| Interprétation de lecture | **Oui**, toujours | Oui | **Non**, jamais directement | le texte ne permet pas d'identifier une lecture, ou évoque une écriture |
| Action proposée | **Oui** | Oui — c'est son but | **Non** | l'interprétation sous-jacente est ambiguë ou hors périmètre |
| Acceptation explicite | Non — c'est une décision humaine | N/A (c'est une réponse) | **Ouvre** la transition suivante, ne l'exécute jamais elle-même | la réponse n'est pas univoquement affirmative (refus par défaut) |
| `ToolRequest` | Non — c'est une structure d'appel | Non (interne) | **Oui**, via `PermissionManager`/`ToolExecutor` inchangés | l'entrée ne passe pas `gmail.read.validateInput()` |

**Comment empêcher qu'une suggestion devienne automatiquement une
exécution** — trois garde-fous cumulatifs, dont deux déjà garantis par le
code existant et inchangés :
1. **[proposition]** Aucune fonction d'interprétation ne doit jamais
   invoquer `ToolExecutor.run()` — seule la fonction de transformation
   (5.5), déclenchée **après** acceptation, le fait.
2. **[fait démontré, inchangé]** `PermissionManager`/`ToolExecutor`
   restent les seuls points de décision et d'exécution — rien dans ce
   document ne les contourne ni ne les duplique.
3. **[fait démontré, inchangé]** Le refus par défaut sur toute réponse non
   univoque (patron `terminal-confirm.ts:50`) garantit qu'une ambiguïté de
   *réponse* à la proposition produit une absence d'exécution, jamais une
   exécution par défaut.

## 7. Options évaluées

- **Parser déterministe** — **[recommandé]** pour ce périmètre. Reconnaît
  un nombre restreint de formulations (mots-clés « email »/« mail »/« lire »/
  « montre » + un nombre optionnel) et produit soit une Interprétation de
  lecture, soit un statut « ambigu »/« hors périmètre » explicite. Aucun
  appel réseau, testable de façon totalement déterministe — même discipline
  que `parseGmailReadArgs`, dont il reprend l'esprit (fonction pure, ne
  valide pas la plage `maxResults`, laisse `gmail.read.validateInput()`
  trancher).
- **Interpréteur LLM simulé** — **[proposition]**, plus riche mais plus
  coûteux à concevoir correctement : nécessiterait un contrat de sortie
  structuré (schéma fermé, comme `parseSituationPrototypeOutput` du POC) et
  un faux `LlmProvider` pour les tests (patron déjà présent :
  `MockLlmProvider`, cité en commentaire dans
  `packages/inbox/src/email-summarizer.ts:61`). Reporte la richesse
  d'interprétation, mais introduit une dépendance et un risque de
  sur-interprétation qu'un parser déterministe n'a pas.
- **Approche hybride** — **[hypothèse à valider]**, cohérente avec le
  précédent de `packages/classification` (résolution déterministe d'abord,
  LLM en repli explicite) — pertinente pour une **évolution ultérieure**,
  pas pour ce premier pas.
- **CLI uniquement** — **[recommandé]** pour ce périmètre, dans la
  continuité stricte de VS-01 : aucune extension d'`AgentLoop` ni d'API.
- **Extension ultérieure à `AgentLoop`/API** — explicitement **hors
  périmètre** de VS-02 (voir section 10) ; resterait conditionnée par les
  décisions D1/D2 déjà identifiées dans
  `docs/vertical-slice-readiness.md` §9.

## 8. Scénarios de test (proposés, non implémentés)

Tous réalisables sans LLM réel, sans Gmail réel, en réutilisant le patron
`DesktopDeps`/`fetchFn` déjà éprouvé par `main-read.test.ts`.

1. **Demande claire** (« montre mes derniers emails ») → Interprétation de
   lecture sans `maxResults` → Action proposée → acceptation → `ToolRequest`
   identique au défaut de VS-01.
2. **Demande avec nombre de résultats** (« montre mes 5 derniers emails »)
   → `maxResults: 5` extrait par le parser déterministe → vérifié ensuite,
   sans changement, par `gmail.read.validateInput()`.
3. **Demande ambiguë** (« montre-moi des trucs ») → Interprétation
   marquée « ambiguë », **aucune** Action proposée exécutable — restitution
   d'une demande de clarification, aucun `ToolRequest` construit.
4. **Demande hors périmètre** (« quel temps fait-il ? ») → Interprétation
   marquée « hors périmètre » — aucune Action proposée, aucun `ToolRequest`.
5. **Demande d'écriture** (« envoie un email à... ») → **doit être refusée
   au niveau de l'interprétation elle-même**, jamais transformée en lecture
   partielle ni en action candidate silencieusement redirigée — test
   critique de sécurité (empêcher qu'une mauvaise interprétation dérive
   vers `gmail.send`, absent de ce périmètre par construction, voir
   section 10).
6. **Refus** de l'Action proposée → aucun `ToolRequest`, `fetchFn` jamais
   appelé (même assertion que `main-read.test.ts:193`, transposée).
7. **Acceptation** de l'Action proposée → `ToolRequest` construit, chemin
   ensuite **identique** à VS-01 (permission `allow`, exécution, résultat).
8. **Compte absent** → propagé sans changement par `resolveOrConnectGmailAccount`
   (`main.ts:355-374`) — comportement déjà démontré et testé par VS-01
   (`main-read.test.ts:152-165`), non affecté par la nouvelle couche
   d'interprétation puisqu'elle intervient **avant** la résolution de
   compte, jamais après.
9. **Compte ambigu** → `AmbiguousAccountError`, déjà démontré et testé
   (`main-read.test.ts:167-194`), même raisonnement.

## 9. Risques

- **Risque principal** : qu'un parser (déterministe ou simulé) glisse vers
  une interprétation trop généreuse et propose une action hors du
  périmètre de `gmail.read` (ex. un critère de recherche inventé, absent
  de l'outil réel) — mitigé structurellement par le fait que la
  Transformation contrôlée (5.5) ne peut produire que des champs déjà
  acceptés par `gmail.read.validateInput()`.
- **Risque de confusion** entre l'acceptation d'interprétation (5.4) et une
  confirmation d'exécution `ConfirmationService` — mitigé par la
  distinction explicite de la section 5.4 et par l'absence totale de
  `require_confirmation` sur `gmail.read` (action `read`).
- **Risque de sur-ingénierie** : construire un contrat riche
  (« Interprétation »/« Action proposée ») pour un besoin que
  `parseGmailReadArgs` couvre déjà presque entièrement pour l'usage
  actuel — à surveiller dans le choix du périmètre exact d'implémentation
  future (hors de ce document).
- **Risque déjà identifié par les études précédentes**, non résolu ici :
  aucune garantie structurelle (seulement une consigne de conception,
  scénario 5) n'empêche qu'un futur interpréteur plus riche (LLM) propose
  une action hors périmètre — la protection reste, comme pour
  `humanCommitments`, une discipline de conception plutôt qu'une
  contrainte de schéma.

## 10. Décisions ouvertes

- **[décision ouverte]** Le parser déterministe doit-il reconnaître
  plusieurs langues (français/anglais), ou un seul vocabulaire fixe pour ce
  premier pas ?
- **[décision ouverte]** Une Interprétation « ambiguë » doit-elle proposer
  une clarification structurée (ex. « voulez-vous dire N ou M ? ») ou
  simplement refuser et demander à l'utilisateur de reformuler ?
- **[décision ouverte]** La restitution de l'Action proposée doit-elle
  réutiliser `createTerminalConfirm` en l'adaptant (nouveau type d'entrée,
  plus léger que `ConfirmationRequest`), ou une fonction dédiée distincte
  est-elle préférable pour marquer clairement qu'il ne s'agit **pas** d'une
  confirmation `ConfirmationService` ?
- **[décision ouverte, héritée]** Le passage à une surface `AgentLoop`/API
  reste conditionné par D1/D2 de `docs/vertical-slice-readiness.md` §9 —
  non rouvert ici.

## 11. Recommandation

**Commencer par un parser déterministe, strictement CLI, sans LLM**,
produisant une Interprétation de lecture uniquement pour un vocabulaire
restreint et explicite, avec un statut « ambigu »/« hors périmètre »
explicite pour tout le reste (jamais une tentative de deviner). Réutiliser
le patron d'acceptation de `createTerminalConfirm` **en l'adaptant** à un
type dédié — ne jamais réutiliser `ConfirmationRequest` tel quel pour cette
étape, afin de préserver la distinction de la section 5.4. La
transformation vers `ToolRequest` doit rester une fonction pure,
strictement bornée aux champs déjà acceptés par `gmail.read`. Ne pas
concevoir l'interpréteur LLM simulé ni l'approche hybride avant que ce
premier pas déterministe soit lui-même validé — cohérent avec la
discipline déjà appliquée par `ADR-0010`/`ADR-0006` (pas de généralisation
avant un besoin réel démontré).

## 12. Périmètre explicitement exclu

- `AgentLoop`, API, LLM réel — cette étude reste CLI-only, comme VS-01.
- `gmail.send` / toute action `execute` — la demande d'écriture (scénario 5)
  doit être **refusée** dès l'interprétation, jamais acheminée plus loin.
- `ConfirmationService` — non modifié, non réutilisé tel quel (section 5.4).
- Mémoire (`MemoryStore`/`MemoryCandidate`/`MemoryPromoter`) — aucune
  écriture ni lecture mémoire dans ce périmètre.
- Situation structurée / POC (`candidateActions`/`humanCommitments`) — non
  intégrée ; l'« Action proposée » de ce document est un concept distinct,
  plus étroit, né directement de la demande explicite du même échange.
- Nouveau système d'autorisation — aucun mécanisme parallèle à
  `PermissionManager`/`ConfirmationService` n'est proposé.
- Modification d'`AgentLoop`, `ToolExecutor`, `PermissionManager`,
  `ConfirmationService` ou de tout contrat de production.
