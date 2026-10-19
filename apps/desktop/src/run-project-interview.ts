import { createInterface } from 'node:readline';

import {
  MAX_ANSWER_CHARS,
  ProjectBriefStoreError,
  isBoundedNonEmptyText,
  pickNextQuestion,
  type FileProjectBriefStore,
  type ProjectBrief,
  type Question,
} from '@jarvis/project-briefs';

/**
 * `project interview <id>` — questionnaire interactif à **règle fixe**,
 * jamais un LLM : la question proposée est toujours la première `open` (par
 * ordre d'ajout), filtrée des questions passées pour cette session
 * uniquement (voir {@link SKIP_COMMAND}). Réutilise le store et
 * `pickNextQuestion` tels qu'ils existent déjà pour `project next-question`
 * / `project answer-question` — aucune nouvelle règle de sélection, aucune
 * nouvelle commande d'écrasement ou de réouverture.
 *
 * **Une seule interface `readline`** pour tout le parcours (réponse, passage,
 * confirmation) — jamais une seconde instance concurrente. Toute ligne reçue
 * est traitée par la même boucle `for await`, dispatchée selon `mode` ;
 * l'écriture effective (`store.answerQuestion`) n'a lieu qu'après une
 * confirmation explicite `y`/`yes`/`oui` lue comme une LIGNE de cette
 * boucle — jamais avant, jamais automatiquement.
 *
 * Ctrl+C (`'SIGINT'` de l'interface, jamais un signal process — même motif
 * que `chat-repl.ts`) et `/quit` ferment la boucle sans déclencher la
 * moindre écriture non déjà confirmée, et sans jamais traiter une ligne
 * restée en attente dans le flux (`interrupted`, vérifié avant tout
 * traitement — même motif documenté et testé dans `chat-repl.ts`). Une
 * mutation déjà engagée (le `store.answerQuestion` déjà en cours d'exécution
 * synchrone) n'est elle-même jamais annulée — ce code ne prétend pas le
 * contraire ; `FileProjectBriefStore` est synchrone, il n'existe donc ici
 * aucune fenêtre où une écriture serait « en vol » au moment d'un Ctrl+C.
 *
 * `removeAllListeners('data')` (motif de `chat-repl.ts`) n'est volontairement
 * PAS utilisé ici : il retirerait aussi un écouteur `'data'` posé par un
 * autre consommateur de la même entrée, hors du contrôle de ce fichier. Seul
 * l'écouteur `'data'` ajouté par CETTE interface `readline` (identifié par
 * différence avant/après sa création) est retiré en sortie.
 *
 * `already_answered` (résolution concurrente entre l'affichage et la
 * confirmation d'un appelant, voir `FileProjectBriefStore.answerQuestion`) :
 * signalé comme un conflit explicite, la réponse abandonnée n'est jamais
 * resoumise automatiquement — seule une nouvelle sélection (relecture
 * fraîche) suit.
 */

