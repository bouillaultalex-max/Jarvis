import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { LlmMessage, LlmProvider, LlmResponse, Tool } from '@jarvis/core';
import { PermissionManager, ToolExecutor, ToolRegistry, invalid, valid } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import { buildServer } from '../server.js';
import {
  INTERNAL_FAKE_EXECUTE_TOOL_NAME,
  internalFakeExecuteTool,
} from '../tools/internal-fake-tool.js';
import { FIXTURE_READ_TOOL_NAME, fixtureMailbox } from './fixture-mailbox.js';
import {
  MAX_BATCH_SIZE,
  registerInboxRoutes,
  type InboxMailbox,
  type InboxRoutesDependencies,
} from './inbox-routes.js';

/**
 * Routes Inbox du centre de commandement — temps A : boîte fictive seule.
 * Aucun réseau, aucun compte, aucun secret ; le LLM n'apparaît que sous forme
 * de double, injecté explicitement par les tests de restitution.
 */

function buildApp(deps: InboxRoutesDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerInboxRoutes(app, deps);
  return app;
}

function postRun(app: FastifyInstance, payload: unknown, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/inbox/runs',
    payload: payload as Record<string, unknown>,
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
  });
}

function mailboxWith(readTool: Tool): InboxMailbox {
  return { id: 'test-box', label: 'Boîte de test', kind: 'fixture', readTool };
}

function readToolReturning(execute: () => Promise<unknown>): Tool {
  return {
    name: 'test.read',
    description: 'Outil de lecture de test.',
    action: 'read',
    inputSchema: { type: 'object', properties: {}, required: [] },
    validateInput: (input: unknown) => (input === null ? invalid('entrée nulle') : valid(input)),
    execute,
  };
}

const EMAIL: EmailMessage = {
  id: 'e1',
  sender: 'chef@exemple.test',
  recipients: ['moi@exemple.test'],
  subject: 'Budget à valider',
  body: 'Corps de test.',
  receivedAt: '2026-11-02T08:00:00.000Z',
};

/** Double LLM : JSON pour la classification, texte pour le résumé. Zéro réseau. */
class FakeLlm implements LlmProvider {
  public readonly calls: LlmMessage[][] = [];
  /** Noms des outils présentés au LLM à chaque appel. */
  public readonly toolNames: string[][] = [];

  constructor(private readonly label = 'important') {}

  async chat(
    messages: LlmMessage[],
    options?: { tools?: readonly { name: string }[] },
  ): Promise<LlmResponse> {
    this.calls.push(messages);
    this.toolNames.push((options?.tools ?? []).map((tool) => tool.name));
    const system = String(messages[0]?.content ?? '');
    if (system.includes('résumes')) {
      return { content: 'Résumé de test.' };
    }
    return { content: JSON.stringify({ label: this.label, reason: 'Raison du double LLM.' }) };
  }
}

describe('GET /inbox/mailboxes', () => {
  it('liste la boîte fictive, clairement étiquetée, et la borne du lot', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/inbox/mailboxes' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      mailboxes: [{ id: 'fixture', label: 'Boîte fictive', kind: 'fixture' }],
      maxBatchSize: 10,
    });
  });
});

describe('POST /inbox/runs — lot nominal sur la boîte fictive', () => {
  it('renvoie un lot calculé par le pipeline, avec identifiant d’exécution et source', async () => {
    const res = await postRun(buildApp(), { mailboxId: 'fixture', maxResults: 3 });
    const run = res.json();

    expect(res.statusCode).toBe(200);
    expect(run.status).toBe('completed');
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.mailbox).toEqual({ id: 'fixture', label: 'Boîte fictive', kind: 'fixture' });
    expect(run.source).toEqual({ tool: FIXTURE_READ_TOOL_NAME, requested: 3, returned: 3 });
    expect(run.items).toHaveLength(3);
    expect(run.error).toBeUndefined();
  });

  it('sans LLM, chaque message est « incertain » par repli, avec sa raison', async () => {
    const run = (await postRun(buildApp(), { mailboxId: 'fixture', maxResults: 2 })).json();

    for (const item of run.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['id', 'label', 'reason', 'receivedAt', 'sender', 'source', 'subject'].sort(),
      );
      expect(item.label).toBe('uncertain');
      expect(item.source).toBe('default');
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  it('distingue les étapes exécutées des étapes non activées', async () => {
    const run = (await postRun(buildApp(), { mailboxId: 'fixture', maxResults: 2 })).json();

    expect(run.steps.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      ['read', 'executed'],
      ['classify', 'executed'],
      ['llm_classification', 'not_enabled'],
      ['summary', 'not_enabled'],
    ]);
  });

  it('ne renvoie jamais le corps des messages', async () => {
    const res = await postRun(buildApp(), { mailboxId: 'fixture', maxResults: MAX_BATCH_SIZE });

    expect(res.json().items).toHaveLength(MAX_BATCH_SIZE);
    expect(res.body).not.toContain('"body"');
  });

  it('deux exécutions ont des identifiants différents', async () => {
    const app = buildApp();
    const first = (await postRun(app, { mailboxId: 'fixture', maxResults: 1 })).json();
    const second = (await postRun(app, { mailboxId: 'fixture', maxResults: 1 })).json();

    expect(first.runId).not.toBe(second.runId);
  });
});

