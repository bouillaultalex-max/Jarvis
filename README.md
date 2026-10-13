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
apps/desktop       Client CLI terminal (connect / read / inbox / send / disconnect / legal-search / chat)
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

### `chat` (conversation locale, mémoire de session bornée, sans outil)

```bash
node_modules/.bin/tsx apps/desktop/src/main.ts chat
```

Boucle interactive : une ligne tapée → une réponse de Jarvis affichée, jusqu'à
`/quit`, Ctrl+C, ou la fin de l'entrée. **Portée volontairement minimale** :
`AgentLoop` est construit **sans** `ToolExecutor` — aucun outil n'est présenté
au modèle (`gmail.*`/`legal-search` restent des commandes séparées, non
accessibles depuis ce chat).

**Mémoire de session (RAM uniquement)** : l'historique (paires `user`/
`assistant` complètes) est conservé dans une variable locale du process,
**jamais écrit sur disque, jamais journalisé** — perdu à l'arrêt du process.
Borné à 20 messages et 8 000 caractères (`MAX_HISTORY_MESSAGES`/
`MAX_HISTORY_CONTEXT_CHARS`, `chat-repl.ts`) — un comptage de **caractères**,
pas de tokens : aucun plafond de tokens ni de coût monétaire n'est garanti.
Au-delà, les échanges les plus anciens sont retirés (jamais un texte tronqué
en son milieu) et c'est annoncé à l'écran. Un message qui dépasse seul la
limite est refusé localement, sans appel ; une réponse trop volumineuse est
affichée mais jamais conservée. `/reset` efface tout instantanément, sans
appel réseau.

Prérequis : `ANTHROPIC_API_KEY` (sinon message d'erreur contrôlé au premier
message, aucun appel réseau tenté). **N'exige ni configuration Gmail, ni
Légifrance.** `ANTHROPIC_MODEL` optionnelle pour forcer explicitement un
modèle — le défaut codé dans `AnthropicProvider`
(`packages/llm/src/index.ts`) n'est pas garanti correspondre à un identifiant
actuellement disponible.

**Chaque message non vide déclenche un appel réel à l'API Anthropic et peut
être facturé** — l'abonnement Claude Code ne couvre pas cette consommation.
Conserver un historique **augmente le coût d'entrée de chaque tour suivant**
(il est renvoyé en entier à chaque appel) — à mettre en balance avec
l'absence de budget pour un essai réel. Ctrl+C n'annule jamais un appel déjà
en cours (aucun mécanisme d'annulation câblé dans ce dépôt) : une réponse en
vol au moment de l'interruption s'affiche quand même avant la fermeture
effective de la boucle, mais aucune ligne suivante, même déjà en attente,
n'est jamais traitée.

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
