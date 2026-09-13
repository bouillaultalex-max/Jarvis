# ADR-0006: Confirmation fingerprintée obligatoire pour les actions à effet externe (execute)

Date: 2026-09-13
Status: Accepted

## Context

Deux mécanismes de confirmation coexistent aujourd'hui dans le dépôt, avec
des garanties très différentes. Côté `@jarvis/core`, `AgentLoop.run(message,
{ confirmedTools })` construit un `Set` de noms d'outils une seule fois par
tour (`agent-loop.ts`) et transmet `confirmed: confirmed.has(call.tool)` à
`ToolExecutor.run()` à chaque appel d'outil de la boucle. `ToolExecutor`
(`tool-executor.ts`) ne fait alors que lire `request.confirmed === true` — un
booléen déclaré par l'appelant, sans preuve d'intégrité, sans lien avec
l'`input` réellement exécuté, le compte, ou une quelconque limite d'usage.
Côté `@jarvis/connectors`, `ConfirmationService` (`confirmation/`) émet un
ticket opaque (256 bits, `crypto.randomBytes`) lié par une empreinte SHA-256
canonique à `{toolName, action, accountId, input validé}`
(`confirmation/fingerprint.ts`), à usage unique, avec TTL, et re-vérifié
(`confirmAndExecute`) avant tout appel réel à `ToolExecutor.run`.

`ADR-0005` a déjà établi que `ToolExecutor` est le point d'exécution unique
et qu'une action `execute` exige une confirmation utilisateur qu'aucune
politique `'allow'` ne peut remplacer. Cette décision-ci affine ce que
« confirmation » doit signifier structurellement pour une action `execute` :
`ADR-0005` ne distingue pas les deux mécanismes ci-dessus, alors qu'ils
n'offrent pas le même niveau de garantie.

État actuel du câblage (vérifié dans le code) : `apps/api/src/server.ts`
construit `AgentLoop` sans `ToolExecutor` — aucun outil n'est exposé au LLM
via cette voie. `apps/desktop` n'utilise jamais `AgentLoop` : chaque
sous-commande CLI construit directement son propre `ToolRegistry` /
`PermissionManager` / `ToolExecutor` et, pour `gmail.send`, passe
explicitement par `ConfirmationService` / `proposeConfirmation` /
`confirmAndExecute` (`apps/desktop/src/gmail-send.ts`), en rejetant même une
politique `'allow'`. **Aucune vulnérabilité n'est exploitable en production
aujourd'hui** : `confirmedTools` n'atteint jamais un outil `execute` réel par
un chemin livré. C'est un **risque latent** : rien dans `packages/core` n'empêche
qu'un futur câblage `AgentLoop` → `ToolExecutor` réutilise `confirmedTools`
pour un outil `execute`, auquel cas une confirmation nommée pour `gmail.send`
autoriserait, dans un même tour, n'importe quel appel ultérieur à ce même nom
d'outil — destinataire, contenu ou compte différents inclus — puisque
`confirmed.has(call.tool)` ne vérifie que le nom (`PROJECT_STATE.md` documente
déjà ce point comme limite connue de `confirmedTools`, sans en tirer de
décision d'architecture).

## Decision

1. `confirmed: true` seul n'est jamais une preuve suffisante pour autoriser
   une action à effet externe (`action: 'execute'`).
2. `AgentLoop` ne doit jamais accorder elle-même une confirmation à une
   action `execute`. Face à un `ToolExecutor` qui répond
   `awaiting_confirmation` pour un outil `execute`, `AgentLoop` se comporte
   comme pour tout autre blocage (`stopReason: 'tool_blocked'`) : elle
   remonte le résultat et arrête le tour, sans jamais retenter
   automatiquement via un `confirmedTools` valable pour tout le tour.
3. Toute action à effet externe doit être confirmée via un mécanisme
   vérifiable, lié à l'empreinte exacte de l'appel : outil, action, compte,
   input validé, et toute autre donnée pertinente au contexte d'exécution
   (ex. destinataire). Le nom de l'outil seul ne constitue jamais cette
   preuve.
4. `ConfirmationService` (ticket opaque + empreinte canonique + usage unique
   + TTL) reste l'autorité de preuve à court terme pour ce niveau de risque.
5. À court terme, l'orchestration de la confirmation (proposer, afficher,
   vérifier, exécuter) reste **hors de `core`**, dans la couche applicative
   ou l'interface utilisateur — exactement comme `apps/desktop/src/gmail-send.ts`
   le fait déjà aujourd'hui pour la CLI.
