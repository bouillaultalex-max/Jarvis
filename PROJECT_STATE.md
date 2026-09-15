# État du projet JARVIS

_Dernière mise à jour : 2026-09-08 — M8 (Gmail Send) committé et terminé,
sous-jalons M8-B2 à M8-B6 : OAuth Google Authorization Code + PKCE
(`2d088b7`), `SecretStore` de production via trousseau OS (`b5db57e`),
boucle d'envoi confirmée (`a811027`), câblage CLI desktop `connect`/`send`
(`309bbfb`), couverture des erreurs réseau/provider post-confirmation
(`2faf205`). Voir section dédiée ci-dessous. `apps/api` reste non branché
(aucun outil connecteur dans son `ToolRegistry`)._

_Après M8, **surface CLI desktop post-M8** (hors numérotation de jalon —
exposition CLI de briques déjà existantes) : commande `disconnect`
(`cc2e8a4`), commande `read` (`9c24cb7`), commande `inbox` (`996d716`,
`fetchAndClassifyEmails`, s'arrête à la classification), commande
`prepare-reply` (`753f4d0`, câblage du Tool `gmail.prepare_reply`).
`apps/desktop` expose donc six commandes : `connect` / `read` / `inbox` /
`prepare-reply` / `send` / `disconnect`. `apps/api` toujours non branché._

_Entre M7.4 et M8, une **fondation architecturale transversale** —
`Connector Architecture Foundation` (commit `8506792`, voir « Functional
milestones vs Architectural foundations » ci-dessous) — a été ajoutée :
elle ne constitue PAS un nouveau jalon fonctionnel et ne remplace pas le M5
Gmail historique (`fd13ffa`)._

_Après la surface CLI desktop post-M8, **VS-02 — Lecture naturelle
contrôlée** ajoute une septième commande, `read-natural "<texte>"`
(lecture Gmail en langage naturel, périmètre readonly strictement
contrôlé — voir « Lecture naturelle contrôlée — VS-02 » ci-dessous).
**Implémentée, testée et committée** (`8fb7ff4` — 82 tests ciblés verts)._

## Vue d'ensemble

JARVIS est un assistant IA personnel organisé en monorepo npm workspaces
(TypeScript strict, exécution via `tsx`, tests via Vitest).

## Functional milestones vs Architectural foundations

Deux catégories d'entrées cohabitent dans ce document et dans l'historique
Git — ne pas les confondre :

- **Functional milestones** (`M4`, `M5`, `M6`, `M7.1`–`M7.4`, `M8`…) :
  livrent une capacité utilisateur visible (lire Gmail, classer un email,
  préparer une réponse, envoyer un email…). Numérotés séquentiellement,
  chacun correspond à un ou plusieurs commits précis. C'est la chronologie
  de référence, détaillée en fin de document (« Commits clés »).
- **Architectural foundations** : refactorent ou généralisent une brique
  déjà existante **sans livrer de nouvelle capacité utilisateur**. Elles ne
  portent pas de numéro de jalon fonctionnel — leur donner un `Mx` créerait
  une collision avec la chronologie ci-dessus. Elles sont documentées par
  leur libellé et le commit qui les introduit.

  - `Connector Architecture Foundation` (alias technique `M5.ARCH` —
    volontairement hors de la suite `M4…M8` pour éviter toute confusion
    avec le M5 fonctionnel `fd13ffa`) : commit `8506792`. Généralise
    l'architecture connecteurs posée en amont de M5 (`Connector<TClient>`,
    déjà existant) avec `ConnectorRegistry`, `AccountStore` (multi-compte
    par provider) et `SecretStore`/`InMemorySecretStore`. Voir
    `docs/connectors-architecture.md` et la section dédiée plus bas. Ne
    modifie ni `gmailConnector`, ni `inMemoryConnector`, ni
    `PermissionManager`/`ToolExecutor` : additive, se situe
    chronologiquement entre M7.4 et le prochain jalon fonctionnel (M8),
    sans en faire partie.

En résumé : si une entrée de ce document ne livre aucune nouvelle capacité
utilisateur observable, elle appartient à la seconde catégorie — même si
elle est substantielle en volume de code ou en tests.

## Workspaces & dépendances

```
@jarvis/types           (aucune dépendance interne)
@jarvis/llm             → @anthropic-ai/sdk
@jarvis/core            → @jarvis/llm (types uniquement), @jarvis/types
@jarvis/tools           → @jarvis/core, @jarvis/types
@jarvis/connectors      → @jarvis/core, @jarvis/types
@jarvis/classification  → @jarvis/llm (types uniquement), @jarvis/types
@jarvis/inbox           → @jarvis/core, @jarvis/classification, @jarvis/llm (types uniquement), @jarvis/types
                           (+ @jarvis/connectors en devDependency, tests uniquement)
apps/api                → @jarvis/core, @jarvis/llm, @jarvis/tools, fastify
apps/desktop            → @jarvis/connectors
```

`@jarvis/connectors` ne dépend que de `@jarvis/core` + `@jarvis/types` :
`@jarvis/core` ne connaît, et ne connaîtra jamais, Gmail/Discord/etc.

