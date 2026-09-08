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
- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`), terminé :
  - M8-B2 — OAuth Google Authorization Code + PKCE (`2d088b7`)
  - M8-B3 — `SecretStore` de production via trousseau OS (`b5db57e`)
  - M8-B4 — boucle d'envoi Gmail confirmée (`a811027`)
  - M8-B5 — câblage CLI desktop `connect`/`send` (`309bbfb`)
  - M8-B6 — couverture des erreurs réseau/provider post-confirmation (`2faf205`)

**Fondation architecturale** (hors numérotation fonctionnelle)
- Connector Architecture Foundation — `ConnectorRegistry`, `AccountStore`,
  `SecretStore`, `Capability` (`8506792`)

Détail complet de M8 (contexte, invariants, tests) : `PROJECT_STATE.md` →
« Envoi Gmail confirmé (M8) » et `docs/adr/0001` à `0005`.

508 tests / 47 fichiers au total (`npm test`).

## LATER

- Autres connecteurs réels (Calendar, Drive, Slack, GitHub…) — aucun
  n'existe encore, même en ébauche ; la fondation générique
  (`Connector Architecture Foundation`) les rend possibles sans toucher
  au cœur (`ToolExecutor`/`PermissionManager`), mais aucun n'est planifié
  à une date précise.
- Interface conversationnelle / NLU (piloter `recordFeedbackForEmail` /
  `applyUserRule` en langage naturel) — non commencé.
- Branchement de `@jarvis/inbox` dans `apps/api` (route HTTP) — non
  commencé, non priorisé face aux autres pistes.
