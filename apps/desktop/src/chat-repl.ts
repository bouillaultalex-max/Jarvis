import { createInterface } from 'node:readline';

import { AgentLoop, type AgentStopReason, type LlmProvider } from '@jarvis/core';

/**
 * REPL conversationnel local — **mono-tour, sans historique entre les
 * messages, sans mémoire persistante, sans outil**. `AgentLoop` est construit
 * sans `ToolExecutor` (jamais importé dans ce fichier, ni dans `main.ts` pour
 * cette commande) : aucun outil n'est présenté au modèle, et même si un
 * provider renvoyait malgré tout un `toolCall` (`agent-loop.ts` :
 * `toolExecutor === undefined` ⇒ le `toolCall` éventuel est ignoré), le tour
 * se termine toujours en `'llm_final'` — garantie structurelle, pas une
 * politique (même discipline que
 * `apps/whatsapp-channel/src/agent-loop-conversational-service.ts`).
 *
 * Chaque appel à `agent.run()` reconstruit sa propre conversation depuis zéro
 * (`agent-loop.ts` : un seul message `user` initial par tour) — aucun état
 * n'est conservé ici entre deux lignes : c'est la portée mono-tour annoncée
 * au démarrage, pas une limite de ce fichier à contourner plus tard sans le
 * dire.
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
 * ligne n'est jamais lue après.
 */

export interface ChatReplDeps {
  readonly llm: LlmProvider;
  /** Défaut : `process.stdin`. */
  readonly input?: NodeJS.ReadableStream;
  /** Défaut : `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
}

const QUIT_COMMAND = '/quit';

/** Sous-chaîne stable de l'erreur levée par `AnthropicProvider.resolveClient()` — jamais la clé elle-même. */
const MISSING_API_KEY_MARKER = 'ANTHROPIC_API_KEY manquante';

function printBanner(write: (line: string) => void): void {
  write('🤖 Jarvis — chat local (conversation pure, aucun outil disponible).');
  write(
    'Portée mono-tour : aucun historique entre les messages, aucune mémoire persistante — ' +
      'chaque ligne est un tour entièrement indépendant.',
  );
  write(
    "Chaque message non vide déclenche un appel réel à l'API Anthropic et peut être " +
      "facturé — l'abonnement Claude Code ne couvre PAS cette consommation.",
  );
  write(
    'Modèle : celui par défaut de AnthropicProvider, sauf si la variable ANTHROPIC_MODEL ' +
      'est définie (voir packages/llm/src/index.ts) — ce défaut code en dur un identifiant ' +
      "sans garantie qu'il reste disponible ; définissez ANTHROPIC_MODEL explicitement si besoin.",
  );
  write(
    `Commandes : "${QUIT_COMMAND}" pour quitter — Ctrl+C ou la fin de l'entrée ferment aussi la boucle.`,
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

export async function runChatRepl(deps: ChatReplDeps): Promise<void> {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const write = (line: string): void => {
    output.write(`${line}\n`);
  };

  printBanner(write);

  const agent = new AgentLoop(deps.llm);
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

      try {
        const result = await agent.run(line);
        write(describeStopReason(result.stopReason, result.content));
      } catch (err) {
        write(describeChatError(err));
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
