# ADR-0025 : Appel du lanceur Obsidian Windows depuis WSL (`obsidian.read`)

Date: 2026-11-08
Status: Proposed

## Context

JARVIS tourne sous Ubuntu (WSL). Obsidian Desktop tourne sous Windows et expose une
CLI (`Obsidian.com`) qui n'opère qu'avec l'application ouverte, dans la session de
l'utilisateur. Le pilote `obsidian-cli` (skill Claude Code, PR #9) a validé `vault
info=files`, `search … total` et `read path=…` via `powershell.exe`. Aucun connecteur
ne lançait jusqu'ici de processus local.

Comportements observés le 2026-11-08 (Obsidian ouvert) :

- note présente : contenu brut, octet pour octet, code `0` ;
- note absente : code `0`, stderr vide, stdout `Error: File "<path>" not found.\n` —
  indiscernable, par la seule sortie, d'une note dont ce serait le contenu exact ;
- premier lancement de PowerShell : bloc `#< CLIXML` de progression possible sur
  stderr.

## Decision

1. **Configuration : un seul vault.** `OBSIDIAN_VAULT_ID` (nom ou identifiant passé à
   `vault=`), `OBSIDIAN_VAULT_ROOT` (racine Windows absolue), `OBSIDIAN_CLI_PATH` (chemin
   Windows de `Obsidian.com`), `OBSIDIAN_POWERSHELL_PATH` optionnelle (défaut
   `powershell.exe`). Aucune valeur par défaut pour le vault, aucun chemin dans le
   dépôt. Configuration absente ou mal formée : refus avant tout processus, message
   nommant la variable.
2. **Outil.** `obsidian.read` (`action: 'read'`), seule capacité du connecteur
   `obsidian` (`@jarvis/connectors`), exécuté via `ToolRegistry` → `PermissionManager`
   → `ToolExecutor` comme `gmail.read` (règle explicite `allow` côté desktop ; défaut
   `deny` inchangé). Commande `apps/desktop` : `obsidian-read --vault … --path …`, sans
   dépendance Gmail. `core` n'est pas modifié.
