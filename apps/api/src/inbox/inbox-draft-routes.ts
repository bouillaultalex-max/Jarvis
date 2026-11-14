import type { FastifyInstance } from 'fastify';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type MemorySelector,
  type MemoryStore,
} from '@jarvis/core';
import {
  EmailFetchBlockedError,
  EmailReplyWorkflow,
  fetchEmailsViaTool,
  type EmailAnalyzer,
  type EmailReplyPlanner,
} from '@jarvis/inbox';
import { InMemoryMemoryStore } from '@jarvis/memory';

import { checkDraftAgainstConfirmedFacts } from './confirmed-fact-guard.js';
import { requireLoopback, type InboxMailbox } from './inbox-routes.js';
import { fixtureMailbox } from './fixture-mailbox.js';

/**
 * Route Inbox — brouillon de réponse (temps A, boîte fictive).
 *
 *   POST /inbox/draft { mailboxId, messageId }
 *     → { status: 'ok', draft: { body, subject? } }
 *     → { status: 'needs_clarification', questions: string[] }  (aucun brouillon)
 *     → { status: 'blocked', reason: string }                   (aucun brouillon)
 *     → { status: 'error', reason: string }
 *
 * Parcours strictement **jamais** connecté à Gmail : `EmailReplyWorkflow`
 * (`@jarvis/inbox`, inchangé, déjà publié) s'arrête à un `draft` proposé —
 * `prepareReplyFromDraft` / `gmail.prepare_reply` ne sont jamais appelés ici.
 * Aucun envoi, aucune écriture mémoire (le `MemoryStore` n'est consulté qu'en
 * lecture par le workflow). Même discipline loopback-only et refus par défaut
 * que `inbox-routes.ts` — `requireLoopback` y est réutilisé tel quel.
 *
 * `analyzer` et `planner` sont **requis**, sans valeur par défaut : cette
 * tranche ne branche délibérément aucun modèle (ni Ollama, ni Anthropic) —
 * voir la note Obsidian « Inbox temps A - boîte fictive », décision n°4,
 * toujours ouverte. Seuls des doubles (tests, essai Chrome) les fournissent.
 */

const DRAFT_LOOKUP_MAX_RESULTS = 50;
const DRAFT_INPUT_KEYS = ['mailboxId', 'messageId'];

/** Sélecteur trivial : renvoie toutes les entrées, sans filtrage lexical.
 * Choix délibéré pour cette tranche : la boîte fictive ne porte que quelques
 * faits confirmés, et le contrôle de sortie ({@link checkDraftAgainstConfirmedFacts})
 * doit voir **tous** les faits transmis, pas seulement ceux qu'un filtrage
 * lexical aurait jugés pertinents pour la requête. Une vraie boîte utiliserait
 * `LexicalMemorySelector` (ou un sélecteur sémantique) sans que ce fichier change. */
const SELECT_ALL_MEMORY: MemorySelector = {
  select: (_query, candidates) => candidates,
};

export interface InboxDraftRoutesDependencies {
  /** Défaut : la boîte fictive seule — même registre que `inbox-routes.ts`. */
  readonly mailboxes?: readonly InboxMailbox[];
  /** Tests uniquement (lecture refusée). Défaut : seul l'outil de la boîte est autorisé. */
  readonly permissions?: PermissionManager;
  readonly analyzer: EmailAnalyzer;
  readonly planner: EmailReplyPlanner;
  /** Faits confirmés transmis au workflow. Défaut : aucun (store vide). */
  readonly memory?: MemoryStore;
}

function parseDraftInput(body: unknown): { mailboxId: string; messageId: string } | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Corps de requête JSON manquant ou invalide.';
  }
  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !DRAFT_INPUT_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return `Propriété(s) non acceptée(s) : ${unknownKeys.join(', ')}.`;
  }
  const { mailboxId, messageId } = record;
  if (typeof mailboxId !== 'string' || mailboxId.length === 0) {
    return 'Le champ « mailboxId » est requis.';
  }
  if (typeof messageId !== 'string' || messageId.length === 0) {
    return 'Le champ « messageId » est requis.';
  }
  return { mailboxId, messageId };
}

export function registerInboxDraftRoutes(
  app: FastifyInstance,
  deps: InboxDraftRoutesDependencies,
): void {
  const mailboxes = deps.mailboxes ?? [fixtureMailbox];
  for (const mailbox of mailboxes) {
    if (mailbox.readTool.action !== 'read') {
      throw new Error(
        `Routes Inbox (brouillon) : l'outil « ${mailbox.readTool.name} » n'est pas une lecture.`,
      );
    }
  }

  void app.register(async (inbox) => {
    inbox.addHook('onRequest', requireLoopback);

    inbox.post('/inbox/draft', async (request, reply) => {
      const input = parseDraftInput(request.body);
      if (typeof input === 'string') {
        return reply.code(400).send({ error: input });
      }
      const mailbox = mailboxes.find((candidate) => candidate.id === input.mailboxId);
      if (mailbox === undefined) {
        return reply.code(404).send({ error: 'Boîte inconnue.' });
      }

      const tool = mailbox.readTool;
      const registry = new ToolRegistry();
      registry.register(tool);
      const permissions =
        deps.permissions ??
        new PermissionManager({ rules: { [tool.name]: 'allow' }, default: 'deny' });
      const executor = new ToolExecutor(registry, permissions);

      let emails;
      try {
        emails = await fetchEmailsViaTool(executor, {
          toolName: tool.name,
          input: { maxResults: DRAFT_LOOKUP_MAX_RESULTS },
        });
      } catch (err) {
        if (err instanceof EmailFetchBlockedError && err.outcome.status === 'denied') {
          return reply
            .code(403)
            .send({ error: 'Lecture refusée par la politique de permissions.' });
        }
        const status =
          err instanceof EmailFetchBlockedError ? err.outcome.status : 'unexpected_output';
        return reply.code(502).send({ error: `Lecture échouée (${status}).` });
      }

      const email = emails.find((candidate) => candidate.id === input.messageId);
      if (email === undefined) {
        return reply.code(404).send({ error: 'Message inconnu dans cette boîte.' });
      }

      const workflow = new EmailReplyWorkflow({
        analyzer: deps.analyzer,
        planner: deps.planner,
        memory: deps.memory ?? new InMemoryMemoryStore(),
        memorySelector: SELECT_ALL_MEMORY,
      });
      const result = await workflow.process({ email });

      if (result.status === 'analysis_failed') {
        return reply.code(502).send({ status: 'error', reason: result.analysis.reason });
      }
      if (result.status === 'draft_failed') {
        return reply.code(502).send({ status: 'error', reason: result.draft.reason });
      }

      const questions = [...result.analysis.missingInformation, ...(result.draft.unresolved ?? [])];
      if (questions.length > 0) {
        return reply.send({
          status: 'needs_clarification',
          mailboxId: mailbox.id,
          messageId: email.id,
          questions,
        });
      }

      const confirmedFacts = result.selectedMemory.map((entry) => entry.statement);
      const check = checkDraftAgainstConfirmedFacts(result.draft.body, confirmedFacts);
      if (!check.ok) {
        return reply.send({
          status: 'blocked',
          mailboxId: mailbox.id,
          messageId: email.id,
          reason: check.violation,
        });
      }

      return reply.send({
        status: 'ok',
        mailboxId: mailbox.id,
        messageId: email.id,
        draft: {
          body: result.draft.body,
          ...(result.draft.subject !== undefined ? { subject: result.draft.subject } : {}),
        },
      });
    });
  });
}
