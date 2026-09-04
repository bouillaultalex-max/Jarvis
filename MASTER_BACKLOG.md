# JARVIS — Backlog

Backlog minimal, dérivé strictement de l'état réel du dépôt (voir
`PROJECT_STATE.md` pour le détail complet). Aucune fonctionnalité listée
ici n'est inventée : chaque entrée correspond à un commit existant ou à
une décision explicitement ouverte dans `PROJECT_STATE.md`.

Voir aussi `MASTER_ROADMAP.md` pour la vue synthétique DONE / NEXT / LATER.

## Jalons fonctionnels terminés

- **M4** — Contrat `Tool`, `ToolRegistry`, `PermissionManager`,
  `ToolExecutor`, `AgentLoop` (boucle d'agent bornée). (`f836375`)
- **M5** — `gmailConnector` réel, lecture seule (`gmail.read`,
  `action: 'read'`). (`fd13ffa`)
- **M6** — Intégration Gmail ↔ classification (`@jarvis/inbox` :
  `fetchEmailsViaTool`, `classifyEmails`, `fetchAndClassifyEmails`).
  (`b5d82df`)
- **M7.1–M7.3** — Identification des emails nécessitant l'attention,
  résumé LLM (`email.summarize`, `action: 'read'`), préparation de
  réponse Gmail (`gmail.prepare_reply`, `action: 'prepare'`). (`84e2955`)
- **M7.4** — Composition attention + résumé
  (`summarizeEmailsNeedingAttention`, `triage.ts`). (`938d71c`)

## Fondations architecturales terminées

- **Connector Architecture Foundation** (alias technique `M5.ARCH`, hors
  numérotation fonctionnelle) — `ConnectorRegistry`, `AccountStore`
  (multi-compte par provider, `resolve()` sans jamais de sélection
  implicite), `SecretStore`/`InMemorySecretStore` (dev/test uniquement),
  `Capability` (description déclarative, ne contourne jamais
  `PermissionManager`). Additive : ne modifie ni `gmailConnector`, ni
  `inMemoryConnector`, ni `PermissionManager`/`ToolExecutor`. (`8506792`)
  Doc : `docs/connectors-architecture.md`.

## Prochain grand jalon fonctionnel

- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`) — pas encore
  commencé. Nécessite un feu vert explicite avant toute implémentation
  (envoi réel = effet de bord irréversible côté utilisateur).

## Prérequis encore ouverts pour M8

Ces points sont explicitement non tranchés dans `PROJECT_STATE.md` — la
`Connector Architecture Foundation` (`8506792`) ne les résout pas, elle
pose seulement l'abstraction générique :

1. **Flux de connexion initiale du compte Gmail** — consentement OAuth
   interactif, obtention du tout premier `refreshToken`. Non implémenté ;
   `gmailConnector` suppose aujourd'hui un `refreshToken` déjà obtenu, lu
   via `loadGmailCredentialsFromEnv()`.
2. **Stockage sécurisé du refresh token en production** — seule
   l'interface `RefreshTokenStore` (côté `gmail-auth.ts`) et
   l'abstraction générique `SecretStore` (côté `Connector Architecture
   Foundation`) existent. `InMemorySecretStore` n'est pas utilisable en
   production (non chiffré, non persistant).
3. **Modèle de confirmation utilisateur pour une action `execute`
   réelle** — `PermissionManager` sait déjà bloquer une action derrière
   `require_confirmation`, mais aucune UI (via `apps/api` ou
   `apps/desktop`) n'existe encore pour recueillir cette confirmation.
4. **Desktop ou serveur pour le flux de connexion** — impacte
   directement (1) et (2), non tranché.

## Décisions d'architecture encore nécessaires

- Brancher (ou non) `gmailConnector` sur `ConnectorRegistry`/
  `AccountStore`/`SecretStore` avant M8, ou traiter ce branchement comme
  un chantier séparé de M8 lui-même.
- Choisir le mécanisme de `SecretStore` de production (coffre-fort OS,
  fichier chiffré, service cloud…) — aucun candidat retenu à ce jour.
- Définir la forme exacte d'un `Account` Gmail concret (valeurs de
  `accountIdentifier`, `metadata` autorisée) avant d'enregistrer un
  premier compte réel dans `AccountStore`.

## Pistes non encore validées (ne pas commencer sans validation explicite)

- Brancher `@jarvis/inbox` (`fetchAndClassifyEmails` /
  `summarizeEmailsNeedingAttention`) dans `apps/api` via une route HTTP.
- Construire une interface conversationnelle / NLU pour piloter
  `recordFeedbackForEmail` / `applyUserRule` (actuellement des contrats
  fins, non branchés à du langage naturel).
- Ajouter un connecteur non-Gmail réel (Calendar, Drive, Slack, GitHub…)
  au-delà du `Connector Architecture Foundation` générique — aucun de ces
  connecteurs n'existe encore, même en ébauche.
- `apps/desktop` : non commencé (dossier vide).

Ces pistes sont mentionnées dans `PROJECT_STATE.md` comme décisions
ouvertes ; aucune n'est priorisée par rapport aux autres à ce stade.
