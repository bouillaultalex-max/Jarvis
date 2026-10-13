import { createInterface } from 'node:readline';

import {
  AgentLoop,
  type AgentHistoryMessage,
  type AgentStopReason,
  type LlmProvider,
} from '@jarvis/core';

/**
 * REPL conversationnel local — **mémoire de session bornée, uniquement en
 * RAM, sans outil**. `AgentLoop` est construit sans `ToolExecutor` (jamais
 * importé dans ce fichier, ni dans `main.ts` pour cette commande) : aucun
 * outil n'est présenté au modèle, et même si un provider renvoyait malgré
 * tout un `toolCall` (`agent-loop.ts` : `toolExecutor === undefined` ⇒ le
 * `toolCall` éventuel est ignoré), le tour se termine toujours en
 * `'llm_final'` — garantie structurelle, pas une politique (même discipline
 * que `apps/whatsapp-channel/src/agent-loop-conversational-service.ts`).
 * Cette garantie ne dispense cependant pas de traiter `tool_blocked`/
 * `max_iterations` explicitement (voir {@link describeStopReason}) — ils
 * restent de vrais statuts d'`AgentLoop`, pas des cas supposés impossibles.
 *
 * **Historique** : `history` (`AgentHistoryMessage[]`, `@jarvis/core`) est
 * conservé dans une variable locale à {@link runChatRepl} — jamais écrit sur
 * disque, jamais journalisé (aucun import `fs` dans ce fichier). Seuls les
 * tours terminés **normalement** (`stopReason === 'llm_final'`) sont ajoutés
 * (par paire complète `user`+`assistant`) ; une erreur ou un statut non
 * final ne modifie jamais l'historique conservé. Borné par
 * {@link MAX_HISTORY_MESSAGES} et {@link MAX_HISTORY_CONTEXT_CHARS} — voir
 * {@link dropOldestPairsUntil}. `/reset` l'efface sans jamais appeler le
 * provider.
 *
 * Séquentialité : `for await...of rl` ne redemande la ligne suivante au
 * générateur `readline` qu'une fois le corps de boucle (donc l'`await`
 * courant) résolu — aucun second appel à `llm.chat()`/`agent.run()` ne peut
 * donc jamais être en vol en même temps qu'un premier.
 *
 * `/quit`, Ctrl+C (évènement `'SIGINT'` de l'interface `readline`, pas un
 * signal process), ou la fin de `stdin` ferment la boucle proprement. Ctrl+C
 * n'annule **jamais** un appel déjà en cours : ni `LlmProvider.chat()` ni
 * `AgentLoop.run()` n'acceptent de signal d'annulation dans ce dépôt
 * aujourd'hui. Si la frappe survient pendant un appel en vol, celui-ci va à
 * son terme et sa réponse (ou son erreur contrôlée) s'affiche malgré tout,
 * avant la fermeture effective de la boucle — simplement, aucune **nouvelle**
 * ligne n'est jamais lue après (même déjà en attente dans le flux).
 */

