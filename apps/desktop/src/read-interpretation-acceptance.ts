import { createInterface } from 'node:readline';

import type { ReadInterpretation } from './read-intent-parser.js';

/**
 * Demande à l'utilisateur, au terminal, s'il **reconnaît et accepte**
 * l'interprétation d'une demande de lecture — sous-étape VS-02c
 * (`docs/second-readonly-vertical-slice.md`, section 5.4,
 * « Acceptation explicite »).
 *
 * **Cette acceptation valide uniquement la compréhension de la demande.**
 * Elle ne constitue et ne produit **jamais** :
 *   - une autorisation d'outil (`PermissionManager` n'est ni importé ni
 *     appelé) ;
 *   - une confirmation d'exécution (`ConfirmationService` n'est ni importé
 *     ni appelé, aucun `ConfirmationRequest` n'est jamais créé) ;
 *   - une exécution (`ToolExecutor`/`AgentLoop` ne sont ni importés ni
 *     appelés) ;
 *   - un `ToolRequest` (ce module ne convertit rien — voir
 *     `read-intent-to-tool-request.ts` pour cette étape distincte, non
 *     déclenchée ici) ;
 *   - une validation de résultat, ni une autorisation générale.
 *
 * Reprend le patron d'interaction déjà éprouvé par `terminal-confirm.ts`
 * (`createInterface`, `rl.question`, refus par défaut sur `close`), sans
 * réutiliser son type `ConfirmationRequest` — délibérément, pour ne jamais
 * confondre cette acceptation de compréhension avec une confirmation
 * d'exécution `execute` fingerprintée (`ADR-0006`).
 */

/**
 * `declined`               : une réponse a été obtenue, mais ce n'est pas
 *                             une affirmation reconnue (refus explicite,
 *                             réponse vide, réponse inconnue, réponse
 *                             conditionnelle — jamais interprétée).
 * `invalid-interpretation` : l'interprétation fournie n'est pas éligible à
 *                             une acceptation (`ambiguous`, `unsupported`,
 *                             ou `understood` sans `proposedRead`
 *                             exploitable) — **aucune question n'est posée**.
 * `input-error`            : aucune réponse n'a pu être obtenue (EOF, flux
 *                             fermé avant toute saisie, erreur de lecture).
 */
export type InterpretationAcceptanceRefusalReason =
  'declined' | 'invalid-interpretation' | 'input-error';

export type InterpretationAcceptanceResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: InterpretationAcceptanceRefusalReason };

export interface ReadInterpretationAcceptanceIo {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/** Réponses acceptées — correspondance exacte uniquement (jamais une sous-chaîne). */
const ACCEPTED_ANSWERS: ReadonlySet<string> = new Set(['oui', 'o', 'yes', 'y']);

const QUESTION_PROMPT = 'Est-ce bien ce que tu souhaites ? [o/N] ';

/**
 * Construit le texte de proposition à afficher, ou `undefined` si
 * l'interprétation n'est pas éligible à une acceptation — dans ce cas
 * l'appelant ne doit **jamais** poser de question. Fonction pure, séparée
 * de la décision d'acceptation pour rester testable indépendamment.
 *
 * Vocabulaire volontairement au futur/conditionnel (« je vais lire »),
 * jamais au passé ni au vocabulaire d'autorisation (« autorisé »,
 * « confirmé », « exécuté », « permission ») — ce texte décrit une
 * proposition, jamais un fait accompli ni un droit déjà accordé.
 */
export function describeReadInterpretationProposal(
  interpretation: ReadInterpretation,
): readonly string[] | undefined {
  if (interpretation.status !== 'understood') {
    return undefined;
  }
  const { proposedRead } = interpretation;
  if (proposedRead === undefined || proposedRead.tool !== 'gmail.read') {
    return undefined;
  }

  const lines = ['Interprétation comprise :', 'Je vais lire tes derniers emails Gmail.'];
  const { maxResults } = proposedRead.input;
  if (maxResults !== undefined) {
    lines.push(`Nombre maximal : ${maxResults}.`);
  }
  return lines;
}

/**
 * Pose la question d'acceptation et interprète la réponse. Ne lève jamais.
 * N'appelle jamais `ToolExecutor`, `PermissionManager`, `ConfirmationService`
 * ni `AgentLoop`. Ne produit jamais de `ToolRequest` ni de
 * `ConfirmationRequest`.
 *
 * Défaut sûr, cohérent avec `createTerminalConfirm` : toute réponse qui
 * n'est pas une affirmation reconnue à l'identique (`oui`/`o`/`yes`/`y`,
 * insensible à la casse et aux espaces de bord) vaut refus — y compris une
 * réponse conditionnelle ou ambiguë, jamais interprétée au-delà de sa
 * correspondance exacte.
 */
export async function requestReadInterpretationAcceptance(
  interpretation: ReadInterpretation,
  io: ReadInterpretationAcceptanceIo = {},
): Promise<InterpretationAcceptanceResult> {
  const proposal = describeReadInterpretationProposal(interpretation);
  if (proposal === undefined) {
    return { accepted: false, reason: 'invalid-interpretation' };
  }

  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;

  try {
    output.write(`${proposal.join('\n')}\n\n`);

    const rl = createInterface({ input, output });
    try {
      const answer = await new Promise<string | undefined>((resolve) => {
        rl.question(QUESTION_PROMPT, (value) => resolve(value));
        // EOF / flux fermé avant toute saisie → distinct d'une réponse vide.
        rl.once('close', () => resolve(undefined));
        rl.once('error', () => resolve(undefined));
      });

      if (answer === undefined) {
        return { accepted: false, reason: 'input-error' };
      }
      if (ACCEPTED_ANSWERS.has(answer.trim().toLowerCase())) {
        return { accepted: true };
      }
      return { accepted: false, reason: 'declined' };
    } finally {
      rl.close();
    }
  } catch {
    // Défense en profondeur : aucune exception non maîtrisée ne doit
    // sortir de ce module — un résultat fermé et sûr est toujours renvoyé.
    return { accepted: false, reason: 'input-error' };
  }
}
