# JARVIS — Backlog

Backlog minimal, dérivé strictement de l'état réel du dépôt (voir
`PROJECT_STATE.md` pour le détail complet). Aucune fonctionnalité listée
ici n'est inventée : chaque entrée correspond à un commit existant ou à
une décision explicitement ouverte dans `PROJECT_STATE.md`.

Voir aussi `MASTER_ROADMAP.md` pour la vue synthétique DONE / LATER.

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
- **M8 — Gmail Send** (`gmail.send`, `action: 'execute'`), terminé,
  5 sous-jalons :
  - **M8-B2** — OAuth Google Authorization Code + PKCE (`gmail-oauth-flow.ts`). (`2d088b7`)
  - **M8-B3** — `SecretStore` de production via trousseau OS (`OsCredentialSecretStore`). (`b5db57e`)
  - **M8-B4** — Boucle d'envoi Gmail confirmée (`runGmailSend`). (`a811027`)
  - **M8-B5** — Câblage CLI desktop `connect`/`send`. (`309bbfb`)
  - **M8-B6** — Couverture des erreurs réseau/provider post-confirmation. (`2faf205`)

  Détail : `PROJECT_STATE.md` → « Envoi Gmail confirmé (M8) »,
  `docs/adr/0001` à `0005`.

## Surface CLI desktop post-M8 (hors numérotation de jalon)

Exposition en ligne de commande de capacités **déjà écrites et testées** dans
`@jarvis/connectors` / `@jarvis/inbox`. Ne constituent pas de nouveaux jalons
fonctionnels : aucune nouvelle brique de bibliothèque, seulement du câblage
CLI réutilisant le noyau M8.

- **`disconnect`** — câblage CLI de `disconnectGmailAccount()` (révocation
  OAuth réelle + statut de compte). (`cc2e8a4`)
- **`read`** — câblage CLI du Tool `gmail.read` (lecture seule, `--maxResults`
  transmis tel quel). (`9c24cb7`)
- **`inbox`** — câblage CLI de `fetchAndClassifyEmails` (`@jarvis/inbox`) :
  lit puis classe (`important` / `not_important` / `uncertain`). S'arrête
  **volontairement** à la classification — résumé, triage et feedback restent
  hors périmètre. (`996d716`)

`apps/desktop` expose donc cinq commandes : `connect` / `read` / `inbox` /
`send` / `disconnect`.

## Fondations architecturales terminées

- **Connector Architecture Foundation** (alias technique `M5.ARCH`, hors
  numérotation fonctionnelle) — `ConnectorRegistry`, `AccountStore`
  (multi-compte par provider, `resolve()` sans jamais de sélection
  implicite), `SecretStore`/`InMemorySecretStore` (dev/test uniquement),
  `Capability` (description déclarative, ne contourne jamais
  `PermissionManager`). Additive : ne modifie ni `gmailConnector`, ni
  `inMemoryConnector`, ni `PermissionManager`/`ToolExecutor`. (`8506792`)
  Doc : `docs/connectors-architecture.md`.

## Prérequis pour M8 — tous résolus

Ces points étaient explicitement non tranchés lors de `Connector
Architecture Foundation` (`8506792`, qui posait seulement l'abstraction
générique). Ils sont désormais tous résolus et implémentés par M8 :

1. **Flux de connexion initiale du compte Gmail** — ~~non implémenté~~
   **résolu par M8-B2** : consentement OAuth interactif + PKCE
   (`gmail-oauth-flow.ts`, `2d088b7`).
2. **Stockage sécurisé du refresh token en production** — ~~aucune
   implémentation~~ **résolu par M8-B3** : `OsCredentialSecretStore`,
   trousseau natif de l'OS (`b5db57e`). `InMemorySecretStore` reste
   dev/test uniquement.
3. **Modèle de confirmation utilisateur pour une action `execute`
   réelle** — **résolu par M8-B4/B5** : `ConfirmationService` +
   confirmation au terminal (`apps/desktop`, `a811027`/`309bbfb`). Une
   politique `'allow'` sur `gmail.send` reste refusée sans confirmation
   explicite.
4. **Desktop ou serveur pour le flux de connexion** — **tranché : desktop**
   (`apps/desktop`, CLI `connect` / `read` / `inbox` / `send` / `disconnect`).

## Décisions d'architecture — résolues par M8

- Brancher `gmailConnector` sur `ConnectorRegistry`/`AccountStore`/
  `SecretStore` : **fait**, via `resolveGmailApiClient` (M8).
- Mécanisme de `SecretStore` de production : **tranché — trousseau OS**
  (`@napi-rs/keyring`, `OsCredentialSecretStore`). Voir
  `docs/adr/0003-os-credential-backend.md`.
- Forme d'un `Account` Gmail concret : **en usage en production** via
  `connectGmailAccount`/`FileAccountStore` (`accountIdentifier` = adresse
  email, aucun credential dans `metadata`).

## Pistes non encore validées (ne pas commencer sans validation explicite)

- Brancher `@jarvis/inbox` (`fetchAndClassifyEmails` /
  `summarizeEmailsNeedingAttention`) dans `apps/api` via une route HTTP.
- Construire une interface conversationnelle / NLU pour piloter
  `recordFeedbackForEmail` / `applyUserRule` (actuellement des contrats
  fins, non branchés à du langage naturel).
- Ajouter un connecteur non-Gmail réel (Calendar, Drive, Slack, GitHub…)
  au-delà du `Connector Architecture Foundation` générique — aucun de ces
  connecteurs n'existe encore, même en ébauche.

Ces pistes sont mentionnées dans `PROJECT_STATE.md` comme décisions
ouvertes ; aucune n'est priorisée par rapport aux autres à ce stade. La
surface CLI desktop post-M8 (ci-dessus) est déjà livrée et ne préempte
aucune de ces pistes.

Capacités de bibliothèque encore **non exposées** à l'utilisateur, à noter
pour mémoire (ne constituent pas des pistes priorisées) : le Tool
`gmail.prepare_reply` (`@jarvis/connectors`, M7.3) et les fonctions
`summarizeEmailsNeedingAttention` / `recordFeedbackForEmail` / `applyUserRule`
(`@jarvis/inbox`, M7) — testées, mais câblées dans aucune commande CLI
`apps/desktop` ni route `apps/api`. (`disconnectGmailAccount()` figurait ici
jusqu'à `cc2e8a4` ; elle est désormais câblée via la commande `disconnect`.)
