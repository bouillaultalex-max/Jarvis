# JARVIS

Assistant IA personnel — monorepo npm workspaces (TypeScript strict, Node 24, `tsx`, Vitest).

## État du projet

- Vue d'ensemble synthétique : [`MASTER_ROADMAP.md`](./MASTER_ROADMAP.md)
- Backlog actionnable : [`MASTER_BACKLOG.md`](./MASTER_BACKLOG.md)
- État détaillé, invariants et historique complet : [`PROJECT_STATE.md`](./PROJECT_STATE.md)
- Architecture des connecteurs : [`docs/connectors-architecture.md`](./docs/connectors-architecture.md)
- Décisions d'architecture (ADR) : [`docs/adr/`](./docs/adr/)

## Workspaces

```
apps/api          Serveur HTTP Fastify
apps/desktop       Client CLI terminal (connect / read / inbox / send / disconnect / legal-search)
packages/types      Types partagés
packages/llm        Abstraction LLM (Anthropic)
packages/core       AgentLoop, Tool, PermissionManager, ToolExecutor
packages/tools      Outils locaux
packages/connectors Connecteurs externes (Gmail…), AccountStore, SecretStore
packages/classification  Classification des emails
packages/inbox      Orchestration inbox (fetch → classify → attention → résumé)
```

Graphe de dépendances détaillé : voir `PROJECT_STATE.md` → « Workspaces & dépendances ».

### `legal-search` (recherche juridique Légifrance, lecture seule)

```bash
apps/desktop legal-search --asOf 2026-01-01 "préavis licenciement économique"
```

Prérequis : `SecretStore` (trousseau OS) peuplé avec
`legifrance.<sandbox|production>.clientId`/`clientSecret`. Provisionnement
interactif (terminal requis, saisie masquée, jamais d'appel OAuth ni de
recherche) :

```bash
node_modules/.bin/tsx apps/desktop/src/provision-legifrance-secrets.ts
```

`LEGIFRANCE_ENVIRONMENT` optionnelle (défaut `sandbox`). N'exige **ni**
configuration Gmail ni `ANTHROPIC_API_KEY`.

Code de sortie de `legal-search` : `0` pour un résultat exploitable (y compris
une recherche vide ou un résultat partiel, limites toujours présentées dans le
texte) ; non nul si la configuration est absente/invalide, si la permission
est refusée, ou en cas d'échec du fournisseur — dérivé du statut structuré du
flow, jamais d'une détection du texte affiché.

Limites assumées : recherche seule, budget fixe (1 page, 5 candidats, 5
récupérations) ; ne présente jamais une source comme « droit applicable » ni
une conclusion juridique vérifiée ; n'écrit jamais de dossier (`LegalCase`) ;
testé uniquement avec des doubles — **aucun appel réel à la Sandbox PISTE
n'a été exécuté**. Détail : `PROJECT_STATE.md` → `apps/desktop`.

## Développement local

```bash
npm install
npm run typecheck     # tsc --noEmit sur tout le monorepo
npm run lint          # eslint . (flat config, TypeScript-aware)
npm test              # vitest run
npm run test:coverage # vitest run --coverage (informatif, aucun seuil)
npm run format:check  # prettier --check . (informatif — pas encore un gate CI)
```

Node 24.x, npm 11.x requis (voir `engines` si ajouté, ou aligner sur votre environnement local).

`npm install` active aussi un hook Git pre-commit (`.githooks/`, via `core.hooksPath`) qui vérifie lint/format/typecheck sur les fichiers stagés. La CI (`.github/workflows/ci.yml`) ajoute un scan de secrets (gitleaks) ; les dépendances sont surveillées par Dependabot (`.github/dependabot.yml`).

## Secrets et environnement

- Aucune valeur sensible ne doit être commitée : `.gitignore` exclut déjà `.env*`, les credentials OAuth, et tous les fichiers runtime RuFlo (`.swarm/`, `.claude-flow/data|logs|sessions`, `ruvector.db`).
- Les secrets applicatifs (refresh token Gmail, etc.) sont stockés via `SecretStore` — jamais dans `AccountStore`, jamais loggés, jamais renvoyés à l'utilisateur ou au LLM. Voir `packages/connectors/src/secret-store.ts`.
- Chaque package qui en a besoin fournit un `.env.example` (`packages/connectors`, `packages/llm`) : copier en `.env` local, jamais commiter le `.env`.

## Claude Code + RuFlo

Ce dépôt utilise Claude Code avec l'orchestration RuFlo (`claude-flow`). Voir [`CLAUDE.md`](./CLAUDE.md) pour les règles de travail, la stratégie Explore → Plan → Implement → Review, et les conventions Git.

### Skill `code-review-skill`

Dépendance de développement (guides de revue de code par langage/framework), **non versionnée** dans ce dépôt : seul `skills-lock.json` (source + hash) est commité. La copie du skill (`.agents/`) et son symlink (`.claude/skills/code-review-skill`) sont exclus via `.gitignore` et régénérés localement à la demande.

Réinstallation :

```bash
DISABLE_TELEMETRY=1 npx skills add awesome-skills/code-review-skill --skill code-review-skill -y
```

`DISABLE_TELEMETRY=1` désactive la télémétrie anonyme de la CLI `skills` (sinon identifiants dépôt/skill envoyés pour les dépôts publics). `skills-lock.json` conserve la source (`awesome-skills/code-review-skill`), le chemin (`SKILL.md`) et un hash de contenu permettant de vérifier l'intégrité après réinstallation.
