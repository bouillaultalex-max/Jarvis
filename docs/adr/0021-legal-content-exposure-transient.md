# ADR-0021: Content Exposure — contenu juridique transitoire et vérifié

Date: 2026-09-24
Status: Accepted (implémenté dans `@jarvis/legal-research`) — le contenu n'est ni persisté, ni rechargeable, ni un artefact

**Supersède ADR-0011 sur un point précis** : la limitation historique selon laquelle
`RetrievalResult` « ne porte volontairement pas le texte » (le provider le jetait
après calcul du hash). Le reste d'ADR-0011 (séparation Search / Retrieval, ports,
budget) reste en vigueur ; le stockage **durable** du texte, que cet ADR-0011
laissait ouvert, le reste. Complète aussi ADR-0019 (version résolue) et ADR-0020
(citations de niveau source). Implémentation : `research/content-hash.ts`,
`research/retrieved-content.ts`, `retrieval-types.ts`, `legifrance-source-mapping.ts`,
`legifrance-retrieval-adapter.ts`.

## Contexte

Le texte d'un article (`texte`) est téléchargé à chaque récupération (`retrieve` et
`retrieveVersion` passent par le même `fetchArticle`), puis **jeté** par le
mapping après calcul du SHA-256 : un futur ANALYZE n'avait rien à lire.

- **[EXISTANT]** Le hash n'était calculé qu'une fois et jamais recontrôlé : une
  étiquette, pas une garantie d'intégrité.
- **[EXISTANT]** Des tests exigent que `JSON.stringify(ResearchResult)` ne contienne
  aucun texte ; les erreurs ne doivent pas en contenir non plus.
- **[EXISTANT]** Le connecteur ne lit pas `texteHtml`.

## Décision

**1. Stratégie : transitoire, dans le pipeline.** Le texte est capturé pendant l'appel
**existant** et porté par les résultats de récupération. Le rechargement par id et
l'artefact persistant sont différés, sans être empêchés (le contrat ne les exclut pas).
Aucun appel réseau supplémentaire, aucun changement du budget de `ResearchEngine` :
`ResolvedRetrieval.result` référence déjà ces résultats, le contenu suit donc
`initial`, `shared` et `retrieved` sans autre changement.

**2. Où vit le texte.** Champ optionnel `content` de `RetrievalResult` et de
`VersionTargetResult` — pas de `LegalSource`, pas de `LegalCitation`, pas de `LegalCase`.
Identité, provenance et hash restent dans `LegalSource` ; le contenu est un troisième
objet, distinct. `content` est optionnel : un port qui n'expose pas de contenu reste
valide ; l'adaptateur Légifrance le fournit toujours.

**3. `RetrievedContent` : opaque, vérifié par construction, rédigé.**

- Constructeur privé ; seule voie : `RetrievedContent.verified(texte, hashAttendu)`, qui
  refuse tout hash différent ou absent (`ContentIntegrityError`, structurée, ne
  contenant que des hash).
- Le texte (`#text`) n'est lisible que par `revealText()`. Aucune propriété énumérable :
  absent de `JSON.stringify`, du spread, de `Object.keys`, de `structuredClone` ;
  `toJSON`, `toString` et `util.inspect` rendent un marqueur (`{ redacted: true, contentHash }`).
- Conséquence : les garanties d'absence de texte dans les sérialisations restent vraies
  sans exception, et un contenu en mémoire reste **explicite**.

**4. Contrat de hash normatif** (`computeContentHash`, `verifyContentHash`, fonctions
pures uniques) : **SHA-256 des octets UTF-8 du champ `texte` exactement tel que reçu**,
hexadécimal minuscule. Aucune normalisation : ni `trim`, ni Unicode (NFC), ni espaces,
ni fins de ligne. Le mapping utilise cette fonction ; plus aucun autre calcul.

**5. Intégrité : échec dur.** Le mapping construit le contenu contre le hash qu'il
déclare ; l'adaptateur **recontrôle** que `hash(texte) === source.contentHash` avant
d'exposer quoi que ce soit — un fournisseur incohérent, ou une source sans hash, est
refusé. Traduction : `ResearchProviderError` `malformed_response` (raison existante ;
pas de nouvelle raison). Aucun contenu n'est jamais présenté comme vérifié sans l'être.

**6. Texte vide ou nul : comportement conservé.** `null`, `""` ou espaces seuls →
`missing_required_field` → `malformed_response`. Pas de statut `NO_CONTENT`.

**7. Rétention.** Pendant l'exécution, chaque résultat de récupération garde son
contenu (initial, partagé, version cible). Un contenu de source non applicable peut
exister transitoirement, mais n'est jamais persisté : la projection et le rattachement
au dossier n'utilisent que `source`, jamais `content`.

**8. Frontières.** Le contrat appartient à `legal-research`. `legal-core` n'est pas
modifié (aucune fonction, aucun champ). Le connecteur reste responsable de la copie
technique de `texte` ; le provider et l'adaptateur portent la sémantique et
l'intégrité.

## Alternatives écartées

- **Texte comme chaîne simple sur les résultats** : `JSON.stringify(ResearchResult)`
  contiendrait le texte de tous les candidats ; les garanties de test tomberaient.
- **Texte dans `LegalSource`** : persisté en clair par `serializeLegalCaseFile`.
- **Rechargement (B) ou artefact (C) maintenant** : un appel réseau par accès hors du
  budget, ou un stockage sans chiffrement ; hors périmètre validé.
- **Nouvelle raison d'erreur ou statut `NO_CONTENT`** : les raisons existantes suffisent.
- **Vérification seulement au calcul** : tautologique ; le recontrôle à l'exposition
  est la garantie.

## Conséquences

- Le test qui affirmait `not.toHaveProperty('content')` sur `RetrievalResult` a été adapté :
  il affirme désormais que `content` existe mais est opaque et rédigé.
- `MapLegifranceArticleResult` gagne un champ `content` (obligatoire) : tout
  `LegalSourceProvider` doit le fournir.
- Un `RetrievedContent` est cohérent avec le hash qui lui a été donné à la
  construction ; **le lien avec `source.contentHash` d'un autre port n'est pas imposé
  par le type** : l'adaptateur Légifrance le contrôle, les futurs ports devront le faire.

## Limites — hors de ce bloc

- **Aucune persistance, aucun rechargement, aucun artefact, aucun chiffrement.** Le
  contenu disparaît avec les résultats.
- **`texte` seul.** `texteHtml` n'est pas exposé (connecteur inchangé). Le format réel
  de `texte` (HTML éventuel, entités, fins de ligne) n'a jamais été observé : la
  stabilité du hash d'un rechargement reste **non vérifiée**.
- **Un article au texte vide n'est toujours pas récupérable.**
- L'algorithme n'est pas inscrit dans la valeur du hash.
- Comparaison d'un `quotedText` (exacte ou normalisée), citations de passage, VERIFY,
  ANALYZE, `AgentLoop` : hors périmètre. Si un Tool Légifrance était un jour branché à
  l'`AgentLoop`, sa sortie brute (`JSON.stringify`) porterait le texte vers le modèle :
  ce chemin est indépendant de ce bloc.
