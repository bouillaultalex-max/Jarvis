# JARVIS — Roadmap synthétique

Vue d'ensemble condensée. Le détail (raisons, invariants, tests) vit dans
`PROJECT_STATE.md` ; le détail actionnable vit dans `MASTER_BACKLOG.md`.
Cette page ne fait que positionner chaque élément dans le temps.

## DONE

**Jalons fonctionnels**
- M4 — Tool / permissions / executor / agent loop (`f836375`)
- M5 — Connecteur Gmail réel, lecture seule (`fd13ffa`)
- M6 — Intégration Gmail ↔ classification (`b5d82df`)
- M7.1–7.4 — Triage, résumé, préparation de réponse Gmail, composition
  attention + résumé (`84e2955`, `938d71c`)

**Fondation architecturale** (hors numérotation fonctionnelle)
- Connector Architecture Foundation — `ConnectorRegistry`, `AccountStore`,
  `SecretStore`, `Capability` (`8506792`)

## NEXT

Décisions/prérequis à trancher avant de commencer M8 (voir
`MASTER_BACKLOG.md` → « Prérequis encore ouverts pour M8 ») :

- Flux de connexion initiale du compte Gmail (OAuth interactif)
- Stockage sécurisé du refresh token en production
- Modèle de confirmation utilisateur pour une action `execute` réelle
- Desktop vs serveur pour le flux de connexion
- (décision séparée) Brancher `gmailConnector` sur
  `ConnectorRegistry`/`AccountStore`/`SecretStore` avant ou pendant M8

**M8 n'est pas prêt à être implémenté tant que ces points ne sont pas
tranchés.**

## LATER

- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`) — bloqué par
  NEXT ci-dessus, feu vert explicite requis avant toute implémentation.
- Autres connecteurs réels (Calendar, Drive, Slack, GitHub…) — aucun
  n'existe encore, même en ébauche ; la fondation générique
  (`Connector Architecture Foundation`) les rend possibles sans toucher
  au cœur (`ToolExecutor`/`PermissionManager`), mais aucun n'est planifié
  à une date précise.
- Interface conversationnelle / NLU (piloter `recordFeedbackForEmail` /
  `applyUserRule` en langage naturel) — non commencé.
- Branchement de `@jarvis/inbox` dans `apps/api` (route HTTP) — non
  commencé, non priorisé face aux autres pistes.
- `apps/desktop` — non commencé (dossier vide).
