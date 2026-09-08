# ADR-0003: Credentials Gmail stockés via le trousseau OS, aucune cryptographie maison

Date: 2026-09-08
Status: Accepted

## Context

Le refresh token Gmail doit être persisté entre deux exécutions de
`apps/desktop`, de façon chiffrée au repos. Deux options existaient :
implémenter un stockage fichier avec chiffrement applicatif (gestion de
clé, algorithme, rotation — à la charge de JARVIS), ou déléguer entièrement
au gestionnaire d'identification déjà fourni par le système d'exploitation.
Une cryptographie maison, pour un projet solo sans revue de sécurité
dédiée, est un risque disproportionné par rapport au bénéfice.

## Decision

`OsCredentialSecretStore` (`packages/connectors/src/os/os-credential-secret-store.ts`)
implémente `SecretStore` en délégant intégralement au gestionnaire natif de
l'OS — Windows Credential Manager, macOS Keychain, ou Linux Secret Service
— via la librairie `@napi-rs/keyring`. Aucun fichier, aucune clé de
chiffrement, aucun algorithme cryptographique n'est géré par JARVIS : le
chiffrement au repos est entièrement délégué à l'OS. L'implémentation ne
garde aucun état sensible en mémoire au-delà du nom de service (non
sensible) ; chaque appel crée une entrée éphémère pour la clé demandée.

## Consequences

Aucune surface de code cryptographique à maintenir ou auditer côté JARVIS.
La sécurité du stockage dépend entièrement du trousseau OS de la machine de
l'utilisateur — hors du contrôle de JARVIS, mais c'est un mécanisme mature
et déjà audité par ailleurs. Dépendance native ajoutée (`@napi-rs/keyring`)
: la portabilité de JARVIS sur une plateforme est liée au support de ce
package pour cette plateforme. `InMemorySecretStore` reste l'implémentation
dev/test uniquement, jamais utilisée en production.