export interface ChatReplDeps {
  readonly llm: LlmProvider;
  /** Défaut : `process.stdin`. */
  readonly input?: NodeJS.ReadableStream;
  /** Défaut : `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
}

const QUIT_COMMAND = '/quit';
const RESET_COMMAND = '/reset';

/**
 * Bornes de l'historique de session — en **caractères**, pas en tokens :
 * aucun plafond de tokens ou de coût monétaire n'est garanti par ces
 * valeurs, seulement un ordre de grandeur. Chaque message conservé
 * augmente le coût d'entrée de **tous les tours suivants** de la session
 * (l'historique entier est renvoyé à chaque appel) — à mettre en balance
 * avec l'absence de budget actuelle pour un essai réel.
 */
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_CONTEXT_CHARS = 8000;

/** Sous-chaîne stable de l'erreur levée par `AnthropicProvider.resolveClient()` — jamais la clé elle-même. */
const MISSING_API_KEY_MARKER = 'ANTHROPIC_API_KEY manquante';

function printBanner(write: (line: string) => void): void {
  write('🤖 Jarvis — chat local (mémoire de session en RAM uniquement, aucun outil disponible).');
  write(
    `Historique conservé en mémoire pour cette session — jamais écrit sur disque, jamais ` +
      `journalisé. Borné à ${MAX_HISTORY_MESSAGES} messages et ${MAX_HISTORY_CONTEXT_CHARS} ` +
      `caractères (approximatif, PAS un comptage de tokens) ; au-delà, le contexte le plus ` +
      `ancien est retiré et annoncé. "${RESET_COMMAND}" efface tout immédiatement, sans appel réseau.`,
  );
  write(
    "Chaque message non vide déclenche un appel réel à l'API Anthropic et peut être " +
      "facturé — l'abonnement Claude Code ne couvre PAS cette consommation. Conserver un " +
      "historique augmente le coût d'entrée de chaque tour suivant (il est renvoyé en entier).",
  );
  write(
    'Modèle : celui par défaut de AnthropicProvider, sauf si la variable ANTHROPIC_MODEL ' +
      'est définie (voir packages/llm/src/index.ts) — ce défaut code en dur un identifiant ' +
      "sans garantie qu'il reste disponible ; définissez ANTHROPIC_MODEL explicitement si besoin.",
  );
  write(
    `Commandes : "${QUIT_COMMAND}" pour quitter, "${RESET_COMMAND}" pour effacer l'historique — ` +
      "Ctrl+C ou la fin de l'entrée ferment aussi la boucle.",
  );
}

/**
 * `tool_blocked`/`max_iterations` sont structurellement inatteignables tant
 * qu'aucun `ToolExecutor` n'est fourni à `AgentLoop` (voir l'en-tête de
 * fichier) — traités ici en défense explicite plutôt que supposés en
 * silence : si ce fichier est un jour modifié pour présenter un outil, ce
 * `switch` échouera visiblement à la compilation (`exhaustive: never`)
 * plutôt que de laisser une réponse vide passer pour une réponse normale.
 */
export function describeStopReason(stopReason: AgentStopReason, content: string): string {
  switch (stopReason) {
    case 'llm_final':
      return content;
    case 'tool_blocked':
      return (
        'Réponse interrompue (un outil a été demandé, mais ce chat local ne présente aucun ' +
        'outil) — reformulez votre demande.'
      );
    case 'max_iterations':
      return "Réponse interrompue (limite d'itérations atteinte) — reformulez plus simplement.";
    default: {
      const exhaustive: never = stopReason;
      return `Réponse interrompue (statut inattendu : ${String(exhaustive)}).`;
    }
  }
}

/**
 * Motif fixe et contrôlé — jamais `err.message`, une pile, ou une réponse
 * brute du fournisseur (même discipline que `provision-whatsapp-secrets.ts`
 * après sa revue finale) : une erreur de l'API Anthropic pourrait embarquer
 * un détail interne non maîtrisé. Seul le cas « clé absente » est reconnu
 * explicitement, parce que son message (`AnthropicProvider.resolveClient()`)
 * est fixe, contrôlé par ce dépôt, et ne contient jamais la clé elle-même.
 */
export function describeChatError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes(MISSING_API_KEY_MARKER)) {
    return (
      'Clé API absente : définissez ANTHROPIC_API_KEY pour utiliser ce chat — ' +
      'aucun appel réseau n’a été tenté.'
    );
  }
  return 'Le fournisseur LLM a renvoyé une erreur — réessayez, ou vérifiez sa configuration.';
}

