# Frontières conceptuelles — le « Résultat vérifié »

Date : 2026-09-15. Document **conceptuel et documentaire uniquement**. Il ne
modifie aucun code, aucune ADR existante, aucun contrat de production. Il
prolonge [`docs/action-transition-boundaries.md`](./action-transition-boundaries.md)
sur son dernier maillon, resté délibérément non défini : « Résultat vérifié ».

**Convention de lecture** : chaque affirmation de ce document est étiquetée
explicitement —
**[démontré]** = observé directement dans le code inspecté (fichier:ligne cité) ;
**[absent]** = recherché et non trouvé dans le dépôt ;
**[possible en théorie]** = techniquement réalisable avec les briques
existantes, mais jamais assemblé ni exercé par le code actuel ;
**[proposition conceptuelle]** = idée de ce document, ne décrivant rien
d'existant.

## Addendum (2026-10-21) — ce qui a changé depuis la rédaction

Depuis cette étude (2026-09-15), une implémentation **opt-in et de portée
étroite** du modèle conceptuel de la section 8 existe : `runWithVerification`
(`packages/core/src/verification.ts`), un vérificateur concret pour
`inmemory.send` (`packages/connectors/src/in-memory/in-memory-send-verification.ts`)
et une démonstration CLI, `apps/desktop verify-demo` (commits `64702a2`,
`748b7a0`, `f463033`, `f474cd8`, `5478144` — détail et statut de publication :
`PROJECT_STATE.md` → « Vérification de postcondition (opt-in) »). Ce qui ne
change **pas** : `ToolExecutor`, `PermissionManager`, `ConfirmationService` et
`AgentLoop` restent non modifiés (conforme à la section 10 ci-dessous) ;
`gmail.send` reste **sans aucune vérification** ; `AgentLoop` et `apps/api`
n'appellent toujours jamais ce mécanisme. Les affirmations devenues fausses
par cette implémentation sont corrigées ponctuellement ci-dessous, avec
l'étiquette **[implémenté depuis]** ; le reste du document (sections 1 à 10,
y compris le modèle proposé en section 8) reste la lecture conceptuelle de
référence et n'est pas modifié.

## 1. Contexte et objectif

`docs/action-transition-boundaries.md` établit la chaîne : Situation
comprise → Action candidate → Demande d'action → Permission évaluée →
(Action autorisée immédiatement | Action nécessitant confirmation) → Action
confirmée → Action exécutée → **Résultat vérifié**. Ce dernier maillon y est
identifié comme une lacune conceptuelle et technique, sans être étudié plus
avant. Ce document comble cette étude, sans implémenter quoi que ce soit :
il clarifie ce que « exécuté » signifie réellement aujourd'hui, ce qu'un
résultat renvoyé prouve ou ne prouve pas, et ce que « vérifié » pourrait
signifier sans jamais être confondu avec « n'a pas levé d'exception ».

## 2. Définitions factuelles issues du code

### 2.1 Que signifie « action exécutée » ?

**[démontré]** `ToolExecutionResult` est une union de 6 statuts mutuellement
exclusifs (`packages/core/src/tool-executor.ts:66-72`) :
`executed` / `unknown_tool` / `invalid_input` / `error` / `denied` /
`awaiting_confirmation`. Le statut `executed` est produit exactement ici
(`tool-executor.ts:138-140`) :

```
const output = await tool.execute(validation.value);
return { status: 'executed', decision, output };
```

**[démontré]** « Exécuté » signifie **uniquement** : la promesse renvoyée
par `tool.execute()` s'est résolue sans lever d'exception. Rien de plus.
Une exception transforme le statut en `error` (`tool-executor.ts:141-146`,
commentaire explicite : « erreur _technique_ de l'outil — jamais confondue
avec un refus de permission »).

**[démontré]** Il existe bien une distinction entre trois notions, mais pas
celles que « résultat vérifié » suggérerait :

- _appel accepté_ : la permission a résolu `allow`, ou une confirmation a
  été vérifiée (`PermissionDecision`, `ConfirmationVerifyResult`) ;
- _appel exécuté_ : `tool.execute()` a été invoqué et a résolu ;
- _opération réellement réussie (métier)_ : **absente**. Il n'existe aucun
  statut, aucun champ, aucune fonction qui évalue si l'effet visé a
  réellement eu lieu au-delà de « la promesse ne s'est pas rejetée ».

