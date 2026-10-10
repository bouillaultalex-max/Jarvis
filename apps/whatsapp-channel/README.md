# @jarvis/whatsapp-channel — intégration locale (ADR-0022/ADR-0023, Proposed)

Première intégration locale du canal conversationnel WhatsApp. **Entièrement
simulée** : aucun secret réel, aucune connexion Meta, aucun appel LLM réel,
aucune exposition réseau au-delà de `127.0.0.1`. `docs/adr/0022-whatsapp-channel-boundary.md`
(frontières du canal) et `docs/adr/0023-whatsapp-durable-reception-sqlite.md`
(réception durable SQLite) restent **`Proposed`** — cette app retient des
décisions d'implémentation concrètes pour ces tranches, elle ne vaut pas
acceptation définitive de l'architecture.

## Commande locale

```bash
npm run dev --workspace=@jarvis/whatsapp-channel
```

Démarre sur `127.0.0.1:${PORT:-3001}` (défaut `3001`). Aucune variable
d'environnement de secret n'est lue — voir § Configuration synthétique.

**Node ≥ 24.20.0 requis** (`engines.node` dans `package.json`) — version
**exacte** vérifiée empiriquement pour `node:sqlite` dans cette session,
pas une extrapolation depuis la cible CI (`node-version: '24'`, dernière
mineure non figée). Voir ADR-0023 § Compatibilité.

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
  → par événement : statut/type non supporté → 200 immédiat, jamais admis
                     message, expéditeur non autorisé → 200 immédiat, jamais admis
                     message, expéditeur autorisé → admission durable dans
                       MessageStore (SQLite, ADR-0023) — persistée et
                       confirmée avant tout accusé
  → réponse HTTP (200/503) dès l'admission confirmée — AVANT tout traitement ;
    une erreur de stockage pendant l'admission produit un 503 explicite,
    jamais un 200 optimiste
  → traitement réel (service conversationnel, transport), en tâche de fond,
    par DurableMessageWorker
