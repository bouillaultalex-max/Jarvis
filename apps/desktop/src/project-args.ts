/**
 * Parsing de `project <sous-commande> ...` — avant tout accès disque,
 * exactement comme `parseLegalSearchArgs`/`parseGmailSendArgs`. Une erreur
 * ici (sous-commande inconnue, arité incorrecte, argument vide) lève une
 * `Error` simple qui remonte jusqu'au gestionnaire générique de `main()` —
 * même convention que les autres sous-commandes de ce fichier.
 */
export type ProjectInput =
  | { readonly op: 'create'; readonly id: string; readonly name: string }
  | { readonly op: 'show'; readonly id: string }
  | { readonly op: 'interview'; readonly id: string }
  | { readonly op: 'add-fact'; readonly id: string; readonly text: string }
  | { readonly op: 'add-hypothesis'; readonly id: string; readonly text: string }
  | { readonly op: 'add-question'; readonly id: string; readonly text: string }
  | {
      readonly op: 'answer-question';
      readonly id: string;
      readonly questionId: string;
      readonly answer: string;
    }
  | { readonly op: 'add-decision'; readonly id: string; readonly text: string }
  | { readonly op: 'validate-decision'; readonly id: string; readonly decisionId: string }
  | { readonly op: 'obsolete-decision'; readonly id: string; readonly decisionId: string }
  | { readonly op: 'add-source'; readonly id: string; readonly text: string }
  | {
      readonly op: 'add-need';
      readonly id: string;
      readonly text: string;
      readonly sourceIds: readonly string[];
    }
  | {
      readonly op: 'link-source';
      readonly id: string;
      readonly item: ProjectSourceableRef;
      readonly sourceId: string;
    }
  | {
      readonly op: 'justify-decision';
      readonly id: string;
      readonly decisionId: string;
      readonly item: ProjectItemRef;
    }
  | { readonly op: 'next-question'; readonly id: string }
  | { readonly op: 'export-markdown'; readonly id: string; readonly outputPath: string };

/** Miroir local d'`ItemRef` (`@jarvis/project-briefs`) — ce module ne fait que parser. */
export interface ProjectItemRef {
  readonly kind: 'fact' | 'hypothesis';
  readonly id: string;
}

/** Miroir local de `SourceableRef` — réservé à `link-source` (un besoin ne justifie jamais une décision). */
export interface ProjectSourceableRef {
  readonly kind: 'fact' | 'hypothesis' | 'need';
  readonly id: string;
}

/**
 * Côté CLI seulement, le type est déduit du préfixe produit par le store
 * (`fact-…` / `hyp-…`) ; le modèle stocke ensuite une référence typée
 * explicite, jamais un id nu.
 */
function parseItemRef(value: string | undefined): ProjectItemRef {
  const id = requireArg(value, 'élément');
  if (id.startsWith('fact-')) return { kind: 'fact', id };
  if (id.startsWith('hyp-')) return { kind: 'hypothesis', id };
  throw new Error(
    `project : élément « ${id} » invalide — attendu un fait (fact-…) ou une hypothèse (hyp-…).`,
  );
}

/**
 * Parseur DISTINCT de `parseItemRef` : accepte en plus `need-…`, pour
 * `link-source` uniquement. `justify-decision` garde `parseItemRef`, qui
 * refuse `need-…`.
 */
function parseSourceableRef(value: string | undefined): ProjectSourceableRef {
  const id = requireArg(value, 'élément');
  if (id.startsWith('need-')) return { kind: 'need', id };
  if (id.startsWith('fact-')) return { kind: 'fact', id };
  if (id.startsWith('hyp-')) return { kind: 'hypothesis', id };
  throw new Error(
    `project : élément « ${id} » invalide — attendu un fait (fact-…), une hypothèse (hyp-…) ou un besoin (need-…).`,
  );
}

const ADD_NEED_USAGE = 'usage : project add-need <id> "texte" [--source <source-id> ...]';

/** `<id> "texte" [--source src-n]...` — 0..n `--source`, rien d'autre toléré. */
function parseAddNeed(rest: readonly string[]): ProjectInput {
  if (rest.length < 2 || (rest.length - 2) % 2 !== 0) {
    throw new Error(`project : ${ADD_NEED_USAGE}`);
  }
  const sourceIds: string[] = [];
  for (let i = 2; i < rest.length; i += 2) {
    if (rest[i] !== '--source') {
      throw new Error(`project : ${ADD_NEED_USAGE}`);
    }
    sourceIds.push(requireArg(rest[i + 1], 'source-id'));
  }
  return {
    op: 'add-need',
    id: requireArg(rest[0], 'id'),
    text: requireArg(rest[1], 'texte'),
    sourceIds,
  };
}