3. **Validation d'entrée** (`validateInput`, avant la permission) : `vault` doit être
   exactement l'identifiant configuré ; `path` relatif, séparateur `/`, extension `.md`,
   sans segment vide, `.` ou `..`, sans `\`, `:` (lecteurs et flux NTFS), caractère
   interdit par Windows ou de contrôle, segment terminé par un point ou une espace, ni
   nom réservé (`CON`, `NUL`, `COM1`…).
4. **Passage par PowerShell.** `execFile` sans shell sur
   `powershell.exe -NoProfile -NonInteractive -NoLogo -EncodedCommand`. Aucune valeur
   n'est insérée telle quelle dans le script : chacune y figure encodée en base64 (alphabet sans guillemet ni
   caractère actif PowerShell), n'est décodée qu'en variable, puis passée au lanceur
   comme argument distinct. Chaque script fixe `$ProgressPreference='SilentlyContinue'`.
   Les décisions reposent uniquement sur des codes de sortie réservés produits par nos
   scripts ; le code du lanceur n'est jamais transmis tel quel ; stderr ne participe à
   aucune décision.
5. **Séquence de `execute`.**
   1. **Contrôle de la racine.** `vault=<id> vault info=path`. Le script vérifie
      d'abord qu'un processus `Obsidian` existe dans la session Windows courante (sinon
      code réservé, lanceur jamais appelé) et que le lanceur existe. La sortie doit être
      un chemin Windows absolu sur une seule ligne, égal à la racine configurée
      (comparaison insensible à la casse, `/` ≡ `\`, séparateur final ignoré). Sortie
      inexploitable : `vault_check_failed` ; autre racine : `vault_mismatch`. Aucune
      lecture dans les deux cas.
   2. **Inspection**, sans lecture de contenu : parcours de la racine segment par
      segment ; tout point d'analyse (lien symbolique, jonction) rencontré sous la
      racine est refusé (`link_in_path`), ce qui garantit que le fichier lu reste sous
      la racine sans résoudre de lien ; dossier à la place de la note refusé ; absence →
      `not_found` sans appeler le lanceur.
   3. **Lecture.** `vault=<id> read path=<path>`, avec le même contrôle de processus.
      Si stdout est exactement le diagnostic « fichier introuvable » de ce chemin,
      nouvelle inspection : absent → `not_found` ; toujours présent →
      `ambiguous_not_found`. Toute autre sortie, y compris un texte commençant par
      `Error:`, est du contenu.
6. **Erreurs.** Codes typés (`obsidian_not_running`, `launcher_not_found`,
   `vault_mismatch`, `vault_check_failed`, `vault_root_unavailable`, `link_in_path`,
   `not_a_file`, `ambiguous_not_found`, `timeout`, `output_too_large`,
   `process_failed`), messages fixes ; jamais la sortie brute du lanceur. La CLI affiche
   le contenu en cas de succès (code `0`), un message JARVIS sinon (code `1`).
7. **Limites.** 10 s par processus PowerShell, arrêt au-delà (`timeout`) ; 1 Mio par
   flux de sortie, dépassement = erreur sans résultat partiel (`output_too_large`) ;
   aucune nouvelle tentative automatique.

## Consequences

- Ne fonctionne que sous WSL avec l'interopérabilité Windows active, dans la session
  interactive de l'utilisateur, Obsidian ouvert. Ailleurs (CI, service sans session) :
  erreur explicite. Les tests automatisés n'utilisent que des doubles et ne lancent
  aucun processus.
- Le connecteur inspecte le système de fichiers Windows (existence, type, points
  d'analyse), sans en lire le contenu ; c'est ce qui lève l'ambiguïté de `not_found`.
- Jusqu'à quatre processus PowerShell par lecture (contrôle de la racine, inspection,
  lecture, seconde inspection éventuelle), de l'ordre de 0,3 à 0,5 s chacun mesurés.
- **Courses résiduelles**, réduites mais non éliminées :
  - Obsidian fermé entre deux scripts : chaque script qui appelle le lanceur refait le
    contrôle de processus ; s'il se ferme entre ce contrôle et l'appel, le lanceur peut
    échouer ou rouvrir l'application ; le délai maximal borne l'attente ;
  - fichier supprimé entre l'inspection et la lecture : diagnostic exact, seconde
    inspection → `not_found` ;
  - fichier créé, modifié ou remplacé par un lien entre l'inspection et la lecture :
    la lecture peut renvoyer un contenu postérieur à l'inspection, ou suivre un lien
    créé dans cet intervalle ; aucun verrou n'est pris sur le vault.
- La vérification d'intégrité par empreintes reste une procédure du pilote, pas de
  l'application.
- Test réel du 2026-11-08 : contrôle de la racine accepté, lecture exacte (code `0`),
  message JARVIS pour une note absente (code `1`), inventaire et empreintes SHA-256 du
  vault identiques à une sauvegarde avant et après chacune des deux commandes. Le
  diagnostic ambigu et Obsidian fermé ne sont couverts que par des tests avec doubles.

## Avenant (2026-11-08) : `obsidian.search`

Statut : `Proposed`, comme le reste de cet ADR.

### Décision

- **Second outil.** `obsidian.search` (`action: 'read'`) rejoint `obsidian.read` dans le
  connecteur `obsidian`, avec une permission distincte (règle explicite `allow` côté
  desktop, défaut `deny` inchangé). Commande `apps/desktop` :
  `obsidian-search --vault … --query …`, sans dépendance Gmail.
- **Réutilisation.** Même configuration de vault unique, même contrôle de la racine par
  `vault info=path` avant la recherche, même passage par PowerShell (valeurs en base64,
  contrôle d'Obsidian ouvert et du lanceur avant l'appel), mêmes limites de durée et de
  sortie.
- **Appel.** `vault=<id> search query=<texte> limit=5 format=json`, sans `total`. La
  limite est fixée dans le code. La requête est un texte d'une ligne, non vide, d'au plus
  200 caractères.
- **Aucune note ouverte.** La recherche renvoie des chemins relatifs, utilisables avec
  `obsidian-read` ; elle n'appelle ni `read`, ni `search:context`, ni l'inspection de
  fichiers, et n'affiche aucun contenu.

### Formats observés (2026-11-08, Obsidian ouvert)

- **Avec résultats** : tableau JSON compact de chaînes sur une seule ligne, suivi d'un
  saut de ligne, code `0`. Chaque chaîne est un chemin relatif au vault, séparateur `/`.
  L'ordre n'est pas alphabétique ; il est conservé tel quel.
- **Sans résultat** : le texte exact `No matches found.\n`, code `0`, **bien que**
  `format=json` soit demandé.

### Interprétation

1. Sortie exactement égale à `No matches found.\n`, ou tableau JSON vide `[]` (accepté
   au cas où une version future l'adopterait) : recherche réussie sans résultat.
2. Sinon, la sortie doit être un tableau JSON d'au plus cinq chaînes. Chaque chemin est
   validé **avant tout filtrage**, avec les règles lexicales de `obsidian.read` hors
   extension ; un chemin invalide ou un doublon rejette toute la sortie.
3. Les chemins valides qui ne sont pas des notes `.md` sont ensuite écartés et comptés.
4. Toute autre sortie (autre texte, autre forme JSON, plus de cinq entrées) est l'erreur
   `search_output_invalid`, avec un message fixe ; la sortie brute n'est jamais
   affichée.

La CLI affiche un chemin Markdown par ligne, dans l'ordre d'Obsidian, puis le nombre de
résultats non Markdown écartés s'il y en a. Code de sortie `0` pour une recherche
réussie, avec ou sans résultat ; `1` sinon.

### Conséquences

- Un `limit=5` atteint ne dit pas s'il existe d'autres résultats ; `total` n'est pas
  appelé.
- La recherche n'inspecte pas chaque chemin sur le disque : l'existence, le type et
  l'absence de lien sont vérifiés au moment de la lecture par `obsidian-read`.
- Une requête coûteuse est interrompue par le délai maximal de 10 s.