### 2.2 Que signifie « résultat retourné par l'outil » ?

**[démontré]** `ToolExecuted<TOutput>.output` est **exactement** ce que
`tool.execute()` a résolu (`tool-executor.ts:19-23, 139`) — recopié tel
quel, jamais interprété ni validé une seconde fois par `ToolExecutor`.

**Exemples concrets, contrat par contrat :**

- **`gmail.send`** (`packages/connectors/src/gmail/gmail-connector.ts:242-244`) :
  `execute(input)` fait exactement `return client.sendMessage(input)`.
  `GmailApiClient.sendMessage()` (`gmail-api-client.ts:152-187`) envoie un
  `POST /users/me/messages/send`, et si la réponse HTTP est `ok` et
  contient un `id` de chaîne non vide, renvoie `{id, threadId?}`
  (`:178-186`). **[démontré]** Ce résultat est la preuve que **l'API Gmail
  a accepté la requête et renvoyé un identifiant** — c'est une preuve
  d'_acceptation par l'API_, jamais une preuve de _livraison au
  destinataire_, de _lecture_, ni de _succès métier_ (l'email pourrait
  rebondir de façon asynchrone, une réalité du protocole SMTP externe à ce
  dépôt — **[possible en théorie]**, non observable dans le code inspecté,
  qui ne suit jamais l'état d'un message après son envoi).
- **`internal.fake_execute`** (`apps/api/src/tools/internal-fake-tool.ts:58-62`) :
  en mode `confirm`, `execute()` renvoie **inconditionnellement**
  `{ok: true, mode: input.mode}` — une valeur figée, sans aucune vérification
  d'aucune sorte. **[démontré]** C'est l'exemple le plus net d'un résultat
  « succès » entièrement auto-déclaré, sans preuve externe — délibérément,
  puisque cet outil sert uniquement à valider le protocole HTTP
  (`ADR-0009`), pas à produire un effet réel.
- **`gmail.read`** (`gmail-connector.ts:78-88`) et **`gmail.prepare_reply`**
  (`:156-166`) : actions `read`/`prepare`, sans effet de bord — leur
  « résultat » est directement le contenu lu/dérivé, pas une prétention de
  succès sur un effet externe. Hors du périmètre direct de cette étude
  (qui porte sur la vérification d'un effet, pas sur une lecture), mais
  pertinents en 2.3 et en section 6.10.

**Réponse aux questions posées** : le résultat retourné est une preuve
**d'exécution technique** (la promesse a résolu, avec telle valeur) —
jamais, par construction, une preuve de succès métier. Il peut être
incomplet (`gmail.send` ne dit rien du destinataire), ambigu, ou trompeur
si interprété comme une confirmation d'effet réel.

## 3. Ce que le système garantit actuellement

**[démontré]** :

- Une erreur technique (`tool.execute()` lève) n'est jamais confondue avec
  un refus de permission, une entrée invalide, ou un outil inconnu — 6
  statuts distincts et jamais mélangés (`tool-executor.ts:66-72`).
- `ConfirmAndExecuteResult` distingue un échec de vérification de
  confirmation (`confirmation_failed`) de tout statut de `ToolExecutionResult`
  (`packages/connectors/src/confirmation/confirmation-flow.ts:107-115`).
- Après une confirmation valide, `PermissionManager` est **re-consulté**
  avant l'exécution réelle — une confirmation ne présume jamais du résultat
  ni ne bypass la ré-évaluation (`ADR-0008` §5, confirmé par
  `confirmation-flow.ts:146-155`).
- `apps/api/src/http-mapping.ts` transmet le résultat brut de l'outil sans
  l'enrichir ni le réinterpréter (`mapConfirmAndExecuteResult`, `:106-107` :
  `case 'executed': return { code: 200, body: result.output }`).
- `runGmailSend` (`apps/desktop/src/gmail-send.ts:168-173`) renvoie
  également le résultat brut de `confirmAndExecute()`, sans post-traitement.

## 4. Ce que le système ne garantit pas

**[absent]**, vérifié par recherche exhaustive dans le dépôt (aucune
correspondance) :

- Aucune classe ou mécanisme de journalisation/audit d'exécution
  (`logger`/`audit`/`trace` — recherché dans `packages/` et `apps/`, aucune
  correspondance).
