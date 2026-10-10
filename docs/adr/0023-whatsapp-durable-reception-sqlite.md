# ADR-0023 : Réception durable du canal WhatsApp (SQLite)

Date: 2026-10-10
Status: Proposed

**Mise à jour (2026-10-10, même journée) — implémentée pour la première tranche
locale, deux passes de revue appliquées.** Avant codage, trois défauts de
conception corrigés (§ Corrections appliquées avant implémentation). Après
implémentation, une revue finale ciblée a trouvé et corrigé six défauts
supplémentaires dans le code déjà écrit (§ Corrections apportées lors de la
revue finale, en fin de document) — dont un bug réel de réutilisation de
réponse et un risque réel de double envoi à la fermeture. Le statut reste
`Proposed` : l'implémentation existe et sa suite de tests est verte, mais
l'acceptation définitive de l'architecture n'est pas actée par ce document
seul — ce commit valide une tranche, pas toute l'architecture.

## Context

`apps/whatsapp-channel` (ADR-0022, toujours `Proposed`) admet aujourd'hui
chaque message dans une `LocalMessageQueue` entièrement en mémoire :
réservation de déduplication (`InMemoryDeduplicator`, `Set`/`Map`), file de
travail et historique des issues (`Map` bornée, éviction FIFO). Tout cet état
est perdu à chaque redémarrage du process et un crash entre l'accusé HTTP 200
et la fin réelle d'un traitement **perd silencieusement le travail en
cours** — limite explicitement assumée et documentée dans
`apps/whatsapp-channel/README.md` (« File volatile, non durable »).

Cette décision conçoit le remplacement de cet état en mémoire par un store
transactionnel durable. Elle ne revient pas sur les quatre frontières posées
par ADR-0022 (vérification d'origine, allowlist, déduplication,
service/transport injectés) et ne branche toujours ni Meta réel, ni
`AnthropicProvider` réel, ni `ToolExecutor`.

### Correctifs par rapport à une proposition précédente, non retenue

Une proposition antérieure (hors dépôt, discussion précédente) envisageait
de persister uniquement le `Deduplicator` et les issues terminales. Rejetée
pour trois raisons concrètes :

1. Persister seulement la déduplication et les issues ne conserve **aucun
   travail à reprendre** : un redémarrage pendant le traitement perdrait
   toujours le message lui-même (texte, expéditeur) puisque rien ne le
   retient entre l'admission et l'issue terminale.
2. Un identifiant retrouvé `in_flight` (réservé, jamais terminé) après un
   crash resterait bloqué indéfiniment — aucun mécanisme ne le reprend ni ne
   le libère.
3. Le synchronisme strict de `Deduplicator.beginProcessing`/`finish` (ADR-0022)
   doit être préservé pour l'admission, mais les contrats existants
   (`ChannelOutcome`, `AdmissionResult`, la séparation
   `Deduplicator`/historique des issues) peuvent évoluer dès qu'ils empêchent
   une admission durable correcte — ce qui est le cas ici : un seul store
   transactionnel, pas deux structures séparées à synchroniser.

### Corrections appliquées avant implémentation (revue de cette tranche)

Une relecture de ce document, avant tout codage, a identifié quatre défauts
concrets dans la version qui précède — corrigés dans le modèle ci-dessous et
dans l'implémentation :

1. **Un `failed` ne doit jamais englober un envoi potentiellement abouti.**
   La version précédente listait « rejet 4xx » comme seule cause de `failed`
   à l'envoi, mais ne distinguait pas explicitement ce cas d'une exception
   **inattendue** levée pendant l'envoi. Corrigé : `failed` depuis `sending`
   n'est atteint que par `TransportResult.status === 'error'` (échec
   **démontré**, contrat déjà strict d'ADR-0022/`channel-ports.ts`) —
   jamais par une exception inattendue du transport, qui va vers `uncertain`
   (voir `durable-message-worker.ts` § distinction `failed`/`uncertain`).
   Même raisonnement à la génération : les trois issues terminales possibles
   (`ignored_unauthorized`, erreur de service, exception inattendue) sont
   **toutes** sûres à classer `failed` puisqu'aucun appel transport n'a pu
   avoir lieu à ce stade — jamais ambigu dans l'autre sens.
2. **Réouverture d'un `failed` bornée en nombre de tentatives.** Sans borne,
   une redélivraison répétée d'un message structurellement invalide (ex.
   texte qui fait toujours échouer le service conversationnel) rouvrirait
   indéfiniment la même ligne. `maxAdmissionAttempts` (défaut 5,
   `sqlite-message-store.ts`) : au-delà, un `failed` reste un doublon
   permanent — plus jamais rouvert par ce mécanisme automatique.