export interface ProjectInterviewDeps {
  readonly store: FileProjectBriefStore;
  /** Défaut : `process.stdin`. */
  readonly input?: NodeJS.ReadableStream;
  /** Défaut : `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
}

const SKIP_COMMAND = '/passer';
const QUIT_COMMAND = '/quit';
const ACCEPTED_CONFIRMATIONS = new Set(['y', 'yes', 'oui']);

type SelectionOutcome =
  | { readonly kind: 'selected'; readonly brief: ProjectBrief; readonly question: Question }
  | { readonly kind: 'done' }
  | { readonly kind: 'all-skipped' }
  | { readonly kind: 'not-found' };

/**
 * Relit la fiche depuis le store (jamais un état mémoire potentiellement
 * périmé), puis applique la règle fixe existante (`pickNextQuestion`) sur
 * les questions `open` encore NON passées pour cette session — le filtre
 * « passé » n'est jamais écrit dans la fiche elle-même, uniquement appliqué
 * ici, en mémoire du process.
 */
function selectNextQuestion(
  store: FileProjectBriefStore,
  id: string,
  skipped: ReadonlySet<string>,
): SelectionOutcome {
  const brief = store.get(id);
  if (brief === undefined) {
    return { kind: 'not-found' };
  }
  const openQuestions = brief.questions.filter((q) => q.status === 'open');
  if (openQuestions.length === 0) {
    return { kind: 'done' };
  }
  const remaining = openQuestions.filter((q) => !skipped.has(q.id));
  if (remaining.length === 0) {
    return { kind: 'all-skipped' };
  }
  const picked = pickNextQuestion({ ...brief, questions: remaining });
  if (picked.status !== 'selected') {
    // Défensif : `remaining` est non vide, donc toujours atteint ci-dessus.
    return { kind: 'all-skipped' };
  }
  return { kind: 'selected', brief, question: picked.question };
}

type Mode =
  | { readonly kind: 'awaiting-answer'; readonly questionId: string }
  | { readonly kind: 'awaiting-confirm'; readonly questionId: string; readonly answer: string };

export async function runProjectInterview(id: string, deps: ProjectInterviewDeps): Promise<number> {
  const { store } = deps;
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const write = (line: string): void => {
    output.write(`${line}\n`);
  };

  if (store.get(id) === undefined) {
    write(`Projet « ${id} » introuvable.`);
    return 1;
  }

  write(
    'Questionnaire à règles fixes — sélection déterministe (première question ouverte, par ' +
      "ordre d'ajout), aucun LLM, aucune interprétation.",
  );
  write(
    `Tapez votre réponse pour répondre ; "${SKIP_COMMAND}" pour passer cette question pour ` +
      `cette session (la fiche n'est jamais modifiée par un passage) ; "${QUIT_COMMAND}" ` +
      '(Ctrl+C aussi) pour quitter.',
  );

  const skipped = new Set<string>();
  let mode: Mode | undefined;
  let exitCode = 0;

  /** Relit, sélectionne et affiche la question suivante ; renvoie `false` si la boucle doit s'arrêter. */
  function advance(): boolean {
    const outcome = selectNextQuestion(store, id, skipped);
    switch (outcome.kind) {
      case 'not-found':
        write(`Projet « ${id} » introuvable.`);
        exitCode = 1;
        mode = undefined;
        return false;
      case 'done':
        write('Aucune question ouverte restante (règle fixe) — rien à interviewer.');
        mode = undefined;
        return false;
      case 'all-skipped':
        write('Questions restantes passées pour cette session.');
        mode = undefined;
        return false;
      case 'selected':
        write(
          `Projet « ${outcome.brief.id} » — ${outcome.brief.name} (révision ${outcome.brief.revision}).`,
        );
        write(`Question : [${outcome.question.id}] ${outcome.question.text}`);
        mode = { kind: 'awaiting-answer', questionId: outcome.question.id };
        return true;
    }
  }

  if (!advance()) {
    return exitCode;
  }

  // Diff avant/après : seuls les écouteurs `'data'` ajoutés par CETTE
  // interface sont retirés en sortie — jamais ceux d'un autre consommateur
  // déjà présent sur `input` avant cet appel.
  const dataListenersBefore = new Set(input.listeners('data'));
  const rl = createInterface({ input, output, terminal: true });
  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
    rl.close();
  };
  rl.on('SIGINT', onSigint);

  try {
    for await (const rawLine of rl) {
      if (interrupted || mode === undefined) {
        break;
      }
      const line = rawLine.trim();

      if (mode.kind === 'awaiting-answer') {
        if (line === QUIT_COMMAND) {
          break;
        }
        if (line === SKIP_COMMAND) {
          skipped.add(mode.questionId);
          if (!advance()) {
            break;
          }
          continue;
        }
        if (line.length === 0) {
          write(`Réponse vide refusée — réessayez, ou "${SKIP_COMMAND}"/"${QUIT_COMMAND}".`);
          continue;
        }
        if (!isBoundedNonEmptyText(line, MAX_ANSWER_CHARS)) {
          write(
            `Réponse refusée (dépasse ${MAX_ANSWER_CHARS} caractères) — réessayez, ou ` +
              `"${SKIP_COMMAND}"/"${QUIT_COMMAND}".`,
          );
          continue;
        }
        write(`Réponse proposée : « ${line} ». Enregistrer ? [y/N]`);
        mode = { kind: 'awaiting-confirm', questionId: mode.questionId, answer: line };
        continue;
      }

      // mode.kind === 'awaiting-confirm'
      const { questionId, answer } = mode;
      if (line === QUIT_COMMAND) {
        break;
      }
      if (!ACCEPTED_CONFIRMATIONS.has(line.toLowerCase())) {
        write('Réponse abandonnée — non enregistrée.');
        if (!advance()) {
          break;
        }
        continue;
      }

      try {
        store.answerQuestion(id, questionId, answer);
        write('Réponse enregistrée.');
      } catch (err) {
        if (err instanceof ProjectBriefStoreError && err.reason === 'already_answered') {
          write(
            'Conflit : cette question a déjà été résolue par un autre processus entre ' +
              "l'affichage et la confirmation — réponse initiale conservée, rien écrasé ici.",
          );
        } else if (err instanceof ProjectBriefStoreError) {
          write(`Erreur de stockage [${err.reason}] : ${err.message}`);
          exitCode = 1;
          break;
        } else {
          write('Erreur de stockage inattendue — arrêt.');
          exitCode = 1;
          break;
        }
      }
      if (!advance()) {
        break;
      }
    }
  } finally {
    rl.off('SIGINT', onSigint);
    rl.close();
    for (const listener of input.listeners('data')) {
      if (!dataListenersBefore.has(listener)) {
        input.removeListener('data', listener as (...args: unknown[]) => void);
      }
    }
  }

  return exitCode;
}