function requireArg(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`project : « ${label} » manquant ou vide.`);
  }
  return value;
}

function requireArity(argv: readonly string[], count: number, usage: string): void {
  if (argv.length !== count) {
    throw new Error(`project : ${usage}`);
  }
}

/** `argv` sans les deux premiers éléments (`project <sous-commande>`). */
export function parseProjectArgs(argv: readonly string[]): ProjectInput {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'create': {
      requireArity(rest, 2, 'usage : project create <id> <nom>');
      return { op: 'create', id: requireArg(rest[0], 'id'), name: requireArg(rest[1], 'nom') };
    }
    case 'show': {
      requireArity(rest, 1, 'usage : project show <id>');
      return { op: 'show', id: requireArg(rest[0], 'id') };
    }
    case 'add-fact': {
      requireArity(rest, 2, 'usage : project add-fact <id> "texte"');
      return { op: 'add-fact', id: requireArg(rest[0], 'id'), text: requireArg(rest[1], 'texte') };
    }
    case 'add-hypothesis': {
      requireArity(rest, 2, 'usage : project add-hypothesis <id> "texte"');
      return {
        op: 'add-hypothesis',
        id: requireArg(rest[0], 'id'),
        text: requireArg(rest[1], 'texte'),
      };
    }
    case 'add-question': {
      requireArity(rest, 2, 'usage : project add-question <id> "texte"');
      return {
        op: 'add-question',
        id: requireArg(rest[0], 'id'),
        text: requireArg(rest[1], 'texte'),
      };
    }
    case 'answer-question': {
      requireArity(rest, 3, 'usage : project answer-question <id> <question-id> "réponse"');
      return {
        op: 'answer-question',
        id: requireArg(rest[0], 'id'),
        questionId: requireArg(rest[1], 'question-id'),
        answer: requireArg(rest[2], 'réponse'),
      };
    }
    case 'add-decision': {
      requireArity(rest, 2, 'usage : project add-decision <id> "texte"');
      return {
        op: 'add-decision',
        id: requireArg(rest[0], 'id'),
        text: requireArg(rest[1], 'texte'),
      };
    }
    case 'validate-decision': {
      requireArity(rest, 2, 'usage : project validate-decision <id> <decision-id>');
      return {
        op: 'validate-decision',
        id: requireArg(rest[0], 'id'),
        decisionId: requireArg(rest[1], 'decision-id'),
      };
    }
    case 'obsolete-decision': {
      requireArity(rest, 2, 'usage : project obsolete-decision <id> <decision-id>');
      return {
        op: 'obsolete-decision',
        id: requireArg(rest[0], 'id'),
        decisionId: requireArg(rest[1], 'decision-id'),
      };
    }
    case 'add-source': {
      requireArity(rest, 2, 'usage : project add-source <id> "texte"');
      return {
        op: 'add-source',
        id: requireArg(rest[0], 'id'),
        text: requireArg(rest[1], 'texte'),
      };
    }
    case 'add-need':
      return parseAddNeed(rest);
    case 'link-source': {
      requireArity(rest, 3, 'usage : project link-source <id> <fact-n|hyp-n|need-n> <source-id>');
      return {
        op: 'link-source',
        id: requireArg(rest[0], 'id'),
        item: parseSourceableRef(rest[1]),
        sourceId: requireArg(rest[2], 'source-id'),
      };
    }
    case 'justify-decision': {
      requireArity(rest, 3, 'usage : project justify-decision <id> <decision-id> <fact-n|hyp-n>');
      return {
        op: 'justify-decision',
        id: requireArg(rest[0], 'id'),
        decisionId: requireArg(rest[1], 'decision-id'),
        item: parseItemRef(rest[2]),
      };
    }
    case 'next-question': {
      requireArity(rest, 1, 'usage : project next-question <id>');
      return { op: 'next-question', id: requireArg(rest[0], 'id') };
    }
    case 'interview': {
      requireArity(rest, 1, 'usage : project interview <id>');
      return { op: 'interview', id: requireArg(rest[0], 'id') };
    }
    case 'export-markdown': {
      if (rest.length !== 3 || rest[1] !== '--output') {
        throw new Error('project : usage : project export-markdown <id> --output <chemin.md>');
      }
      return {
        op: 'export-markdown',
        id: requireArg(rest[0], 'id'),
        outputPath: requireArg(rest[2], 'chemin'),
      };
    }
    default:
      throw new Error(
        `project : sous-commande inconnue « ${sub ?? ''} » — attendu l'une de : create, show, ` +
          'add-fact, add-hypothesis, add-question, answer-question, add-decision, ' +
          'validate-decision, obsolete-decision, add-source, add-need, link-source, justify-decision, ' +
          'next-question, export-markdown, interview.',
      );
  }
}