3. **Contenu divergent sur une même identité fournisseur : détecté, jamais
   remplacé silencieusement.** `MessageStore.admit()` compare systématiquement
   `senderId`/`text` à la ligne existante dès qu'une admission ne crée pas une
   ligne neuve (doublon ou réouverture d'un `failed`) et renvoie
   `contentMismatch: true` le cas échéant — `server.ts` le journalise
   (`console.warn`) et le signale dans la réponse HTTP
   (`reason: 'content_mismatch_kept_original'`). Le texte/l'expéditeur
   d'origine ne sont **jamais** réécrits par cette comparaison, qu'il y ait
   divergence ou non.
4. **Seules les transitions légales sont autorisées, de façon
   transactionnelle.** Chaque transition d'état (`recordResponseReady`,
   `recordSent`, `recordSendRejected`, `recordGenerationFailed`,
   `recordUncertain`) est un `UPDATE ... WHERE provider_message_id = ? AND
status = '<état attendu>'` unique — jamais un `SELECT` suivi d'un
   `UPDATE` séparé. Si la ligne n'était pas dans l'état attendu (déjà
   transitionnée, ou jamais atteint cet état), zéro ligne est affectée et
   `IllegalTransitionError` est levée — jamais une mutation partielle ni une
   transition silencieusement ignorée.

## Compatibilité du runtime retenu

**Choix retenu : `node:sqlite`** (module intégré à Node.js depuis la
version 22.5.0, API **synchrone** `DatabaseSync`/`StatementSync` — aucune
dépendance npm ajoutée). Aucun comparatif supplémentaire avec un store JSON
n'est nécessaire pour cette décision.

Vérifications effectuées dans cette session (lecture + exécution locale
isolée, aucune installation) :

- Version Node **déclarée** par ce dépôt : aucun `engines` dans
  `package.json` (racine ou workspaces), aucun `.nvmrc`. Seule déclaration
  explicite : `.github/workflows/ci.yml` → `actions/setup-node@v4` avec
  `node-version: '24'` (dernière mineure 24.x résolue par CI, non figée à un
  patch). `README.md` énonce en prose « Node 24.x, npm 11.x requis ».
- Node local utilisé pour cette vérification : **v24.20.0**.
- `require('node:sqlite')` sur cette version : **aucun `ExperimentalWarning`
  émis** (listener `process.on('warning')` posé avant le `require` — testé
  explicitement, tableau vide).
- SQLite embarquée par ce binaire Node : **3.53.4**. `RETURNING` fonctionne
  (`UPDATE ... RETURNING *`), la contrainte `UNIQUE` est appliquée, un
  `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE <condition>` avec
  `RETURNING` se comporte exactement comme documenté par SQLite (no-op
  silencieux, aucune ligne retournée, si la condition du `WHERE` est fausse)
  — vérifié par exécution directe, pas supposé.

**Ce qui n'est PAS vérifié ici, à ne pas confondre avec ce qui précède** :
le comportement sur d'autres patches de la branche 24.x, sur l'environnement
de déploiement réel (conteneur, autre distribution, autre architecture CPU),
ni le statut de stabilité officiel documenté par Node pour cette API sur la
version exacte qui sera réellement déployée. **Disponibilité locale ≠
compatibilité de déploiement.**

**Version minimale retenue, corrigée après revue : Node ≥ 24.20.0** — la
version **exacte** vérifiée empiriquement dans cette session, pas
`>= 24.0.0` (CI ne déclare que la dernière mineure `'24'`, ce qui n'est pas
une preuve que `24.0.0` à `24.19.x` offrent le même comportement — jamais
vérifiés ici). `engines.node` de `apps/whatsapp-channel/package.json` porte
désormais ce plancher honnête, pas une extrapolation. Toujours pas le
minimum théorique (22.5.0) auquel `node:sqlite` existe en principe, mais
jamais vérifié ici — ne pas promettre plus que ce qui est effectivement
établi. Un `.nvmrc` racine reste absent, hors périmètre de cette tranche
(porterait sur tout le monorepo).

## Modèle de données et machine à états

Un **store unique**, une seule table, une seule source de vérité — pas de
`Deduplicator` et d'historique d'issues séparés à synchroniser.

```
CREATE TABLE whatsapp_inbound_messages (
  provider_message_id TEXT PRIMARY KEY,   -- identifiant fournisseur, clé de déduplication
  sender_id            TEXT NOT NULL,
  text                  TEXT NOT NULL,     -- voir § Données et rétention (non chiffré, purge séparée)
  status                TEXT NOT NULL,     -- voir machine à états ci-dessous
  attempts              INTEGER NOT NULL DEFAULT 0,
  response_text         TEXT,              -- réponse générée, réutilisée telle quelle à l'envoi
  claimed_by             TEXT,              -- id de boot du process (observabilité — PAS une garantie d'exclusion, voir § Concurrence)
  claimed_at             TEXT,
  last_error             TEXT,              -- raison du dernier `failed`/`uncertain`
  received_at           TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
```

Machine à états (`status`) :

```
queued → processing → response_ready → sending → sent
            │                              │
            └──────────────┐               ├──→ uncertain   (jamais de renvoi automatique)
                            ↓               └──→ failed       (certain, redelivrable)
                          failed  (erreur service conversationnel, certaine)
```