```

## Admission partielle (événements multi-message)

Chaque message d'un même événement webhook a sa **propre** réservation de
déduplication. Si un seul message du lot ne peut pas être admis (capacité
atteinte), le lot entier reçoit **503** — WhatsApp relivre alors le lot
complet — mais les messages déjà admis gardent leur réservation : une
relivraison du même lot ne les retraite jamais en double, seuls les
messages non admis la première fois obtiennent une admission neuve.

## Réception durable (SQLite, ADR-0023)

Depuis ADR-0023, l'admission et tout l'état de traitement (`queued` →
`processing` → `response_ready` → `sending` → `sent`/`uncertain`/`failed`)
vivent dans un store SQLite unique (`SqliteMessageStore`,
`node:sqlite`, aucune dépendance npm ajoutée), pas en mémoire :

- **Admission persistée avant l'accusé HTTP** — une erreur de stockage
  empêche explicitement le 200 (voir § Parcours).
- **Reprise après redémarrage** (`recoverAfterRestart()`, appelée avant
  `app.listen()`) : un `processing` interrompu est relancé depuis zéro (sûr
  — aucun outil `execute` n'est jamais atteignable, voir § Limites) ; un
  `response_ready` interrompu reprend l'envoi avec la réponse déjà
  générée, **sans jamais la régénérer** ; un `sending` interrompu (crash
  pendant l'envoi, issue inconnue) est mis en quarantaine `uncertain` —
  **jamais** classé comme non-envoyé, **jamais** renvoyé automatiquement.
- **Exclusivité de process** : un seul worker exclusif est supporté dans
  cette tranche, garantie par le verrou OS que SQLite acquiert lui-même à
  l'ouverture (`PRAGMA locking_mode=EXCLUSIVE`) — pas un fichier PID
  (écarté : fenêtre de course, PID réutilisable, verrou ambigu à nettoyer).
  Un second process qui tenterait de démarrer reçoit une erreur explicite
  (`ExclusivityError`), jamais un démarrage silencieux à deux instances.
- **Réouverture bornée d'un échec certain** (`failed`, démontré sans envoi)
  sur redélivraison : au plus `maxAdmissionAttempts` fois (défaut 5) ;
  au-delà, doublon permanent — même redélivré indéfiniment, jamais une
  boucle de tentatives pour un rejet permanent du fournisseur. La **cible**
  de la réouverture dépend de la phase qui a échoué : après une erreur de
  **génération**, régénération nécessaire (`queued`) ; après un **rejet
  d'envoi** démontré (ex. 4xx), la réponse déjà générée est **réutilisée
  telle quelle** (`response_ready`) — le service conversationnel n'est
  **jamais** rappelé une seconde fois pour le même message. Un `uncertain`
  n'est en revanche **jamais** rouvert automatiquement, quel que soit le
  nombre de tentatives.
- **Contenu divergent détecté, jamais remplacé silencieusement** : si une
  redélivraison du même identifiant fournisseur porte un texte/expéditeur
  différent, c'est signalé (`contentMismatch`, journalisé) mais le
  texte/expéditeur d'origine ne sont jamais écrasés.
- **Capacité bornée en deux axes** : travail actif (`maxActiveDepth`,
  défaut 50) et volume total stocké (`maxStoredMessages`, défaut 5000) —
  ce second plafond protège contre une accumulation illimitée de
  `uncertain`/`failed` jamais purgés automatiquement dans cette tranche.
- **Durabilité** : `journal_mode=WAL` + `synchronous=FULL` — survit à un
  crash du process (vérifié par un vrai `SIGKILL` dans les tests) ;
  résistance à une coupure électrique/crash de l'OS affirmée au niveau de
  la documentation SQLite, non vérifiable par un test automatisé.
- **Rétention** : fichier et répertoire en permissions restrictives
  (`0600`/`0700`), texte **non chiffré au repos** (même posture que
  `FileMemoryStore`/`FileAccountStore` déjà dans ce dépôt). Longueur de
  texte/réponse bornée (`MAX_TEXT_LENGTH_CHARS`/`MAX_RESPONSE_TEXT_LENGTH_CHARS`,
  4096 caractères — choix applicatif local, pas une limite Meta) : un
  nombre de lignes borné ne borne pas, seul, le volume disque. Purge du
  contenu **manuelle**, jamais programmée automatiquement dans cette
  tranche (voir § Commandes ci-dessous) — ne touche jamais le travail actif
  ni un `uncertain`.

Détail complet, matrice crash/reprise et garanties exactes :
`docs/adr/0023-whatsapp-durable-reception-sqlite.md`.

## Fermeture

`DurableMessageWorker.close(timeoutMs?)` arrête immédiatement toute nouvelle
admission, puis attend que le travail déjà admis se termine. Cesser
d'**attendre** à l'échéance n'**annule** jamais un envoi en cours — aucun
contrat d'annulation sur `ConversationalService`/`OutboundTransport`
aujourd'hui.

**Garantie exacte sur le verrou SQLite, sans fausse promesse** : si du
travail reste actif à l'échéance (`'closed_with_pending_work'`), `main.ts`
ne ferme **jamais** explicitement le store — un envoi peut encore être en
vol, et fermer le store relâcherait le verrou pendant cette ambiguïté,
permettant à un second process de reprendre et traiter le **même** message.
La seule fermeture **sûre** du verrou dans ce cas est la **terminaison du
process** (`process.exit(1)`) : on ne prétend pas pouvoir rendre la main
« proprement » tant qu'un envoi reste ambigu. Le store reste cohérent dans
tous les cas : une ligne encore `processing`/`sending` à la terminaison du
process est reprise par `recoverAfterRestart()` au prochain démarrage,
jamais perdue.

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

`DurableMessageWorker` persiste `'transport_uncertain'` comme `uncertain`
dans le store (ADR-0023) — **aucune relance automatique**, de façon
**durable** : contrairement à l'ancienne version en mémoire, ce blocage
survit à un redémarrage (plus de fenêtre de rétention FIFO à exceder pour
qu'un identifiant « s'oublie »). Une relivraison du même message, même
après redémarrage, reste un doublon tant que la ligne n'a pas été résolue
explicitement. L'issue réelle reste consultable (`MessageStore.getRow()`)
pour une décision explicite ultérieure — aucun mécanisme de révision
manuelle n'est construit ici.

Garanties de l'adaptateur : `apiVersion`/`phoneNumberId` validés à la
construction (format strict, aucune injection d'hôte/chemin possible) ;
`fetch` injecté (jamais le global) ; validation locale avant tout appel
réseau (espaces dans le destinataire explicitement rejetés) ; délai borné
via `AbortController`, couvrant l'attente des en-têtes **et** la lecture
du corps ; **aucun retry automatique** (un seul appel par `send()`) ;
aucun secret (jeton) dans un résultat ou une erreur renvoyée, aucun
`console.*` dans la classe.

## Limites — ne pas présenter comme prêt pour une exposition publique

- **Mono-process strictement.** Un seul worker exclusif est supporté
  (ADR-0023) — aucun support multi-process/multi-machine. Un `uncertain`
  reste une ambiguïté non résolue par construction, désormais durable
  (visible après redémarrage) mais pas résolue pour autant.
- **Purge de rétention non programmée.** Le modèle de rétention (ADR-0023 §
  Données) est défini mais son exécution périodique n'est pas codée dans
  cette tranche — une accumulation de lignes terminales reste possible
  jusqu'au plafond `maxStoredMessages`, qui refuse alors explicitement de
  nouvelles admissions plutôt que de dégrader silencieusement.
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

## Commandes (données synthétiques uniquement dans ces exemples)

**Démarrage** (reprise automatique après redémarrage — `recoverAfterRestart()`
s'exécute avant d'accepter la première requête, voir § Réception durable) :

```bash
npm run dev --workspace=@jarvis/whatsapp-channel
# Emplacement du store : $JARVIS_DATA_DIR ou répertoire de données par OS
# (voir data-path.ts) ; override explicite pour les tests/CI :
WHATSAPP_MESSAGES_DB_PATH=/tmp/exemple-synthetique/messages.db \
  npm run dev --workspace=@jarvis/whatsapp-channel
