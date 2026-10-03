# @jarvis/whatsapp-channel — intégration locale (ADR-0022, Proposed)

Première intégration locale du canal conversationnel WhatsApp. **Entièrement
simulée** : aucun secret réel, aucune connexion Meta, aucun appel LLM réel,
aucune exposition réseau au-delà de `127.0.0.1`. `docs/adr/0022-whatsapp-channel-boundary.md`
reste **`Proposed`** — cette app retient des décisions d'implémentation
concrètes pour cette tranche, elle ne vaut pas acceptation définitive de
l'architecture.

## Commande locale

```bash
npm run dev --workspace=@jarvis/whatsapp-channel
```

Démarre sur `127.0.0.1:${PORT:-3001}` (défaut `3001`). Aucune variable
d'environnement de secret n'est lue — voir § Configuration synthétique.

## Configuration synthétique

`src/config.ts` fournit des valeurs **locales, fixes, jamais des secrets
réels** : `verifyToken`, `appSecret` (HMAC), `allowedSenderId`. Aucun
`accessToken`/`phoneNumberId` n'est demandé — ces champs n'existent pas
tant qu'aucun transport réseau réel n'est branché (voir § Limites). Le
provider conversationnel (`SimulatedLlmProvider`) et le transport
(`SimulatedOutboundTransport`) sont également simulés dans `main.ts` —
`AnthropicProvider` réel n'y est jamais construit.

## Parcours

```
POST /webhooks/whatsapp (signé)
  → vérification de signature sur les octets bruts (avant parsing)
  → parsing de l'enveloppe WhatsApp
  → par événement : statut/type non supporté → 200 immédiat, jamais mis en file
                     message, expéditeur non autorisé → 200 immédiat, jamais mis en file
                     message, expéditeur autorisé → admission dans LocalMessageQueue
  → réponse HTTP (200/503) dès l'admission décidée — AVANT tout traitement
  → traitement réel (service conversationnel, transport) en tâche de fond
```

## Admission partielle (événements multi-message)

Chaque message d'un même événement webhook a sa **propre** réservation de
déduplication. Si un seul message du lot ne peut pas être admis (capacité
atteinte), le lot entier reçoit **503** — WhatsApp relivre alors le lot
complet — mais les messages déjà admis gardent leur réservation : une
relivraison du même lot ne les retraite jamais en double, seuls les
messages non admis la première fois obtiennent une admission neuve.

## Rétention mémoire bornée

Une file **de travail** bornée (`maxQueueSize`, `maxConcurrency`) ne borne
pas automatiquement son **historique** :

- `InMemoryDeduplicator` conserve au plus `maxCompletedEntries` identifiants
  `completed` (défaut 1000), éviction FIFO. Un identifiant évincé peut être
  **retraité** si le fournisseur le relivre bien plus tard — **pas** une
  déduplication illimitée dans le temps, seulement sur une fenêtre récente.
- `LocalMessageQueue` conserve au plus `maxRetainedOutcomes` issues
  consultables via `getOutcome()` (défaut 1000), éviction FIFO indépendante
  de la déduplication (un outcome évincé ne redevient pas un doublon
  possible).

Aucune persistance n'est ajoutée pour fermer ces écarts — volontairement
hors périmètre.

## Fermeture

`LocalMessageQueue.close(timeoutMs?)` arrête immédiatement toute nouvelle
admission, puis attend que le travail déjà admis se termine. **Aucune
annulation réelle** n'est possible : `ConversationalService`/
`OutboundTransport` n'exposent aucun contrat d'annulation aujourd'hui. Sans
délai, `close()`/`drain()` peuvent donc attendre indéfiniment si un
traitement ne se termine jamais. Avec délai, ils résolvent au plus tard
après ce délai en rapportant `'closed_with_pending_work'` si du travail
reste en cours — **sans jamais libérer sa réservation** (pas d'exécution
concurrente possible du même message). `main.ts` utilise cette forme bornée
(`SHUTDOWN_DRAIN_TIMEOUT_MS`) sur `SIGINT`/`SIGTERM`, et journalise un
avertissement explicite si du travail reste en cours à l'échéance — jamais
masqué.

## Adaptateur Graph API (implémenté, non activé)

`src/graph-api-transport.ts` fournit `GraphApiOutboundTransport`, une
implémentation **réelle** d'`OutboundTransport` — mais `main.ts` ne la
construit nulle part dans cette tranche (`SimulatedOutboundTransport`
reste le seul transport câblé). Contrat vérifié par fetch direct de la
documentation officielle (voir l'en-tête du fichier pour sources et
dates) : endpoint `POST https://graph.facebook.com/{apiVersion}/{phoneNumberId}/messages`,
authentification `Bearer`, corps `text`, réponse de succès/erreur. Points
**non vérifiés de façon fiable** et donc non codés en dur : limite de
longueur du corps (sources contradictoires), délai de requête recommandé
pour l'envoi, format exact du destinataire (`+` ou non).

### Classification des issues (`TransportResult` à trois valeurs)

**Échec certain (`'error'`)** — seulement quand rien n'a pu avoir été
transmis au fournisseur, ou quand il l'a rejeté explicitement : rejet de
la validation locale ou jeton d'accès indisponible (dans les deux cas,
**avant** tout appel réseau) ; réponse HTTP **4xx** (rejet explicite,
avec ou sans corps exploitable — le code HTTP lui-même est le signal).