- **[implémenté depuis, portée étroite]** Une vérification post-exécution
  existe désormais, mais uniquement comme capacité de bibliothèque opt-in
  (`runWithVerification`) et pour un seul outil : `inmemory.send` (connecteur
  fictif, démonstration CLI `verify-demo`). **Toujours vrai pour `gmail.send`
  ou tout autre outil réel** : aucune vérification post-exécution,
  automatique ou non, ne les concerne — voir l'addendum en tête de document
  et `PROJECT_STATE.md` → « Vérification de postcondition (opt-in) ».
- Aucune détection de double exécution au niveau de `ToolExecutor.run()`
  lui-même — aucune clé d'idempotence, aucune déduplication (`tool-executor.ts`,
  lu intégralement). La protection contre le rejeu existe **uniquement** au
  niveau du ticket de confirmation (usage unique, `confirmation-service.ts:160-174`)
  — elle ne protège pas contre **deux propositions indépendantes** du même
  appel, chacune confirmée séparément.
- Aucune mention, dans les ADR ou la documentation de suivi, du concept de
  « résultat vérifié », de « vérification du résultat » ou de « lecture
  après écriture » (recherche exhaustive sur `docs/`, `PROJECT_STATE.md`,
  `MASTER_ROADMAP.md`, `MASTER_BACKLOG.md` — aucune occurrence antérieure à
  ce document).
- Aucun `MemoryKind` dédié à un événement d'exécution ou à un résultat
  d'action : `MEMORY_KINDS = ['fact', 'preference', 'decision', 'learning']`
  (`packages/memory/src/memory-entry.ts:12-23`) — observation factuelle,
  pas une proposition d'en ajouter un (hors périmètre, voir section 10).

## 5. Distinction conceptuelle des états