6. `packages/core` ne doit pas importer `ConfirmationService`, ni dépendre
   d'un connecteur concret. La frontière ESLint `core` ⊥ `connectors`
   (`ADR-0001`) est préservée sans exception.
7. Une interface générique (`ConfirmationVerifier` ou équivalent), sans
   connaissance d'un provider concret, pourra être introduite ultérieurement
   dans `core` si plusieurs applications ou exécuteurs ont besoin de ce
   niveau de garantie sans dupliquer la logique de vérification. Cette
   interface n'est pas décidée par cet ADR — seule sa possibilité future
   l'est.
8. `confirmedTools` ne doit plus servir de preuve d'autorisation pour une
   action à effet externe. Son maintien pour des actions non `execute` et à
   faible risque perçu (ex. un futur `prepare` sans effet de bord) reste
   possible, mais devra être soumis à une politique explicite plutôt qu'à
   un défaut implicite.

Répartition des responsabilités qui en découle :
- **AgentLoop** : orchestration LLM ↔ outils uniquement. Pour `execute`,
  relaie `awaiting_confirmation` et arrête le tour — n'accorde jamais
  elle-même de confirmation à ce niveau de risque.
- **ToolExecutor** : reste le point de contrôle unique (`ADR-0005`).
  `allow` / `deny` / `require_confirmation` restent décidés par
  `PermissionManager` ; pour `require_confirmation` sur une action
  `execute`, `confirmed: true` reste une précondition que l'appelant doit
  satisfaire via un mécanisme fort — `ToolExecutor` ne vérifie pas lui-même
  de ticket, il fait confiance à l'appelant de haut niveau qui, lui, doit
  avoir vérifié un `ConfirmationService` (ou équivalent futur) avant
  d'appeler `run()` avec `confirmed: true`.
- **PermissionManager** : inchangé — ne connaît aucun mécanisme de
  confirmation, décide uniquement `allow`/`deny`/`require_confirmation` par
  outil/action.
- **ConfirmationService** : seule autorité qui prouve qu'un
  `{tool, action, compte, input}` précis a été réellement approuvé. Sa
  logique ne doit pas être dupliquée ailleurs.
- **Couche applicative / interface utilisateur** : responsable de présenter
  la demande de confirmation à un humain réel et de n'appeler
  `confirmAndExecute` (ou équivalent) qu'après approbation effective.

Flux cible pour toute action `execute` (état visé, pas encore câblé pour
`AgentLoop` — voir Conséquences) :

```
LLM (via AgentLoop)
  → ToolExecutor.run({ tool, input, confirmed:false })
  → PermissionManager.decide()
       deny                 → arrêt, tool_blocked
       allow (action != execute) → exécution directe
       require_confirmation → AgentLoop arrête le tour (tool_blocked),
                               ne retente jamais seule

  [hors AgentLoop, couche applicative / UI]
  → proposeConfirmation() → ConfirmationService.create(fingerprint)
  → présentation à l'utilisateur réel
  → confirmAndExecute(ticket, payload)
       → ConfirmationService.verify() (fingerprint exact requis)
            échec → confirmation_failed, aucune exécution
            succès (ticket consommé, usage unique)
       → ToolExecutor.run({ tool, input, confirmed:true })
       → PermissionManager redécide (un ticket valide ne force jamais l'exécution)
```

Alternatives considérées et rejetées :
- **Conserver `confirmedTools` pour toutes les actions, y compris
  `execute`** — rejeté : c'est exactement la faiblesse identifiée
  (confirmation par nom, réutilisable pour tout input dans le tour).
- **Transmettre simplement `confirmed: true` sans structure**, en comptant
  sur la discipline de chaque appelant — rejeté : aucune garantie
  vérifiable, dépend entièrement de la rigueur de code futur non écrit
  encore.
