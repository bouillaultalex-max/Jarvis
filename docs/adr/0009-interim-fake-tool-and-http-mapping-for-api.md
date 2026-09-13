# ADR-0009: Outil factice intérimaire, mapping HTTP et politique de permissions pour la validation du protocole de confirmation dans apps/api

Date: 2026-09-13
Status: Accepted

Cette ADR accepte les décisions d'architecture et de protocole décrites
ci-dessous. Elle n'implique pas que leur implémentation ait déjà été
réalisée.

## Context

`ADR-0008` spécifie le protocole HTTP de confirmation (`202`/`POST
/chat/confirmations/:id`) au-dessus d'un `ToolExecutor` déjà peuplé, mais
laisse explicitement hors périmètre (voir sa section « Hors périmètre de
cette décision ») : le choix de l'outil exposé, le mapping HTTP des statuts
`tool_blocked` autres qu'`awaiting_confirmation`, le cycle de vie de l'état
pending après consommation, la politique de `PermissionManager`
d'`apps/api`, et la précondition `ADR-0006` sur `Tool.validateInput()`.

Un diagnostic en lecture seule (non versionné dans ce dépôt) a établi que,
sans ces décisions, le `202` d'`ADR-0008` reste inatteignable en pratique :
`apps/api/src/main.ts` construit aujourd'hui `AgentLoop` sans aucun
`ToolExecutor`, et `ToolExecutor.run()` (`packages/core/src/tool-executor.ts`)
n'entoure pas `tool.validateInput()` d'un `try`/`catch` (seul `execute()`
l'est) — un risque identifié par `ADR-0006` comme préalable à tout
branchement d'un outil tiers réel.

## Decision

### 1. Outil exposé par `apps/api` pour cette étape

`apps/api` expose, pour la validation initiale du protocole, un **outil
factice interne**, `action: 'execute'`, sans aucun effet de bord réel :
aucun réseau, aucun système de fichiers, aucune ressource externe. Cet
outil n'est jamais partagé avec un connecteur réel et ne doit jamais être
confondu avec un outil de production. **Aucun branchement du connecteur
Gmail (ni d'aucun autre connecteur réel) n'est décidé par cet ADR** — voir
§4 et la section « Hors périmètre » d'`ADR-0008`.

Son `validateInput()` doit être **trivial, local et structurellement
incapable de lever une exception** (aucun `JSON.parse`, aucun accès à une
ressource externe, aucune récursion non bornée) — condition nécessaire à
l'acceptation de cet outil sous la précondition ouverte décrite en §4.

### 2. Mapping HTTP des statuts `tool_blocked`

La distinction entre les réponses HTTP de `POST /chat` se fait à partir du
`status` du **dernier** élément de `AgentResult.toolOutcomes` — jamais à
partir de `stopReason` seul, qui ne distingue pas entre les sous-statuts de
blocage :

| `toolOutcome.status` | HTTP | Corps |
|---|---|---|
| `awaiting_confirmation` | `202` | `{ "status": "confirmation_required", "confirmation": ConfirmationRequest }` |
| `denied` | `403` | `{ "status": "tool_denied", "reason": "Action denied by policy." }` |
| `invalid_input` | `422` | `{ "status": "invalid_tool_input", "reason": "Invalid tool input." }` |
| `unknown_tool` | `500` | `{ "status": "internal_tool_error", "reason": "Internal tool error." }` |
| `error` | `502` | `{ "status": "tool_execution_failed", "reason": "Tool execution failed." }` |

**Aucun de ces quatre messages n'est un passthrough** de `toolOutcome.reason`
(produit par `ToolExecutor`/le `Tool` lui-même, qui peut contenir le nom de
l'outil ou le détail d'une validation) : ce sont des chaînes **fixes et
génériques**, choisies une fois pour toutes ici, cohérentes avec la
section « Security Invariants » ci-dessous, qui interdit déjà tout détail
brut pour `403`/`422`/`500`/`502` sans exception. Un précédent état de ce
tableau montrait `<reason>` pour `denied`/`invalid_input`, laissant croire
à un passthrough possible pour ces deux cas seulement — **corrigé ici pour
lever cette ambiguïté**, sans changer aucun code HTTP ni aucune autre
décision.

Le cas `awaiting_confirmation` reste régi par `ADR-0008`. Les quatre autres
cas ne créent jamais de ticket de confirmation (cohérent avec
`proposeConfirmation`, qui ne construit un ticket que pour
`awaiting_confirmation`).

**Cas limite** : si `stopReason === 'tool_blocked'` mais qu'aucun
`toolOutcome` exploitable n'est disponible (tableau vide, ou dernier
élément dans une forme inattendue par rapport aux six statuts connus de
`ToolExecutionResult`), la réponse est, **exactement** :

```json
HTTP 500
{ "status": "internal_tool_error", "reason": "Internal tool error." }
```

— jamais un `202`, jamais une supposition sur l'intention du blocage.
**Aucun `202` ne doit jamais être produit sans un `ConfirmationRequest`
valide et complet** (tel que renvoyé par `buildConfirmationRequest`) ; en
son absence, le cas limite ci-dessus s'applique.

### 3. Cycle de vie du pending après consommation ou refus

Après consommation réussie ou refus, l'entrée de la table
`confirmationId → payload` d'`apps/api` est **conservée dans un état
terminal** plutôt que supprimée immédiatement. Une confirmation ultérieure
sur ce même `confirmationId` reçoit `409` (forme générique, sans
distinction de cause, cohérente avec `ADR-0008` §7). Une purge différée
(TTL applicatif) ou une limite de taille de la table doit borner sa
croissance — voir §12 pour les invariants minimaux exacts. Voir §11 pour
le principe de non-duplication qui justifie que cette table reste une
simple association `confirmationId → payload`, sans machine à états
locale redondante.

Le `confirmationId` peut être transmis au client et réutilisé par lui pour
confirmer ou refuser l'action — c'est son unique fonction, déjà prévue par
`ADR-0008`. Il ne doit toutefois jamais être journalisé au-delà de ce qui
est strictement nécessaire au fonctionnement du protocole, et ne doit
**jamais être confondu** avec : un secret, le ticket interne opaque géré
par `ConfirmationService` (256 bits, jamais stocké en clair côté service —
voir `confirmation-service.ts`), ou le payload brut associé. Le
`confirmationId` prouve uniquement la connaissance d'un ticket émis pour un
appel précis (rappel déjà présent dans `ADR-0008`, Security Invariants) ;
aucun ticket brut ni aucun secret ne doit jamais apparaître dans un log ou
une réponse HTTP.

### 4. Précondition `ADR-0006` sur `Tool.validateInput()`

La précondition identifiée par `ADR-0006` (absence de `try`/`catch` autour
de `tool.validateInput()` dans `ToolExecutor.run()`,
`packages/core/src/tool-executor.ts`) **reste ouverte et non résolue** par
cet ADR. En conséquence :
- aucun outil Gmail ni aucun autre outil tiers réel ne doit être branché
  dans `apps/api` tant que cette précondition n'a pas été traitée par un
  chantier séparé sur `packages/core` ;
- l'outil factice décidé en §1 est autorisé **uniquement** sous les
  conditions de trivialité de `validateInput()` déjà énoncées en §1.

### 5. Politique `PermissionManager` pour `apps/api`

Politique minimale, exprimée avec les décisions déjà supportées par
`PermissionPolicy` (`packages/core/src/permissions.ts`) — aucune nouvelle
valeur de décision introduite :
- `actionDefaults.read = 'allow'` ;
- `actionDefaults.prepare = 'allow'` ;
- `actionDefaults.execute = 'require_confirmation'` — **aucun outil
  `execute` n'est autorisé par défaut** (jamais `'allow'`) ;
- `default = 'deny'` (filet de sécurité global, explicite plutôt
  qu'implicite) ;
- absence de compte résolu pour un outil qui en dépend → échec **avant**
  tout appel à `ToolExecutor.run()` (résolution de compte séparée de la
  décision de permission, jamais traduite en `allow` implicite) ;
- permission indéterminée (outil/action non couverts par `rules`/
  `actionDefaults`) → retombe sur `default = 'deny'`, selon la résolution
  déjà native de `PermissionManager.decide()`.

### 6. Relation avec `ADR-0008`

Cet ADR ne modifie ni ne remplace `ADR-0008` : il complète les points que sa
section « Hors périmètre de cette décision » identifie explicitement comme
non tranchés. Le protocole HTTP lui-même (routes, codes, cycle de vie du
ticket de confirmation `ConfirmationService`) reste entièrement défini par
`ADR-0008`.

### 7. Compte (`Account`) synthétique pour l'outil factice

`proposeConfirmation()` (`packages/connectors/src/confirmation/confirmation-flow.ts`)
exige un paramètre `account: Account` complet — `packages/connectors/src/account.ts`
impose `id`, `provider`, `accountIdentifier`, `status`, `createdAt`,
`updatedAt` (`displayName`/`metadata` optionnels). L'outil factice décidé
en §1 n'a aucun compte réel : `apps/api` doit donc construire un `Account`
**synthétique** pour satisfaire cette signature et peupler
`ConfirmationAccountView` (`confirmation-request.ts`) dans le
`ConfirmationRequest` affiché au client.

Cet `Account` synthétique :
- est autorisé **uniquement** pour l'outil factice interne décrit en §1 —
  jamais pour un outil réel ;
- est construit **en mémoire**, à la demande, par `apps/api` — jamais lu ni
  écrit dans un `AccountStore` (`FileAccountStore`, `InMemoryAccountStore`
  ou toute autre implémentation) ;
- n'est **jamais persisté**, sous quelque forme que ce soit ;
- ne représente **aucune authentification utilisateur réelle** —
  `status: 'connected'` y est une valeur de convenance structurelle,
  jamais la preuve d'une session ou d'un consentement OAuth ;
- ne doit **jamais** être utilisé par `gmailConnector` ni par aucun
  connecteur réel — `resolveAccount()`/`AccountStore` restent l'unique
  chemin de résolution de compte pour un outil réel (`ADR-0006`,
  `ADR-0008` « Hors périmètre ») ;
- ne doit **jamais** être renvoyé, dans un log ou une réponse HTTP, comme
  s'il s'agissait d'un compte utilisateur authentifié — seul le
  sous-ensemble déjà restreint par `ConfirmationAccountView` est exposé,
  uniquement pour l'affichage du `ConfirmationRequest`.

**L'identifiant de ce compte synthétique est fixé à `internal-fake-tool`**
(`account.id` et `account.accountIdentifier`), avec `provider:
'internal'`. Cette valeur est délibérément non ambiguë et ne doit jamais
être confondue avec un identifiant Gmail ou un compte réel. Rappel des
propriétés déjà énoncées ci-dessus, applicables à cet identifiant précis :
il reste **interne** à `apps/api`, **non persisté** (construit en mémoire
à chaque proposition de confirmation), et **ne constitue jamais une
authentification** — sa présence dans un `ConfirmationRequest` ne prouve
rien d'autre que l'usage de l'outil factice décrit en §1. Il est
**interdit** de réutiliser cet identifiant (ou tout `Account` construit
sous ce `provider`) pour Gmail ou tout autre connecteur réel.

### 8. Contrat de réponse de `POST /chat/confirmations/:confirmationId`

Cette route a un contrat **distinct** de celui de `POST /chat` (§2) — le
mapping à cinq entrées (`202`/`403`/`422`/`500`/`502`) défini en §2 **ne
s'applique pas automatiquement** à cette route. D'après `ADR-0008` (§2,
§7) et le comportement vérifié de `confirmAndExecute()`/
`ConfirmationService.verify()` :

| Cas | HTTP |
|---|---|
| Approbation et exécution réussie (`ToolExecutionResult.status === 'executed'`) | `200` |
| Refus explicite de l'utilisateur (`approve: false`) | `200` (voir §9 pour le corps exact — ce n'est jamais un échec HTTP) |
| `confirmationId` inconnu (`ConfirmationFailed.failureReason === 'not_found'`) | `404` |
| Confirmation expirée, divergente, révoquée, refusée antérieurement ou déjà consommée (`ConfirmationFailed.failureReason` ∈ `{expired, payload_mismatch, denied, revoked, already_consumed}`) | `409` (forme générique, sans distinction de cause — `ADR-0008` §7, Security Invariants) |
| Défaillance technique de l'outil après exécution confirmée (`ToolExecutionResult.status === 'error'`) | `502` |
| `denied` / `invalid_input` / `unknown_tool` renvoyés par `ToolExecutor.run({..., confirmed:true})` **après un `verify()` réussi** | `500` (voir §10 — décidé, n'est plus une décision ouverte) |

**Décidé** : après un `verify()` réussi, `confirmAndExecute()` appelle
`ToolExecutor.run({..., confirmed:true})`, qui — structurellement, d'après
la lecture de `packages/core/src/tool-executor.ts` — peut encore renvoyer
`denied` (politique changée entre proposition et confirmation),
`invalid_input`, ou `unknown_tool` (cas résiduels rares mais possibles).
Ces trois cas sont désormais tranchés par §10 : `500` générique, jamais un
code qui suggérerait un nouveau refus, une nouvelle erreur de saisie ou une
nouvelle confirmation. Il ne s'agissait pas d'une contradiction du code
actuel (`apps/api/src/server.ts` ne construit aujourd'hui aucun
`ToolExecutor`, donc cette route n'existe pas encore), mais d'une lacune de
spécification, désormais comblée.

### 9. Corps de réponse pour un refus explicite (`approve: false`)

```json
{ "status": "confirmation_denied" }
```
- Ne renvoie jamais le payload de l'action (`toolName`/`action`/
  `accountId`/`input`).
- Ne renvoie jamais de secret ni de détail interne.
- Le `confirmationId` n'a pas besoin d'être répété dans le corps — le
  client le connaît déjà (c'est lui qui l'a fourni dans l'URL) ; l'omettre
  réduit la surface de duplication sans perte d'information utile.

### 10. Traitement d'un résultat inattendu de `confirmAndExecute()`

Si `confirmAndExecute()` retourne, **après un `verify()` réussi**, un
`ToolExecutionResult` de statut `denied`, `invalid_input` ou
`unknown_tool`, la réponse de `POST /chat/confirmations/:confirmationId`
est **exactement** :

```json
HTTP 500
{ "status": "internal_tool_error", "reason": "Internal tool error." }
```

Ces trois résultats, à ce stade précis du flux, indiquent une
**incohérence interne** — la confirmation elle-même est valide
(`verify()` a réussi), mais l'exécution qui suit se heurte à un état que
le protocole n'anticipe pas dans son fonctionnement normal (ex. une
politique de permission modifiée entre la proposition et la confirmation,
un outil retiré du registre entre-temps). En conséquence :
- **ils ne doivent jamais être interprétés comme un nouveau refus
  utilisateur** — ce n'est pas un `403`/`tool_denied`, ni une variante du
  refus explicite documenté en §9 : l'utilisateur, lui, a bien approuvé ;
- **ils ne doivent jamais être interprétés comme une nouvelle erreur de
  saisie** — ce n'est pas un `422`/`invalid_tool_input` : l'input a déjà
  été validé et fingerprinté au moment de la proposition ;
- **ils ne doivent jamais être interprétés comme une nouvelle
  confirmation à obtenir** — jamais de `202`, jamais de nouveau ticket
  `ConfirmationService.create()` ; la confirmation déjà vérifiée reste
  consommée, un seul cycle de confirmation a lieu ;
- aucun détail interne (message d'exception, nom d'outil, raison de
  permission brute) ne doit jamais être exposé tel quel dans la réponse
  HTTP — seul le corps générique ci-dessus est renvoyé ;
- un tel résultat n'est **jamais** traité comme une confirmation réussie —
  il ne doit en aucun cas produire un `200` de succès ;
- aucune réexécution automatique n'est tentée dans aucun cas —
  `confirmAndExecute()` n'est appelé qu'une seule fois par requête HTTP
  entrante sur cette route ;
- le comportement `502` pour une défaillance technique de l'outil
  (`status: 'error'`) est **conservé sans changement**, ce cas étant déjà
  explicitement décidé par `ADR-0008` §7 et distinct des trois cas
  ci-dessus (`error` signale un échec d'exécution de l'outil lui-même,
  jamais une incohérence de permission/registre).

### 11. `ConfirmationService` reste l'unique source de vérité (non-duplication de la machine à états)

`ConfirmationService` (`packages/connectors/src/confirmation/confirmation-service.ts`)
reste, sans exception, l'unique autorité pour :
- l'expiration (dérivée à la demande, jamais stockée) ;
- la divergence de payload (`payload_mismatch`, par recalcul du
  fingerprint) ;
- le refus (`denied`) ;
- la consommation unique et la transition atomique `pending → consumed` ;
- la détection d'une confirmation déjà consommée (`already_consumed`).

La table `confirmationId → payload` d'`apps/api` (`ADR-0008` §3) **ne doit
pas recréer une seconde machine à états complète** dupliquant ces mêmes
distinctions : son unique rôle est de conserver le payload nécessaire pour
réalimenter `verify()`/`confirmAndExecute()` à chaque appel, y compris
après consommation. Une structure côté `apps/api` plus riche qu'une simple
association `confirmationId → payload` (par exemple un statut local
`pending`/`consumed`/`denied` recalculé indépendamment de
`ConfirmationService`) ne serait introduite que si une nécessité concrète
et démontrée l'exigeait — non anticipée par cette ADR.

### 12. Invariants minimaux de la table pending

Ces cinq invariants s'appliquent, sans exception, à la table
`confirmationId → payload` d'`apps/api` (§3) :

- **TTL aligné sur la durée de confirmation** : la table ne retient une
  entrée que pour une durée comparable à celle du ticket
  `ConfirmationService` associé (`ConfirmationServiceOptions.ttlMs`,
  5 minutes par défaut) — elle ne doit pas inventer sa propre notion
  d'expiration indépendante de celle de `ConfirmationService` (cohérent
  avec §11 : `ConfirmationService` reste l'autorité de l'expiration).
- **Purge opportuniste** : les entrées en état terminal (consommées ou
  refusées) au-delà de ce TTL sont éligibles à suppression à l'occasion
  d'accès normaux à la table (ex. lors d'une prochaine écriture ou
  lecture) — aucun processus périodique ni minuteur dédié n'est requis,
  dans le même esprit que la dérivation à la demande de l'expiration côté
  `ConfirmationService`.
