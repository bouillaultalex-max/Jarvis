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
- **Transport et provider simulés.** Aucun appel réseau réel (Graph API
  WhatsApp, API Anthropic) n'est possible avec le code actuel de cette
  app.

## Tests

```bash
npm test --workspace=@jarvis/whatsapp-channel
```

`server.test.ts` (bout en bout, `app.inject()`, aucun socket réel),
`local-message-queue.test.ts`, `in-memory-deduplicator.test.ts`.
