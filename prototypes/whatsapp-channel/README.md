# Prototype — frontière de canal conversationnel (WhatsApp)

PROTOTYPE JETABLE. Voir `docs/adr/0022-whatsapp-channel-boundary.md` pour la
décision d'architecture. Vit hors du graphe de workspaces (pas de
`package.json`, non couvert par le `tsconfig.json` racine) — même
convention que `prototypes/situation-poc/`.

Aucun réseau, aucun secret réel, aucune connexion Meta, aucun branchement à
`AgentLoop`/`ToolExecutor` réel. Toutes les requêtes des tests sont
construites localement (`fixtures.ts`).

## Fichiers

- `channel-ports.ts` — contrats génériques (signature, allowlist, dédup,
  service conversationnel, transport). Zéro import `@jarvis/*`.
- `webhook-signature.ts` — vérification HMAC-SHA256 générique
  (`node:crypto` uniquement), confirmée en source primaire (voir ci-dessous).
- `channel-processor.ts` — orchestration générique, indépendante du
  fournisseur et du moteur conversationnel.
- `whatsapp-webhook-adapter.ts` — **seul** fichier qui connaît la forme du
  JSON WhatsApp (handshake + parsing des événements).
- `whatsapp-channel.ts` — assemble les trois ci-dessus pour une requête
  POST entrante.
- `fixtures.ts` — payloads synthétiques et doubles de test.
- `whatsapp-channel.test.ts` — suite de validation (voir § Validation).

## Preuves officielles utilisées

| Point                                                                                   | Source                                                                                       | Vérifié comment                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handshake GET (`hub.mode`/`hub.verify_token`/`hub.challenge`)                           | `developers.facebook.com/docs/graph-api/webhooks/getting-started`                            | ✅ Fetch direct                                                                                                                                                                                                        |
| Signature `X-Hub-Signature-256`, HMAC-SHA256 sur le corps avec l'App Secret             | Idem                                                                                         | ✅ Fetch direct                                                                                                                                                                                                        |
| Enveloppe `entry[].changes[].value`, message texte, statut « delivered »                | `developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`                  | ✅ **Fetch direct, revue ciblée** — champs `object`, `entry.id`, `changes[].field:"messages"`, `value.messaging_product/metadata/contacts`, `messages[].{id,from,timestamp,type,text.body}`, `statuses[].id` confirmés |
| Plusieurs messages dans un même événement                                               | —                                                                                            | ⚠️ Aucun exemple officiel vu explicitement ; `messages` est structurellement un tableau dans l'exemple vérifié — traité par construction, pas par un cas spécial non prouvé                                            |
| Type de message non pris en charge (image, audio…)                                      | —                                                                                            | ⚠️ Aucun exemple officiel vu ; tout `type !== 'text'` est traité comme `unsupported` par construction, sans avoir eu besoin de l'exemple exact                                                                         |
| `group_id` distinguant un message de groupe                                             | `developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/` | ⚠️ Fetch direct + une source indépendante concordante, mais **sans bloc JSON complet obtenu** — confiance raisonnable, pas une citation verbatim du même niveau que l'enveloppe ci-dessus                              |
| Éligibilité France / tarification / parcours d'inscription développeur / numéro de test | —                                                                                            | Voir étude de faisabilité (conversation précédente) : points non tranchés ou contradictoires. **Ce prototype ne dépend d'aucun d'eux** — il ne prouve ni l'un ni l'autre.                                              |

**Conversations privées uniquement** : ce filtrage s'appuie sur le champ
officiel `group_id` ci-dessus (présent seulement sur un message de groupe,
absent sur un message 1:1) — jamais sur un champ inventé. Un message
porteur de `group_id` est classé `unsupported`, jamais traité.

## Politique de déduplication et relivraison

Au moins une fois, **jamais** exactement une fois. `Deduplicator` fonctionne
en deux temps (`beginProcessing` puis `finish`) :

- Seule l'issue `replied` (réponse réellement envoyée) marque l'identifiant
  `completed` — bloqué définitivement, une relivraison est ignorée
  (`ignored_duplicate`).
- Toute autre issue (`ignored_unauthorized`, `conversational_service_error`,
  `transport_error`) **libère** l'identifiant : une relivraison ultérieure
  est retraitée comme un essai neuf, jamais perdue silencieusement.
- Conséquence assumée, pas masquée : si le service conversationnel réussit
  mais que le transport échoue, une relivraison **réexécute le service**
  (nouvel appel, texte potentiellement différent) avant de retenter l'envoi
  — pas de cache de la réponse déjà produite dans ce prototype.
- Ambiguïté non résolue, assumée explicitement : une réponse **réellement
  envoyée** dont l'accusé de réception serait perdu (ex. crash du process
  juste après un envoi réussi, avant tout traitement ultérieur) n'est pas
  distinguable d'un message jamais traité après un redémarrage — ce
  prototype ne prétend pas garantir l'« exactement une fois » de bout en
  bout.

## Limites assumées

1. **La déduplication en mémoire ne garantit rien après un redémarrage.**
   `InMemoryDeduplicator` perd tout son état à l'arrêt du process — y
   compris un identifiant déjà `completed`, qui serait retraité comme neuf.
   Démontré explicitement par le test « redémarrage simulé ». Pas de
   persistance ici, par construction (prototype — hors périmètre de cette
   mission).