- **Limite maximale de taille, configurable** : la table est bornée par un
  nombre maximal d'entrées configurable ; au-delà, les entrées les plus
  anciennes en état terminal sont éligibles à éviction en priorité. Cette
  limite protège contre une croissance non bornée en l'absence de purge
  suffisamment fréquente — elle ne remplace pas le TTL, elle le complète.
- **Aucune entrée expirée ne peut être exécutée** : une entrée purgée (ou
  éligible à purge) ne doit jamais permettre une exécution — la purge de
  la table pending d'`apps/api` ne se substitue jamais à la vérification
  de `ConfirmationService.verify()`, qui reste seule juge de l'expiration
  réelle du ticket ; si la table a supprimé une entrée avant que le
  ticket sous-jacent n'ait expiré, la requête de confirmation échoue de
  façon sûre (`404`, id inconnu côté `apps/api`), jamais par une
  exécution non vérifiée.
- **La table pending ne devient pas une seconde machine à états** :
  conformément à §11, ces invariants de cycle de vie (TTL, purge, limite
  de taille) ne réintroduisent aucune distinction d'état
  (`pending`/`consumed`/`denied`/`expired`) gérée indépendamment de
  `ConfirmationService` — ils ne portent que sur la **présence ou
  l'absence** d'une entrée, jamais sur une resémantisation de son statut.

