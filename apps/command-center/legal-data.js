// Données et descriptions pour la section « Legal Core ». Les descriptions
// de capacités reflètent ce qui existe réellement dans le dépôt (vérifié
// avant d'écrire ce fichier) ; les résultats de recherche et le dossier
// présentés dans l'interface sont fictifs — démonstration uniquement,
// aucune consultation Légifrance réelle, aucun appel à un modèle de langage.

export const LEGAL_CAPABILITIES = [
  {
    title: 'Modèle de dossier (Fait / Provenance / Preuve / Temporalité)',
    status: 'non-raccorde',
    description:
      "@jarvis/legal-core implémente le modèle LegalCase v3 (faits typés, provenance human/tool/deterministic/llm, intervalles temporels à précision explicite). Aucune API ne l'expose à ce navigateur.",
  },
  {
    title: 'Moteur de dossier',
    status: 'non-raccorde',
    description:
      "@jarvis/legal-case-engine applique des opérations atomiques (ajout de question ouverte, enregistrement d'un fait rapporté) sur un LegalCase en mémoire. Utilisable aujourd'hui en code, pas depuis cette interface.",
  },
  {
    title: 'Stockage de dossiers',
    status: 'non-raccorde',
    description:
      "@jarvis/legal-case-store définit un format de fichier pour persister un dossier. Le format existe ; aucun dossier réel n'est actuellement stocké ni lu par cette interface.",
  },
  {
    title: 'Recherche Légifrance',
    status: 'non-raccorde',
    description:
      "@jarvis/legal-research traduit une requête structurée vers l'outil legifrance.search ; @jarvis/legifrance-client sait parler au vrai service (OAuth + HTTP). Les deux nécessitent des identifiants réels et ne sont jamais appelés par cette interface.",
  },
  {
    title: 'Résolution temporelle de version',
    status: 'non-raccorde',
    description:
      "Le résolveur de version (@jarvis/legal-research) détermine quelle version d'un texte semble applicable à une date, et distingue explicitement les cas sans version applicable ou indéterminés. Logique réelle, non branchée ici.",
  },
  {
    title: "Historique et consultation de dossiers dans l'interface",
    status: 'prevu',
    description:
      "Aucune interface de consultation de dossiers n'existe aujourd'hui, dans le code ou ailleurs.",
  },
  {
    title: "Identité d'un document (LegalDocument)",
    status: 'non-raccorde',
    description:
      "@jarvis/legal-core modélise un document versé au dossier (titre, empreinte de contenu, provenance), mais ne stocke ni ne lit jamais son contenu. Aucune étape d'ingestion n'existe dans le dépôt.",
  },
  {
    title: 'Extraction et vérification de contenu (PDF / DOCX / TXT)',
    status: 'prevu',
    description:
      "Aucune bibliothèque d'extraction, d'OCR ou d'analyse de fichier n'est présente dans le dépôt, pour aucun format.",
  },
  {
    title: 'Analyse juridique avec références aux passages sources',
    status: 'prevu',
    description:
      "Suppose une extraction de contenu fonctionnelle, qui n'existe pas encore — ne peut donc pas exister elle-même aujourd'hui.",
  },
  {
    title: 'Sélection locale de documents (cette interface)',
    status: 'fonctionnel',
    description:
      'Choix de fichiers et glisser-déposer, contrôle du format/nombre/taille, retrait et remise à zéro — entièrement local au navigateur, sans lecture de contenu.',
  },
  {
    title: 'Extraction de texte PDF locale (cette interface)',
    status: 'fonctionnel',
    description:
      "Pour un PDF contenant du texte : extraction locale dans le navigateur (pdf.js), au clic uniquement, sans réseau, sans OCR, sans analyse. Limitée à 50 pages et 200 000 caractères par document. DOCX/TXT non traités. Le texte obtenu n'est pas vérifié.",
  },
  {
    title: "Repérage déterministe d'éléments (cette interface)",
    status: 'fonctionnel',
    description:
      "Sur le texte déjà extrait : repérage par règles (expressions régulières) de dates, montants et références d'articles explicitement écrits, avec page et extrait exact. Aucune identification de partie/personne/organisation (aucune règle assez précise). Ni vérifié ni interprété juridiquement.",
  },
];

// Formats proposés à la sélection — ne préjuge pas d'une capacité
// d'extraction réelle. Seul le PDF (texte) est traité (voir
// LEGAL_CAPABILITIES ci-dessus) ; DOCX/TXT restent non raccordés.
export const LEGAL_DOCUMENT_ACCEPTED_FORMATS = ['pdf', 'docx', 'txt'];
export const LEGAL_DOCUMENT_MAX_FILES = 5;
export const LEGAL_DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo

// Limites centralisées de l'extraction PDF — une seule source de vérité,
// jamais de résultat tronqué présenté comme complet sans le signaler.
export const PDF_EXTRACTION_MAX_PAGES = 50;
export const PDF_EXTRACTION_MAX_CHARS = 200_000;

