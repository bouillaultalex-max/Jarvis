# ADR-0002: SecretStore séparé d'AccountStore, jamais lu par un Tool

Date: 2026-09-08
Status: Accepted

## Context

Un `Account` (`packages/connectors/src/account.ts`) porte des métadonnées
utiles à afficher, journaliser ou sérialiser : provider, identifiant
visible (ex. adresse email), statut de connexion. Un secret (refresh token
OAuth, clé API) n'a aucune de ces propriétés : il ne doit jamais transiter
vers un log, une réponse utilisateur, ou le LLM. Mélanger les deux dans une
seule abstraction créerait un risque structurel de fuite : un
`console.log(account)` ou une sérialisation JSON anodine pourrait exposer
un secret par accident.

## Decision

Les secrets vivent exclusivement dans `SecretStore`
(`packages/connectors/src/secret-store.ts`), une interface distincte
d'`AccountStore`. `Account.metadata` ne contient jamais de credential.
Seul du code d'infrastructure qui construit un client déjà authentifié
(ex. `resolveGmailApiClient`) est autorisé à lire un `SecretStore` — jamais
un `Tool`, jamais `AgentLoop`, jamais une réponse renvoyée à l'utilisateur.
Cet invariant est vérifié explicitement par `security.test.ts`.

## Consequences

Toute nouvelle fonctionnalité touchant un compte doit demander le secret
explicitement via `SecretStore.get()`, jamais le lire depuis un objet
`Account`. Un `Account` peut être journalisé ou renvoyé dans une réponse
sans risque — par construction, il ne peut pas contenir de secret. Le coût
est un niveau d'indirection supplémentaire (deux stores à consulter au lieu
d'un) pour toute opération qui a besoin à la fois de l'identité du compte
et de son secret.
