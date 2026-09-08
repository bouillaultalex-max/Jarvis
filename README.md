# JARVIS

Assistant IA personnel — monorepo npm workspaces (TypeScript strict, Node 24, `tsx`, Vitest).

## État du projet

- Vue d'ensemble synthétique : [`MASTER_ROADMAP.md`](./MASTER_ROADMAP.md)
- Backlog actionnable : [`MASTER_BACKLOG.md`](./MASTER_BACKLOG.md)
- État détaillé, invariants et historique complet : [`PROJECT_STATE.md`](./PROJECT_STATE.md)
- Architecture des connecteurs : [`docs/connectors-architecture.md`](./docs/connectors-architecture.md)

## Workspaces

```
apps/api          Serveur HTTP Fastify
apps/desktop       Client desktop (terminal)
packages/types      Types partagés
packages/llm        Abstraction LLM (Anthropic)
packages/core       AgentLoop, Tool, PermissionManager, ToolExecutor
packages/tools      Outils locaux
packages/connectors Connecteurs externes (Gmail…), AccountStore, SecretStore
packages/classification  Classification des emails
packages/inbox      Orchestration inbox (fetch → classify → attention → résumé)
```

Graphe de dépendances détaillé : voir `PROJECT_STATE.md` → « Workspaces & dépendances ».

## Développement local

```bash
npm install
npm run typecheck   # tsc --noEmit sur tout le monorepo
npm run lint        # eslint . (flat config, TypeScript-aware)
npm test            # vitest run
npm run format:check  # prettier --check . (informatif — pas encore un gate CI)
```

Node 24.x, npm 11.x requis (voir `engines` si ajouté, ou aligner sur votre environnement local).

## Secrets et environnement

- Aucune valeur sensible ne doit être commitée : `.gitignore` exclut déjà `.env*`, les credentials OAuth, et tous les fichiers runtime RuFlo (`.swarm/`, `.claude-flow/data|logs|sessions`, `ruvector.db`).
- Les secrets applicatifs (refresh token Gmail, etc.) sont stockés via `SecretStore` — jamais dans `AccountStore`, jamais loggés, jamais renvoyés à l'utilisateur ou au LLM. Voir `packages/connectors/src/secret-store.ts`.
- Chaque package qui en a besoin fournit un `.env.example` (`packages/connectors`, `packages/llm`) : copier en `.env` local, jamais commiter le `.env`.

## Claude Code + RuFlo

Ce dépôt utilise Claude Code avec l'orchestration RuFlo (`claude-flow`). Voir [`CLAUDE.md`](./CLAUDE.md) pour les règles de travail, la stratégie Explore → Plan → Implement → Review, et les conventions Git.
