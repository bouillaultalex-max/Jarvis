# Architecture des connectors personnels (M5)

Fondation générique pour connecter JARVIS à des services personnels
externes (Gmail, Google Calendar, Google Drive, Slack, GitHub, …), sans
coupler le cœur de JARVIS à un fournisseur particulier.

**Hors périmètre de M5** : aucune intégration réseau réelle, aucun OAuth,
aucun stockage de secret de production. M5 pose uniquement l'architecture ;
seuls `gmailConnector` (lecture seule + préparation de réponse) et
`inMemoryConnector` (démo locale) existent comme implémentations concrètes.

## Vue d'ensemble

```text
                    ┌─────────────────┐
                    │      Tool       │   ← produit par un Connector
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ PermissionMgr   │   ← SEULE autorité d'autorisation
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  ToolExecutor   │   ← point de passage unique
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │    Connector    │   ← id, name, capabilities, createTools(client)
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ External API    │   ← hors périmètre M5
                    └─────────────────┘

  ConnectorRegistry                 AccountStore
  ────────────────────────────      ────────────────────────────
  résout un Connector par id        résout un Account par (provider, accountId?)
  aucune logique métier             ne choisit jamais un compte en cas d'ambiguïté

                Secrets (tokens OAuth, clés API…)
                             │
                             ↓
                       ┌────────────┐
                       │ SecretStore│   ← jamais lu par un Tool, jamais journalisé
                       └────────────┘
```

Le flux d'exécution d'un `Tool` **ne change pas** avec M5 :

```text
Tool → ActionLevel → PermissionManager → ToolExecutor → Connector → External service
```

`ConnectorRegistry`, `AccountStore` et `SecretStore` interviennent **en
amont** de ce flux (résolution du connector, du compte, du client
authentifié) — jamais à sa place. Aucun ne prend de décision d'autorisation.

## `Connector` (inchangé depuis M4)

```ts
interface Connector<TClient = unknown> {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly string[];
  createTools(client: TClient): readonly Tool[];
}
```

M5 est **additif** : ce contrat n'a pas été modifié. Un connector ne prend
aucune décision de permission et ne porte aucun credential — il reçoit un
client déjà authentifié par injection (`createTools(client)`).

Voir `packages/connectors/src/gmail/gmail-connector.ts` et
`packages/connectors/src/in-memory/in-memory-connector.ts` pour deux
implémentations conformes.

## `ConnectorRegistry`

`packages/connectors/src/connector-registry.ts`

Registre déterministe, symétrique à `ToolRegistry` (`@jarvis/core`) :
`register`, `has`, `get`, `list`, `listCapabilities`. Aucune logique
spécifique à un provider — un connector fictif s'y comporte exactement
comme `gmailConnector`.

```text
ConnectorRegistry
        │
        ├── gmailConnector
        ├── inMemoryConnector
        └── (futur) CalendarConnector, DriveConnector, SlackConnector, GitHubConnector…
```

## `Capability`

`packages/connectors/src/capability.ts`

Une `Capability` **décrit** ce qu'un connector sait faire — elle ne
décide jamais si l'action est autorisée :

```text
Capability
    ↓
Connector / Tool
    ↓
ActionLevel
    ↓
PermissionManager
    ↓
ToolExecutor
```

`describeCapabilities(connectorId, tools)` dérive les `Capability` d'un
connector à partir des `Tool` qu'il produit — `action` y est recopié de
`Tool.action`, jamais réinterprété. Ce n'est **pas** un second système de
permissions : `PermissionManager` reste l'unique autorité pour
autoriser/refuser une action, à partir de ce même `ActionLevel`.

## Accounts (`Account` / `AccountStore`)

`packages/connectors/src/account.ts`

Un utilisateur peut avoir plusieurs comptes pour un même provider (ex.
Google personnel + professionnel) : ne jamais supposer *1 provider = 1
compte*.