**Issue incertaine (`'uncertain'`)** — dès qu'un doute réel subsiste sur ce
que le fournisseur a fait de la requête : **toute exception levée par
`fetch` lui-même**, timeout compris (une exception de `fetch` ne prouve
jamais que la requête n'a pas atteint le fournisseur — une connexion peut
être interrompue après que le serveur a déjà reçu et traité la requête) ;
un délai dépassé pendant la **lecture du corps** de réponse, après réception
des en-têtes (même raisonnement) ; une réponse **5xx** (le fournisseur a
répondu, donc a bien reçu la requête, mais une erreur serveur ne prouve ni
l'envoi ni son absence) ; une réponse 200 au JSON illisible ou de forme
inattendue. **Un timeout, à quelque étape que ce soit, n'est jamais traité
comme une preuve de non-envoi.**

### Politique de relivraison pour une issue incertaine

`LocalMessageQueue` traite `'transport_uncertain'` comme `'replied'` du
point de vue de la déduplication — l'identifiant marque `completed`,
**aucune relance automatique** tant qu'il reste retenu. Une relivraison
**immédiate** du même message est donc vue comme un doublon — évite un
double envoi si le message a en réalité été délivré.

**Garantie exacte, pas absolue** : ce blocage n'est **pas** un verrou
permanent. `InMemoryDeduplicator` borne le nombre d'identifiants
`completed` retenus (`maxCompletedEntries`, éviction FIFO) et perd tout
son état au redémarrage — voir § Rétention mémoire bornée. Un identifiant
évincé, ou retrouvé après redémarrage, est retraité comme un essai neuf si
redélivré, qu'il s'agisse d'un `'replied'` ou d'un `'transport_uncertain'`.
Aucune affirmation de blocage « définitif » ou de « jamais de renvoi » ne
doit être faite sur cette base — et aucune persistance n'est ajoutée pour
fermer cet écart dans cette mission. L'issue réelle reste consultable via
`getOutcome()` (tant que non évincée) pour une décision explicite
ultérieure — aucun mécanisme de révision manuelle n'est construit ici.

Garanties de l'adaptateur : `apiVersion`/`phoneNumberId` validés à la
construction (format strict, aucune injection d'hôte/chemin possible) ;
`fetch` injecté (jamais le global) ; validation locale avant tout appel
réseau (espaces dans le destinataire explicitement rejetés) ; délai borné
via `AbortController`, couvrant l'attente des en-têtes **et** la lecture
du corps ; **aucun retry automatique** (un seul appel par `send()`) ;
aucun secret (jeton) dans un résultat ou une erreur renvoyée, aucun
`console.*` dans la classe.

## Limites — ne pas présenter comme prêt pour une exposition publique

- **File volatile, non durable.** Tout l'état (réservations, file,
  issues) vit en mémoire du process. Un crash entre l'accusé HTTP et la
  fin réelle d'un traitement perd silencieusement ce traitement. Cette
  file ne permet donc **pas**, à elle seule, une exposition réseau réelle
  fiable — une file durable (persistée) serait nécessaire pour fermer cet
  écart.
- **Aucune session conversationnelle.** Chaque message déclenche un tour
  `AgentLoop` indépendant (mono-tour) — aucun historique entre messages
  d'un même expéditeur.
- **Aucun outil `execute`.** `AgentLoop` est construit sans
  `ToolExecutor` — garantie structurelle, pas une politique.
- **Aucune confirmation « OUI/NON ».** Non implémentée dans cette
  tranche — conception distincte requise.
- **`127.0.0.1` strictement.** Aucun mode d'écoute public dans cette app.
- **Transport et provider simulés dans `main.ts`.** `GraphApiOutboundTransport`
  existe et est testé (`graph-api-transport.test.ts`, fetch injecté
  uniquement) mais n'est **pas** construit par le bootstrap — aucun appel
  réseau réel n'a lieu avec le code actuellement exécuté par cette app.
  `AnthropicProvider` réel n'est construit nulle part non plus.

## Tests

```bash
npm test --workspace=@jarvis/whatsapp-channel
```

`server.test.ts` (bout en bout, `app.inject()`, aucun socket réel),
`local-message-queue.test.ts`, `in-memory-deduplicator.test.ts`,
`graph-api-transport.test.ts` (fetch injecté, aucun socket réel).

## Prochaines étapes avant un premier échange réel

Blocages effectifs, non levés par cette mission :

- Éligibilité France / tarification / parcours d'inscription développeur
  individuel / numéro de test (étude de faisabilité précédente, non
  tranchés ou contradictoires).
- Secrets réels (`accessToken`, `phoneNumberId`) — n'existent dans aucune
  configuration de cette app aujourd'hui, volontairement.
- Réception durable (file persistée) — cette file reste volatile, voir
  § Rétention mémoire bornée et § Fermeture.
- Exposition HTTPS publique — `main.ts` reste strictement `127.0.0.1`.
- Un essai unique explicitement autorisé, une fois les points ci-dessus
  tranchés — jamais déclenché automatiquement par ce dépôt.