`@jarvis/classification` ne dépend ni de `@jarvis/connectors` ni de
`@jarvis/core` : uniquement de `@jarvis/types` (pour `EmailMessage`) et des
**types** de `@jarvis/llm` (`LlmProvider`/`LlmMessage`, `import type` — aucune
dépendance d'exécution sur `@anthropic-ai/sdk`).

`@jarvis/inbox` (M6, étendu en M7) est la **couche d'orchestration** qui
relie connecteurs et classification : son code livré (`dependencies`) ne
connaît **aucun fournisseur** — il fonctionne avec n'importe quel `Tool` de
lecture déjà enregistré dans un `ToolExecutor`. `@jarvis/connectors`
n'apparaît qu'en `devDependency`, utilisé uniquement par le test
d'intégration qui démontre le flux avec le `gmailConnector` réel.
`@jarvis/llm` n'est importé qu'en `import type` (même garantie que
`@jarvis/classification` : aucune dépendance d'exécution sur
`@anthropic-ai/sdk`). `ClassificationEngine` n'est ni modifié ni sous-classé.

| Workspace | Rôle | État |
|---|---|---|
| `@jarvis/types` | Types partagés (`JarvisMessage`, `EmailMessage`) | stable, minimal |
| `@jarvis/llm` | Abstraction LLM + `AnthropicProvider` | fonctionnel ; clé lue en lazy au 1er appel ; `LlmResponse.toolCall?` défini mais jamais émis par `AnthropicProvider` |
| `@jarvis/core` | `AgentLoop`, `Tool`, `ToolRegistry`, `PermissionManager`, `ToolExecutor` | Tools + Permissions branchés dans `AgentLoop` ; inchangé depuis M4 |
| `@jarvis/tools` | Outils locaux ; `echoTool` de démonstration | 1 outil de démo, sans réseau ni effet de bord |
| `@jarvis/connectors` | Contrat `Connector` + `InMemoryConnector` (fake) + `gmailConnector` (**réel**) : `gmail.read` (`action: 'read'`) + `gmail.prepare_reply` (`action: 'prepare'`, M7.3) + `gmail.send` (`action: 'execute'`, M8) ; + `ConnectorRegistry`/`AccountStore`/`SecretStore`/`Capability` ; + `OsCredentialSecretStore` (M8-B3, production) ; + `GmailOAuthFlow` PKCE (M8-B2) ; + `ConfirmationService`/`proposeConfirmation`/`confirmAndExecute` (M8) | `gmail.modify`/`gmail.delete` toujours inexistants ; `gmailConnector` utilise `ConnectorRegistry`/`AccountStore`/`SecretStore` via `resolveGmailApiClient` (M8) |
| `@jarvis/classification` | `ClassificationEngine`, `PreferenceStore`, `EmailLlmClassifier` | inchangé depuis M4.5 ; toujours aucun connecteur ni LLM réel branché en interne |
| `@jarvis/inbox` | `fetchEmailsViaTool`, `classifyEmails`, `fetchAndClassifyEmails`, `recordFeedbackForEmail`, `applyUserRule`, `needsAttention`/`filterEmailsNeedingAttention` (M7.1), `createSummarizeEmailTool`/`EmailSummarizer` (M7.2), `summarizeEmailsNeedingAttention` (M7.4) | flux complet Gmail → classification → attention → résumé validé par tests (Gmail/LLM mockés) ; **non branché dans `apps/api`** |
| `apps/api` | Serveur HTTP Fastify, `POST /chat` | fonctionnel ; `AgentLoop` sans `ToolExecutor` (le provider réel n'émet pas de `toolCall`) ; connecteurs/inbox **non branchés** |
| `apps/desktop` | Client CLI (`connect`, `read`, `inbox`, `prepare-reply`, `send`, `disconnect`) | fonctionnel — connexion OAuth PKCE + persistance trousseau OS + envoi Gmail confirmé (M8-B2→B6) ; + lecture (`read`), lecture&classification (`inbox`, s'arrête à la classification), préparation de réponse (`prepare-reply`, câblage du Tool `gmail.prepare_reply`) et déconnexion/révocation (`disconnect`) — surface CLI desktop post-M8 (`cc2e8a4`/`9c24cb7`/`996d716`/`753f4d0`) |

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

### Connecteur réel : `gmailConnector` (M5 — lecture seule)

`packages/connectors/src/gmail/` — premier connecteur **réel** (OAuth 2.0
Google, appels HTTP effectifs en production), mais strictement limité à la
lecture pour ce jalon :

```
Google OAuth credentials → GmailApiClient (Gmail API) → GmailRawMessage
                                                              ↓  mapGmailMessageToEmailMessage (frontière stricte)
                                                          EmailMessage → ClassificationEngine (déjà existant, non modifié)
```

- **`gmail-auth.ts`** — couche d'authentification, séparée du client Gmail :
  - `GmailCredentials { clientId, clientSecret, refreshToken }` — jamais
    manipulé par `GmailApiClient`, un `Tool` ou un connecteur.
  - `AccessTokenProvider` : interface dont dépend `GmailApiClient` (« fournis
    un access token », sans savoir comment).
  - `GoogleOAuthAccessTokenProvider` : implémentation **réelle** — échange le
    refresh token contre un access token via l'endpoint OAuth de Google,
    cache le résultat avec marge de sécurité, **renouvelle automatiquement**
    à expiration, et `revoke()` (déconnexion réelle). Appels HTTP via un
    `fetchFn` **injectable** (tests : mock, zéro réseau réel).
  - `RefreshTokenStore` : interface posée pour un futur stockage sécurisé du
    refresh token — **non implémentée**, et **supplantée en pratique** par
    `SecretStore` / `OsCredentialSecretStore` (M8-B3), qui assurent ce rôle
    en production. Placeholder obsolescent conservé (aucune suppression de
    code) ; `resolveGmailCredentials` n'en dépend pas
    (`gmail-auth.test.ts` le prouve explicitement).
  - `loadGmailCredentialsFromEnv()` : lit `GMAIL_CLIENT_ID` /
    `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (voir
    `packages/connectors/.env.example`, placeholders uniquement) ; erreur
    explicite si absent, ne cite jamais de valeur.
- **`gmail-api-client.ts`** — `GmailApiClient` : le `TClient` reçu par
  `gmailConnector.createTools(client)`. Seulement `listMessageIds()` et
  `getMessage()` — **aucune méthode d'écriture n'existe sur la classe** (pas
  une question de permission : la capacité n'existe pas). Manipule
  exclusivement des types `GmailRaw*` (forme brute Gmail), qui ne sortent
  jamais de ce module.
- **`gmail-message-mapper.ts`** — `mapGmailMessageToEmailMessage(raw)` :
  fonction pure, **frontière stricte** entre l'API Gmail et le domaine
  JARVIS. Extrait expéditeur/destinataires depuis les en-têtes `From`/`To`,
  décode le corps `text/plain` (recherche récursive dans les parties
  `multipart`, `''` si seul du HTML est disponible — jamais de HTML brut en
  guise de corps), convertit `internalDate` en ISO 8601. Au-delà de cette
  fonction, plus aucun objet brut Gmail ne remonte.
- **`gmail-connector.ts`** — `gmailConnector: Connector<GmailApiClient>` :
  à l'origine (M5) `capabilities: ['gmail.read']`, un seul `Tool`
  (`action: 'read'`). **Depuis M7.3/M8, étendu** à trois `Tool` :
  `gmail.read` (`'read'`), `gmail.prepare_reply` (`'prepare'`, M7.3),
  `gmail.send` (`'execute'`, M8 — voir section dédiée ci-dessous). Toujours
  pas de `gmail.modify` ni `gmail.delete` — ni comme `Tool`, ni comme
  méthode sur `GmailApiClient`.
- **`ClassificationEngine` non modifié** : consomme l'`EmailMessage` produit
  par le mapper exactement comme n'importe quel autre `EmailMessage`.

Aucun secret réel dans le dépôt : `packages/connectors/.env.example` ne
contient que des placeholders (`GMAIL_CLIENT_ID=your-gmail-oauth-client-id`,
etc.), couvert par `.gitignore` (`.env` / `.env.*` ignorés, `.env.example`
explicitement autorisé).

### Fondation architecturale : ConnectorRegistry / AccountStore / SecretStore (`Connector Architecture Foundation`, commit `8506792`)

**Ceci n'est pas un jalon fonctionnel.** Ne livre aucune nouvelle capacité
utilisateur (pas de nouveau `Tool`, aucun connecteur réel supplémentaire) —
généralise, pour un futur `CalendarConnector`/`DriveConnector`/
`SlackConnector`/`GitHubConnector`, ce que `gmailConnector` fait déjà
manuellement. `gmailConnector` et `inMemoryConnector` ne sont pas modifiés
et n'utilisent pas encore ces abstractions.

- **`ConnectorRegistry`** (`connector-registry.ts`) — enregistrement/lookup
  de `Connector` par id, symétrique à `ToolRegistry`. Aucune logique
  métier spécifique à un provider.
- **`AccountStore`** (`account.ts`) — un utilisateur peut avoir plusieurs
  comptes pour un même provider (ex. Google perso + pro).
  `resolve({ provider, accountId? })` est le seul point de sélection d'un
  compte : `AmbiguousAccountError` si plusieurs comptes existent et
  qu'aucun `accountId` n'est fourni — **jamais** de sélection implicite.
- **`SecretStore`** (`secret-store.ts`) — interface indépendante du
  mécanisme de stockage ; **`InMemorySecretStore`** est la seule
  implémentation fournie, **dev/test uniquement**, jamais utilisable en
  production (stockage non chiffré, non persistant, champ JS réellement
  privé `#secrets` pour qu'aucune valeur ne fuite via
  `JSON.stringify`/`console.log`).
- **`Capability`** (`capability.ts`) — description déclarative (id,
  connectorId, action, description) dérivée des `Tool` réels d'un
  connecteur via `describeCapabilities()`. **Ne décide jamais d'une
  autorisation** : `action` n'est qu'une recopie de `Tool.action`. Seul
  `PermissionManager` autorise ou refuse — vérifié explicitement par
  `security.test.ts`.
- **Erreurs métier typées** (`errors.ts`) : `UnknownConnectorError`,
  `ConnectorUnavailableError`, `UnknownCapabilityError`,
  `UnsupportedCapabilityError`, `UnknownAccountError`,
  `AmbiguousAccountError`, `SecretNotFoundError` — jamais de secret dans un
  message. Un refus de permission reste représenté par
  `ToolExecutionResult` côté `@jarvis/core`, jamais dupliqué ici.

Documentation détaillée : `docs/connectors-architecture.md`. Tests :
`connector-registry.test.ts` (9), `account.test.ts` (10),
`capability.test.ts` (5), `in-memory-secret-store.test.ts` (7),
`security.test.ts` (10) — 41 tests, tous dans `packages/connectors/src/`.

À l'époque de son introduction (`8506792`), cette fondation ne résolvait
encore aucune des décisions listées dans « Prochaine étape prévue
(connecteurs) » (flux de connexion OAuth initiale, stockage sécurisé de
production du refresh token, modèle de confirmation UI pour `gmail.send`).
**Ces trois décisions sont désormais tranchées et implémentées par M8**
(voir section suivante) : `InMemorySecretStore` reste dev/test uniquement,
mais `gmailConnector` utilise maintenant `AccountStore`/`SecretStore` en
production via `resolveGmailApiClient`.

## Envoi Gmail confirmé (M8 — `gmail.send`, terminé)

Jalon fonctionnel M8, décomposé en 5 sous-étapes toutes committées. Ferme
le dernier point resté ouvert depuis M5 : `gmail.send` (`action: 'execute'`,
effet de bord réel et irréversible), avec confirmation utilisateur
obligatoire.

- **M8-B2 — OAuth Google Authorization Code + PKCE** (`2d088b7`,
  `packages/connectors/src/gmail/gmail-oauth-flow.ts`) : flux de connexion
  initiale du compte, `code_challenge`/`code_verifier` (méthode `S256`,
  RFC 7636). `gmail-oauth-callback-server.ts` écoute strictement sur
  `127.0.0.1` (jamais `0.0.0.0`).
- **M8-B3 — `SecretStore` de production** (`b5db57e`,
  `packages/connectors/src/os/os-credential-secret-store.ts`) :
  `OsCredentialSecretStore` délègue entièrement au trousseau natif de l'OS
  (Windows Credential Manager / macOS Keychain / Linux Secret Service) via
  `@napi-rs/keyring` — aucun fichier, aucune clé de chiffrement gérée par
  JARVIS. `FileAccountStore` (déjà existant) assure la persistance des
  comptes entre deux lancements. Voir `docs/adr/0003-os-credential-backend.md`.
- **M8-B4 — Boucle d'envoi confirmée** (`a811027`,
  `apps/desktop/src/gmail-send.ts`, `runGmailSend`) : compose
  `resolveAccount()` → `resolveGmailApiClient()` →
  `gmailConnector.createTools()` → `ToolExecutor` → `proposeConfirmation()`
  → confirmation utilisateur → `confirmAndExecute()`. Une politique
  `'allow'` sur `gmail.send` est refusée (`confirmation_required`) plutôt
  qu'exécutée. Voir `docs/adr/0004-resolve-account-single-point.md` et
  `docs/adr/0005-tool-executor-and-confirmation.md`.
- **M8-B5 — Câblage CLI desktop** (`309bbfb`,
  `apps/desktop/src/{main,gmail-send-args,terminal-confirm}.ts`) :
  sous-commandes `connect` et `send` de `apps/desktop`, confirmation au
  terminal (`createTerminalConfirm`), OAuth non relancé si un compte est
  déjà connecté. (Les commandes `read`, `inbox` et `disconnect` ont été
  ajoutées **après** M8 — voir « Surface CLI desktop post-M8 » ci-dessous.)
- **M8-B6 — Couverture des erreurs post-confirmation** (`2faf205`,
  `gmail-send.test.ts`, `main-send.test.ts`) : preuve par test que
  `runGmailSend` renvoie `status: 'error'` (jamais un faux succès) si le
  refresh token est rejeté (`invalid_grant`) ou si l'API Gmail refuse
  l'envoi, jusqu'au message affiché par la CLI.

**530 tests / 50 fichiers** au total (voir « Vérifications » ci-dessous).
Décisions architecturales de M8 formalisées dans `docs/adr/0001` à `0005`.

`disconnectGmailAccount()` (`packages/connectors/src/gmail/gmail-connection.ts`)
existe, est testée, et **est câblée** dans `apps/desktop` depuis `cc2e8a4`
(`dispatch()` → `runDisconnectFlow` → `disconnectGmailAccount`, révocation
OAuth réelle) — voir « Surface CLI desktop post-M8 » ci-dessous. Aucun
numéro de jalon ne lui est attribué : c'est une exposition CLI d'une brique
existante, pas un jalon fonctionnel.

### Surface CLI desktop post-M8 (`cc2e8a4`, `9c24cb7`, `996d716`, `753f4d0`)

Quatre commits postérieurs à M8 étendent la CLI `apps/desktop` (fichier
`apps/desktop/src/main.ts`, `dispatch()`) **sans ajouter aucune brique de
bibliothèque** : ils câblent des capacités déjà écrites et testées dans
`@jarvis/connectors` / `@jarvis/inbox`, en réutilisant tel quel le noyau de
confiance M8 (`resolveAccount`/`resolveOrConnectGmailAccount` →
`resolveGmailApiClient` → `gmailConnector.createTools()` →
`ToolRegistry`/`PermissionManager`/`ToolExecutor`). **Ce ne sont pas de
nouveaux jalons fonctionnels** — aucun numéro `M8-B7`/`M9`/`OUT-07`.

- **`disconnect`** (`cc2e8a4`) — câblage de `disconnectGmailAccount()` :
  révocation OAuth réelle côté Google + passage du compte à `disconnected`.
  `resolveAccount()` reste l'unique point de sélection ; aucune confirmation
  interactive (`disconnectGmailAccount` n'est pas un `Tool` `execute`).
- **`read`** (`9c24cb7`) — câblage du Tool `gmail.read` (`action: 'read'`,
  lecture seule). `--maxResults` transmis tel quel au Tool (jamais réécrit
  par la CLI). Affiche uniquement expéditeur + objet, jamais le corps.
- **`inbox`** (`996d716`) — câblage de `fetchAndClassifyEmails`
  (`@jarvis/inbox`) : lit via `gmail.read` (strictement par `ToolExecutor`)
  puis classe chaque email (`important` / `not_important` / `uncertain`) via
  `ClassificationEngine`. LLM branché uniquement si `ANTHROPIC_API_KEY` est
  présente ; sans clé ou sur erreur LLM, repli contrôlé vers `uncertain`.
  Affiche uniquement expéditeur, objet, libellé, raison, provenance.
  **`inbox` s'arrête volontairement à la classification** : le résumé
  (`email.summarize` / `summarizeEmailsNeedingAttention`), le triage
  (`filterEmailsNeedingAttention`) et le feedback (`recordFeedbackForEmail` /
  `applyUserRule`) **restent hors de son périmètre actuel**. Aucune
  persistance de préférences introduite (`InMemoryPreferenceStore`, toujours
  vide en production).
- **`prepare-reply`** (`753f4d0`) — câblage du Tool `gmail.prepare_reply`
  (`action: 'prepare'`, aucun effet de bord Gmail réel) : `--messageId`/
  `--body` transmis tels quels (`parsePrepareReplyArgs`), validation de fond
  déléguée à `gmail.prepare_reply.validateInput` via `ToolExecutor`.
  N'appelle jamais `gmail.send`.

`apps/desktop` expose donc six commandes : `connect` / `read` / `inbox` /
`prepare-reply` / `send` / `disconnect`.

### Lecture naturelle contrôlée — VS-02 (`read-natural`, committé `8fb7ff4`)

Septième commande, **implémentée, testée et committée** (`8fb7ff4` —
`apps/desktop/src/main.ts` et les nouveaux fichiers
`apps/desktop/src/read-intent-parser.ts`,
`read-intent-to-tool-request.ts`, `read-interpretation-acceptance.ts`,
`read-natural-language-flow.ts` et leurs tests). Pipeline :

```
texte libre → parser (read-intent-parser.ts)
  → acceptation explicite (read-interpretation-acceptance.ts)
  → conversion contrôlée en ToolRequest (read-intent-to-tool-request.ts)
  → runReadFlow (VS-01, inchangé)
  → PermissionManager / ToolExecutor (inchangés)
  → gmail.read
```

Restitue distinctement six états (`ambiguous`, `unsupported`, `declined`,
`acceptance_error`, `conversion_failed`, `read_result`) — jamais un succès
artificiel : un `ToolExecutionResult` non `executed` reste affiché comme
tel (délégation à `describeReadResult`, inchangée).

`PermissionManager`/`ToolExecutor` **conservés sans modification** ; aucun
outil d'écriture accessible par ce chemin (`gmail.send` structurellement
inatteignable — le nom d'outil n'est jamais dérivé du texte utilisateur).
Aucune intégration `AgentLoop`, `apps/api`, ni mémoire (`@jarvis/memory`) :
**ne constitue pas** une conversation naturelle générale de Jarvis.

82 tests ciblés verts (`read-intent-parser.test.ts` 20,
`read-intent-to-tool-request.test.ts` 15,
`read-interpretation-acceptance.test.ts` 19,
`read-natural-language-flow.test.ts` 9, `main-read.test.ts` 6 — non
régressé —, `main-read-natural.test.ts` 13), `typecheck`/`lint` propres.
Aucun appel LLM, réseau réel, Gmail réel ou OAuth réel dans ces tests.

Détail complet : `docs/second-readonly-vertical-slice.md`,
`docs/second-readonly-vertical-slice-integration-study.md`,
`docs/second-readonly-vertical-slice-cli-study.md`,
`docs/first-readonly-vertical-slice.md`.

### Limites connues (héritées de M4, inchangées)

- Le résultat d'outil est réinjecté au LLM en **texte** (`chat(messages)` n'a pas
  encore de bloc `tool_result` structuré).