## Security Invariants

- Aucun message d'erreur renvoyé au client (`403`/`422`/`500`/`502`) ne
  reproduit un détail brut d'exception ou un nom d'outil interne — **aucun
  passthrough de `toolOutcome.reason` dans aucun de ces quatre cas** :
  seuls les messages fixes et génériques de §2
  (`"Action denied by policy."` / `"Invalid tool input."` /
  `"Internal tool error."` / `"Tool execution failed."`) sont renvoyés,
  mêmes garanties de généricité que celles déjà appliquées par
  `describeConfirmationFailure` (`ConfirmationService`).
- Une entrée pending en état terminal ne permet jamais une seconde
  exécution réelle : la garantie d'unicité repose sur la transition
  atomique déjà démontrée de `ConfirmationService.verify()`, jamais sur un
  verrou supplémentaire côté `apps/api`.
- Aucun outil `execute` ne peut recevoir `allow` par défaut dans la
  politique `apps/api` — seule `require_confirmation` est acceptée pour ce
  niveau d'action, cohérent avec `ADR-0006`.
- L'outil factice de validation ne doit jamais acquérir, même
  temporairement, une capacité réseau, fichier ou système — sa seule
  fonction est d'exercer le protocole de confirmation.
- Le `confirmationId` circule librement entre client et serveur (c'est son
  rôle), mais n'est jamais traité comme un secret, un ticket interne, ou un
  payload — ces trois éléments restent internes à `ConfirmationService`
  et à la table pending d'`apps/api`, jamais exposés.
