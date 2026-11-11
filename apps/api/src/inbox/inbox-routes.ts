import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ClassificationEngine,
  InMemoryPreferenceStore,
  LlmProviderEmailClassifier,
} from '@jarvis/classification';
import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type LlmProvider,
  type Tool,
} from '@jarvis/core';
import {
  EmailFetchBlockedError,
  LlmProviderEmailSummarizer,
  classifyEmails,
  fetchEmailsViaTool,
  summarizeEmailsNeedingAttention,
  type AttentionSummary,
  type ClassifiedEmail,
} from '@jarvis/inbox';

import { fixtureMailbox } from './fixture-mailbox.js';

/**
 * Routes Inbox du centre de commandement — temps A (boîte fictive).
 *
 *   GET  /inbox/mailboxes                      → boîtes proposées
 *   POST /inbox/runs  { mailboxId, maxResults } → un lot lu puis classé
 *
 * Parcours séparé du chat : son propre registre (un seul outil, de lecture),
 * sa propre politique (refus par défaut), aucun `AgentLoop`. Le navigateur ne
 * fournit que l'identifiant de boîte et la taille du lot — jamais un nom
 * d'outil. Rien n'est conservé après la réponse.
 */

export const MAX_BATCH_SIZE = 10;

export interface InboxMailbox {
  readonly id: string;
  readonly label: string;
  readonly kind: 'fixture';
  /** Seul outil du registre de cette boîte ; doit être `action: 'read'`. */
  readonly readTool: Tool;
}

export interface InboxRoutesDependencies {
  /** Défaut : la boîte fictive seule. */
  readonly mailboxes?: readonly InboxMailbox[];
  /** Tests uniquement (lecture refusée). Défaut : seul l'outil de la boîte est autorisé. */
  readonly permissions?: PermissionManager;
  /** Tests uniquement (double). Absent dans le parcours normal : aucun LLM. */
  readonly llmProvider?: LlmProvider;
}

type StepStatus = 'executed' | 'refused' | 'failed' | 'skipped' | 'not_enabled';

interface RunStep {
  readonly id: 'read' | 'classify' | 'llm_classification' | 'summary';
  readonly status: StepStatus;
  readonly detail: string;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const RUN_INPUT_KEYS = ['mailboxId', 'maxResults'];

async function requireLoopback(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!LOOPBACK_ADDRESSES.has(request.ip) || !LOOPBACK_HOSTNAMES.has(request.hostname)) {
    await reply.code(403).send({ error: 'Routes Inbox accessibles uniquement depuis ce poste.' });
  }
}

function parseRunInput(body: unknown): { mailboxId: string; maxResults: number } | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Corps de requête JSON manquant ou invalide.';
  }
  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !RUN_INPUT_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return `Propriété(s) non acceptée(s) : ${unknownKeys.join(', ')}.`;
  }
  const { mailboxId, maxResults } = record;
  if (typeof mailboxId !== 'string' || mailboxId.length === 0) {
    return 'Le champ « mailboxId » est requis.';
  }
  if (
    typeof maxResults !== 'number' ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_BATCH_SIZE
  ) {
    return `Le champ « maxResults » doit être un entier entre 1 et ${MAX_BATCH_SIZE}.`;
  }
  return { mailboxId, maxResults };
}

function describeMailbox(mailbox: InboxMailbox) {
  return { id: mailbox.id, label: mailbox.label, kind: mailbox.kind };
}

/**
 * Étapes LLM, déduites de ce qui a réellement eu lieu : `submitted` messages
 * soumis au classifieur, `summaries` résumés demandés (`null` = rien n'a
 * tourné, la lecture ayant échoué).
 */
function llmSteps(
  llmEnabled: boolean,
  ran: { readonly submitted: number; readonly byLlm: number; readonly summaries: number } | null,
): readonly RunStep[] {
  if (!llmEnabled) {
    const detail = 'Aucun LLM configuré pour ce parcours.';
    return [
      { id: 'llm_classification', status: 'not_enabled', detail },
      { id: 'summary', status: 'not_enabled', detail },
    ];
  }
  return [
    ran !== null && ran.submitted > 0
      ? {
          id: 'llm_classification',
          status: 'executed',
          detail: `${ran.submitted} message(s) soumis au LLM, ${ran.byLlm} classé(s) par lui.`,
        }
      : { id: 'llm_classification', status: 'skipped', detail: 'Aucun message soumis au LLM.' },
    ran !== null && ran.summaries > 0
      ? {
          id: 'summary',
          status: 'executed',
          detail: `${ran.summaries} message(s) « important » soumis au résumé.`,
        }
      : { id: 'summary', status: 'skipped', detail: 'Aucun message « important » à résumer.' },
  ];
}

