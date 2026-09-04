# État du projet JARVIS

_Dernière mise à jour : 2026-09-04 — après M4 + architecture connecteurs :
moteur de classification d'emails (package `@jarvis/classification`),
indépendant de tout fournisseur. Sans intégration réelle (Gmail/Discord/OAuth)
ni branchement API._

## Vue d'ensemble

JARVIS est un assistant IA personnel organisé en monorepo npm workspaces
(TypeScript strict, exécution via `tsx`, tests via Vitest).

## Workspaces & dépendances

```
@jarvis/types           (aucune dépendance interne)
@jarvis/llm             → @anthropic-ai/sdk
@jarvis/core            → @jarvis/llm (types uniquement), @jarvis/types
@jarvis/tools           → @jarvis/core, @jarvis/types
@jarvis/connectors      → @jarvis/core
@jarvis/classification  → @jarvis/llm (types uniquement), @jarvis/types
apps/api                → @jarvis/core, @jarvis/llm, @jarvis/tools, fastify
apps/desktop            (vide)
```

`@jarvis/connectors` ne dépend que de `@jarvis/core` (pour le contrat `Tool`) :
`@jarvis/core` ne connaît, et ne connaîtra jamais, Gmail/Discord/etc.

`@jarvis/classification` ne dépend ni de `@jarvis/connectors` ni de
`@jarvis/core` : uniquement de `@jarvis/types` (pour `EmailMessage`) et des
**types** de `@jarvis/llm` (`LlmProvider`/`LlmMessage`, `import type` — aucune
dépendance d'exécution sur `@anthropic-ai/sdk`). Le futur connecteur Gmail
produira des `EmailMessage` ; le moteur de classification les consomme ;
aucun des deux ne connaît l'autre.

| Workspace | Rôle | État |
|---|---|---|
| `@jarvis/types` | Types partagés (`JarvisMessage`, `EmailMessage`) | stable, minimal |
| `@jarvis/llm` | Abstraction LLM + `AnthropicProvider` | fonctionnel ; clé lue en lazy au 1er appel ; `LlmResponse.toolCall?` défini mais jamais émis par `AnthropicProvider` |
| `@jarvis/core` | `AgentLoop`, `Tool`, `ToolRegistry`, `PermissionManager`, `ToolExecutor` | Tools + Permissions branchés dans `AgentLoop` |
| `@jarvis/tools` | Outils locaux ; `echoTool` de démonstration | 1 outil de démo, sans réseau ni effet de bord |
| `@jarvis/connectors` | Contrat `Connector` + connecteur fake `InMemoryConnector` | architecture validée par tests ; **aucun connecteur réel** (pas de Gmail/Discord/OAuth) |
| `@jarvis/classification` | `ClassificationEngine`, `PreferenceStore`, `EmailLlmClassifier` | architecture validée par tests ; **aucun connecteur ni LLM réel branché** |
| `apps/api` | Serveur HTTP Fastify, `POST /chat` | fonctionnel ; `AgentLoop` sans `ToolExecutor` (le provider réel n'émet pas de `toolCall`) ; connecteurs **non branchés** |
| `apps/desktop` | Client desktop | non commencé (dossier vide) |

## Ce qui fonctionne

- `POST /chat { message }` → `{ content }` : Fastify → `AgentLoop` → `LlmProvider`. Validation 400. Démarrage sans clé ; `/chat` sans clé → 503 contrôlée.
- `AgentLoop.process(message): Promise<string>` — comportement historique inchangé.
- **Contrat d'outil** (`@jarvis/core`) :
  - `Tool<TInput, TOutput>` : `name`, `description`, `action: ActionLevel`, `validateInput(unknown) → ToolValidationResult<TInput>`, `execute(TInput) → Promise<TOutput>`. Aucun `any`.
  - `ActionLevel = 'read' | 'prepare' | 'execute'`.
  - `ToolRegistry` : `register` / `get` / `has` / `list` ; noms uniques ; erreurs explicites.
- **Permissions** (`PermissionManager`) :
  - `decide(toolName, action) → 'allow' | 'deny' | 'require_confirmation'`.
  - Résolution : `rules[nom]` → `actionDefaults[action]` → `default` → **`deny`** (`SAFE_DEFAULT_DECISION`).
  - Aucun nom de service codé en dur. Sans règle ⇒ `deny` (jamais « allow everything »).
- **Exécution centralisée** (`ToolExecutor.run`) — **point de contrôle unique** :
  - 6 issues : `executed` / `denied` / `awaiting_confirmation` / `unknown_tool` / `invalid_input` / `error`.
  - `error` (exception technique dans `execute`) est **distinct** d'un refus de permission et n'est jamais un succès.
  - Une confirmation (`confirmed: true`) ne peut **pas** outrepasser un `deny`.
  - `allow` ⇒ exécution ; `deny` ⇒ rien ; `require_confirmation` ⇒ rien sans `confirmed: true`.
- **Boucle d'agent** (`AgentLoop`) :
  - `new AgentLoop(llm, { toolExecutor?, maxIterations = 5 })` ; `run(message, { confirmedTools? }) → AgentResult`.
  - `AgentResult { content, iterations, stopReason: 'llm_final' | 'tool_blocked' | 'max_iterations', toolOutcomes[] }`.
  - Boucle **bornée** : `LLM → (toolCall ?) → ToolExecutor → résultat réinjecté (texte) → LLM …`, ≤ `maxIterations` appels modèle.
  - `AgentLoop` n'appelle **jamais** `tool.execute()` — uniquement `ToolExecutor`.
  - `confirmedTools` est **par nom d'outil** : confirmer `A` n'autorise pas `B`.
  - Un outil bloqué (deny / confirmation / inconnu / entrée invalide / erreur) arrête le tour (`stopReason: 'tool_blocked'`).

## Invariants de sécurité vérifiés par les tests

- Un outil inconnu n'est jamais exécuté.
- Un outil `deny` n'est jamais exécuté (même si le modèle insiste en boucle).
- `require_confirmation` exige une confirmation explicite.
- Une confirmation ne vaut que pour l'outil nommé (`confirmedTools: ['A']` ne débloque pas `B`).
- Une confirmation n'outrepasse jamais un `deny`.
- Une erreur technique d'outil ne devient jamais un `allow` / un succès.
- `AgentLoop` ne dépasse jamais `maxIterations`.
- `AgentLoop` passe toujours par `ToolExecutor` (les cas deny/inconnu/invalide laissent le compteur d'exécution à 0).
- Aucun test ne nécessite de clé API ni de réseau (vérifié : suite relancée avec un hook `require` qui échoue si `@anthropic-ai/sdk` ou `undici` est chargé → 59/59 passent).

## Architecture connecteurs (`@jarvis/connectors`)

Package `packages/connectors`, dépendance unique vers `@jarvis/core`. But :
permettre à un futur connecteur (Gmail, Discord, Calendar…) de fournir des
`Tool` à JARVIS **sans que `@jarvis/core` connaisse ces services**, et sans
qu'un credential ne transite jamais par le modèle.

- **Contrat `Connector<TClient>`** (`packages/connectors/src/connector.ts`) :
  `{ id, name, capabilities: readonly string[], createTools(client: TClient): readonly Tool[] }`.
  - `capabilities` est purement déclaratif (noms des `Tool` que le connecteur
    peut produire, ex. `['gmail.read', 'gmail.prepare_reply', 'gmail.send']`) —
    ne requiert aucun client, ne construit rien.
  - `createTools(client)` reçoit un client **déjà authentifié** et construit
    les `Tool` en le capturant par fermeture. Le connecteur ne construit
    jamais lui-même ce client : pas de logique OAuth, pas de stockage de
    token dans ce package.
- **Séparation credential / Tool** : le client authentifié (`TClient`)
  n'apparaît jamais comme propriété d'un `Tool` retourné, ni dans son
  input/output. Vérifié par test (`Object.keys(tool)` ne contient que le
  contrat générique `name/description/action/validateInput/execute`).
- **Un outil = une capacité, un `ActionLevel`.** Un connecteur qui expose
  `service.read`, `service.prepare_reply`, `service.send` produit **trois
  `Tool` distincts** avec des `action` différents (`read` / `prepare` /
  `execute`). `service.read` ne peut jamais envoyer : ce n'est pas la même
  fonction, ni le même nom, ni le même niveau de permission.
- **`ToolExecutor` / `PermissionManager` restent les seuls points de
  contrôle**, inchangés et toujours génériques (aucun nom de service codé en
  dur). Un connecteur ne contourne rien : il produit des `Tool` ordinaires,
  enregistrés dans le `ToolRegistry` comme n'importe quel autre outil.

### Connecteur fake : `InMemoryConnector`

`packages/connectors/src/in-memory/` — connecteur de validation, **100%
local et fictif**, sans réseau ni OAuth :

- `InMemoryMailClient` : "client déjà authentifié" simulé (boîte de
  réception en dur, méthode `send()` qui mute un état en mémoire). Porte un
  marqueur fictif privé (`#fakeAuthMarker`, jamais un vrai secret) utilisé
  uniquement par les tests pour prouver qu'il ne fuit jamais dans un `Tool`.
- Trois `Tool` produits par `inMemoryConnector.createTools(client)` :
  - `inmemory.read` (`action: 'read'`) — lecture seule.
  - `inmemory.prepare_reply` (`action: 'prepare'`) — construit un brouillon,
    **aucune mutation** de l'état du client.
  - `inmemory.send` (`action: 'execute'`) — seule opération qui mute
    réellement l'état (`listSent()`).

Cela démontre bout en bout, sans rien de réel à connecter : l'injection d'un
client authentifié, la lecture, la préparation, l'exécution, le passage par
`PermissionManager`/`ToolExecutor`, et l'absence de fuite de credential.

### Limites connues (héritées de M4, inchangées)

- Le résultat d'outil est réinjecté au LLM en **texte** (`chat(messages)` n'a pas
  encore de bloc `tool_result` structuré).
- Une entrée dans `confirmedTools` vaut pour **tout le tour** : si le modèle
  rappelle le même outil confirmé plusieurs fois dans un tour, chaque appel passe.
- `apps/api` n'expose pas encore outils / confirmations via HTTP.

### Volontairement repoussé (décisions à trancher plus tard, hors scope de cette session)

- **Aucun connecteur réel** : pas de Gmail, Discord, Calendar, ni aucun appel
  réseau ou OAuth. `InMemoryConnector` est purement local.
- **Aucune gestion de credentials réelle** : pas de stockage de token, pas de
  flux OAuth, pas de rafraîchissement. `TClient` reste un type générique
  injecté par l'appelant.
- **`apps/connectors` non branché dans `apps/api`** : le `ToolRegistry` de
  `apps/api` reste vide de tout outil connecteur pour l'instant, pour éviter
  une intégration précipitée avant que l'authentification réelle existe.

### Prochaine étape prévue (connecteurs)

Authentification OAuth réelle, en commençant probablement par Gmail — avec
une décision explicite à prendre au préalable sur : stockage sécurisé des
tokens (où, comment chiffré), flux OAuth (desktop vs. serveur), et modèle de
confirmation utilisateur pour les actions `execute` réelles (UI de
confirmation via `apps/api` ou `apps/desktop`).

## Moteur de classification d'emails (`@jarvis/classification`)

Package `packages/classification`. But : classer l'importance d'un email
(`important` / `not_important` / `uncertain`) **indépendamment du
fournisseur** — Gmail, Outlook ou tout autre connecteur futur produisent le
même type `EmailMessage`, consommé sans savoir d'où il vient.

```
Gmail Connector (futur)
      ↓
EmailMessage        (@jarvis/types — partagé, zéro logique)
      ↓
ClassificationEngine (@jarvis/classification)
      ↓
PreferenceStore ──┘   (stockage pur, aucune décision)
      ↓
ClassificationResult { label, source, reason, preferenceId?, confidence? }
```

### Modèle `EmailMessage` (`@jarvis/types`)

`{ id, threadId?, sender, recipients, subject, body, receivedAt }`. Aucun
credential, aucun token OAuth, aucune donnée brute spécifique à un
fournisseur (payload API, labels internes…).

### Préférences (`Preference` / `PreferenceStore`)

- **Attributs supportés** (volontairement peu nombreux) : `sender`,
  `domain`, `subject_contains`, `keyword` (objet **ou** corps).
- **Origine** (`PreferenceOrigin`) : `explicit_rule` (règle générale déclarée
  directement, ex. « les mails de mon patron sont importants ») ou
  `user_correction` (correction réactive sur un email précis). Conservée
  uniquement pour la **traçabilité** (`ClassificationResult.source`) — les
  deux origines ont le **même poids** dans la résolution.
- `InMemoryPreferenceStore` : stockage pur (`add` / `list`), **aucune
  décision** — même philosophie que `ToolRegistry` côté `@jarvis/core`. Pas
  de base de données à ce stade (non nécessaire pour ce jalon).
- Le matching et la résolution de conflit vivent dans une fonction pure
  séparée, `matchPreference` (`preference-matcher.ts`), symétrique à
  `PermissionManager` : le store ne décide jamais.

### Résolution déterministe (hiérarchie validée)

1. **Préférence utilisateur** correspond (`explicit_rule` ou
   `user_correction`, peu importe laquelle) → sa décision, **jamais
   outrepassée par le LLM**. Entre préférences contradictoires :
   - la plus **spécifique** gagne : `sender` (4) > `subject_contains` (3) >
     `domain` (2) > `keyword` (1) ;
   - à spécificité égale, la plus **récente** (`createdAt`) gagne — l'origine
     n'intervient jamais dans ce départage.
2. **Classification LLM**, uniquement si aucune préférence ne correspond, via
   l'abstraction `EmailLlmClassifier` (le moteur ne connaît aucun provider
   concret).
3. **`uncertain` (`source: 'default'`)** — LLM absent, réponse inexploitable,
   erreur technique du provider, ou aucune préférence ni classification
   disponible. Une exception du provider LLM ne remonte jamais telle quelle :
   elle se traduit toujours par `uncertain`.

Note de conception : la hiérarchie à 5 niveaux initialement envisagée
(règle explicite > correction > « règles déterministes » > LLM > uncertain)
a été simplifiée après revue — une règle explicite et une correction sont
structurellement la même chose (une `Preference`, résolue par le même
mécanisme) ; les séparer en deux niveaux de priorité aurait fait gagner à
coup sûr une règle générale ancienne sur une correction précise et récente,
ce qui contredit l'exemple d'usage attendu.

### Apprentissage par correction

`ClassificationEngine.learnFromFeedback(email, decision)` crée une
préférence `user_correction` de portée **`sender` uniquement** — jamais
`domain` ni `keyword` — pour qu'une correction ponctuelle ne se généralise
pas sans contexte explicite. `ClassificationEngine.addExplicitRule(...)`
crée une préférence `explicit_rule` sur l'attribut choisi par l'appelant
(future couche NLU, hors scope ici : ce jalon fournit le mécanisme, pas
l'extraction de règles depuis du texte libre).

### Classification par LLM (`EmailLlmClassifier`)

- Interface `classify(email) → { label, reason, confidence? } | undefined`
  (`undefined` = repli sur `uncertain`). Le moteur ne dépend que de cette
  interface, jamais d'un `LlmProvider` concret.
- `LlmProviderEmailClassifier` : implémentation basée sur `LlmProvider`
  (`@jarvis/llm`, réutilisé — pas de nouvelle abstraction LLM créée). Parsing
  JSON strict et défensif de la réponse ; toute erreur de parsing ou du
  provider → `undefined`, jamais d'exception propagée.
- **Prompt minimal et borné** (`buildClassificationPrompt`) : exclut
  délibérément `recipients` (adresses tierces sans rapport avec la décision)
  et `threadId` ; corps borné à `MAX_BODY_EXCERPT_CHARS` (500 caractères) —
  testé explicitement (email plus long → extrait tronqué à exactement cette
  taille).
- Tests avec `MockLlmProvider` uniquement ; aucun appel réseau,
  `@anthropic-ai/sdk` importé uniquement via `import type` (jamais chargé à
  l'exécution des tests).

### Volontairement repoussé (classification)

- Aucune extraction automatique de règles depuis du texte libre utilisateur
  (« les mails de mon patron sont importants » → `Preference` reste, à ce
  stade, un appel explicite à `addExplicitRule`, pas une compréhension NLU).
- Aucun renforcement de préférence par répétition (`strength`/score) : une
  correction crée une nouvelle préférence, elle ne modifie pas une existante.
- Aucune persistance (`InMemoryPreferenceStore` uniquement).
- Aucun branchement à `apps/api` ni à un vrai connecteur Gmail/Outlook.
- Aucune limite de nombre de préférences ni de nettoyage/expiration.

### Prochaine étape prévue (classification)

Connecteur Gmail réel : mapper les messages de l'API Gmail vers
`EmailMessage`, sans toucher à `@jarvis/classification`. Nécessitera de
trancher au préalable l'authentification OAuth (déjà identifiée comme
prochaine étape connecteurs, ci-dessus) avant tout branchement.

## Ce qui n'est PAS fait (volontairement)

- Aucune intégration externe réelle (Gmail, Discord, Calendar, OAuth…).
- Pas de tool-use Anthropic réel (`AnthropicProvider` n'émet pas de `toolCall`).
- `@jarvis/connectors` existe mais ne contient qu'un connecteur **fake**
  (`InMemoryConnector`) ; aucune fausse API externe simulée, aucune
  simulation de flux OAuth.
- Connecteurs non branchés dans `apps/api` (`ToolRegistry` de l'API toujours
  vide d'outil connecteur).
- Aucun connecteur Gmail/Outlook réel ; `@jarvis/classification` n'a jamais
  vu de vrai `EmailMessage` (seulement des emails fictifs, en test).
- Aucune extraction NLU de règles depuis du texte libre (voir section
  classification ci-dessus).
- Pas de mémoire persistante, pas de streaming, pas de WebSocket.
- Pas d'outil filesystem / shell / réseau.
- `apps/desktop` non commencé.

## Vérifications (après M4 + architecture connecteurs + moteur de classification)

- `npm run typecheck` : vert
- `npm run typecheck --workspaces` : vert (7 workspaces)
- `npm test` : vert — **87 tests, 11 fichiers** (70 hérités inchangés + 17 pour
  `@jarvis/classification` : 7 dans `preference-matcher.test.ts`, 10 dans
  `classification-engine.test.ts`)
- Aucun appel réseau / clé API dans les tests. `@jarvis/classification`
  n'importe `@jarvis/llm` qu'en `import type` (aucun chargement runtime de
  `@anthropic-ai/sdk`) ; les tests LLM utilisent uniquement `MockLlmProvider`.

## Commits clés

- `9d4021f` scaffold monorepo workspaces
- `2b4db31` TypeScript monorepo foundations
- `c95e80f` Anthropic LLM provider
- `5aed22d` core agent loop
- `0716411` HTTP chat API
- `3bde930` tool contract, registry, permissions, executor
- `f836375` agent tool execution loop (fin M4)
- `e059601` architecture connecteurs (`@jarvis/connectors` + `InMemoryConnector`)
- _(moteur de classification `@jarvis/classification` + `EmailMessage` : non committé — en attente de revue)_
