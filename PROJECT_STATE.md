# État du projet JARVIS

_Dernière mise à jour : 2026-09-04 — finalisation M4 (étapes 1 + 2)._

## Vue d'ensemble

JARVIS est un assistant IA personnel organisé en monorepo npm workspaces
(TypeScript strict, exécution via `tsx`, tests via Vitest).

## Workspaces & dépendances

```
@jarvis/types   (aucune dépendance interne)
@jarvis/llm     → @anthropic-ai/sdk
@jarvis/core    → @jarvis/llm (types uniquement), @jarvis/types
@jarvis/tools   → @jarvis/core, @jarvis/types
apps/api        → @jarvis/core, @jarvis/llm, @jarvis/tools, fastify
apps/desktop    (vide)
```

| Workspace | Rôle | État |
|---|---|---|
| `@jarvis/types` | Types partagés (`JarvisMessage`) | stable, minimal |
| `@jarvis/llm` | Abstraction LLM + `AnthropicProvider` | fonctionnel ; clé lue en lazy au 1er appel ; `LlmResponse.toolCall?` défini mais jamais émis par `AnthropicProvider` |
| `@jarvis/core` | `AgentLoop`, `Tool`, `ToolRegistry`, `PermissionManager`, `ToolExecutor` | Tools + Permissions branchés dans `AgentLoop` |
| `@jarvis/tools` | Outils locaux ; `echoTool` de démonstration | 1 outil de démo, sans réseau ni effet de bord |
| `apps/api` | Serveur HTTP Fastify, `POST /chat` | fonctionnel ; `AgentLoop` sans `ToolExecutor` (le provider réel n'émet pas de `toolCall`) |
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

## Préparation des connecteurs externes (non implémentés)

L'abstraction actuelle est prête à recevoir des outils type `gmail.read`,
`gmail.draft`, `gmail.send`, `discord.read`, `calendar.read`… sans donner un
accès global au compte :

- **Un outil = une capacité.** Chaque capacité est un `Tool` distinct, nommé
  (`service.action`) et typé, avec son propre `ActionLevel`. `gmail.read` ne peut
  pas envoyer.
- **Les credentials n'appartiennent pas à l'outil-contrat.** Une future couche
  « connecteurs » construira les outils en leur injectant un client déjà
  authentifié (`createGmailReadTool(client)`). Le `Tool` exposé ne contient ni
  token ni logique OAuth.
- **Le LLM ne possède jamais de credential.** Il émet `LlmToolCall { tool, input }`
  (structuré, `input: unknown` validé par l'outil). Aucun secret ne transite par
  le modèle ni par les réponses HTTP.
- **`ToolExecutor` reste le seul point de passage** avant toute action ;
  `PermissionManager` reste générique (aucune logique Gmail/Discord/…).
- **read / prepare / execute distingués** → politique par niveau
  (`actionDefaults: { read: 'allow', prepare: 'allow', execute: 'require_confirmation' }`)
  ou par outil (`rules: { 'gmail.delete': 'deny' }`).

Limites connues (à trancher plus tard) :
- Le résultat d'outil est réinjecté au LLM en **texte** (`chat(messages)` n'a pas
  encore de bloc `tool_result` structuré).
- Une entrée dans `confirmedTools` vaut pour **tout le tour** : si le modèle
  rappelle le même outil confirmé plusieurs fois dans un tour, chaque appel passe.
- `apps/api` n'expose pas encore outils / confirmations via HTTP.

## Ce qui n'est PAS fait (volontairement)

- Aucune intégration externe (Gmail, Discord, Calendar, OAuth…).
- Pas de tool-use Anthropic réel (`AnthropicProvider` n'émet pas de `toolCall`).
- Pas de package `connectors`, pas de fausse API externe, pas de simulation OAuth.
- Pas de mémoire persistante, pas de streaming, pas de WebSocket.
- Pas d'outil filesystem / shell / réseau.
- `apps/desktop` non commencé.

## Vérifications (fin M4)

- `npm run typecheck` : vert
- `npm run typecheck --workspaces` : vert (5 workspaces)
- `npm test` : vert — **59 tests, 8 fichiers**
- Aucun appel réseau / clé API dans les tests.

## Commits clés

- `9d4021f` scaffold monorepo workspaces
- `2b4db31` TypeScript monorepo foundations
- `c95e80f` Anthropic LLM provider
- `5aed22d` core agent loop
- `0716411` HTTP chat API
- _(M4 — Tools + Permissions + boucle d'agent : commit en cours)_
