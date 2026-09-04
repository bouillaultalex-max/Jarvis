# État du projet JARVIS

_Dernière mise à jour : 2026-09-04 — M7 (M7.1–M7.4) : identification des
emails nécessitant l'attention, résumé LLM (`Tool` `action: 'read'`),
préparation de réponse Gmail (`gmail.prepare_reply`, `action: 'prepare'`,
cible toujours dérivée du message réel), et composition
`summarizeEmailsNeedingAttention`. Toujours aucun `gmail.send`. Non branché
dans `apps/api`._

## Vue d'ensemble

JARVIS est un assistant IA personnel organisé en monorepo npm workspaces
(TypeScript strict, exécution via `tsx`, tests via Vitest).

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
apps/desktop            (vide)
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
| `@jarvis/connectors` | Contrat `Connector` + `InMemoryConnector` (fake) + `gmailConnector` (**réel**) : `gmail.read` (`action: 'read'`) + `gmail.prepare_reply` (`action: 'prepare'`, M7.3) | aucune capacité d'écriture (`gmail.send`/`modify`/`delete` inexistants) |
| `@jarvis/classification` | `ClassificationEngine`, `PreferenceStore`, `EmailLlmClassifier` | inchangé depuis M4.5 ; toujours aucun connecteur ni LLM réel branché en interne |
| `@jarvis/inbox` | `fetchEmailsViaTool`, `classifyEmails`, `fetchAndClassifyEmails`, `recordFeedbackForEmail`, `applyUserRule`, `needsAttention`/`filterEmailsNeedingAttention` (M7.1), `createSummarizeEmailTool`/`EmailSummarizer` (M7.2), `summarizeEmailsNeedingAttention` (M7.4) | flux complet Gmail → classification → attention → résumé validé par tests (Gmail/LLM mockés) ; **non branché dans `apps/api`** |
| `apps/api` | Serveur HTTP Fastify, `POST /chat` | fonctionnel ; `AgentLoop` sans `ToolExecutor` (le provider réel n'émet pas de `toolCall`) ; connecteurs/inbox **non branchés** |
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
    refresh token — **non implémentée** à ce stade.
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
  `capabilities: ['gmail.read']`, un seul `Tool` (`action: 'read'`). Pas de
  `gmail.send`, `gmail.modify`, `gmail.delete` ni `gmail.prepare_reply` — ni
  comme `Tool`, ni comme méthode sur `GmailApiClient`.
- **`ClassificationEngine` non modifié** : consomme l'`EmailMessage` produit
  par le mapper exactement comme n'importe quel autre `EmailMessage`.

Aucun secret réel dans le dépôt : `packages/connectors/.env.example` ne
contient que des placeholders (`GMAIL_CLIENT_ID=your-gmail-oauth-client-id`,
etc.), couvert par `.gitignore` (`.env` / `.env.*` ignorés, `.env.example`
explicitement autorisé).

### Limites connues (héritées de M4, inchangées)

- Le résultat d'outil est réinjecté au LLM en **texte** (`chat(messages)` n'a pas
  encore de bloc `tool_result` structuré).
- Une entrée dans `confirmedTools` vaut pour **tout le tour** : si le modèle
  rappelle le même outil confirmé plusieurs fois dans un tour, chaque appel passe.
- `apps/api` n'expose pas encore outils / confirmations via HTTP.

### Volontairement repoussé (décisions à trancher plus tard)

- **Discord/Calendar/autres fournisseurs** : `InMemoryConnector` reste le
  seul exemple non-Gmail.
- **Toute capacité Gmail au-delà de la lecture** : pas de `gmail.send`, pas
  de `gmail.modify`, pas de `gmail.delete`, pas de `gmail.prepare_reply`.
  Volontaire pour ce jalon (M5 = lecture seule) — un futur jalon pourra
  ajouter `gmail.prepare_reply` (action `prepare`) puis, avec un modèle de
  confirmation explicite, `gmail.send` (action `execute`).
- **Connexion initiale du compte** (flux de consentement OAuth interactif,
  obtention du tout premier refresh token) : non implémentée. `gmailConnector`
  suppose un `refreshToken` déjà obtenu, fourni via `GmailCredentials`.
- **Stockage sécurisé du refresh token** : seule l'interface
  `RefreshTokenStore` est posée ; aucune implémentation (fichier chiffré,
  trousseau OS…) n'existe. Le refresh token transite tel quel, en mémoire,
  via `GmailCredentials`.
- **`apps/connectors` non branché dans `apps/api`** : le `ToolRegistry` de
  `apps/api` reste vide de tout outil connecteur pour l'instant — décision
  explicitement repoussée par consigne de ce jalon.
- **`apps/desktop`** : aucun flux de connexion Gmail dans une UI — hors
  scope tant que la connexion initiale (ci-dessus) n'est pas tranchée.

### Prochaine étape prévue (connecteurs)