- **`queued`** — admis, pas encore réclamé par le worker.
- **`processing`** — réclamé, en appel au service conversationnel. Aucun
  effet de bord possible à ce stade : `ConversationalService` ne passe
  jamais par un `ToolExecutor` réel dans ce prototype (garantie structurelle
  d'ADR-0022, pas une politique) — c'est précisément ce qui rend cet état
  **sûr à ré-exécuter** après un crash (voir § Reprise).
- **`response_ready`** — réponse générée et persistée (`response_text`
  rempli), pas encore envoyée. Une reprise à partir de cet état **ne
  régénère jamais** la réponse.
- **`sending`** — appel au transport sortant en cours. Issue non encore
  connue : un crash ici ne doit **jamais** être interprété comme « non
  envoyé » (voir § Reprise, c'est le cœur de la correction demandée).
- **`sent`** — terminal, succès confirmé par le transport.
- **`uncertain`** — terminal pour la politique automatique : succès non
  confirmé mais échec non prouvé (timeout, 5xx, corps illisible — même
  sémantique que `TransportResult.uncertain` déjà posée par ADR-0022/
  `graph-api-transport.ts`), **ou** une `sending` retrouvée après un crash.
  Jamais renvoyé automatiquement.
- **`failed`** — terminal, échec certain (erreur de service conversationnel,
  ou rejet 4xx explicite du transport **avant** tout envoi confirmé). Seul
  état **redélivrable** : une redélivraison du même
  `provider_message_id` rouvre la ligne vers `queued` (voir requête
  d'admission ci-dessous) plutôt que d'être traitée comme un doublon pour
  toujours.

### Admission — persistée et confirmée avant le 200 HTTP

Une seule instruction SQL, synchrone (`node:sqlite` est une API synchrone —
aucun `await` entre la décision et l'écriture, donc **aucune fenêtre
d'interleaving**, propriété déjà exploitée par `InMemoryDeduplicator`
aujourd'hui et explicitement préservée ici plutôt que cassée) :

```sql
INSERT INTO whatsapp_inbound_messages
  (provider_message_id, sender_id, text, status, attempts, received_at, updated_at)
VALUES (?, ?, ?, 'queued', 0, ?, ?)
ON CONFLICT(provider_message_id) DO UPDATE
  SET status = 'queued', updated_at = excluded.updated_at
  WHERE status = 'failed'
RETURNING status;
```

Vérifié empiriquement (SQLite 3.53.4 via `node:sqlite`) :

- Nouvelle ligne → `{status: 'queued'}` retourné → admission `'queued'`.
- Ligne existante dans un état non `failed` (`queued`, `processing`,
  `response_ready`, `sending`, `sent`, `uncertain`) → **aucune ligne
  retournée**, aucune erreur, aucune écriture → admission `'duplicate'`.
- Ligne existante `failed` → réécrite en `queued`, `attempts` conservé (pas
  réinitialisé) → admission `'queued'` (nouvel essai), symétrique à la
  politique `'released'` déjà actée par ADR-0022 pour les échecs certains.

**Une erreur de stockage (I/O disque, verrou, contrainte imprévue) à cette
étape empêche explicitement l'accusé 200** : la route HTTP (`server.ts`)
n'émet jamais `200`/`'queued'` sans confirmation que l'`INSERT`/`UPSERT` a
réellement committé. Une exception levée par `node:sqlite` à cette étape
doit se traduire par une réponse d'échec d'admission pour cet événement (503
pour le lot, même politique de relivraison partielle qu'aujourd'hui — voir
`apps/whatsapp-channel/README.md` § Admission partielle), jamais par un 200
optimiste.

**Capacité bornée** : avant de committer la transaction d'admission, un
comptage (`SELECT COUNT(*) WHERE status IN ('queued','processing',
'response_ready','sending')`) contre un plafond configurable
(`maxQueueDepth`, équivalent durable de `DEFAULT_QUEUE_MAX_SIZE`) décide du
`'rejected_capacity'` — dans ce cas la ligne vient d'être insérée/rouverte
puis **annulée dans la même transaction** (`ROLLBACK`), exactement comme
`LocalMessageQueue.admit()` libère aujourd'hui sa réservation en mémoire sur
dépassement de capacité, pour qu'une relivraison ultérieure retente un
admission neuf plutôt que de voir un faux doublon permanent.

## Reprise et concurrence

### Revendication atomique d'un travail

`claimNextQueued()` : une seule instruction, synchrone, atomique au sein du
process (aucune fenêtre d'`await`) :

```sql
UPDATE whatsapp_inbound_messages
   SET status = 'processing', claimed_by = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
 WHERE provider_message_id = (
   SELECT provider_message_id FROM whatsapp_inbound_messages
    WHERE status = 'queued' ORDER BY received_at LIMIT 1
 )
RETURNING *;
```

### Propriétaire et protection contre un worker obsolète — corrigé : pas un fichier PID

`claimed_by` enregistre un identifiant de boot du process (PID + horodatage
de démarrage) — **observabilité et diagnostic uniquement, pas une garantie
d'exclusion**. Un simple jeton (« fencing token ») ne protège en rien contre
un effet **externe déjà produit** par un worker obsolète qui croirait encore
détenir le travail (un envoi réseau réel ne peut pas être « annulé » après
coup par la perte d'un jeton). Cette décision ne prétend donc pas résoudre
la concurrence multi-worker par un mécanisme de bail/fencing.

**Un fichier PID a été écarté avant codage, pour trois raisons concrètes**
relevées en relecture : (1) son existence est vérifiée puis créée en deux
étapes séparées — fenêtre de course entre les deux ; (2) un PID mort peut
avoir été **réutilisé** par un processus totalement étranger, rendant la
vérification de vivacité trompeuse ; (3) un verrou laissé par un crash est
**ambigu** à nettoyer automatiquement — rien ne prouve qu'il est réellement
périmé plutôt que détenu par un process encore vivant mais lent à répondre.

**Mécanisme retenu à la place : le verrou OS de SQLite lui-même**
(`PRAGMA locking_mode=EXCLUSIVE`), acquis à l'ouverture
(`SqliteMessageStore.open()`) par une première transaction d'écriture
(`BEGIN IMMEDIATE` / `COMMIT`) avec `busy_timeout=0`. Propriétés vérifiées
**empiriquement** dans cette session, par de vrais process Node (pas
supposées) :

- **Acquisition atomique** — l'acquisition **est** la vérification : il
  n'existe pas de fenêtre séparée entre « vérifier » et « prendre ». Un
  second process (ou une seconde connexion dans le même process) qui tente
  la même opération échoue **immédiatement** (`ERR_SQLITE_ERROR`,
  « database is locked »), sans attente.
- **Libération automatique par le noyau à la mort du process détenteur,
  y compris `SIGKILL`** — vérifié par un process tué brutalement
  (`kill -9`) suivi d'un second process acquérant immédiatement le même
  verrou et relisant les données déjà committées, sans corruption. Aucune
  réutilisation de PID ne peut créer de faux positif : le verrou est tenu
  par le descripteur de fichier ouvert par le noyau, pas par une donnée
  applicative relisable/falsifiable.
- **Aucun verrou ambigu à nettoyer** — il n'existe pas de fichier de verrou
  séparé : l'état du verrou est toujours celui que le noyau rapporte à
  l'instant de l'acquisition. Aucune politique de reprise/« vol » d'un
  verrou périmé n'est nécessaire, donc aucune n'est codée.

Ce mécanisme ne requiert **aucune dépendance nouvelle** (`node:sqlite` est
déjà le choix retenu pour le store) et **aucune décision supplémentaire** —
le blocage anticipé (« si l'exclusivité fiable exige une dépendance
nouvelle, rapporter avant de coder ») ne s'est donc pas matérialisé une fois
cette alternative identifiée. Limite assumée, inchangée : support
**mono-process strictement** dans cette tranche — un second process qui
tenterait de démarrer pendant que le premier tourne reçoit explicitement
`ExclusivityError`, jamais un démarrage silencieux à deux instances.

Une contrainte `UNIQUE` (la clé primaire `provider_message_id`) empêche une
**admission** doublonnée ; elle n'empêche **pas**, seule, deux traitements
concurrents d'une même ligne — c'est le verrou d'exclusivité de process
ci-dessus qui porte cette garantie dans cette tranche, pas la contrainte SQL.

### Durabilité — journal, `synchronous`, transactions, fichiers annexes

Réglages appliqués à l'ouverture (`SqliteMessageStore.open()`) : `journal_mode=WAL`
puis `synchronous=FULL`. Chaque transition d'état est **une seule
instruction SQL** (voir § Corrections ci-dessus) — SQLite l'enveloppe
elle-même dans une transaction implicite ; l'admission (§ ci-dessus) utilise
une transaction explicite (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) quand
plusieurs lectures/écritures doivent réussir ou échouer ensemble (vérifier
l'existant, décider capacité, écrire).

**Distinction explicite, à ne jamais confondre** :

- **Survie à un crash du process** (`SIGKILL`, exception non rattrapée,
  coupure de l'alimentation de l'application) : garantie par `journal_mode=WAL`
  seul, quelle que soit la valeur de `synchronous` — un commit terminé est
  retrouvé intact après redémarrage, jamais de corruption. Vérifié
  empiriquement dans cette session (process tué par `SIGKILL`, données
  committées relues intactes par le process suivant — voir
  `durable-message-worker.crash-recovery.test.ts`).
- **Résistance à une coupure électrique/crash de l'OS** (la machine entière
  s'arrête, pas seulement le process) : nécessite `synchronous=FULL` —
  chaque commit est synchronisé sur disque (`fsync`) avant de retourner,
  au prix d'un coût d'E/S par commit. **Ce point n'est pas vérifié
  empiriquement dans cette session** (une coupure électrique réelle n'est
  pas simulable de façon fiable par des tests automatisés) — affirmation de
  niveau documentation officielle SQLite uniquement, pas une mesure. Avec
  `synchronous=NORMAL` sous WAL (non retenu ici), la survie à un crash
  process reste garantie, mais les derniers commits pourraient être perdus
  (jamais corrompus) lors d'une coupure électrique — compromis jugé non
  pertinent ici, l'admission devant survivre même à ce cas rare plutôt que
  d'optimiser la latence d'écriture.
- **Fichiers annexes** (`messages.db-wal`, `messages.db-shm`, créés par le
  mode WAL) : mêmes permissions restrictives que le fichier principal
  (`0600`, appliquées explicitement après l'ouverture — voir § Données et
  rétention) ; déjà couverts par `.gitignore` (`*.db-wal`/`*.db-shm`
  préexistants, aucun changement nécessaire).

### Comportement après crash, par étape

| État retrouvé au démarrage | Side effect possible avant crash                                                                                     | Action de reprise                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`                   | Aucun (jamais réclamé)                                                                                               | Reprise normale : éligible à `claimNextQueued()`                                                                                                          |
| `processing`               | Appel au service conversationnel, **sans** `ToolExecutor` (ADR-0022) → aucun effet de bord possible structurellement | Ré-exécuté depuis le début (nouvel appel service conversationnel) ; `attempts` déjà incrémenté à la réclamation précédente en témoigne                    |
| `response_ready`           | Réponse générée et persistée, pas encore envoyée                                                                     | Reprise directement à l'étape d'envoi avec `response_text` stocké — **jamais régénéré**                                                                   |
| `sending`                  | Appel transport démarré, issue inconnue — **a pu être livré**                                                        | **Jamais** classé `failed`/non-envoyé : transition immédiate vers `uncertain`, mis en quarantaine, surfaced (log explicite), **aucun renvoi automatique** |
| `sent`                     | Confirmé                                                                                                             | Aucune action (terminal)                                                                                                                                  |
| `failed`                   | Échec certain déjà enregistré                                                                                        | Aucune action automatique ; redélivrable sur nouvelle admission (`WHERE status='failed'` ci-dessus)                                                       |
| `uncertain`                | Issue jamais connue                                                                                                  | Aucune action automatique ; nécessite une décision explicite hors de cette tranche (voir § Rétention)                                                     |

Cette table est exécutée une fois, au démarrage, **avant** `app.listen()` —
puisque le verrou de process garantit qu'aucune autre instance n'a pu
modifier ces lignes depuis le crash, la reprise est déterministe (pas
d'ambiguïté sur « qui d'autre a pu toucher cette ligne »).

## Données et rétention

- **Emplacement** : même convention que `FileAccountStore`
  (`apps/desktop/src/main.ts` → `defaultAccountsFilePath()`) —
  `JARVIS_DATA_DIR` si défini, sinon répertoire de données applicatif par OS
  (`XDG_DATA_HOME`/`APPDATA`/`Application Support`), sous-dossier
  `jarvis/whatsapp-channel/messages.db`. Hors Git — déjà couvert par
  `.gitignore` (`*.db`, `*.db-shm`, `*.db-wal` déjà exclus, aucun changement
  de `.gitignore` nécessaire).
- **Permissions** : répertoire créé en `0700`, fichier de base en `0600`
  (positionné explicitement après création, pas supposé hérité de l'umask).
  Pas de sauvegarde automatique ajoutée par cette tranche ; si un mécanisme
  de sauvegarde externe existe sur la machine de l'utilisateur, il échappe
  au périmètre de cette décision — à documenter séparément si besoin.
- **Texte non chiffré au repos — choix explicite**, même posture que
  `FileMemoryStore`/`FileAccountStore` déjà dans ce dépôt (JSON non chiffré) :
  aucune régression de confidentialité par rapport à l'état de l'art déjà
  accepté ici, mais à ne jamais présenter comme un stockage protégé.
- **Rétention du contenu, distincte de la déduplication** : la ligne
  elle-même (donc la protection anti-doublon par `provider_message_id`) peut
  être conservée plus longtemps que le texte. Politique proposée : après un
  délai configurable (`contentRetentionMs`, défaut proposé 30 jours) sur une
  ligne **terminale** (`sent`/`failed`), `text` et `response_text` sont
  effacés (`NULL`) in place — la ligne (id, status, horodatages) reste pour
  continuer à bloquer une redélivraison très tardive d'un message déjà
  traité. Une purge complète de la ligne (second délai, plus long,
  configurable séparément) libère l'identifiant pour de bon.
- **`uncertain` non résolus** : **jamais** purgés par la politique
  ci-dessus tant qu'ils n'ont pas de décision explicite — une purge
  automatique d'une issue incertaine effacerait la seule trace qu'un envoi a
  peut-être eu lieu. Comptés et surfacés (log/compteur observable) ; la
  décision de les rouvrir, les abandonner ou les confirmer manuellement
  reste hors du périmètre codé par cette tranche (pas d'UI/CLI de révision
  ici).
- **Capacité maximale et saturation** : `maxQueueDepth` (voir § Modèle de
  données) — dépassement → `'rejected_capacity'`/503, identique à la
  politique déjà en place aujourd'hui, jamais une admission silencieusement
  dégradée.
- **Tests** : aucun message réel, aucun secret réel — mêmes doubles que les
  tests existants (`graph-api-transport.test.ts` : fetch injecté ; identifiants
  et textes synthétiques, jamais un numéro/compte WhatsApp réel).

## Limites et modèle de concurrence (résumé)

- Durable pour un **seul process exclusif**. Pas de support multi-instance/
  multi-machine dans cette tranche — explicitement hors périmètre, pas une
  omission accidentelle.
- La protection « un seul traitement concurrent par message » reste, comme
  aujourd'hui, une propriété du process (synchronisme Node + verrou
  d'exclusivité), jamais d'un jeton de possession seul.
- Une ligne `uncertain` reste une ambiguïté non résolue par construction —
  ADR-0022 l'assumait déjà pour la version en mémoire ; cette tranche la
  rend seulement **durable** (visible après redémarrage), elle ne la
  résout pas.
- Toujours aucune confirmation « OUI/NON », aucun `ToolExecutor`, aucun
  secret réel, aucune exposition publique — inchangé par rapport à
  ADR-0022.

## Fichiers d'implémentation (tranche minimale, implémentée)

Liste mise à jour après implémentation — diffère de la liste envisagée
initialement sur deux points, expliqués ci-dessous.

- `apps/whatsapp-channel/src/message-store.ts` — port `MessageStore`
  (`admit`, `claimNextQueued`, `claimNextResponseReady`, `recordResponseReady`,
  `recordSent`, `recordSendRejected`, `recordGenerationFailed`,
  `recordUncertain`, `recoverAfterRestart`, `getRow`, `countActive`,
  `countTotal`), `IllegalTransitionError`, `ExclusivityError`,
  `UnsupportedSchemaError`.
- `apps/whatsapp-channel/src/sqlite-message-store.ts` — implémentation
  `node:sqlite` : schéma versionné (`PRAGMA user_version`), ouverture +
  acquisition de l'exclusivité (§ Reprise et concurrence — **pas de fichier
  séparé `process-lock.ts`** : l'exclusivité est une propriété de
  l'ouverture du store lui-même, inutile de la découper), toutes les
  requêtes de cette ADR.
- `apps/whatsapp-channel/src/generate-response.ts` /
  `send-response.ts` — **remplacent** `execute-message-event.ts` (retiré) :
  étape « génération » et étape « envoi » séparées, pour que le worker
  puisse persister `response_ready` **entre** les deux (voir § Admission) et
  reprendre après un crash sans jamais régénérer une réponse déjà obtenue.
- `apps/whatsapp-channel/src/durable-message-worker.ts` — **remplace**
  `local-message-queue.ts` + `in-memory-deduplicator.ts` (tous deux
  retirés, pas conservés en double). Boucle à concurrence bornée,
  réclamant en priorité les `response_ready` (travail déjà proche du
  terme) puis les `queued`.
- `apps/whatsapp-channel/src/channel-ports.ts` — `Deduplicator`/
  `ClaimResult`/`ProcessingOutcome` retirés (remplacés par `MessageStore`) ;
  `ChannelEvent`/`SenderAllowlist`/`ConversationalService`/
  `OutboundTransport`/`ChannelOutcome` inchangés dans leur rôle.
- `apps/whatsapp-channel/src/server.ts`, `main.ts` — câblage du store et du
  worker, reprise (`recoverAfterRestart`) explicitement avant
  `app.listen()`, erreur de stockage pendant l'admission mappée en 503
  (`kind: 'storage_error'`), jamais un 200.
- `apps/whatsapp-channel/package.json` — `engines.node: ">=24.20.0"` ajouté
  (§ Compatibilité, décision désormais actée pour ce workspace).
- Tests : `sqlite-message-store.test.ts`, `generate-response.test.ts`,
  `send-response.test.ts`, `durable-message-worker.test.ts`,
  `durable-message-worker.crash-recovery.test.ts` (sous-process réel,
  `SIGKILL`, synchronisation par sentinel stdout — voir § Tests
  d'acceptation), `server.test.ts` réécrit pour le nouveau worker.

**Pourquoi la liste diffère de celle envisagée initialement** : (1) aucun
`process-lock.ts` séparé — un fichier PID a été écarté avant codage (§
Reprise et concurrence), et le mécanisme retenu (verrou OS SQLite) est une
propriété de l'ouverture du store, pas un composant indépendant ; (2)
`execute-message-event.ts` est remplacé par deux fichiers
(`generate-response.ts`/`send-response.ts`) plutôt que conservé tel quel,
pour permettre la persistance de `response_ready` entre génération et
envoi — nécessaire à la garantie « reprend sans régénérer ».

## Tests d'acceptation

1. Admission dupliquée (même `provider_message_id`) sur une ligne `queued`,
   `processing`, `response_ready`, `sending`, `sent` ou `uncertain` →
   `'duplicate'`, aucune écriture.
2. Admission sur une ligne `failed` → rouverte en `queued`, `attempts`
   conservé, pas de nouveau texte écrasant un texte différent sans
   justification (si le texte redélivré diffère, décision à documenter —
   voir § Décisions nécessaires).
3. Dépassement de `maxQueueDepth` → `'rejected_capacity'`, ligne annulée
   (vérifiable : une admission immédiatement après reçoit `'queued'`, pas
   `'duplicate'`).
4. Erreur de stockage simulée (ex. base ouverte en lecture seule, ou
   `DatabaseSync` fermée) pendant l'admission → aucun 200 renvoyé pour
   l'événement concerné.
5. **Arrêt brutal d'un sous-processus et réouverture** (test d'intégration
   obligatoire, pas seulement unitaire) : démarrer `main.ts` dans un
   processus enfant réel (`child_process.spawn`), lui envoyer un message
   admis, le tuer (`SIGKILL`) à un point précis de son traitement (injecter
   un délai contrôlable ou un hook de test pour arrêter juste après le
   passage à `sending` avant tout appel transport réel — transport déjà
   simulé) puis redémarrer un nouveau process pointant vers le **même**
   fichier `.db` : la ligne doit être retrouvée `uncertain`, jamais
   renvoyée automatiquement. Répéter pour un arrêt pendant `processing`
   (doit reprendre proprement) et pendant `response_ready` (doit reprendre
   sans régénérer la réponse — assertion sur l'identité du texte renvoyé).
6. Exclusivité de process : démarrer un second process/connexion pendant
   qu'un premier détient le verrou → refus immédiat (`ExclusivityError`) ;
   tuer le premier par `SIGKILL` puis rouvrir → acquisition immédiate,
   aucune attente, aucun nettoyage manuel requis.
7. Aucun test de cette suite ne doit utiliser de message, numéro ou secret
   réel — uniquement des doubles déjà en place (`SimulatedOutboundTransport`/
   `SimulatedLlmProvider`).
8. _(ajoutés après revue)_ Doublon à contenu divergent → `contentMismatch`
   signalé, texte d'origine conservé. Réouverture d'un `failed` bornée par
   `maxAdmissionAttempts`. Transition illégale → `IllegalTransitionError`,
   zéro mutation. Capacité totale bornée même quand seuls des `uncertain`/
   `failed` s'accumulent (`maxStoredMessages`, distinct de `maxActiveDepth`).

## Tranche minimale — implémentée

1. `message-store.ts` (port) + `sqlite-message-store.ts` (implémentation :
   schéma versionné, admission avec détection de divergence et borne de
   réouverture, `claimNextQueued`/`claimNextResponseReady`, transitions
   CAS-gardées, `recoverAfterRestart`, acquisition de l'exclusivité à
   l'ouverture — pas de fichier séparé, voir § Fichiers d'implémentation).
2. `generate-response.ts`/`send-response.ts` (remplacent
   `execute-message-event.ts`) + `durable-message-worker.ts` (remplace
   `local-message-queue.ts`/`in-memory-deduplicator.ts`, retirés).
3. Câblage dans `main.ts`/`server.ts`, erreur de stockage pendant
   l'admission mappée en 503 explicite, jamais un 200.
4. Les huit tests d'acceptation ci-dessus — suite complète verte (voir le
   rapport d'intégration pour le détail d'exécution).

Explicitement **hors** de cette tranche minimale, non implémenté : purge/
rétention **programmée** (le modèle — § Données et rétention — est défini,
son exécution périodique reste une tâche manuelle documentée pour l'instant),
toute UI ou CLI de révision des `uncertain`, tout support multi-process.

## Hors périmètre

- Tout appel réseau réel, tout secret réel, tout branchement Meta ou LLM
  réel — inchangé par rapport à ADR-0022.
- Support multi-process ou multi-machine du store.
- Chiffrement au repos.
- Interface de révision manuelle des issues `uncertain`/`failed`.
- Mise à jour de `README.md`/`MASTER_ROADMAP.md`/`MASTER_BACKLOG.md`/
  `PROJECT_STATE.md` — déjà signalés comme désynchronisés avec le travail
  WhatsApp existant (ADR-0022 et ses commits) dans un diagnostic précédent ;
  leur mise à jour reste une mission séparée, non entamée ici.

## Alternatives considérées

- **Store JSON (patron `FileStore` déjà utilisé trois fois dans ce
  dépôt)** — non retenu pour cette décision à la demande explicite du
  périmètre (« aucun comparatif supplémentaire avec JSON nécessaire ») ;
  resterait un choix défendable si `node:sqlite` s'avérait incompatible
  avec l'environnement de déploiement réel (voir § Compatibilité).
- **Lease/fencing token pour un modèle multi-worker** — rejeté pour cette
  tranche : un jeton seul ne protège pas contre un effet externe déjà
  produit par un worker obsolète (envoi réseau réel). Un seul worker
  exclusif est la garantie la plus simple qui tienne réellement à ce stade.
- **Rouvrir aussi les lignes `uncertain` sur redélivraison** — rejeté :
  risquerait un double envoi si le message a en réalité été délivré ; seule
  une décision explicite, hors politique automatique, doit lever cette
  ambiguïté.

## Décisions nécessaires

1. ~~Fixer `engines.node`~~ **fait** : `apps/whatsapp-channel/package.json`
   porte désormais `engines.node: ">=24.20.0"`, cohérent avec la CI
   (`node-version: '24'`). Reste ouvert : un `.nvmrc` racine, pas ajouté ici
   (porterait sur tout le monorepo, hors périmètre de cette tranche).
2. `maxActiveDepth`/`maxStoredMessages`/`maxAdmissionAttempts` (défauts
   codés : 50/5000/5) et les délais de rétention du contenu (§ Données et
   rétention, non implémentés dans cette tranche — purge non programmée) —
   valeurs par défaut à valider, pas encore actées comme politique de
   production.
3. **Tranché par la revue de cette tranche** (voir § Corrections appliquées
   avant implémentation) : une admission sur une ligne `failed` avec un
   texte **différent** est désormais détectée (`contentMismatch`) et
   journalisée, sans jamais écraser le texte d'origine. Reste ouvert : faut-il
   un jour **rejeter** explicitement (plutôt qu'admettre avec juste un
   signalement) une admission dont le contenu diverge ? Non tranché.
4. Qui valide/ferme manuellement une ligne `uncertain` dans l'attente d'une
   interface de révision (hors périmètre de cette tranche) — procédure
   manuelle à documenter séparément.
5. Statut final de cette ADR (`Proposed` → `Accepted`) — à faire évoluer
   après revue, comme ADR-0022 reste lui-même `Proposed`. L'implémentation
   existe et sa suite de tests est verte (voir le rapport d'intégration),
   mais cela ne vaut pas acceptation architecturale actée par ce document.

## Corrections apportées lors de la revue finale (avant commit)

Une relecture ciblée, après l'implémentation initiale, a trouvé et corrigé
six défauts concrets — aucun n'était visible sans relire le code à la
lumière des garanties exactes promises :

1. **Bug de réouverture : la réponse déjà générée n'était jamais réutilisée.**
   `admit()` rouvrait systématiquement vers `queued` (régénération), même
   pour un échec d'**envoi** où `response_text` était déjà disponible.
   Corrigé : la cible de réouverture dépend de `response_text` — `NULL` →
   `queued` (régénération nécessaire), sinon → `response_ready` (réponse
   réutilisée telle quelle, service conversationnel jamais rappelé). Voir
   § Corrections appliquées avant implémentation (point 1) pour la
   politique complète, et `durable-message-worker.test.ts` pour les tests
   de comptage d'appels qui l'auraient détecté.
2. **Sémantique d'`attempts` déplacée** de la réclamation (`claimNextQueued`)
   vers la réouverture elle-même — sans ce déplacement, un échec d'envoi
   répété (qui ne repasse jamais par `claimNextQueued`) n'aurait **jamais**
   atteint `maxAdmissionAttempts`, permettant une boucle de réouvertures
   illimitée pour un rejet permanent du fournisseur. `attempts` compte
   désormais les réouvertures, pas les réclamations — voir
   `message-store.ts` § politique de réouverture.
3. **Verrou SQLite relâché pendant un envoi potentiellement en vol.**
   `main.ts` fermait systématiquement le store après le délai de fermeture,
   même quand `worker.close()` rapportait du travail encore actif. Corrigé :
   le store n'est **jamais** fermé explicitement dans ce cas — seule la
   terminaison du process (`process.exit(1)`) libère le verrou, de façon
   atomique, sans fenêtre où un second process pourrait reprendre le même
   travail. Voir `main.ts` et le test dédié dans
   `durable-message-worker.test.ts` qui reproduit cet invariant sans
   dépendre de `main.ts` lui-même.
4. **Base corrompue classée comme un problème d'exclusivité.** L'ouverture
   distinguait seulement « échec » de « succès » ; un fichier corrompu
   recevait la même `ExclusivityError` qu'un verrou déjà détenu — message
   trompeur. Corrigé : distinction par code SQLite (`errcode` 5/6 = verrou,
   11/26 = corruption/format invalide) → `ExclusivityError` ou
   `CorruptStoreError` selon le cas réel, jamais une classification
   optimiste.
5. **Aucune limite de taille sur le texte/la réponse stockés.** Un nombre
   de lignes borné (`maxStoredMessages`) ne borne pas, seul, le volume
   disque. Ajouté : `MAX_TEXT_LENGTH_CHARS`/`MAX_RESPONSE_TEXT_LENGTH_CHARS`
   (choix applicatifs locaux, pas une limite Meta), appliqués en rejet
   explicite (`admit()`/worker) **et** en contrainte `CHECK` SQL (filet de
   sécurité).
6. **Purge manuelle implémentée, avec un bug corrigé par son propre test.**
   `MessageStore.purgeRetainedContent()` + script
   `purge-retained-content.ts` (dry-run par défaut). Premier jet défectueux :
   la purge de contenu réécrivait `updated_at`, remettant à zéro l'âge de la
   ligne et l'empêchant indéfiniment d'atteindre le seuil de suppression
   complète — détecté immédiatement par le test dédié, corrigé en ne
   touchant plus jamais `updated_at` lors de l'effacement de contenu.

Point déjà correct, vérifié mais non modifié : la distinction `failed`
(démontré sans envoi) / `uncertain` (ambigu) à l'envoi était déjà bonne —
confirmée par de nouveaux tests de comptage d'appels service/transport sur
relivraison, pas seulement par inspection du code.

`engines.node` resserré de `>=24.0.0` à `>=24.20.0` — voir § Compatibilité,
ne promet plus que ce qui a été effectivement vérifié dans cette session.
