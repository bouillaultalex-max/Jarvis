/**
 * Interprète, de façon **purement déterministe**, un sous-ensemble
 * volontairement restreint de demandes de lecture Gmail exprimées en
 * langage naturel — prototype expérimental pour VS-02
 * (`docs/second-readonly-vertical-slice.md`), non intégré à `main.ts`,
 * `AgentLoop`, `ToolExecutor` ni `PermissionManager` à ce stade.
 *
 * Garanties structurelles :
 *   - synchrone, sans effet de bord, sans I/O, sans réseau, sans LLM ;
 *   - ne connaît et n'importe ni `ToolExecutor`, ni `PermissionManager`,
 *     ni `ConfirmationService`, ni `AgentLoop` ;
 *   - ne construit jamais un `ToolRequest` exécutable — seulement une
 *     `ReadInterpretation`, dont `proposedRead` décrit un appel possible,
 *     jamais déjà autorisé ni exécuté (voir `action-transition-boundaries.md`) ;
 *   - ne reconnaît qu'un vocabulaire fermé et restreint — toute formulation
 *     hors de ce vocabulaire produit `ambiguous` ou `unsupported`, jamais
 *     une tentative de deviner ;
 *   - ne propose jamais `gmail.send` ni aucun autre outil que `gmail.read`.
 */

/**
 * `understood`   : une lecture précise a pu être déterminée — `proposedRead`
 *                  est renseigné.
 * `ambiguous`     : une intention de lecture est plausible, mais un élément
 *                  nécessaire manque ou est invalide (verbe ou objet non
 *                  identifié, nombre de résultats hors bornes plausibles) —
 *                  `proposedRead` est **toujours** absent.
 * `unsupported`   : la demande sort du périmètre de `gmail.read` (écriture,
 *                  recherche/filtrage, ou tout autre chose) — `proposedRead`
 *                  est **toujours** absent.
 */
export type ReadInterpretationStatus = 'understood' | 'ambiguous' | 'unsupported';

/**
 * Proposition de lecture — **jamais** un `ToolRequest` : aucun champ
 * `execute`/`authorized`/`confirmed`/`permission`/`ticket` ou équivalent.
 * Forme volontairement identique à ce que `runReadFlow` construit déjà
 * (`apps/desktop/src/main.ts:435`), pour rester directement transposable
 * sans réinterprétation ultérieure — mais ce module ne l'exécute jamais.
 */
export interface ProposedGmailRead {
  readonly tool: 'gmail.read';
  readonly input: {
    /**
     * Absent lorsque l'utilisateur n'a exprimé aucune limite — même
     * convention que `parseGmailReadArgs` (`main.ts:690`) : le défaut de
     * `gmail.read` s'applique alors, jamais réécrit ici.
     */
    readonly maxResults?: number;
  };
}

/** Résultat de l'interprétation — jamais un `ToolRequest`, jamais exécutable. */
export interface ReadInterpretation {
  readonly status: ReadInterpretationStatus;
  /** Texte fourni tel quel, non modifié — donnée non fiable, jamais une instruction. */
  readonly originalRequest: string;
  /** Explication lisible par un humain, présente pour les trois statuts. */
  readonly explanation: string;
  /** Renseigné **uniquement** si `status === 'understood'`. */
  readonly proposedRead?: ProposedGmailRead;
}

/**
 * Verbes de lecture reconnus — liste fermée et volontairement courte.
 * `montre` couvre aussi `montre-moi` (correspondance par sous-chaîne).
 */
const READ_VERBS: readonly string[] = ['lis', 'montre', 'affiche', 'consulte'];

/** Objets « email » reconnus — liste fermée et volontairement courte. */
const MAIL_NOUNS: readonly string[] = ['email', 'mail', 'message'];

/**
 * Marqueurs d'une action d'écriture — leur présence exclut toute lecture
 * proposée, quel que soit le reste du texte (`gmail.send` n'existe pas dans
 * ce vocabulaire et ne doit jamais être atteint indirectement).
 */
const WRITE_ACTION_MARKERS: readonly string[] = [
  'reponds',
  'repondre',
  'envoie',
  'envoyer',
  'supprime',
  'supprimer',
  'efface',
  'effacer',
  'archive',
  'archiver',
  'modifie',
  'modifier',
];