// Repérage déterministe : borne explicite sur le nombre d'occurrences
// gardées par type — jamais un dépassement silencieux.
export const DETECTION_MAX_OCCURRENCES_PER_TYPE = 200;

export const LEGAL_DOCUMENT_NEXT_STEPS = [
  {
    step: 1,
    title: 'Sélectionner les documents',
    status: 'fonctionnel',
    description: 'Réalisé — sélection locale uniquement, aucune lecture de contenu.',
  },
  {
    step: 2,
    title: 'Extraire le texte (PDF texte uniquement)',
    status: 'fonctionnel',
    description:
      'Réalisé pour le PDF contenant du texte — extraction locale au clic, sans OCR. DOCX/TXT non traités. Texte non vérifié.',
  },
  {
    step: 3,
    title: 'Analyser juridiquement avec références aux passages sources',
    status: 'non-raccorde',
    description: "Non raccordé — suppose une vérification du texte extrait, qui n'existe pas.",
  },
];

// Trois résultats fictifs couvrant les trois issues réelles de la résolution
// de version : applicable, indéterminée, sans version trouvée — plus un
// résultat partiel. Aucun de ces résultats ne correspond à une consultation
// réelle de Légifrance.
export const LEGAL_DEMO_RESULTS = [
  {
    id: 'legal-demo-1',
    reference: 'Exemple de démonstration — Code civil, art. 1240',
    title: 'Responsabilité du fait personnel (exemple pédagogique)',
    versionStatus: 'applicable',
    versionNote:
      'Version jugée applicable à la date de référence choisie, dans ce jeu de démonstration uniquement.',
    source: 'Non consulté — démonstration locale, aucune donnée issue de Légifrance.',
    limits:
      "Aucune vérification d'exactitude juridique n'a été faite. Ce texte ne doit pas être utilisé comme référence réelle.",
  },
  {
    id: 'legal-demo-2',
    reference: 'Exemple de démonstration — Code du travail, art. L1234-5',
    title: "Illustration d'un cas de version indéterminée",
    versionStatus: 'indeterminee',
    versionNote:
      'Dans ce jeu de démonstration, plusieurs versions se chevauchent à la date choisie : la résolution reste indéterminée plutôt que de deviner.',
    source: 'Non consulté — démonstration locale, aucune donnée issue de Légifrance.',
    limits:
      "Une version indéterminée n'est jamais une absence de droit applicable — seulement une absence de certitude dans cette démonstration.",
  },
  {
    id: 'legal-demo-3',
    reference: 'Exemple de démonstration — Code de la consommation, art. L221-18',
    title: "Illustration d'un résultat partiel",
    versionStatus: 'aucune',
    versionNote:
      'Aucune version applicable trouvée à la date choisie, dans ce jeu de démonstration.',
    source: 'Non consulté — démonstration locale, aucune donnée issue de Légifrance.',
    limits:
      "Résultat partiel : un fondement additionnel attendu n'a pas été inclus dans ce jeu de démonstration.",
    partial: true,
  },
];

export const VERSION_STATUS_LABELS = {
  applicable: 'Version jugée applicable (démonstration)',
  indeterminee: 'Version indéterminée (démonstration)',
  aucune: 'Aucune version trouvée (démonstration)',
};

// Dossier fictif adapté à la forme réelle de LegalCase (étapes du workflow,
// questions ouvertes, faits avec provenance et temporalité) — aucun dossier
// réel n'existe aujourd'hui dans le dépôt.
export const LEGAL_DEMO_CASE = {
  id: 'dossier-demo-1',
  title: 'Dossier fictif de démonstration — litige de voisinage',
  status: 'RESEARCH',
  openQuestions: [
    {
      id: 'q1',
      question: 'Le trouble allégué est-il anormal au sens de la jurisprudence ?',
      status: 'open',
    },
    {
      id: 'q2',
      question: 'Le délai de prescription court-il depuis la première constatation ?',
      status: 'answered',
    },
  ],
  facts: [
    {
      id: 'f1',
      summary:
        'Le voisin a signalé des nuisances sonores répétées depuis mars 2026 (fait rapporté, non vérifié).',
      provenanceOrigin: 'human',
      temporal: { kind: 'point', precision: 'month', value: '2026-03' },
    },
    {
      id: 'f2',
      summary: "Un constat d'huissier fictif daterait du 14 au 21 avril 2026 (exemple).",
      provenanceOrigin: 'tool',
      temporal: { kind: 'interval', start: '2026-04-14', end: '2026-04-21' },
    },
    {
      id: 'f3',
      summary: 'Date exacte du premier échange amiable non précisée dans ce jeu de données.',
      provenanceOrigin: 'human',
      temporal: { kind: 'unknown' },
    },
  ],
};

export const LEGAL_PROVENANCE_LABELS = {
  human: 'Rapporté par une personne',
  tool: 'Produit par un outil',
  deterministic: 'Calcul déterministe',
  llm: 'Proposé par un modèle de langage',
};