describe('POST /inbox/runs — entrées refusées avant toute lecture', () => {
  it.each([
    ['taille nulle', { mailboxId: 'fixture', maxResults: 0 }],
    ['taille au-delà de la borne', { mailboxId: 'fixture', maxResults: 11 }],
    ['taille non entière', { mailboxId: 'fixture', maxResults: 2.5 }],
    ['taille en chaîne', { mailboxId: 'fixture', maxResults: '5' }],
    ['taille absente', { mailboxId: 'fixture' }],
    ['boîte absente', { maxResults: 5 }],
    [
      'clé supplémentaire (nom d’outil)',
      { mailboxId: 'fixture', maxResults: 5, tool: 'gmail.send' },
    ],
    ['corps non objet', [1, 2]],
  ])('%s → 400, aucun lot', async (_label, payload) => {
    let reads = 0;
    const spied: InboxMailbox = {
      ...fixtureMailbox,
      readTool: {
        ...fixtureMailbox.readTool,
        execute: async () => ((reads += 1), { messages: [] }),
      },
    };

    const res = await postRun(buildApp({ mailboxes: [spied] }), payload);

    expect(res.statusCode).toBe(400);
    expect(res.json().runId).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('boîte inconnue → 404', async () => {
    const res = await postRun(buildApp(), { mailboxId: 'gmail', maxResults: 5 });

    expect(res.statusCode).toBe(404);
    expect(res.json().runId).toBeUndefined();
  });
});

describe('POST /inbox/runs — refus et erreurs visibles, sans faux résultat', () => {
  it('lecture refusée par la politique → 403, étape « refused », aucun message', async () => {
    const app = buildApp({ permissions: new PermissionManager() });

    const res = await postRun(app, { mailboxId: 'fixture', maxResults: 3 });
    const run = res.json();

    expect(res.statusCode).toBe(403);
    expect(run.status).toBe('failed');
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.items).toEqual([]);
    expect(run.error).toContain('refusée');
    expect(run.steps.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      ['read', 'refused'],
      ['classify', 'skipped'],
      ['llm_classification', 'not_enabled'],
      ['summary', 'not_enabled'],
    ]);
  });

  it('erreur technique de lecture → 502, sans fuite du message brut', async () => {
    const tool = readToolReturning(async () => {
      throw new Error('DETAIL-INTERNE-A-NE-PAS-AFFICHER');
    });

    const res = await postRun(buildApp({ mailboxes: [mailboxWith(tool)] }), {
      mailboxId: 'test-box',
      maxResults: 3,
    });
    const run = res.json();

    expect(res.statusCode).toBe(502);
    expect(run.status).toBe('failed');
    expect(run.items).toEqual([]);
    expect(run.steps[0]).toMatchObject({ id: 'read', status: 'failed' });
    expect(run.steps[1]).toMatchObject({ id: 'classify', status: 'skipped' });
    expect(res.body).not.toContain('DETAIL-INTERNE');
  });

  it('sortie de lecture malformée → 502, aucun message', async () => {
    const tool = readToolReturning(async () => ({ pasDeMessages: true }));

    const res = await postRun(buildApp({ mailboxes: [mailboxWith(tool)] }), {
      mailboxId: 'test-box',
      maxResults: 3,
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().items).toEqual([]);
    expect(res.json().steps[0]).toMatchObject({ id: 'read', status: 'failed' });
  });

  it('une lecture qui renvoie plus que demandé est tronquée à la taille du lot', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...EMAIL, id: `e${i}` }));
    const tool = readToolReturning(async () => ({ messages: many }));

    const run = (
      await postRun(buildApp({ mailboxes: [mailboxWith(tool)] }), {
        mailboxId: 'test-box',
        maxResults: 4,
      })
    ).json();

    expect(run.items).toHaveLength(4);
    expect(run.source.returned).toBe(4);
  });
});