- Une entrée dans `confirmedTools` vaut pour **tout le tour** : si le modèle
  rappelle le même outil confirmé plusieurs fois dans un tour, chaque appel passe.
- `apps/api` n'expose pas encore outils / confirmations via HTTP.

### Volontairement repoussé (décisions à trancher plus tard)

- **Discord/Calendar/autres fournisseurs** : `InMemoryConnector` reste le
  seul exemple non-Gmail.
- **Modification/suppression Gmail** : toujours pas de `gmail.modify`, pas
  de `gmail.delete`. `gmail.read`, `gmail.prepare_reply` et `gmail.send`
  existent tous les trois depuis M8 (voir section dédiée ci-dessus).
- **Connexion initiale du compte** : ~~non implémentée~~ **résolue par
  M8-B2** (flux OAuth interactif + PKCE, `gmail-oauth-flow.ts`).
- **Stockage sécurisé du refresh token** : ~~aucune implémentation~~
  **résolu par M8-B3** (`OsCredentialSecretStore`, trousseau OS).
- **`apps/connectors` non branché dans `apps/api`** : **toujours vrai** —
  le `ToolRegistry` de `apps/api` reste vide de tout outil connecteur ;
  seul `apps/desktop` consomme `@jarvis/connectors` à ce stade.
- **`apps/desktop`** : ~~aucun flux de connexion Gmail~~ **résolu par
  M8-B2/B5** (`connect`/`send` en CLI ; étendu depuis à
  `read`/`inbox`/`prepare-reply`/`disconnect` — voir « Surface CLI desktop
  post-M8 »).

