# ADR-0005: ToolExecutor comme point d'exécution unique, confirmation obligatoire pour toute action execute

Date: 2026-09-08
Status: Accepted

## Context

Une action classée `execute` (ex. `gmail.send`) produit un effet de bord
réel et irréversible côté utilisateur — un email envoyé ne peut pas être
« annulé ». Le modèle de langage (LLM) ne doit jamais pouvoir déclencher
une telle action seul, même si la politique de permission configurée
l'autoriserait techniquement.

## Decision

`AgentLoop` n'appelle jamais `tool.execute()` directement : toute exécution
passe exclusivement par `ToolExecutor.run()`, point de contrôle unique.
`PermissionManager.decide()` et la confirmation utilisateur sont deux
mécanismes distincts et non substituables : une politique qui répondrait
`'allow'` pour une action `execute` (ex. `gmail.send`) ne suffit pas à
l'exécuter — le code applicatif (`runGmailSend`, `apps/desktop`) refuse
explicitement ce cas (`confirmation_required`) plutôt que d'exécuter. Seule
une confirmation utilisateur explicite (`confirmed: true`, obtenue via
`ConfirmationService`) permet l'exécution, et cette confirmation ne peut
jamais outrepasser un `deny`.

## Consequences

Toute nouvelle action `execute` doit être câblée derrière un flux de
confirmation dédié — il n'existe pas de raccourci « allow direct » pour une
action irréversible. Ce choix ajoute une étape obligatoire (UI de
confirmation) avant tout envoi réel, au bénéfice d'une garantie forte :
aucun effet de bord irréversible ne peut se produire sans un geste
utilisateur explicite, quelle que soit la politique de permission
configurée.