2. **Un webhook testé localement n'est pas une intégration Meta
   opérationnelle.** Aucune requête de ce prototype n'a jamais atteint un
   serveur Meta ; la forme du payload a été revérifiée pour l'enveloppe
   message/statut mais pas pour le multi-message, les types non supportés,
   ni le détail exact de `group_id` (voir tableau ci-dessus) ; aucune
   conclusion sur la compatibilité réelle ne peut être tirée de ces tests
   seuls.
3. **Les fixtures ne prouvent ni l'éligibilité du compte, ni la
   tarification applicable.** Elles valident uniquement la logique du
   canal (signature, dédup, allowlist, routage), jamais les conditions
   contractuelles de Meta.
4. **Aucune session conversationnelle persistante, aucune action réelle.**
   `ConversationalService`/`OutboundTransport` sont des doubles en mémoire ;
   aucun contexte multi-message n'est conservé entre deux appels
   (hors périmètre de cette décision, voir ADR-0022).
5. **Aucune confirmation « OUI/NON ».** Ce prototype n'implémente aucune
   liaison entre une réponse libre et une confirmation `ConfirmationService`
   (ADR-0006/0008) — explicitement différé, conception distincte requise.

## Robustesse — exceptions inattendues

`processChannelEvent` entoure allowlist/service/transport d'un `try/catch`
après la réservation `beginProcessing` : une exception réelle (pas un
`{status:'error'}` structuré — un bug d'un double, un rejet non géré)
libère tout de même l'identifiant (`'released'`) et renvoie un outcome
`processing_error`, au lieu de laisser la réservation bloquée en
`in_flight` indéfiniment ou de remonter l'exception jusqu'à l'appelant.
Conséquence directe : dans un événement à plusieurs messages
(`whatsapp-channel.ts`, boucle `for`), l'échec inattendu d'un message
n'abandonne jamais les suivants — chacun est traité indépendamment.
Démontré par les tests « robustesse » et « l'échec inattendu du premier
message n'abandonne pas le second ».

## Validation exécutée

`npx vitest run prototypes/whatsapp-channel/whatsapp-channel.test.ts` —
**36 tests** (31 → 36, +5 lors de la revue de clôture) : signatures
valide/absente/altérée/mauvais secret/mauvais préfixe/mauvaise longueur,
absence de secret dans les motifs d'erreur, handshake correct/incorrect,
expéditeur autorisé/refusé (y compris sur un événement à plusieurs
messages, et sur une allowlist qui lève), réservation atomique directe
(`beginProcessing` synchrone), doublon séquentiel et concurrent,
relivraison après échec du service/transport/refus (retraitée, pas
perdue), redémarrage simulé (perte d'état démontrée), notification de
statut, type non supporté, message de groupe (`group_id`), plusieurs
messages dans un même événement (y compris la continuité après l'échec
inattendu du premier), corps JSON malformé et plusieurs formes
structurellement inattendues (`entry` absent/non-tableau, `changes`
absent, message `null`/chaîne dans `messages`) sans exception, erreur
structurée et exception inattendue du service conversationnel, erreur
structurée et exception inattendue du transport et de l'allowlist.

**Doubles, pas seulement absence d'import réseau** : chaque dépendance
construite dans les tests est soit un type local pur
(`HmacSha256SignatureVerifier` — `node:crypto` uniquement, aucune E/S),
soit un double en mémoire (`InMemoryAllowlist`, `InMemoryDeduplicator`,
`FakeConversationalService`, `FakeTransport`), soit un littéral objet
écrit à la main dans le test (cas « robustesse »). Vérifié par grep sur
tout le dossier : aucune occurrence de `fetch(`/`http.request`/
`https.request`/`axios`/`XMLHttpRequest`/`net.connect`/`WebSocket`.

`npx vitest list` confirme que `prototypes/whatsapp-channel/whatsapp-channel.test.ts`
est découvert par la configuration racine (`vitest.config.ts`, aucun
`include` restrictif) — donc inclus par `npm test` au même titre que le
reste du dépôt, sans configuration additionnelle.

## Prochaines étapes

**Blocages effectifs avant un premier échange réel** (ce prototype ne les
lève pas) :

- Trancher les points encore non vérifiés/contradictoires de l'étude de
  faisabilité (éligibilité France, tarification au 01/10/2026, parcours
  d'inscription développeur individuel, limites du numéro de test).
- Confirmer `group_id` par une citation verbatim de la documentation
  officielle (confiance raisonnable actuelle, pas une preuve au même niveau
  que l'enveloppe message/statut).
- Décider où ce code s'intègre réellement (nouvelle app ? extension
  d'`apps/api` restant loopback ? un service séparé exposé publiquement ?)
  — question non tranchée par ce prototype.
- Remplacer les doubles par de vraies implémentations : `ConversationalService`
  adossé à `AgentLoop` (sans branchement `execute` réel tant qu'ADR-0006
  n'est pas satisfaite), `OutboundTransport` vers l'API Graph WhatsApp,
  secret d'application via le `SecretStore` existant.

**Améliorations futures, non bloquantes** :

- Concevoir la liaison confirmation ↔ échange conversationnel (hors
  périmètre ADR-0022, conception distincte requise).
- Obtenir/confirmer un exemple officiel d'événement à plusieurs messages et
  d'un type non supporté, pour remplacer le raisonnement « par construction »
  actuel par une citation directe.
- Au-delà de ce prototype : une politique de cache de la réponse du service
  conversationnel keyée par identifiant d'événement éviterait de réexécuter
  le service sur une relivraison après échec du seul transport — non fait
  ici, délibérément (voir § Politique de déduplication).