| Notion                              | Statut aujourd'hui                                                                                                                                             | Ce qu'elle prouve                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Action demandée                     | **[absent]** comme concept code (cf. `action-transition-boundaries.md` §2.7)                                                                                   | Rien de structurel — convention documentaire uniquement                                                                             |
| Action autorisée                    | **[démontré]** `PermissionDecision === 'allow'` (`permissions.ts:11`)                                                                                          | La politique ne s'y oppose pas — jamais une preuve d'effet                                                                          |
| Action confirmée                    | **[démontré]** `ConfirmationVerifyResult.ok === true` (`confirmation-service.ts:148-175`)                                                                      | L'appel exact proposé a été approuvé — jamais une preuve d'effet                                                                    |
| Action exécutée                     | **[démontré]** `tool.execute()` a résolu sans lever (`tool-executor.ts:138-140`)                                                                               | La fonction n'a pas levé — rien sur l'effet réel                                                                                    |
| Résultat retourné                   | **[démontré]** `ToolExecuted.output`, valeur brute de `tool.execute()`                                                                                         | Ce que l'outil (ou l'API sous-jacente) déclare — une **prétention**, pas une preuve indépendante                                    |
| Résultat observé                    | **[proposition conceptuelle]**                                                                                                                                 | Un fait externe, constaté après coup (ex. relire la boîte d'envoi), distinct de ce que l'outil a _déclaré_ au moment de l'exécution |
| Résultat vérifié                    | **[proposition conceptuelle]**                                                                                                                                 | Une correspondance établie, par un mécanisme explicite, entre le résultat retourné et un fait vérifiable indépendant                |
| Résultat confirmé par l'utilisateur | **[possible en théorie]**, jamais câblé à un résultat d'exécution — seul un mécanisme analogue existe pour la mémoire (`PendingMemoryConfirmation`, section 7) | Une déclaration humaine, jamais elle-même une preuve technique                                                                      |
| Échec technique                     | **[démontré]** `status: 'error'` (`tool-executor.ts:141-146`)                                                                                                  | La fonction a levé — distinct de tout refus de permission                                                                           |
| Échec métier                        | **[absent]** aucun statut ne le représente                                                                                                                     | Un effet visé non atteint malgré une exécution technique réussie — non représentable aujourd'hui                                    |
| Résultat inconnu ou indéterminé     | **[absent]** aucun statut ne le représente                                                                                                                     | Ni succès ni échec constatable — état aujourd'hui non distingué d'un succès silencieux                                              |

## 6. Cas limites et ambiguïtés

1. **L'outil ne lève aucune exception mais l'objectif métier n'est pas
   atteint** — **[possible en théorie]** pour `gmail.send` : l'API Gmail
   peut accepter un envoi (renvoyer un `id`) pour une adresse qui rebondira
   ensuite de façon asynchrone. Rien dans le code inspecté ne suit cet état
   après l'envoi — non vérifiable dans ce dépôt au-delà de la structure du
   résultat renvoyé (2.2).
2. **L'outil renvoie un succès sans preuve externe** — **[démontré]** :
   `internal.fake_execute` en mode `confirm` (2.2). Cas réel, pas
   hypothétique.
3. **Effet asynchrone** — **[absent]** : aucun outil du dépôt (`gmail.read`,
   `gmail.prepare_reply`, `gmail.send`, `echo`, `internal.fake_execute`)
   n'a d'effet asynchrone au sens d'un résultat qui se matérialiserait après
   le retour de `execute()`. Cas non rencontré, purement théorique ici.
4. **Effet partiel** — **[absent]** : chaque outil actuel effectue un seul
   appel HTTP atomique du point de vue de JARVIS. Aucun outil multi-étapes
   n'existe.
5. **Action exécutée plusieurs fois** — **[démontré]** comme risque
   structurel : aucune déduplication dans `ToolExecutor.run()` (section 4).
   Le ticket de confirmation protège contre le rejeu du **même** ticket
   (`already_consumed`), mais rien n'empêche une deuxième proposition
   indépendante d'aboutir à un deuxième envoi réel si elle est confirmée
   séparément.
6. **L'action échoue après une confirmation valide** — **[démontré]** comme
   cas géré : `confirmAndExecute()` ré-invoque `ToolExecutor.run()`, qui
   peut toujours renvoyer `status: 'error'` si `tool.execute()` lève
   (`confirmation-flow.ts:141-155`). Correctement distingué d'un échec de
   confirmation.
7. **Le résultat semble réussir mais une vérification ultérieure le
   contredit** — **[absent]** : aucun mécanisme de contradiction n'existe,
   puisqu'aucune vérification ultérieure n'existe.
8. **La vérification est impossible** — **[proposition conceptuelle]**,
   mais réaliste : savoir si un destinataire a effectivement lu un email
   n'est, par nature, pas vérifiable par JARVIS. Un futur modèle doit
   traiter « non vérifiable » comme un état légitime et stable, pas comme
   une erreur ni comme un succès par défaut.
9. **L'utilisateur affirme que le résultat est correct sans preuve
   technique** — **[possible en théorie]**, par analogie avec un mécanisme
   _existant mais destiné à un autre objet_ : `PendingMemoryConfirmation`
   (`packages/memory/src/memory-promoter.ts:28-90`) permet à un utilisateur
   de confirmer explicitement **un candidat de mémoire** (`confirm()`/
   `refuse()`). Ce mécanisme ne porte aujourd'hui **jamais** sur un résultat
   d'exécution — l'amalgame entre « confirmer un souvenir » et « confirmer
   qu'une action a réussi » serait une confusion conceptuelle à éviter
   explicitement (voir section 8).
10. **Une action de lecture permet de vérifier une action d'écriture
    précédente** — **[possible en théorie]**, jamais exercé : `gmail.read`
    existe et pourrait, en principe, être invoqué après `gmail.send` pour
    constater la présence du message envoyé. Rien dans `AgentLoop`,
    `ToolExecutor` ou `gmailConnector` ne fait ce lien aujourd'hui — c'est
    une possibilité offerte par les briques existantes, pas une capacité
    implémentée.

## 7. Lien avec la mémoire

**[démontré]** La mémoire n'a aujourd'hui aucune connaissance du concept
d'exécution d'action : `MemoryCandidate`/`MemoryEntry` ne portent aucun
champ lié à un `ToolExecutionResult`, un `confirmationId`, ou un outil
(`packages/memory/src/memory-candidate.ts`, `memory-entry.ts` — lus
intégralement, schémas fermés, aucune clé de ce type acceptée).

**Ce qui pourrait être mémorisable [proposition conceptuelle]** : le _fait_
qu'une action a été demandée, confirmée et exécutée pourrait un jour
alimenter un `MemoryCandidate` de nature `fact` (ex. « un email a été
envoyé à X le 15 septembre ») — mais `MEMORY_KINDS` actuel ne distingue pas
une observation d'exécution d'un fait quelconque rapporté par l'utilisateur
(section 4).

**Une exécution réussie peut-elle être mémorisée directement ?** Réponse
prudente, sans proposer de modification : **non, pas telle quelle**. Une
`ToolExecuted` ne prouve qu'une absence d'exception (section 2.1) — la
promouvoir en `fact` mémorisé durablement reviendrait à transformer une
**prétention** technique en **vérité** mémorisée, exactement le risque que
`ADR-0007` a déjà écarté pour les candidats `llm_proposed` (promotion
conservatrice par défaut, confirmation humaine requise).

**Une absence de vérification doit-elle empêcher toute mémorisation ?**
Pas nécessairement toute mémorisation — mais elle devrait, a minima,
empêcher qu'un résultat non vérifié soit mémorisé avec le même niveau de
certitude qu'un fait constaté. La hiérarchie de `Provenance` déjà existante
(`user_stated` > `user_confirmed` > `email_extracted` > `inferred` >
`llm_proposed`, `packages/memory/src/provenance.ts`) offre déjà un
vocabulaire de degrés de certitude — mais aucun de ses niveaux ne
correspond à « résultat d'exécution non vérifié » ; le plus proche
(`llm_proposed`) sous-entend une proposition du LLM, pas un résultat
d'outil. C'est une question ouverte (section 9), pas résolue ici.

**Comment éviter de transformer une supposition de succès en fait
mémorisé ?** Implication documentée, sans modification proposée : toute
future écriture mémoire dérivée d'un résultat d'exécution devrait passer
par le même mécanisme de confirmation explicite que celui déjà utilisé pour
les candidats `llm_proposed` (`createConservativeMemoryPromotionPolicy`,
`ADR-0007`) — jamais un chemin de promotion automatique parallèle. Ce
document **ne propose aucune modification** de `MemoryPromoter` ni de la
politique de promotion, conformément à la consigne.

## 8. Modèle conceptuel minimal proposé

**[proposition conceptuelle]**, en réponse à la question « statut / objet /
preuve / étape / combinaison » : une **combinaison** de deux éléments
minimaux, pas plus — un simple statut booléen serait insuffisant car il ne
peut pas porter _comment_ la vérification a eu lieu (distinction explicite
exigée), ce qui rendrait un futur `verified: true` aussi peu fiable que
`status: 'executed'` l'est aujourd'hui pour le succès métier.

1. **Résultat retourné** _(déjà existant, inchangé)_ — `ToolExecuted.output`
   tel qu'il est aujourd'hui. Ce document ne propose aucune modification de
   ce contrat.
2. **Tentative de vérification** _(concept nouveau, non implémenté)_ — un
   objet conceptuel distinct, rattachable à un résultat retourné, portant :
   - sa **source** : automatique (ex. relecture via `gmail.read`),
     observée (un fait externe remarqué plus tard), ou confirmée par
     l'utilisateur (une déclaration humaine explicite) — jamais fusionnées ;
   - son **issue** : confirmé / contredit / impossible à déterminer.
3. **Résultat vérifié** _(état, pas un objet séparé)_ — atteint
   **uniquement** lorsqu'une Tentative de vérification existe et conclut
   positivement. En l'absence de toute tentative, le résultat reste
   **« non vérifié »** indéfiniment — un état stable et légitime, jamais
   traité comme une erreur ni comme un succès par défaut.

**Compatibilité explicite avec les frontières déjà actées** :

- Ne recouvre ni ne remplace `PermissionManager` (qui décide _avant_
  l'exécution) ni `ConfirmationService` (qui prouve une approbation
  _avant_ l'exécution) — la vérification se situe strictement _après_.
- Ne devient jamais un `MemoryEntry` ni un `MemoryCandidate` par
  elle-même — elle ne fait, au mieux, que rendre un futur candidat
  _éligible_ à une provenance plus fiable ; la politique de promotion
  (inchangée) reste seule décisionnaire.
- Ne transforme jamais automatiquement une Tentative de vérification en
  nouvelle action — une contradiction constatée ne déclenche aucune
  réaction automatique par ce modèle.
- Ne promet aucune vérification universelle — « impossible à déterminer »
  est une issue de première classe, pas un cas d'erreur.

## 9. Décisions ouvertes

- Faut-il une nouvelle valeur de `Provenance` ou de `MemoryKind` pour un
  résultat d'exécution vérifié — ou le vocabulaire existant suffit-il en le
  réinterprétant ? _(non tranché ici, changerait un contrat de production)_
- Qui déclenche une Tentative de vérification automatique (ex. un
  `gmail.read` après un `gmail.send`) — un mécanisme générique dans
  `ToolExecutor`, une responsabilité par outil, ou une orchestration
  applicative distincte ? _(bloquant avant toute implémentation)_
- Une action jamais vérifiée doit-elle un jour expirer vers un état
  différent de « non vérifié », ou rester indéfiniment dans cet état ?
- Comment distinguer, dans une future confirmation utilisateur d'un
  résultat, une déclaration sincère mais erronée d'une confirmation
  fiable — question laissée ouverte, analogue à celle déjà non résolue par
  `MemoryPromoter` pour un candidat mémoire quelconque.
- Le second appel indépendant (section 6.5, double exécution hors ticket
  unique) doit-il être traité par ce modèle, ou reste-t-il un sujet
  distinct relevant de `ToolExecutor`/`ConfirmationService` ?

## 10. Non-objectifs et limites de l'étude

Ce document :

- ne modifie `AgentLoop`, `ToolExecutor`, `PermissionManager`,
  `ConfirmationService`, `MemoryExtractor`, `MemoryPromoter`, ni aucun
  contrat de production ;
- ne crée aucun type TypeScript, aucun test de code ;
- ne propose pas d'ajouter un `MemoryKind` ni une valeur de `Provenance`
  (mentionnés uniquement comme questions ouvertes, section 9) ;
- n'intègre pas le POC Structured Situation à `AgentLoop` ;
- n'a impliqué aucun appel réseau ni aucun appel LLM pour sa rédaction ;
- ne prétend pas couvrir tous les outils futurs possibles — l'analyse
  s'appuie exclusivement sur les outils réellement présents dans le dépôt
  (`echo`, `internal.fake_execute`, `gmail.read`/`prepare_reply`/`send`) ;
- laisse explicitement ouvertes les questions de la section 9 — ce n'est
  pas une omission, c'est la limite volontaire de ce cadrage.

## 11. Conclusion et recommandation

Le constat central est net et vérifié : **« exécuté » ne signifie, dans le
code actuel, rien de plus que « n'a pas levé d'exception »**
(`tool-executor.ts:138-140`), et le résultat renvoyé par un outil est une
**prétention technique**, jamais une preuve de succès métier — démontré
concrètement par `gmail.send` (preuve d'acceptation API, pas de livraison)
et par `internal.fake_execute` (succès entièrement auto-déclaré).

**[implémenté depuis, portée étroite]** Un mécanisme de vérification
post-exécution existe désormais (`runWithVerification`), mais seulement comme
capacité de bibliothèque opt-in, exercée par une unique démonstration CLI
locale (`apps/desktop verify-demo`) sur un connecteur fictif (`inmemory.send`)
— voir l'addendum en tête de document et `PROJECT_STATE.md`. **Pour
`gmail.send`, pour `AgentLoop` et pour toute application de production, la
lacune décrite ci-dessus reste entière** : aucune vérification, aucune
journalisation, aucun audit. Ce n'est plus une lacune totale du dépôt, mais
c'est toujours la lacune exacte que ce document identifie pour tout usage
réel.

**Recommandation** : traiter le concept de « Résultat vérifié » comme un
prérequis conceptuel — pas encore technique — à documenter et discuter
avant tout branchement futur d'`AgentLoop` vers une action `execute`
pilotée par le LLM, et avant toute génération automatique de
`MemoryCandidate` à partir d'un résultat d'exécution. Cette étude ne
recommande **pas** d'implémenter le modèle proposé en section 8
maintenant — elle recommande de le garder disponible comme référence pour
la prochaine décision d'architecture qui touchera réellement l'exécution
ou la mémorisation de résultats.

**[implémenté depuis, portée étroite]** Le modèle de la section 8 a depuis
été implémenté comme capacité de bibliothèque opt-in (voir addendum), mais
strictement hors du périmètre que cette recommandation visait à retarder :
aucun branchement à `AgentLoop`, à une action `execute` pilotée par le LLM,
ni à une génération automatique de `MemoryCandidate` n'a eu lieu. Cette
recommandation reste donc valide pour ce périmètre précis.