### Prochaine étape prévue (connecteurs)

Les trois décisions listées ci-dessus au moment de `Connector Architecture
Foundation` (flux de connexion initiale, stockage sécurisé du refresh
token, modèle de confirmation utilisateur) sont **toutes tranchées et
implémentées par M8** (voir section dédiée ci-dessus). Point encore ouvert,
non prioritaire : `apps/api` reste sans aucun outil connecteur branché.

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

### Prochaine étape (classification) — faite en M6

Le branchement à un connecteur Gmail réel est fait (voir section suivante,
`@jarvis/inbox`), **sans aucune modification** de ce package.

## Intégration Gmail ↔ classification et triage (`@jarvis/inbox`, M6 + M7)

Package `packages/inbox`. Premier flux réel de bout en bout (M6) :

```
Tool de lecture déjà enregistré (ex. gmail.read)
      ↓  fetchEmailsViaTool()      — passe strictement par ToolExecutor
EmailMessage[]
      ↓  classifyEmails()          — appelle ClassificationEngine.classify(), inchangé
ClassifiedEmail[]  { email, classification }
```

- **`fetchEmailsViaTool(executor, { toolName, input? })`** — générique, ne
  connaît aucun fournisseur. Passe **exclusivement** par `ToolExecutor`
  (jamais `tool.execute()` directement) : un outil refusé, en attente de
  confirmation, inconnu, en erreur, ou dont l'entrée est invalide lève
  `EmailFetchBlockedError` — aucun email n'est renvoyé dans ces cas. Vérifie
  aussi que la sortie a bien la forme `{ messages: EmailMessage[] }`.