- Un `stopReason: 'tool_blocked'` sans `toolOutcome` exploitable ne produit
  jamais de `202` : en l'absence d'un `ConfirmationRequest` valide et
  complet, la réponse est toujours l'erreur interne générique `500` du §2.
- L'`Account` synthétique de l'outil factice, fixé à `internal-fake-tool`
  (§7), n'est jamais persisté, jamais lu depuis ou écrit dans un
  `AccountStore`, et ne doit jamais être réutilisé par `gmailConnector` ni
  par aucun connecteur réel.
- Le corps d'un refus explicite (§9) ne contient jamais le payload de
  l'action ni aucun secret ; le `confirmationId` n'y est jamais dupliqué
  inutilement.
- Les trois cas `denied`/`invalid_input`/`unknown_tool` de
  `confirmAndExecute()` après un `verify()` réussi (§10) reçoivent
  toujours `500 {"status":"internal_tool_error","reason":"Internal tool
  error"}` — jamais traités comme un succès, un nouveau refus, une
  nouvelle erreur de saisie, ou une nouvelle confirmation à obtenir ; ils
  ne déclenchent jamais de réexécution automatique.
- La table pending d'`apps/api` ne duplique jamais la machine à états déjà
  portée par `ConfirmationService` (§11), et ses invariants de cycle de
  vie (§12 : TTL, purge opportuniste, limite de taille) ne permettent
  jamais l'exécution d'une entrée expirée — `ConfirmationService.verify()`
  reste la seule autorité d'expiration réelle.