- **Faire importer `ConfirmationService` directement par `packages/core`**
  — rejeté : romprait la frontière `core` ⊥ `connectors` établie par
  `ADR-0001`, coupleraient un composant générique à un mécanisme situé dans
  une couche plus concrète.
- **Introduire immédiatement une interface `ConfirmationVerifier` dans
  `core`** — rejeté pour l'instant : aucune deuxième application n'a
  aujourd'hui besoin de ce niveau de garantie en dehors d'`apps/desktop` ;
  ajouter l'abstraction avant un second cas d'usage réel serait une
  généralisation prématurée. Reste une option future explicitement ouverte
  (point 7 de la Décision).

## Consequences

Positives : le seul chemin réel capable d'exécuter `gmail.send` aujourd'hui
(`apps/desktop/src/gmail-send.ts`) est déjà conforme à cette décision, sans
aucune modification de code requise pour lui. La décision fixe une règle
claire avant que quiconque ne câble `AgentLoop` à un `ToolExecutor` réel
pour une action `execute`, évitant qu'une intégration future ne réutilise
`confirmedTools` par simplicité. La frontière `core` ⊥ `connectors` reste
intacte.

Négatives : tant que le point 2 n'est pas implémenté dans `AgentLoop`, le
risque latent décrit en Contexte subsiste structurellement dans
`packages/core` — cet ADR documente une décision, il ne modifie aucun code.
Un futur branchement `AgentLoop` → `ToolExecutor` pour une action `execute`
devra nécessairement passer par une étape d'interaction humaine hors du tour
d'`AgentLoop` (pas de confirmation "en ligne" dans la boucle), ce qui
complique l'expérience d'un agent entièrement autonome pour ce type
d'action — compromis assumé au bénéfice de la sécurité.

Conditions préalables au branchement `AgentLoop` → `ToolExecutor` pour une
action `execute` :
- La confirmation doit être liée à l'input exact exécuté, pas seulement au
  nom de l'outil.
- `confirmedTools` ne doit avoir aucune autorité autonome sur une action
  `execute`.
- Des tests doivent couvrir : deux appels au même outil `execute` avec des
  inputs différents dans le même tour ; des comptes différents ; des
  destinataires/contenus différents.
- La priorité de `deny` sur toute confirmation doit rester vérifiée.
- Le ticket/preuve de confirmation doit rester à usage unique.
- Toute divergence entre l'appel proposé et l'appel exécuté doit invalider
  la confirmation.
- Le comportement sans interaction utilisateur disponible (ex. `apps/api`
  sans UI de confirmation) doit être défini explicitement — probablement un
  refus par défaut plutôt qu'une exécution silencieuse.
- Le `try/catch` manquant autour de `tool.validateInput()` dans
  `ToolExecutor.run()` doit être corrigé (actuellement seul `execute()` est
  protégé) avant d'exposer des outils tiers potentiellement moins
  disciplinés que `gmailConnector`.
- L'incohérence de scope OAuth (le scope par défaut ne couvre que
  `gmail.send`, alors que `read`/`prepare_reply` sont câblés sur le même
  flux de connexion) doit être clarifiée avant que `gmail.read` soit
  déclenchable de façon autonome par `AgentLoop`.

Tests de sécurité minimaux à prévoir avant le branchement :
- Test de caractérisation : `AgentLoop` + `ToolExecutor` sur un outil
  `execute` sous `require_confirmation`, avec le nom dans `confirmedTools` —
  deux appels au même outil avec des inputs différents dans le même tour ne
  doivent plus tous les deux s'exécuter une fois la Décision implémentée.
- Test prouvant qu'un outil `action: 'execute'` refuse `confirmed: true`
  sans preuve vérifiée (ticket/empreinte), quel que soit le mécanisme choisi.
- Test de frontière : `packages/core` n'importe jamais `ConfirmationService`
  ni aucun symbole de `packages/connectors`.
- Test bout-en-bout (LLM et réseau entièrement mockés, aucun envoi réel)
  reproduisant le chemin complet une fois `AgentLoop` câblée, vérifiant
  qu'aucune exécution `execute` n'a lieu sans passage effectif par
  `ConfirmationService` (ou son équivalent).