```ts
interface Account {
  readonly id: string;
  readonly provider: string;
  readonly accountIdentifier: string; // ex. une adresse email — jamais un secret
  readonly displayName?: string;
  readonly status: 'connected' | 'disconnected' | 'error';
  readonly metadata?: Readonly<Record<string, unknown>>; // jamais de credential
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

`AccountStore.resolve({ provider, accountId? })` est le seul point de
sélection d'un compte pour une opération :

- `accountId` fourni → ce compte précis, ou `UnknownAccountError`.
- `accountId` absent, un seul compte pour ce provider → il est résolu.
- `accountId` absent, aucun compte → `UnknownAccountError`.
- `accountId` absent, **plusieurs** comptes → `AmbiguousAccountError` —
  **jamais** de sélection implicite.

## `SecretStore`

`packages/connectors/src/secret-store.ts`

```ts
interface SecretStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
```

M5 fournit une seule implémentation, **dev/test uniquement** :
`InMemorySecretStore` (`packages/connectors/src/in-memory/in-memory-secret-store.ts`).
Son stockage est un champ privé JS réel (`#secrets`), pas seulement
`private` TypeScript, pour qu'aucune valeur ne fuite via
`JSON.stringify`/`console.log`. **Ne jamais l'utiliser en production.**

Règles absolues, vérifiées par `packages/connectors/src/security.test.ts` :

- un secret n'est **jamais** envoyé au LLM ;
- un secret n'est **jamais** exposé dans les logs ;
- un secret n'apparaît **jamais** dans une erreur (`SecretNotFoundError` ne
  cite que la clé) ;
- un secret n'est **jamais** retourné par un `Tool` ni inclus dans une
  réponse utilisateur.

## Intégration avec `PermissionManager` — ne pas contourner

Le flux existant reste la seule voie d'exécution :

```text
Tool → ActionLevel → PermissionManager → ToolExecutor
```

`ConnectorRegistry` et `AccountStore` ne font que **résoudre** (quel
connector ? quel compte ?) — ils n'exécutent rien et n'autorisent rien.
Concrètement :

- une capability `execute` reste refusée par une politique `deny`, même
  résolue via `ConnectorRegistry` + `AccountStore` (voir
  `security.test.ts`) ;
- une action `require_confirmation` reste bloquée tant que
  `confirmed !== true`, quel que soit le chemin de résolution du connector
  et du compte ;
- les opérations read-only (`Tool.action === 'read'`) restent distinctes
  des opérations d'écriture (`'prepare'`, `'execute'`) — cette distinction
  vit exclusivement dans `Tool.action`, jamais dans `Capability` ni dans
  `ConnectorRegistry`.

## Erreurs métier

`packages/connectors/src/errors.ts` — jamais de secret dans un message :

| Erreur | Cas |
| --- | --- |
| `UnknownConnectorError` | connector inconnu du `ConnectorRegistry` |
| `ConnectorUnavailableError` | connector enregistré mais indisponible |
| `UnknownCapabilityError` | capability jamais déclarée |
| `UnsupportedCapabilityError` | capability connue, non supportée par ce connector |
| `UnknownAccountError` | `accountId` introuvable, ou aucun compte pour ce provider |
| `AmbiguousAccountError` | plusieurs comptes, `accountId` requis |
| `SecretNotFoundError` | clé absente du `SecretStore` |

Un refus de permission n'est **pas** dans cette liste : il reste représenté
par `ToolExecutionResult` (`status: 'denied' | 'awaiting_confirmation'`)
côté `@jarvis/core` — aucune classe d'erreur connectors ne le duplique.

## Chemin d'intégration futur (ex. Gmail complet, Calendar, Drive, Slack, GitHub)

Ajouter un provider ne doit toucher ni `ToolExecutor`, ni
`PermissionManager`, ni `ConnectorRegistry`, ni `SecretStore` :

1. Créer son `Connector` (`id`, `name`, `capabilities`, `createTools`).
2. Déclarer ses capabilities via `describeCapabilities(connectorId, tools)`.
3. Définir la forme de compte attendue (un `Account` avec `provider: 'x'`).
4. Brancher son authentification (client injecté dans `createTools`,
   secrets lus depuis un `SecretStore` — jamais stockés sur `Account`).
5. Enregistrer le connector dans un `ConnectorRegistry`.

```text
GmailConnector      (existe, lecture seule + préparation)
CalendarConnector   (futur)
DriveConnector      (futur)
SlackConnector      (futur)
GitHubConnector     (futur)
```

Le cœur — `ToolExecutor`, `PermissionManager`, `ConnectorRegistry`,
`SecretStore` — reste générique.