- **`classifyEmails(engine, emails)`** — appelle `ClassificationEngine.classify`
  pour chaque email et recompose `{ email, classification }`.
  `ClassificationEngine` n'est ni modifié, ni sous-classé, ni contourné.
- **`fetchAndClassifyEmails(executor, engine, options)`** — compose les deux
  ci-dessus. C'est la fonction qui réalise concrètement
  `GmailConnector → EmailMessage[] → ClassificationEngine → ClassificationResult[]`,
  sans jamais mentionner Gmail dans son code.
- **`ClassifiedEmail { email, classification }`** — le type de restitution
  pour une future UI : email complet, `label`, `source`, `reason`, et
  `preferenceId` quand une préférence a tranché. Aucun champ nouveau créé :
  `EmailMessage` et `ClassificationResult` portent déjà tout le nécessaire,
  et ni l'un ni l'autre ne peut structurellement contenir un credential.

### Préparation de l'interaction utilisateur (`feedback.ts`)

Contrats fins, sans interface conversationnelle :

- **`recordFeedbackForEmail(engine, batch, emailId, decision)`** — retrouve
  un email par id dans un lot déjà classifié et appelle
  `ClassificationEngine.learnFromFeedback` (portée `sender` uniquement,
  comportement inchangé). Couvre « cet email est important » / « celui-ci
  n'est pas important ».
