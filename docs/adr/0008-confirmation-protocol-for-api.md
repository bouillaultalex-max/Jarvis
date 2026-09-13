# ADR-0008: Protocole de confirmation pour l'API et reprise d'exécution

Date: 2026-09-13
Status: Accepted

## Context

- `apps/api` reste, en V1, une API sans état conversationnel : `POST /chat` (`apps/api/src/server.ts`) ne reçoit et ne conserve qu'un message courant, sans session, sans historique, sans identifiant de conversation. `apps/api/src/main.ts` construit `AgentLoop` sans aucune option mémoire ni `ToolExecutor` peuplé.
- Aucun protocole de reprise n'existe aujourd'hui pour une action bloquée en attente de confirmation via HTTP : le seul chemin réel capable d'exécuter une action `execute` (`gmail.send`) est `apps/desktop/src/gmail-send.ts`, entièrement hors du protocole HTTP.
- Un identifiant de confirmation opaque, détenu par le client, n'est pas en lui-même une preuve cryptographique de ce qui a été approuvé — c'est `ConfirmationService` (fingerprint SHA-256 canonique de `{toolName, action, accountId, validatedInput}`, `packages/connectors/src/confirmation/fingerprint.ts`) qui fournit cette preuve. Ce protocole s'appuie sur cette primitive existante, il n'en réinvente aucune.
- `confirmedTools` (`AgentLoop`) reste, comme établi par `ADR-0006`, structurellement insuffisant pour prouver la confirmation d'une action `execute` : il ne lie qu'un nom d'outil, jamais un input, un compte ou un destinataire précis. Ce protocole n'utilise jamais `confirmedTools` pour une action `execute`.
- Confirmer un identifiant ne suffit pas : il faut confirmer *l'appel exact* — même outil, même action, même compte, même input que celui initialement proposé. C'est la responsabilité du fingerprint, pas du protocole HTTP, de garantir cette identité.
- Cette décision complète `ADR-0005` (ToolExecutor comme point d'exécution unique) et `ADR-0006` (confirmation fingerprintée obligatoire pour `execute`) sans en remplacer aucune : elle spécifie uniquement comment les respecter dans le cas particulier d'une exposition HTTP sans état. Elle est indépendante d'`ADR-0007` (politique de promotion mémoire) : aucun chevauchement, aucune dépendance entre les deux décisions.
- Contraintes de la V1 : mono-processus, sans persistance, sans authentification applicative propre à ce protocole, strictement loopback, sans support multi-instance, sans routage multi-compte, sans limite de tickets pending simultanés.

## Hors périmètre de cette décision

Cet ADR spécifie uniquement le protocole HTTP de confirmation au-dessus d'un `ToolExecutor` déjà peuplé — il ne décide d'aucun des sujets suivants, qui restent ouverts et devront faire l'objet de décisions séparées avant qu'une action `execute` réelle ne soit atteignable via `apps/api` :
- le choix du ou des `Tool` effectivement exposés par `apps/api` ;
- le branchement de Gmail ou d'un autre connecteur réel ;
- le câblage `AccountStore` / `SecretStore` / `GmailAppCredentials` dans `apps/api` ;
- la politique détaillée de `PermissionManager` appliquée par `apps/api` (règles par outil, défauts par niveau d'action) ;
- la correction de l'absence de `try`/`catch` autour de `Tool.validateInput()` dans `ToolExecutor.run()` (précondition déjà identifiée par `ADR-0006`, non résolue à ce jour) ;
- la gestion des comptes et secrets utilisés par un outil `execute` exposé via `apps/api`.

Tant que ces sujets ne sont pas tranchés, le `202 {status:"confirmation_required"}` décrit ici reste un protocole valide mais potentiellement inatteignable en usage réel d'`apps/api` — sa validation initiale doit s'appuyer sur un outil de test sans effet de bord, jamais sur un branchement prématuré d'un connecteur réel. Ces sujets sont traités par `ADR-0009`.

## Decision

1. **Contrat `POST /chat`** conservé et étendu :
   - `200 { content: string }` pour toute réponse conversationnelle ordinaire — comportement historique strictement inchangé.
   - `202 { status: "confirmation_required", confirmation: ConfirmationRequest }` lorsqu'`AgentLoop` s'arrête (`stopReason: 'tool_blocked'`) sur une action `execute` en attente de confirmation. `ConfirmationRequest` est le type déjà existant de `packages/connectors/src/confirmation/confirmation-request.ts`, réutilisé sans modification.
2. **Nouvel endpoint** : `POST /chat/confirmations/:confirmationId`.
   - Corps strictement : `{ approve: boolean }`. Toute autre clé (`toolName`, `action`, `accountId`, `input`) est rejetée par un schéma fermé — le client ne fournit et ne peut structurellement jamais fournir l'appel à exécuter.
   - Réponses : `200` (approuvé et exécuté, ou refusé), `404` (`confirmationId` inconnu), `409` (expiration, divergence de fingerprint, consommation antérieure, ou refus — une seule forme générique, sans distinction de cause), `502` (échec technique de l'outil).
3. **État pending** conservé en mémoire du process `apps/api`, sous deux formes :
   - `ConfirmationService`, instancié une seule fois pour la durée de vie du process, comme `LlmProvider` l'est déjà — seule primitive de vérification et de consommation.
   - Une table `confirmationId → payload validé` propre à `apps/api`, nécessaire car `ConfirmationService.verify()` exige que l'appelant refournisse le payload exact ; `ConfirmationService` ne conserve lui-même qu'une empreinte, jamais le payload en clair, ni le ticket brut.
4. **Cycle de vie** : `POST /chat` bloqué → `proposeConfirmation()` crée le ticket via `ConfirmationService.create()` → réponse `202` avec le seul `ConfirmationRequest` → `POST /chat/confirmations/:id` avec `approve:true` → `confirmAndExecute()` → `ConfirmationService.verify()` valide et consomme atomiquement la preuve correspondant à l'appel exact, puis `ToolExecutor` réévalue les contrôles d'exécution et exécute l'appel confirmé ; son seul résultat est renvoyé.
5. La proposition de confirmation ne constitue pas une autorisation d'exécution. Lors de l'exécution finale, `ToolExecutor` doit réévaluer les validations et permissions applicables ; une confirmation valide ne peut jamais contourner `PermissionManager`.
6. Après approbation, l'appel exact est exécuté **directement** par `ToolExecutor` — **aucun nouveau tour `AgentLoop` n'est lancé**, aucune reprise de conversation, aucune reformulation par le LLM. Le résultat de `ToolExecutor.run()` est renvoyé tel quel.
7. Codes d'erreur retenus, sans exception : `404` pour un `confirmationId` inconnu ; `409` pour expiration, divergence de fingerprint, consommation antérieure, ou refus ; `502` pour une défaillance technique de l'outil.
8. **Contrainte de déploiement V1** : `apps/api` reste en écoute strictement loopback (`127.0.0.1`, déjà le défaut de `main.ts`) ou derrière une passerelle déjà authentifiée — ce protocole ne fournit et ne prétend fournir aucune authentification applicative propre.
9. **Double consommation** : la transition `pending → consumed` de `ConfirmationService.verify()` est atomique et couvre nativement les doubles validations et accès concurrents — aucun verrou supplémentaire introduit côté `apps/api`.
10. **Limites mono-processus** : `ConfirmationService` et la table pending sont locaux à un unique process, non partagés, non persistés — un redémarrage invalide toute confirmation en attente.

## Security Invariants

- Une action ne peut être exécutée qu'après validation de son input et décision de permission favorable. La confirmation ne remplace jamais la permission : un deny reste prioritaire et interdit toute exécution, même si une confirmation existe.
- La validation de l'input (`Tool.validateInput()`) précède toujours le calcul du fingerprint — seul un input déjà validé est fingerprinté et confirmé.
- Le fingerprint inclut systématiquement l'outil, l'action, le compte et l'input validé — aucune confirmation n'est valide sans cette liaison complète.
- Le client ne fournit jamais l'input, l'outil, l'action ou le compte lors de la confirmation — seul `{approve: boolean}` est accepté.
- Aucun ticket n'est réutilisable : consommation atomique et unique, garantie par `ConfirmationService`, jamais contournée par ce protocole.
- Aucun ticket brut n'est jamais exposé dans une réponse HTTP ou un log — seul `ConfirmationRequest` circule vers le client.
- En cas d'état absent ou incohérent, le protocole refuse par défaut (`404`/`409`) — jamais d'exécution par défaut sur donnée manquante ou douteuse.
- Aucune exécution n'a lieu si la vérification de la confirmation échoue, pour quelque raison que ce soit.
- Aucune relance du LLM n'intervient entre confirmation et exécution — élimine tout risque qu'une reformulation modifie l'appel confirmé.
- `confirmedTools` n'est jamais consulté ni utilisé comme preuve pour une action `execute`.
- La possession du `confirmationId` prouve uniquement la connaissance d'un ticket émis pour un appel précis — elle ne constitue jamais une authentification générale de l'appelant ; cette garantie dépend d'un déploiement loopback ou d'une passerelle authentifiée en amont.

## Consequences

**Bénéfices** : réutilise intégralement des primitives déjà existantes et auditées, sans modification de `packages/core` ni `packages/connectors` ; étend `POST /chat` de façon rétrocompatible ; élimine par construction le risque qu'un client modifie l'appel entre proposition et confirmation.

**Compromis** : l'utilisateur reçoit, après confirmation, le résultat brut de l'action plutôt qu'une réponse reformulée par le LLM — perte d'UX mineure acceptée au bénéfice de la sécurité et de la simplicité.

**Limites de la V1** : mono-processus ; sans persistance entre redémarrages ; sans authentification applicative ; sans support multi-instance ; sans routage multi-compte ; sans limite explicite de tickets pending simultanés.

**Future exposition réseau** : si `apps/api` devait un jour être exposée au-delà du loopback, un modèle d'authentification applicative devra être conçu séparément — cette décision ne le fournit pas et ne doit pas être interprétée comme suffisante pour un déploiement exposé.

**Future architecture multi-instance** : l'état pending, actuellement local au process, devra être externalisé si plusieurs instances d'`apps/api` doivent un jour se partager la charge — non traité ici.

**Absence d'idempotence métier en V1** : un double-clic reçoit systématiquement `409`, jamais une réponse de succès mise en cache — aucune idempotence métier n'est ajoutée, uniquement la garantie qu'une seule exécution a lieu.

## Alternatives Considered

- **Jeton auto-porteur signé (sans état serveur)** — rejeté : réintroduit exactement le problème que `ConfirmationService` a été conçu pour éviter (un jeton à usage unique exige quand même une denylist côté serveur), ajoute une primitive cryptographique nouvelle, et inverse le principe déjà établi de ne jamais conserver un ticket en clair.
- **Reprise complète d'un tour `AgentLoop` après confirmation** — rejeté pour cette V1 : `apps/api` n'a aucune notion de session, et `AgentLoop` n'a aucune API pour injecter un résultat d'outil déjà obtenu dans une conversation existante ; construire cette capacité élargirait `packages/core` au-delà de l'Architecture A retenue par `ADR-0006`.
- **`ConfirmationVerifier` générique dans `core`** — différé, non rejeté : `ADR-0006` a déjà écarté cette généralisation comme prématurée ; cette décision ne rouvre pas ce choix.
- **Endpoint de confirmation acceptant à nouveau l'input** — rejeté : réintroduirait la possibilité qu'un client modifie l'appel entre proposition et confirmation, contournant l'intérêt même du fingerprint.

## Implementation Scope

**Créé par cette décision** : uniquement `docs/adr/0008-confirmation-protocol-for-api.md`. Aucun code modifié.

**Fichiers potentiellement concernés par une implémentation future** : `apps/api/package.json` (dépendance `@jarvis/connectors`), `apps/api/src/server.ts` (nouvelle route, extension `POST /chat`), `apps/api/src/main.ts` (construction de `ConfirmationService`/`ToolExecutor`), un nouveau fichier pour la table pending, `apps/api/src/server.test.ts`.

**Fichiers que cette décision ne doit pas faire modifier** : `packages/core/src/agent-loop.ts`, `packages/core/src/tool-executor.ts`, `packages/core/src/permissions.ts` ; `packages/connectors/src/confirmation/*` (aucune généralisation en `ConfirmationVerifier`) ; tout fichier de `apps/desktop`.

## Tests Required Before Implementation

1. Non-régression du `200 {content}` sur une conversation ordinaire.
2. Forme exacte du `202` — aucun champ hors `ConfirmationRequest`, aucun secret, aucun input brut.
3. Confirmation nominale → exécution exactement une fois, sans nouveau tour `AgentLoop`.
4. `confirmationId` inconnu → `404`, aucune exécution.
5. Ticket expiré → `409` générique, aucune exécution.
6. Refus → confirmation terminale, toute approbation ultérieure échoue.
7. Double confirmation → une seule exécution réelle, la seconde reçoit un échec défini.
8. Tentative de fournir/modifier `input`/`toolName`/`accountId` dans le corps → rejetée par le schéma fermé.
9. Course concurrente sur le même id → exactement une exécution.
10. `deny` en amont → l'outil n'atteint jamais l'état de confirmation.
11. Absence de fuite de secret dans les deux endpoints.
12. Redémarrage simulé → un `confirmationId` antérieur devient `404`.