## Consequences

**Bénéfices** : rend le `202` d'`ADR-0008` réellement testable de bout en
bout (y compris via `apps/api/src/main.ts`, pas seulement en tests
unitaires) sans exposer aucun risque réel ; sépare clairement la validation
du protocole du branchement d'un connecteur réel ; documente une politique
de permissions explicite plutôt qu'un défaut implicite.

**Limites** : le `202`/`409`/etc. restent, après cet ADR, exercés uniquement
contre un outil factice — la validation contre un outil réel (Gmail ou
autre) reste un chantier séparé et ultérieur, conditionné par la levée de
la précondition `ADR-0006` (§4) et par la clarification du scope OAuth déjà
notée par `ADR-0006`. **Cette ADR documente des décisions ; aucune d'entre
elles n'a été implémentée par ce document lui-même** (voir Implementation
Scope).

## Implementation Scope

**Créé par cette décision** : uniquement ce document et l'ajout, à
`ADR-0008`, de sa section « Hors périmètre de cette décision ». Aucun code
modifié.

**Fichiers potentiellement concernés par une implémentation future** :
`apps/api/src/main.ts`, `apps/api/src/server.ts`, un outil factice interne
à `apps/api`, un nouveau fichier pour la table pending,
`apps/api/src/server.test.ts`.

