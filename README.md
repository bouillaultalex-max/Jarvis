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
apps/desktop       Client CLI terminal (connect / read / inbox / send / disconnect / legal-search / chat / project)
packages/types      Types partagés
packages/llm        Abstraction LLM (Anthropic)
packages/core       AgentLoop, Tool, PermissionManager, ToolExecutor
packages/tools      Outils locaux
packages/connectors Connecteurs externes (Gmail…), AccountStore, SecretStore
packages/classification  Classification des emails
packages/inbox      Orchestration inbox (fetch → classify → attention → résumé)
packages/project-briefs  Fiches projet persistantes (product builder), sans LLM
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

### `project` (fiches projet persistantes, product builder — sans LLM)

```bash
apps/desktop project create boutique-asiatique "Boutique asiatique"
apps/desktop project show boutique-asiatique
apps/desktop project add-fact boutique-asiatique "texte"
apps/desktop project add-hypothesis boutique-asiatique "texte"
apps/desktop project add-question boutique-asiatique "texte"
apps/desktop project answer-question boutique-asiatique <question-id> "réponse"
apps/desktop project add-decision boutique-asiatique "texte"
apps/desktop project validate-decision boutique-asiatique <decision-id>
apps/desktop project obsolete-decision boutique-asiatique <decision-id>
apps/desktop project next-question boutique-asiatique
apps/desktop project export-markdown boutique-asiatique --output chemin.md
apps/desktop project interview boutique-asiatique
```

N'exige **aucun** credential (ni Gmail, ni Légifrance, ni `ANTHROPIC_API_KEY`) :
règles déterministes, aucun appel LLM. Persistance : un fichier JSON
versionné par projet (`@jarvis/project-briefs`), dans un répertoire privé
hors dépôt — `JARVIS_PROJECT_BRIEFS_DIR` si définie, sinon la convention par
OS déjà utilisée pour `accounts.json` (`$XDG_DATA_HOME`/`AppData`/
`Application Support`, sous-dossier `jarvis/project-briefs/`).

Faits, hypothèses, décisions et questions sont des catégories séparées, à
identifiants stables (jamais un index de tableau). Une décision suit
`proposed → validated`/`obsolete` (jamais l'inverse depuis `obsolete`) ;
répondre à une question (`answer-question`) ne promeut jamais la réponse en
fait ni en décision validée. `next-question` applique une **règle fixe**
(première question `open`, dans l'ordre d'ajout) — explicitement annoncée
comme telle, jamais présentée comme un raisonnement.

**Une question déjà résolue refuse toute nouvelle réponse** (erreur
`already_answered`, détectée sur la relecture fraîche faite sous le verrou
du fichier — jamais sur un état potentiellement périmé) : ni
`answer-question`, ni `interview` (ci-dessous) ne peuvent jamais écraser
silencieusement une réponse existante. Aucune commande de réécriture ou de
réouverture n'existe pour contourner ce refus.

`interview <id>` propose un questionnaire interactif — **toujours la même
règle fixe que `next-question`**, jamais un LLM, explicitement annoncé comme
tel au démarrage. Pour chaque question : taper une réponse l'enregistre
seulement après confirmation explicite (`y`/`yes`/`oui`, insensible à la
casse) ; toute autre confirmation, la fin de l'entrée (EOF) ou Ctrl+C
abandonnent la réponse proposée sans jamais l'enregistrer. `/passer` passe la
question **pour cette session seulement** — la fiche n'est jamais modifiée
par un passage, et une nouvelle session (nouvel appel) retrouve la même
question en premier. Si toutes les questions restantes ont été passées, la
commande s'arrête avec « Questions restantes passées pour cette session »
sans boucler et sans jamais prétendre qu'elles sont résolues. Une seule
interface terminal gère tout le parcours ; si une autre commande résout la
question entre son affichage et sa confirmation (`already_answered`), le
conflit est signalé explicitement et la réponse abandonnée n'est jamais
resoumise automatiquement — seule une nouvelle sélection, après relecture,
suit.

Concurrence entre deux commandes sur le même projet : verrou coopératif par
fichier (création atomique `O_CREAT|O_EXCL`) — la seconde commande est
refusée explicitement (jamais une perte silencieuse). Limite assumée : un
verrou issu d'un process tué en cours d'opération reste en place jusqu'à
suppression manuelle du fichier `<id>.json.lock` (aucune récupération
automatique). Ce chantier est un domaine séparé, **pas** une généralisation
de la Situation (`ADR-0010`) ni de la mémoire contrôlée (`@jarvis/memory`).

`export-markdown <id> --output <chemin.md>` écrit un **instantané** Markdown
de la fiche (rendu pur dans `@jarvis/project-briefs`, écriture exclusive côté
desktop) : aucun retour vers Jarvis, aucune synchronisation — modifier le
fichier exporté ne met jamais à jour la fiche JSON. Création **exclusive**
(`O_CREAT|O_EXCL`) : un fichier destination déjà existant est toujours
refusé, jamais écrasé. Ne modifie jamais le JSON source ni sa révision
(lecture seule). Sur un chemin NTFS monté via WSL (`/mnt/c/...`), les
permissions effectives du fichier dépendent des ACL Windows, pas du mode
Unix demandé par le code — aucune garantie `0600` sur ce type de chemin.

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