describe('Routes Inbox — aucune capacité d’envoi ou de modification', () => {
  it('l’outil de la boîte fictive est une lecture, sans autre méthode exposée', () => {
    expect(fixtureMailbox.readTool.action).toBe('read');
    expect(fixtureMailbox.readTool.name).toBe(FIXTURE_READ_TOOL_NAME);
  });

  it('refuse au démarrage une boîte dont l’outil n’est pas une lecture', () => {
    for (const action of ['prepare', 'execute'] as const) {
      const tool: Tool = { ...readToolReturning(async () => ({ messages: [] })), action };

      expect(() => buildApp({ mailboxes: [mailboxWith(tool)] })).toThrow(/lecture/);
    }
  });

  it('n’expose que les deux routes Inbox prévues', async () => {
    const app = buildApp();
    await app.ready();

    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain('/inbox/mailboxes (GET, HEAD)');
    expect(routes).toContain('/inbox/runs (POST)');
    expect(routes).not.toMatch(/send|modify|delete|trash|confirm|chat/i);

    for (const [method, url] of [
      ['POST', '/inbox/send'],
      ['POST', '/inbox/modify'],
      ['DELETE', '/inbox/runs'],
      ['PUT', '/inbox/runs'],
      ['POST', '/inbox/mailboxes'],
    ] as const) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('le lot n’invoque que l’outil de lecture de la boîte choisie', async () => {
    const invoked: string[] = [];
    const tool = readToolReturning(async () => (invoked.push('test.read'), { messages: [EMAIL] }));
    const other: InboxMailbox = {
      id: 'autre',
      label: 'Autre',
      kind: 'fixture',
      readTool: {
        ...readToolReturning(async () => (invoked.push('autre.read'), { messages: [] })),
        name: 'autre.read',
      },
    };

    await postRun(buildApp({ mailboxes: [mailboxWith(tool), other] }), {
      mailboxId: 'test-box',
      maxResults: 1,
    });

    expect(invoked).toEqual(['test.read']);
  });
});

describe('Routes Inbox — accès limité au loopback', () => {
  it.each(['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20'])(
    'refuse une adresse distante (%s)',
    async (remoteAddress) => {
      const app = buildApp();

      const list = await app.inject({ method: 'GET', url: '/inbox/mailboxes', remoteAddress });
      const run = await postRun(app, { mailboxId: 'fixture', maxResults: 1 }, remoteAddress);

      expect(list.statusCode).toBe(403);
      expect(run.statusCode).toBe(403);
      expect(run.json().runId).toBeUndefined();
    },
  );

  it('refuse un en-tête Host non local (rebinding DNS)', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/inbox/mailboxes',
      headers: { host: 'evil.example:3000' },
    });

    expect(res.statusCode).toBe(403);
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepte le loopback (%s)',
    async (remoteAddress) => {
      const res = await buildApp().inject({
        method: 'GET',
        url: '/inbox/mailboxes',
        remoteAddress,
      });

      expect(res.statusCode).toBe(200);
    },
  );
});

describe('POST /inbox/runs — restitution avec un double LLM (tests uniquement)', () => {
  it('sans double injecté, aucun LLM n’est appelé', async () => {
    const llm = new FakeLlm();

    await postRun(buildApp(), { mailboxId: 'fixture', maxResults: MAX_BATCH_SIZE });

    expect(llm.calls).toHaveLength(0);
  });

  it('avec le double, libellé, raison, provenance « llm » et résumé sont restitués', async () => {
    const llm = new FakeLlm();
    const tool = readToolReturning(async () => ({ messages: [EMAIL] }));

    const run = (
      await postRun(buildApp({ mailboxes: [mailboxWith(tool)], llmProvider: llm }), {
        mailboxId: 'test-box',
        maxResults: 1,
      })
    ).json();

    expect(run.items).toEqual([
      {
        id: 'e1',
        sender: 'chef@exemple.test',
        subject: 'Budget à valider',
        receivedAt: '2026-11-02T08:00:00.000Z',
        label: 'important',
        source: 'llm',
        reason: 'Raison du double LLM.',
        summary: 'Résumé de test.',
      },
    ]);
    expect(run.steps.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      ['read', 'executed'],
      ['classify', 'executed'],
      ['llm_classification', 'executed'],
      ['summary', 'executed'],
    ]);
    expect(llm.calls).toHaveLength(2);
  });
});