function totalChars(history: readonly AgentHistoryMessage[]): number {
  return history.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Retire les paires **les plus anciennes complètes** (jamais un message
 * isolé — l'historique commence donc toujours par `user`) jusqu'à ce que
 * `fits` soit satisfait, ou jusqu'à épuisement. Ne tronque **jamais** le
 * texte d'un message : seules des paires entières disparaissent.
 */
function dropOldestPairsUntil(
  history: readonly AgentHistoryMessage[],
  fits: (candidate: readonly AgentHistoryMessage[]) => boolean,
): { readonly history: readonly AgentHistoryMessage[]; readonly dropped: boolean } {
  let current = history;
  let dropped = false;
  while (current.length > 0 && !fits(current)) {
    current = current.slice(2);
    dropped = true;
  }
  return { history: current, dropped };
}

function fitsBounds(history: readonly AgentHistoryMessage[], extraChars = 0): boolean {
  return (
    history.length <= MAX_HISTORY_MESSAGES &&
    totalChars(history) + extraChars <= MAX_HISTORY_CONTEXT_CHARS
  );
}

export async function runChatRepl(deps: ChatReplDeps): Promise<void> {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const write = (line: string): void => {
    output.write(`${line}\n`);
  };

  printBanner(write);

  const agent = new AgentLoop(deps.llm);
  // Historique de session — en mémoire **uniquement** (variable locale,
  // aucune E/S fichier). Remplacé par une nouvelle référence à chaque
  // changement (immuable), jamais muté en place.
  let history: readonly AgentHistoryMessage[] = [];

  // `terminal: true` explicite : fait émettre l'évènement `'SIGINT'` sur
  // l'interface (jamais un signal process) même si `input` n'est pas un vrai
  // TTY (cas des tests, `PassThrough`) — comportement voulu, pas un défaut
  // d'environnement à contourner.
  const rl = createInterface({ input, output, terminal: true });
  // `rl.close()` seul ne suffit pas : une ligne déjà mise en file par
  // `readline` AVANT l'interruption (reçue pendant l'appel en vol, pas
  // encore consommée par `for await`) est quand même livrée par
  // l'itérateur asynchrone une fois celui-ci redemandé — défaut démontré
  // par test, corrigé par ce drapeau vérifié **avant** tout traitement
  // d'une ligne : aucune ligne déjà en file n'est jamais transformée en
  // nouvel appel après une interruption, même si elle était disponible
  // avant celle-ci. Ne touche ni n'annule l'appel déjà en cours.
  let interrupted = false;
  rl.on('SIGINT', () => {
    interrupted = true;
    rl.close();
  });

  try {
    for await (const rawLine of rl) {
      if (interrupted) {
        break;
      }
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }
      if (line === QUIT_COMMAND) {
        break;
      }
      if (line === RESET_COMMAND) {
        // Efface sans jamais appeler le provider.
        history = [];
        write('Historique de session effacé — nouvelle conversation.');
        continue;
      }

      // Le nouveau message dépasse **seul** le budget de contexte : refusé
      // localement, aucun appel, l'historique existant n'est pas touché.
      if (line.length > MAX_HISTORY_CONTEXT_CHARS) {
        write(
          `Message refusé (${line.length} caractères) : dépasse seul la limite de contexte ` +
            `(${MAX_HISTORY_CONTEXT_CHARS}) — aucun appel effectué, historique conservé tel quel.`,
        );
        continue;
      }

      // Retire les paires les plus anciennes jusqu'à ce que
      // historique + nouveau message respecte le budget — jamais une
      // troncature de texte. N'est commis dans `history` qu'en cas de
      // succès normal (voir plus bas) : sur erreur, `history` reste
      // inchangé, y compris ce retrait éventuel.
      const { history: fittedHistory, dropped: droppedBefore } = dropOldestPairsUntil(
        history,
        (h) => fitsBounds(h, line.length),
      );
      if (droppedBefore) {
        write('Contexte ancien retiré pour respecter la limite de taille avant cet envoi.');
      }

      try {
        const result = await agent.run(line, { history: fittedHistory });
        write(describeStopReason(result.stopReason, result.content));

        // Seul un tour terminé **normalement** modifie l'historique conservé.
        if (result.stopReason === 'llm_final') {
          const pair: readonly AgentHistoryMessage[] = [
            { role: 'user', content: line },
            { role: 'assistant', content: result.content },
          ];
          const pairChars = line.length + result.content.length;
          if (pairChars > MAX_HISTORY_CONTEXT_CHARS) {
            // La nouvelle paire, à elle seule, ne rentrerait jamais dans le
            // budget : affichée (ci-dessus) mais jamais conservée.
            history = fittedHistory;
            write(
              "Cette réponse est trop volumineuse pour être conservée dans l'historique de session.",
            );
          } else {
            const { history: boundedHistory, dropped: droppedAfter } = dropOldestPairsUntil(
              [...fittedHistory, ...pair],
              (h) => fitsBounds(h),
            );
            if (droppedAfter) {
              write(
                'Contexte ancien retiré pour respecter la limite de taille après cette réponse.',
              );
            }
            history = boundedHistory;
          }
        }
        // `tool_blocked`/`max_iterations` : aucune modification de `history`
        // (pas un tour « terminé normalement »), conformément à l'en-tête.
      } catch (err) {
        write(describeChatError(err));
        // Aucune modification de `history` après une erreur — y compris le
        // retrait éventuel calculé ci-dessus pour cet appel.
      }
    }
  } finally {
    rl.close();
    // `rl.close()` retire ses propres écouteurs `'keypress'`/`'end'`/`'error'`
    // sur `input`, mais **pas** `'data'` (constaté par test, pas une garantie
    // documentée de `node:readline`) — retiré explicitement ici : cette
    // fonction est la seule à jamais écouter `input` pendant sa durée de vie.
    input.removeAllListeners('data');
  }
}
