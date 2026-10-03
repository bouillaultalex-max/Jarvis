# ADR-0022: Frontière d'un canal conversationnel (prototype WhatsApp)

Date: 2026-10-03
Status: Proposed

## Context

Étude de faisabilité WhatsApp (non versionnée, conversation précédente) :
viabilité « sous conditions », au moins un point de protocole non vérifiable
en source primaire dans cette session (forme exacte du payload webhook
message/statut — voir Conséquences). Aucun code de canal n'existe
aujourd'hui dans le dépôt. `apps/api` (`POST /chat`, ADR-0008) reste
strictement loopback, sans session de conversation, et n'expose qu'un outil
factice interne (ADR-0009) — cette décision ne le modifie pas et ne le
branche à rien.

`packages/core` (`AgentLoop`) ne doit jamais connaître un fournisseur
concret (ADR-0001). Un canal WhatsApp ne doit donc pas non plus connaître
`AgentLoop` directement : coupler le canal au moteur conversationnel
empêcherait de réutiliser la même frontière pour Telegram ou tout autre
canal sans dupliquer la logique de validation/dédoublonnage/autorisation.

## Decision

Le canal est un **orchestrateur générique**, indépendant du fournisseur
(WhatsApp/Telegram/…) et du moteur conversationnel, construit autour de
quatre frontières (ports), chacune injectée :

1. **Vérification d'origine** — un événement brut (octets + en-têtes) est
   validé _avant_ tout parsing JSON. La signature (HMAC) se calcule sur les
   octets bruts reçus, jamais sur une resérialisation de l'objet parsé —
   toute resérialisation change la représentation en octets et invaliderait
   silencieusement une vérification correcte.
2. **Identité autorisée** — un port `SenderAllowlist` distinct du
   `PermissionManager` existant : il statue sur _qui parle au canal_, pas
   sur quel outil/action est permis. Les deux restent composés, jamais
   fusionnés — un expéditeur autorisé au niveau canal repasse ensuite par
   les permissions normales de Jarvis pour toute action.
3. **Déduplication** — un identifiant d'événement (fourni par le
   fournisseur) est vu au plus une fois. Le contrôle doit être atomique vis-
   à-vis de deux livraisons concurrentes du même identifiant.
4. **Service conversationnel injecté** — une interface minimale
   (`senderId`, `text`) → réponse texte ou erreur structurée. Le canal
   n'importe ni `AgentLoop` ni aucun type de `@jarvis/core` : n'importe quel
   objet satisfaisant ce contrat convient, y compris un double de test
   aujourd'hui, `AgentLoop` plus tard via un adaptateur écrit ailleurs.
5. **Transport de sortie injecté** — la réponse est envoyée via un port
   `send(recipientId, text)`. Aucun appel réseau réel dans ce canal ou ses
   tests ; l'implémentation réelle (Graph API WhatsApp) est hors périmètre
   de cette décision.

Le parsing spécifique à un fournisseur (forme exacte du JSON WhatsApp,
distinction message/statut/type non supporté, handshake GET) vit dans un
**adaptateur dédié**, seul endroit qui connaît la forme des payloads
WhatsApp. Le cœur d'orchestration (dédup → allowlist → service → transport)
ne connaît que des événements déjà normalisés (`ChannelEvent`) et est
réutilisable tel quel pour un futur canal Telegram.

Aucune confirmation « OUI/NON » n'est traitée par cette décision — liaison
à une action précise différée (cf. Hors périmètre).

## Hors périmètre

- Tout appel réseau réel, tout secret réel, tout déploiement, toute
  exposition publique d'`apps/api` ou d'un nouveau service.
- Branchement à `AgentLoop`/`ToolExecutor` réel — le service conversationnel
  reste un double dans ce prototype.
- Traduction d'une confirmation `ConfirmationService`/ADR-0008 en échange
  conversationnel (« répondez OUI ») — nécessite une conception séparée
  (liaison fingerprint ↔ réponse libre, gestion du TTL de 5 min par défaut
  dans un contexte de chat asynchrone).
- Persistance de la déduplication/session au-delà du process courant.
- Détermination définitive de l'éligibilité légale/contractuelle
  (cf. étude de faisabilité précédente, point non tranché).

## Conséquences

Positives : la frontière reste testable sans aucun réseau ni secret ; un
futur canal Telegram réutilise l'orchestrateur générique sans dupliquer
dédup/allowlist ; `packages/core` n'est jamais importé, aucune violation
possible des frontières ADR-0001.

Négatives / limites assumées : l'enveloppe `entry[].changes[].value`, un
message texte (`messages[].{id,from,timestamp,type,text.body}`) et un
statut (`statuses[].id`) ont été revérifiés par fetch direct en revue
ciblée (`developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`).
Le champ `group_id` distinguant un message de groupe reste à confiance
raisonnable, non à citation verbatim vérifiée. Aucun exemple officiel d'un
événement à plusieurs messages ni d'un type non supporté n'a été vu
explicitement — couverts par construction (tableau `messages`, branche
`type !== 'text'` par défaut), pas par un exemple cité. Détail complet et
sources exactes : `prototypes/whatsapp-channel/README.md`. Toute
divergence réelle ne casserait que l'adaptateur WhatsApp, jamais
l'orchestrateur générique ni les autres ports.

La politique de déduplication n'est pas « exactement une fois » : seule
l'issue `replied` bloque définitivement un identifiant ; toute autre issue
(refus, échec service, échec transport) le libère pour une relivraison
traitée comme un essai neuf — voir `channel-processor.ts` et
`channel-ports.ts` pour le détail et la justification. Une réponse
réellement envoyée dont l'accusé de réception serait perdu (ex. crash
juste après un envoi réussi) reste une ambiguïté non résolue par ce
prototype, assumée explicitement plutôt que masquée.

## Alternatives considérées

- **Appeler `AgentLoop` directement depuis le canal** — rejeté : recrée un
  couplage fournisseur↔moteur que `packages/core` interdit déjà par
  construction (ADR-0001) et empêcherait tout second canal sans dupliquer
  la logique.
- **Fusionner `SenderAllowlist` et `PermissionManager`** — rejeté : ce sont
  deux questions différentes (qui parle au canal vs. quelle action un
  message autorise) ; les fusionner romprait la séparation déjà actée par
  ADR-0005/0006 entre identité et permission d'outil.
- **Package npm dédié (`packages/channels`)** — différé : prématuré avant
  un second canal réel et une décision d'intégration à `apps/api`/une
  nouvelle app ; ce prototype vit dans `prototypes/`, hors graphe de
  workspaces (même convention que `prototypes/situation-poc`), sans
  `package.json`, non couvert par le `tsconfig.json` racine.