**Fichiers que cette décision ne doit pas faire modifier** :
`packages/core/src/agent-loop.ts`, `packages/core/src/tool-executor.ts`,
`packages/core/src/permissions.ts` ; `packages/connectors/src/confirmation/*` ;
tout fichier de `apps/desktop`.

## Tests Required Before Implementation

1. Chacun des cinq mappings HTTP (§2) exercé au moins une fois avec l'outil
   factice, avec le corps **exact et fixe** attendu dans chaque cas —
   `denied` → `"Action denied by policy."`, `invalid_input` →
   `"Invalid tool input."`, `unknown_tool` → `"Internal tool error."`,
   `error` → `"Tool execution failed."` — sans jamais recopier
   `toolOutcome.reason` brut (nom d'outil ou détail de validation/exception)
   dans aucun des quatre cas.
2. `stopReason: 'tool_blocked'` sans `toolOutcome` exploitable → `500`
   générique, jamais `202`.
3. Une seconde confirmation sur un `confirmationId` en état terminal reçoit
   `409`, jamais `404`.
4. Une politique `PermissionManager` avec `execute → allow` n'est jamais
   construite ni acceptée par les tests d'intégration d'`apps/api`.
5. Absence de compte résolu → échec avant tout appel à
   `ToolExecutor.run()`, jamais un `allow` implicite observé.
6. L'outil factice ne déclenche, dans aucun test, un accès réseau, fichier
   ou système (assertion négative explicite).
7. Aucun test ni aucune trace de log ne fait apparaître le ticket interne
   brut de `ConfirmationService` ou un payload en clair au-delà du
   `confirmationId` lui-même.
8. Corps exact d'un refus explicite : `{"status":"confirmation_denied"}`,
   sans payload, sans secret, sans répétition inutile du `confirmationId`.
9. Corps exact du cas limite `tool_blocked` sans `toolOutcome`
   exploitable : `HTTP 500 {"status":"internal_tool_error","reason":"Internal tool error."}`.
10. L'`Account` synthétique `internal-fake-tool` construit pour l'outil
    factice n'est jamais écrit dans un `AccountStore` ni journalisé avec
    des champs le faisant ressembler à un compte Gmail réel.
11. Les cas `denied`/`invalid_input`/`unknown_tool` de
    `confirmAndExecute()` après un `verify()` réussi reçoivent exactement
    `500 {"status":"internal_tool_error","reason":"Internal tool error."}`,
    ne produisent jamais un `200` de succès, et ne déclenchent jamais de
    second appel à `ToolExecutor.run()` au sein de la même requête HTTP.
12. Une entrée pending purgée (TTL/limite de taille, §12) ne permet jamais
    qu'une confirmation ultérieure aboutisse à une exécution : elle doit
    échouer de façon sûre (ex. `404`), jamais contourner
    `ConfirmationService.verify()`.
13. Le TTL de la table pending et celui de `ConfirmationService` ne
    divergent jamais au point qu'une entrée survive côté `apps/api` à
    l'expiration réelle du ticket sous-jacent, ni l'inverse au point de
    purger une entrée dont le ticket est encore valide et jamais présenté.
