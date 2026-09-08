# ADR-0001: Frontières architecturales strictes entre workspaces

Date: 2026-09-08
Status: Accepted

## Context

JARVIS est un monorepo npm workspaces (`packages/types`, `llm`, `core`,
`tools`, `connectors`, `classification`, `inbox`, `apps/api`,
`apps/desktop`). Dès le départ, `packages/core` (contrat `Tool`,
`PermissionManager`, `ToolExecutor`, `AgentLoop`) devait rester générique :
capable d'exécuter n'importe quel outil, sans jamais connaître un
fournisseur concret (Gmail, Discord…). De même, `packages/classification`
devait rester une logique métier pure, testable sans connecteur ni moteur
d'exécution réels. Ajouter un futur connecteur ne devait jamais imposer de
modifier `core`.

## Decision

Chaque workspace n'a le droit d'importer que les workspaces situés
strictement en dessous de lui dans la hiérarchie : `types`/`llm` sont des
feuilles ; `core` ne dépend que de `llm` (types uniquement) ; `connectors`
et `tools` dépendent de `core` ; `classification` reste isolée (dépendance
type-only à `llm`/`types` seulement) ; `inbox` orchestre `classification`
et `core`, `connectors` n'y étant autorisé qu'en test (devDependency). Ces
frontières, documentées depuis l'origine dans `docs/connectors-architecture.md`
et `PROJECT_STATE.md`, sont désormais imposées automatiquement par des
règles ESLint (`no-restricted-imports`) par workspace.

## Consequences

Ajouter un connecteur (Calendar, Slack…) reste additif : aucune
modification de `core`/`classification` n'est nécessaire. Une violation de
frontière (import interdit) échoue au lint, en local (hook pre-commit) et
en CI. Cette automatisation ne couvre que les frontières listées
explicitement par workspace — ce n'est **pas** une détection générique de
cycles de dépendances (aucun outil de ce type n'est en place ; l'absence de
cycle a été vérifiée manuellement une fois, pas surveillée en continu).