```

**Purge manuelle** (jamais programmée automatiquement — voir § Rétention ;
**arrêter le canal avant de l'exécuter**, le script acquiert la même
exclusivité de process et échoue explicitement sinon) :

```bash
# Dry-run (défaut) : affiche ce qui serait purgé, ne modifie rien.
node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts

# Applique réellement la purge (texte des sent/failed > 30 jours effacé ;
# lignes sent/failed > 180 jours entièrement supprimées) :
node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts --apply

# Seuils personnalisés :
node_modules/.bin/tsx apps/whatsapp-channel/src/purge-retained-content.ts \
  --content-retention-days 14 --full-purge-after-days 90 --apply
```

La purge ne touche jamais le travail actif (`queued`/`processing`/
`response_ready`/`sending`) ni un `uncertain` — liste positive
`status IN ('sent','failed')` uniquement, voir `message-store.ts`.

## Tests

```bash
npm test --workspace=@jarvis/whatsapp-channel
```

`server.test.ts` (bout en bout, `app.inject()`, aucun socket réel),
`sqlite-message-store.test.ts`, `generate-response.test.ts`,
`send-response.test.ts`, `durable-message-worker.test.ts`,
`durable-message-worker.crash-recovery.test.ts` (sous-process réel,
`SIGKILL`, synchronisation déterministe par sentinel stdout — aucun délai
arbitraire), `graph-api-transport.test.ts` (fetch injecté, aucun socket réel).

## Prochaines étapes avant un premier échange réel

Blocages effectifs, non levés par cette mission :

- Éligibilité France / tarification / parcours d'inscription développeur
  individuel / numéro de test (étude de faisabilité précédente, non
  tranchés ou contradictoires).
- Secrets réels (`accessToken`, `phoneNumberId`) — n'existent dans aucune
  configuration de cette app aujourd'hui, volontairement.
- Exposition HTTPS publique — `main.ts` reste strictement `127.0.0.1`.
- Purge de rétention programmée, interface de révision des `uncertain`,
  support multi-process — voir ADR-0023 § Hors périmètre.
- Un essai unique explicitement autorisé, une fois les points ci-dessus
  tranchés — jamais déclenché automatiquement par ce dépôt.