function toItem(entry: ClassifiedEmail, summaries: readonly AttentionSummary[]) {
  const { email, classification } = entry;
  const summary = summaries.find((s) => s.classified === entry)?.summary;
  return {
    id: email.id,
    sender: email.sender,
    subject: email.subject,
    receivedAt: email.receivedAt,
    label: classification.label,
    source: classification.source,
    reason: classification.reason,
    ...(summary !== undefined ? { summary } : {}),
  };
}

export function registerInboxRoutes(
  app: FastifyInstance,
  deps: InboxRoutesDependencies = {},
): void {
  const mailboxes = deps.mailboxes ?? [fixtureMailbox];
  for (const mailbox of mailboxes) {
    if (mailbox.readTool.action !== 'read') {
      throw new Error(
        `Routes Inbox : l'outil « ${mailbox.readTool.name} » n'est pas une lecture (action « ${mailbox.readTool.action} »).`,
      );
    }
  }
  const { llmProvider } = deps;
  const llmEnabled = llmProvider !== undefined;

  // Plugin encapsulé : le contrôle loopback ne s'applique qu'aux routes Inbox.
  void app.register(async (inbox) => {
    inbox.addHook('onRequest', requireLoopback);

    inbox.get('/inbox/mailboxes', async () => ({
      mailboxes: mailboxes.map(describeMailbox),
      maxBatchSize: MAX_BATCH_SIZE,
    }));

    inbox.post('/inbox/runs', async (request, reply) => {
      const input = parseRunInput(request.body);
      if (typeof input === 'string') {
        return reply.code(400).send({ error: input });
      }
      const mailbox = mailboxes.find((candidate) => candidate.id === input.mailboxId);
      if (mailbox === undefined) {
        return reply.code(404).send({ error: 'Boîte inconnue.' });
      }

      const runId = randomUUID();
      const tool = mailbox.readTool;
      const registry = new ToolRegistry();
      registry.register(tool);
      const permissions =
        deps.permissions ??
        new PermissionManager({ rules: { [tool.name]: 'allow' }, default: 'deny' });
      const executor = new ToolExecutor(registry, permissions);

      const failed = (httpStatus: number, readStatus: StepStatus, error: string) =>
        reply.code(httpStatus).send({
          runId,
          status: 'failed',
          mailbox: describeMailbox(mailbox),
          source: { tool: tool.name, requested: input.maxResults, returned: 0 },
          steps: [
            { id: 'read', status: readStatus, detail: error },
            { id: 'classify', status: 'skipped', detail: 'Non exécutée : aucun message lu.' },
            ...llmSteps(llmEnabled, null),
          ],
          items: [],
          error,
        });

      let emails;
      try {
        emails = (
          await fetchEmailsViaTool(executor, {
            toolName: tool.name,
            input: { maxResults: input.maxResults },
          })
        ).slice(0, input.maxResults);
      } catch (err) {
        // Messages contrôlés : jamais le `reason` brut de l'outil.
        if (err instanceof EmailFetchBlockedError && err.outcome.status === 'denied') {
          return failed(403, 'refused', 'Lecture refusée par la politique de permissions.');
        }
        const status =
          err instanceof EmailFetchBlockedError ? err.outcome.status : 'unexpected_output';
        return failed(502, 'failed', `Lecture échouée (${status}).`);
      }

      const engine = new ClassificationEngine({
        preferenceStore: new InMemoryPreferenceStore(),
        ...(llmProvider !== undefined
          ? { llmClassifier: new LlmProviderEmailClassifier(llmProvider) }
          : {}),
      });
      const classified = await classifyEmails(engine, emails);
      const summaries =
        llmProvider !== undefined
          ? await summarizeEmailsNeedingAttention(
              classified,
              new LlmProviderEmailSummarizer(llmProvider),
            )
          : [];

      return reply.send({
        runId,
        status: 'completed',
        mailbox: describeMailbox(mailbox),
        source: { tool: tool.name, requested: input.maxResults, returned: emails.length },
        steps: [
          { id: 'read', status: 'executed', detail: `${emails.length} message(s) lu(s).` },
          emails.length > 0
            ? {
                id: 'classify',
                status: 'executed',
                detail: `${emails.length} message(s) classé(s) : préférences connues, puis repli « incertain ».`,
              }
            : { id: 'classify', status: 'skipped', detail: 'Aucun message à classer.' },
          ...llmSteps(llmEnabled, {
            // Sans préférence enregistrée, chaque message lu est soumis au classifieur.
            submitted: emails.length,
            byLlm: classified.filter((entry) => entry.classification.source === 'llm').length,
            summaries: summaries.length,
          }),
        ],
        items: classified.map((entry) => toItem(entry, summaries)),
      });
    });
  });
}