- **`applyUserRule(engine, { attribute, value, decision, reason? })`** —
  appelle `ClassificationEngine.addExplicitRule`, avec une explication par
  défaut générée si absente. Couvre « les emails de cette adresse sont
  toujours importants » (`attribute: 'sender'`) et « les newsletters de ce
  domaine ne sont pas importantes » (`attribute: 'domain'`). Une future
  couche NLU n'aura qu'à produire un `UserRuleRequest` — aucun changement
  requis ici.

### M7.1 — Identifier les emails nécessitant l'attention (`attention.ts`)

- `AttentionPolicy { labels: readonly ClassificationLabel[] }` — défaut :
  `['important']` uniquement.
- `needsAttention(classified, policy?)` / `filterEmailsNeedingAttention(batch, policy?)`
  — fonctions **pures** : aucune E/S, aucun réseau, aucun appel LLM. Ne
  mutent jamais `batch` ; préservent l'ordre d'origine.

### M7.2 — Résumer les emails importants (`email-summarizer.ts` + `summarize-email-tool.ts`)

- `EmailSummarizer.summarize(email) → EmailSummary | undefined` —
  `LlmProviderEmailSummarizer` (basée sur `LlmProvider`, `@jarvis/llm`
  importé en `import type` uniquement) construit un prompt minimal :
  expéditeur + objet + extrait de corps borné à `MAX_BODY_EXCERPT_CHARS`
  (500, même logique et même valeur que `@jarvis/classification`, définie
  indépendamment). **`recipients` et `threadId` explicitement exclus.**
- `createSummarizeEmailTool(summarizer): Tool<SummarizeEmailInput, SummarizeEmailOutput>`
  — `name: 'email.summarize'`, **`action: 'read'`** : aucun effet de bord,
  aucune connexion Gmail, aucun appel à `GmailApiClient`. N'appelle que le
  `EmailSummarizer` injecté. Passe par `ToolExecutor` comme tout `Tool`
  (allow/deny/require_confirmation testés). Une réponse LLM inexploitable ou
  une exception du provider → jamais un faux résumé (`undefined` côté
  `EmailSummarizer`, `status: 'error'` côté `ToolExecutor`).

### M7.3 — Préparer une réponse Gmail (`gmail.prepare_reply`, `@jarvis/connectors`)

Deuxième `Tool` du `gmailConnector` (`capabilities: ['gmail.read', 'gmail.prepare_reply']`) :