Décision à prendre avant d'aller plus loin sur Gmail : flux de connexion
initiale du compte (desktop vs. serveur), stockage sécurisé du refresh token
(où, comment chiffré), et modèle de confirmation utilisateur pour de
futures actions `execute` réelles (UI de confirmation via `apps/api` ou
`apps/desktop`) — avant tout `gmail.send`.

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
- Aucun `gmail.send` : l'envoi reste un jalon séparé, après feu vert
  explicite (M8, non commencé).
- Aucune génération automatique du corps d'une réponse par LLM :
  `gmail.prepare_reply` structure un corps déjà fourni, il ne le rédige pas.

### Prochaine étape prévue (inbox)

Décision à prendre avant d'aller plus loin : faut-il brancher ce flux dans
`apps/api` (une route HTTP qui déclenche `fetchAndClassifyEmails`/
`summarizeEmailsNeedingAttention` et expose leurs résultats), ou d'abord
construire l'interface conversationnelle (NLU → `UserRuleRequest`/feedback) ?
Les deux restent hors scope tant que la connexion initiale OAuth (M5,
toujours non tranchée) n'est pas résolue. `gmail.send` reste un jalon séparé
nécessitant un feu vert explicite.

## Ce qui n'est PAS fait (volontairement)

- Discord, Calendar, Outlook, ou tout autre fournisseur réel : seul Gmail a
  un connecteur réel.
- `gmail.send`, `gmail.modify`, `gmail.delete` : aucune de ces capacités
  n'existe (ni `Tool`, ni méthode sur `GmailApiClient`). `gmail.prepare_reply`
  existe depuis M7.3 (`action: 'prepare'`, aucun effet de bord).
- Pas de tool-use Anthropic réel (`AnthropicProvider` n'émet pas de `toolCall`).
- Connecteurs non branchés dans `apps/api` (`ToolRegistry` de l'API toujours
  vide d'outil connecteur) — `@jarvis/classification` n'a donc jamais reçu
  de vrai `EmailMessage` en dehors des tests.
- Flux de connexion initiale du compte Gmail (consentement OAuth, obtention
  du premier refresh token) et stockage sécurisé du refresh token : seules
  les interfaces sont posées (`RefreshTokenStore`), non implémentées.
- Aucune extraction NLU de règles depuis du texte libre — `@jarvis/inbox`
  prépare les contrats (`recordFeedbackForEmail`, `applyUserRule`) mais ne
  parse aucun langage naturel.
- Aucun branchement du flux `@jarvis/inbox` dans `apps/api` : `ToolRegistry`
  de l'API reste vide de tout outil connecteur.
- Pas de mémoire persistante, pas de streaming, pas de WebSocket.
- Pas d'outil filesystem / shell / réseau générique.
- `apps/desktop` non commencé.

## Vérifications (après M4 + connecteurs + classification + Gmail M5 + inbox M6 + M7)

- `npm run typecheck` : vert
- `npm run typecheck --workspaces` : vert (8 workspaces)
- `npm test` : vert — **184 tests, 23 fichiers**, dont pour `@jarvis/inbox` :
  6 (`fetch-emails.test.ts`), 2 (`classify-emails.test.ts`), 6
  (`feedback.test.ts`), 9 (`gmail-integration.test.ts`), 9 (`attention.test.ts`,
  M7.1), 8 (`email-summarizer.test.ts`, M7.2), 9
  (`summarize-email-tool.test.ts`, M7.2), 7 (`triage.test.ts`, M7.4) ; et pour
  `@jarvis/connectors`, `gmail-connector.test.ts` étendu à 14 tests (M7.3).
- Aucun appel réseau réel dans les tests : `GmailApiClient` (via
  `gmailConnector`) reçoit systématiquement un `fetchFn` mocké,
  `ClassificationEngine` et `LlmProviderEmailSummarizer` n'utilisent que
  `MockLlmProvider` — aucune dépendance vers
  `undici`/`node-fetch`/`googleapis`/`@anthropic-ai/sdk` chargée à
  l'exécution des tests.
- Aucun secret réel, aucun nouveau fichier `.env`.

## Commits clés

- `9d4021f` scaffold monorepo workspaces
- `2b4db31` TypeScript monorepo foundations
- `c95e80f` Anthropic LLM provider
- `5aed22d` core agent loop
- `0716411` HTTP chat API
- `3bde930` tool contract, registry, permissions, executor
- `f836375` agent tool execution loop (fin M4)
- `e059601` architecture connecteurs (`@jarvis/connectors` + `InMemoryConnector`)
- `d57e202` moteur de classification (`@jarvis/classification` + `EmailMessage`)
- `fd13ffa` connecteur Gmail réel, lecture seule (M5)
- `b5d82df` intégration Gmail ↔ classification, `@jarvis/inbox` (M6)
- `84e2955` triage, résumés, préparation de réponse Gmail (M7.1 + M7.2 + M7.3)
- _(M7.4 — composition `summarizeEmailsNeedingAttention` (`triage.ts`) : non committé — en attente de revue)_