describe('POST /inbox/runs — étapes LLM fidèles aux opérations réellement faites', () => {
  const stepStatuses = (run: { steps: { id: string; status: string }[] }) =>
    Object.fromEntries(run.steps.map((step) => [step.id, step.status]));

  it('aucun message « important » : le résumé n’est pas annoncé comme exécuté', async () => {
    const llm = new FakeLlm('not_important');
    const tool = readToolReturning(async () => ({ messages: [EMAIL] }));

    const run = (
      await postRun(buildApp({ mailboxes: [mailboxWith(tool)], llmProvider: llm }), {
        mailboxId: 'test-box',
        maxResults: 1,
      })
    ).json();

    expect(llm.calls).toHaveLength(1);
    expect(stepStatuses(run)).toMatchObject({ llm_classification: 'executed', summary: 'skipped' });
    expect(run.items[0].summary).toBeUndefined();
  });

  it('boîte vide : ni classification LLM ni résumé annoncés comme exécutés', async () => {
    const llm = new FakeLlm();
    const tool = readToolReturning(async () => ({ messages: [] }));

    const run = (
      await postRun(buildApp({ mailboxes: [mailboxWith(tool)], llmProvider: llm }), {
        mailboxId: 'test-box',
        maxResults: 3,
      })
    ).json();

    expect(llm.calls).toHaveLength(0);
    expect(run.status).toBe('completed');
    expect(run.items).toEqual([]);
    expect(stepStatuses(run)).toEqual({
      read: 'executed',
      classify: 'skipped',
      llm_classification: 'skipped',
      summary: 'skipped',
    });
  });
});

describe('Routes Inbox et /chat sur le même serveur — ni LLM, ni outil, ni droit partagés', () => {
  // Même câblage que `main.ts` : chat avec l'outil factice et sa politique,
  // puis routes Inbox enregistrées sans aucune dépendance.
  function buildLikeMain() {
    const chatLlm = new FakeLlm();
    const registry = new ToolRegistry();
    registry.register(internalFakeExecuteTool);
    const chatExecutor = new ToolExecutor(
      registry,
      new PermissionManager({
        actionDefaults: { read: 'allow', prepare: 'allow', execute: 'require_confirmation' },
        default: 'deny',
      }),
    );
    const app = buildServer(chatLlm, { toolExecutor: chatExecutor });
    registerInboxRoutes(app);
    return { app, chatLlm, chatExecutor };
  }

  it('un lot Inbox n’appelle jamais le LLM du chat', async () => {
    const { app, chatLlm } = buildLikeMain();

    const res = await postRun(app, { mailboxId: 'fixture', maxResults: MAX_BATCH_SIZE });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(MAX_BATCH_SIZE);
    expect(chatLlm.calls).toHaveLength(0);
  });

  it('le chat ne voit ni ne peut exécuter l’outil de lecture Inbox', async () => {
    const { app, chatLlm, chatExecutor } = buildLikeMain();

    await app.inject({ method: 'POST', url: '/chat', payload: { message: 'Bonjour' } });

    expect(chatLlm.toolNames).toEqual([[INTERNAL_FAKE_EXECUTE_TOOL_NAME]]);
    const outcome = await chatExecutor.run({
      tool: FIXTURE_READ_TOOL_NAME,
      input: { maxResults: 1 },
    });
    expect(outcome.status).toBe('unknown_tool');
  });

  it('les routes du chat restent hors du contrôle loopback Inbox, et inversement', async () => {
    const { app } = buildLikeMain();

    const chat = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {},
      remoteAddress: '192.168.1.20',
    });
    const inbox = await app.inject({
      method: 'GET',
      url: '/inbox/mailboxes',
      remoteAddress: '192.168.1.20',
    });

    // /chat : validation habituelle (400), inchangée par ce travail.
    expect(chat.statusCode).toBe(400);
    expect(inbox.statusCode).toBe(403);
  });
});
