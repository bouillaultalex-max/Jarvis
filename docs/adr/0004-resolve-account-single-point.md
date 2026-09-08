# ADR-0004: resolveAccount() comme unique point de sélection de compte

Date: 2026-09-08
Status: Accepted

## Context

Un utilisateur peut avoir plusieurs comptes pour un même provider (ex.
Gmail personnel et professionnel). Toute opération qui a besoin d'un compte
(envoyer un email, lire une boîte de réception) doit d'abord déterminer
*lequel*. Une sélection implicite silencieuse — par exemple « prendre le
premier compte trouvé » — serait une source de bug de confidentialité
grave et silencieux : une action exécutée depuis le mauvais compte, sans
qu'aucune erreur ne se déclenche.

## Decision

`AccountStore.resolve({ provider, accountId? })`
(`packages/connectors/src/account.ts`) est le seul point de sélection d'un
compte pour une opération. Comportement strict : `accountId` fourni → ce
compte précis ou `UnknownAccountError` ; `accountId` absent et un seul
compte pour ce provider → il est résolu ; `accountId` absent et aucun
compte → `UnknownAccountError` ; `accountId` absent et **plusieurs**
comptes → `AmbiguousAccountError`. Il n'existe aucun chemin de code qui
choisit implicitement un compte parmi plusieurs.

## Consequences

Toute nouvelle fonctionnalité multi-compte doit gérer explicitement le cas
`AmbiguousAccountError` (typiquement en demandant à l'utilisateur de
préciser le compte) plutôt que de supposer qu'un seul compte existe. Le
coût est une erreur explicite à traiter dans les flux multi-comptes, à la
place d'un comportement par défaut plus permissif — un compromis délibéré
en faveur de la sécurité plutôt que de la commodité.