/**
 * Marqueurs de recherche/filtrage — `gmail.read` ne supporte que
 * `maxResults` (`gmail-connector.ts:23-25`) : aucun critère de ce type
 * n'existe réellement, donc aucun n'est jamais proposé.
 */
const SEARCH_OR_FILTER_MARKERS: readonly string[] = [
  'trouve',
  'trouver',
  'cherche',
  'chercher',
  'recherche',
  'rechercher',
  'important',
  'urgent',
  'prioritaire',
];

/**
 * Borne haute locale, **dupliquée intentionnellement** depuis
 * `MAX_ALLOWED_RESULTS` (`packages/connectors/src/gmail/gmail-connector.ts`,
 * non exportée) : sert uniquement à éviter de proposer avec confiance
 * (`understood`) un nombre manifestement hors de portée. La validation
 * réelle et faisant autorité reste exclusivement
 * `gmail.read.validateInput()`, jamais court-circuitée ni remplacée par
 * cette valeur — voir `docs/second-readonly-vertical-slice.md` pour la
 * discussion de ce choix.
 */
const MAX_PLAUSIBLE_RESULTS = 50;

/**
 * Normalise le texte pour la reconnaissance : casse, accents (forme NFD +
 * suppression des diacritiques, idiome standard JS, sans dépendance
 * externe), ponctuation terminale, espaces superflus. Ne change jamais le
 * sens du texte, seulement sa forme de comparaison.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(normalized: string, markers: readonly string[]): boolean {
  return markers.some((marker) => normalized.includes(marker));
}

/** Premier nombre entier trouvé dans le texte normalisé, ou `undefined`. */
function extractFirstNumber(normalized: string): number | undefined {
  const match = normalized.match(/\d+/);
  return match === null ? undefined : Number.parseInt(match[0], 10);
}

function understood(
  originalRequest: string,
  explanation: string,
  maxResults?: number,
): ReadInterpretation {
  return {
    status: 'understood',
    originalRequest,
    explanation,
    proposedRead: {
      tool: 'gmail.read',
      input: maxResults === undefined ? {} : { maxResults },
    },
  };
}

function ambiguous(originalRequest: string, explanation: string): ReadInterpretation {
  return { status: 'ambiguous', originalRequest, explanation };
}

function unsupported(originalRequest: string, explanation: string): ReadInterpretation {
  return { status: 'unsupported', originalRequest, explanation };
}

/**
 * Interprète une demande en langage naturel. Ne lève jamais, ne fait aucun
 * appel réseau ni LLM, n'appelle jamais `ToolExecutor` ni aucun mécanisme
 * de permission ou de confirmation.
 */
export function interpretReadRequest(request: string): ReadInterpretation {
  const normalized = normalize(request);

  if (containsAny(normalized, WRITE_ACTION_MARKERS)) {
    return unsupported(
      request,
      'La demande semble inclure une action d’écriture (répondre, supprimer, envoyer…), non prise en charge par cette interprétation.',
    );
  }
  if (containsAny(normalized, SEARCH_OR_FILTER_MARKERS)) {
    return unsupported(
      request,
      'La demande semble inclure une recherche ou un filtre, non pris en charge par gmail.read.',
    );
  }

  const hasVerb = containsAny(normalized, READ_VERBS);
  const hasNoun = containsAny(normalized, MAIL_NOUNS);

  if (hasVerb && hasNoun) {
    const maxResults = extractFirstNumber(normalized);
    if (maxResults === undefined) {
      return understood(request, 'Lecture des emails récents, sans limite explicite.');
    }
    if (maxResults < 1 || maxResults > MAX_PLAUSIBLE_RESULTS) {
      return ambiguous(
        request,
        `Le nombre demandé (${maxResults}) est nul ou hors des bornes plausibles pour gmail.read.`,
      );
    }
    return understood(request, `Lecture des ${maxResults} derniers emails.`, maxResults);
  }

  if (hasNoun) {
    return ambiguous(
      request,
      'Des emails semblent concernés, mais aucune action de lecture reconnue n’a été identifiée.',
    );
  }
  if (hasVerb) {
    return ambiguous(
      request,
      'Une action de lecture semble demandée, mais aucun objet « email » reconnu n’a été identifié.',
    );
  }

  return unsupported(request, 'Aucune demande de lecture d’emails reconnue dans ce texte.');
}