- `GmailPrepareReplyInput { messageId, body }` → `GmailDraftReply { to, subject, threadId?, body }`.
- **`action: 'prepare'`**, aucun effet de bord côté Gmail : `execute()`
  appelle `client.getMessage(messageId)` (lecture seule, méthode déjà
  existante depuis M5, aucune nouvelle méthode sur `GmailApiClient`) et
  dérive `to`/`subject`/`threadId` du message **réellement lu**. Seul `body`
  vient de l'appelant. `validateInput` ne retient que `{messageId, body}` :
  toute autre clé de l'entrée brute (un `to` fourni par le modèle, par
  exemple) est structurellement ignorée — testé explicitement (« aucune
  cible de réponse fournie par l'appelant ne remplace celle du message
  réel »).
- `gmail.read` **inchangé** (aucune modification de `createGmailReadTool`).
  Permissions indépendantes entre `gmail.read` et `gmail.prepare_reply`
  (testé dans les deux sens). Une confirmation sur `gmail.prepare_reply` ne
  débloque jamais un autre nom d'outil (testé avec un `gmail.send`
  hypothétique, toujours `unknown_tool`).
- Toujours aucun `gmail.send`, `gmail.modify` ni `gmail.delete`.

### M7.4 — Composition attention + résumé (`triage.ts`)

```
ClassifiedEmail[] → filterEmailsNeedingAttention (M7.1) → EmailSummarizer (M7.2)
```

- `AttentionSummary { classified: ClassifiedEmail, summary: string | undefined }`
- `summarizeEmailsNeedingAttention(batch, summarizer, policy?)` — compose
  M7.1 + M7.2, sans toucher à `ClassificationEngine`, `ToolExecutor` ni
  `PermissionManager`. **Seuls** les emails retenus par la politique
  d'attention (par défaut : `important`) sont transmis au `summarizer` : un
  email `not_important` ou `uncertain` n'atteint jamais le LLM — vérifié
  explicitement par comptage des appels d'un `MockLlmProvider`
  (`llm.calls.length` égal au nombre d'emails retenus, jamais à la taille du
  lot). Préserve l'ordre ; ne mute ni le lot, ni les `ClassifiedEmail`.

### Volontairement repoussé (M6 + M7)

- Aucune interface conversationnelle : `feedback.ts` prépare les contrats,
  ne les branche à rien (pas de parsing de langage naturel).
- Aucun stockage ni base de données : les `ClassifiedEmail[]`/`AttentionSummary[]`
  sont des valeurs éphémères, retournées à l'appelant — rien n'est persisté
  par `@jarvis/inbox` lui-même (au-delà de `InMemoryPreferenceStore`, déjà
  existant côté `@jarvis/classification`).
- Non branché dans `apps/api` : aucune route HTTP n'expose ce flux.
- Aucune pagination/synchronisation incrémentale (pas de curseur, pas de
  détection de « nouveaux » emails depuis la dernière lecture).
- `gmail.send` : était un jalon séparé nécessitant feu vert explicite —
  **fait, voir M8 ci-dessus**.
- Aucune génération automatique du corps d'une réponse par LLM :
  `gmail.prepare_reply` structure un corps déjà fourni, il ne le rédige pas.

### Prochaine étape prévue (inbox)

La connexion initiale OAuth et `gmail.send` sont résolus (M8). Depuis,
`fetchAndClassifyEmails` (`@jarvis/inbox`) est **exposé par la CLI desktop**
via la commande `inbox` (`996d716`) — mais limité à la classification
(résumé, triage et feedback restent non exposés, voir « Surface CLI desktop
post-M8 »).

Décision **toujours ouverte, non tranchée à ce stade** — plusieurs
directions possibles, aucune priorisée ici :
- étendre la surface CLI desktop (résumé/triage via
  `summarizeEmailsNeedingAttention`, feedback via
  `recordFeedbackForEmail`/`applyUserRule` — `gmail.prepare_reply` est
  désormais câblé via la commande `prepare-reply`, voir « Surface CLI
  desktop post-M8 ») ;
- brancher `@jarvis/inbox` dans `apps/api` via une route HTTP qui déclenche
  `fetchAndClassifyEmails`/`summarizeEmailsNeedingAttention` ;
- construire l'interface conversationnelle (NLU → `UserRuleRequest`/feedback) ;
- une autre architecture.

Ce document ne tranche aucune de ces directions.

## Ce qui n'est PAS fait (volontairement)

- Discord, Calendar, Outlook, ou tout autre fournisseur réel : seul Gmail a
  un connecteur réel.
- `gmail.modify`, `gmail.delete` : n'existent pas (ni `Tool`, ni méthode sur
  `GmailApiClient`). `gmail.prepare_reply` (M7.3) et `gmail.send` (M8)
  existent tous les deux.
- Pas de tool-use Anthropic réel (`AnthropicProvider` n'émet pas de `toolCall`).
- Connecteurs non branchés dans `apps/api` (`ToolRegistry` de l'API toujours
  vide d'outil connecteur). `apps/desktop`, lui, consomme `@jarvis/connectors`
  directement (M8) **et** `@jarvis/inbox` / `@jarvis/classification` via la
  commande `inbox` (`996d716`) — `@jarvis/classification` reçoit donc de vrais
  `EmailMessage` hors tests dès qu'un compte Gmail réel est connecté en CLI.
- Aucune extraction NLU de règles depuis du texte libre — `@jarvis/inbox`
  prépare les contrats (`recordFeedbackForEmail`, `applyUserRule`) mais ne
  parse aucun langage naturel, et ils ne sont câblés dans aucune commande CLI.
  (Distinct de VS-02 « Lecture naturelle contrôlée » — voir ci-dessus —
  qui ne couvre qu'un vocabulaire fermé de demandes de lecture `gmail.read`,
  jamais `recordFeedbackForEmail`/`applyUserRule`, et ne constitue pas une
  conversation naturelle générale.)
- Aucun branchement du flux `@jarvis/inbox` dans `apps/api` : `ToolRegistry`
  de l'API reste vide de tout outil connecteur. (La commande CLI `inbox` de
  `apps/desktop`, elle, câble `fetchAndClassifyEmails` — mais s'arrête à la
  classification : ni résumé, ni triage, ni feedback.)
- Pas de mémoire persistante, pas de streaming, pas de WebSocket.
- Pas d'outil filesystem / shell / réseau générique.

## Vérifications (après M4 + connecteurs + classification + Gmail M5 + inbox M6 + M7 + Connector Architecture Foundation + M8 + surface CLI desktop post-M8)

- `npm run typecheck` : vert
- `npm test` : vert — **530 tests, 50 fichiers** au total. Détail non
  exhaustif : 225 tests / 28 fichiers à l'issue de `Connector Architecture
  Foundation` (`8506792`, voir historique ci-dessous pour le détail par
  fichier) ; puis M8 (OAuth PKCE, `OsCredentialSecretStore`,
  `ConfirmationService`/`proposeConfirmation`/`confirmAndExecute`,
  `gmail.send`, câblage CLI `apps/desktop`, et la couverture d'erreurs
  post-confirmation de M8-B6 dans `gmail-send.test.ts`/`main-send.test.ts`) ;
  puis la surface CLI desktop post-M8 (`main.test.ts` pour `disconnect`,
  `main-read.test.ts`, `main-inbox.test.ts`, `inbox-view.test.ts`).
- `npm run lint` : vert — `eslint .` (flat config ESLint 9, voir
  `eslint.config.js` à la racine), y compris les règles de frontières
  entre workspaces.
- Aucun appel réseau réel dans les tests : `GmailApiClient` (via
  `gmailConnector`) reçoit systématiquement un `fetchFn` mocké,
  `ClassificationEngine` et `LlmProviderEmailSummarizer` n'utilisent que
  `MockLlmProvider` — aucune dépendance vers
  `undici`/`node-fetch`/`googleapis`/`@anthropic-ai/sdk` chargée à
  l'exécution des tests. `InMemorySecretStore` (nouveau) ne dépend
  d'aucun mécanisme externe.
- Aucun secret réel, aucun nouveau fichier `.env`.

**Addendum VS-02 (committé `8fb7ff4`, non inclus dans le total de 530
ci-dessus, non re-vérifié par une exécution complète de `npm test` à
cette mise à jour)** : 82 tests ciblés verts (détail par fichier dans « Lecture
naturelle contrôlée — VS-02 » ci-dessus), `npm run typecheck` et
`npm run lint` propres sur l'ensemble du dépôt à l'issue de VS-02f.

## Commits clés

Jalons fonctionnels (`M4` → `M8`, chronologie de référence) :

- `9d4021f` scaffold monorepo workspaces
- `2b4db31` TypeScript monorepo foundations
- `c95e80f` Anthropic LLM provider
- `5aed22d` core agent loop
- `0716411` HTTP chat API
- `3bde930` tool contract, registry, permissions, executor
- `f836375` agent tool execution loop (fin M4)
- `e059601` architecture connecteurs (`@jarvis/connectors` + `InMemoryConnector`) — antérieur à M5, pose le contrat `Connector<TClient>`
- `d57e202` moteur de classification (`@jarvis/classification` + `EmailMessage`)
- `fd13ffa` connecteur Gmail réel, lecture seule — **M5**
- `b5d82df` intégration Gmail ↔ classification, `@jarvis/inbox` — **M6**
- `84e2955` triage, résumés, préparation de réponse Gmail — **M7.1 + M7.2 + M7.3**
- `938d71c` composition `summarizeEmailsNeedingAttention` (`triage.ts`) — **M7.4**, committé et terminé
- **M8 — Gmail Send**, committé et terminé :
  - `2d088b7` OAuth Google Authorization Code + PKCE — **M8-B2**
  - `b5db57e` `SecretStore` de production (trousseau OS) — **M8-B3**
  - `a811027` boucle d'envoi Gmail confirmée — **M8-B4**
  - `309bbfb` câblage CLI desktop `connect`/`send` — **M8-B5**
  - `2faf205` couverture des erreurs post-confirmation — **M8-B6**

Surface CLI desktop post-M8 (hors numérotation fonctionnelle — exposition CLI
de briques existantes, aucun numéro `M8-B7`/`M9`/`OUT-07`) :

- `cc2e8a4` commande `disconnect` — câblage CLI de `disconnectGmailAccount()`
- `9c24cb7` commande `read` — câblage CLI du Tool `gmail.read`
- `996d716` commande `inbox` — câblage CLI de `fetchAndClassifyEmails`
  (`@jarvis/inbox`), s'arrête à la classification
- `753f4d0` commande `prepare-reply` — câblage CLI du Tool `gmail.prepare_reply`

Fondations architecturales (hors numérotation fonctionnelle — voir
« Functional milestones vs Architectural foundations » en tête de
document) :

- `8506792` **Connector Architecture Foundation** — `ConnectorRegistry`,
  `AccountStore`, `SecretStore`/`InMemorySecretStore`, `Capability`. Ne
  remplace pas et ne renumérote pas le M5 fonctionnel (`fd13ffa`).
