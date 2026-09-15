import { Readable, Writable } from 'node:stream';

import type { GmailAppCredentials, ToolExecutionResult } from '@jarvis/connectors';
import { InMemoryAccountStore, InMemorySecretStore } from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopDeps } from './main.js';
import { interpretReadRequest } from './read-intent-parser.js';
import { convertReadInterpretationToToolRequest } from './read-intent-to-tool-request.js';
import { requestReadInterpretationAcceptance } from './read-interpretation-acceptance.js';
import { runReadNaturalLanguageFlow } from './read-natural-language-flow.js';

/**
 * Tests unitaires de l'orchestration VS-02d — entièrement déterministes,
 * doubles locaux uniquement. `runRead` (équivalent injectable de
 * `runReadFlow`) est **toujours** un double : ce module ne doit jamais
 * atteindre Gmail, le réseau, un compte réel ou `ToolExecutor` dans ces
 * tests. `parse`/`requestAcceptance`/`convertToToolRequest` sont, selon le
 * test, soit les fonctions réelles (composition genuine, sans réseau —
 * elles sont déjà pures/déterministes), soit des doubles forcés pour
 * isoler un cas précis.
 */

const APP_CREDENTIALS: GmailAppCredentials = {
  clientId: 'app-client-id',
  clientSecret: 'FAKE-APP-CLIENT-SECRET',
};

function fakeDeps(): DesktopDeps {
  return {
    accountStore: new InMemoryAccountStore(),
    secretStore: new InMemorySecretStore(),
    appCredentials: APP_CREDENTIALS,
  };
}

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

const EXECUTED_RESULT: ToolExecutionResult = {
  status: 'executed',
  decision: 'allow',
  output: { messages: [] },
};

describe('runReadNaturalLanguageFlow — demande comprise et acceptée', () => {
  it('« Lis mes 5 derniers emails » → parse/acceptation/conversion/lecture appelés, résultat propagé', async () => {
    const parse = vi.fn(interpretReadRequest);
    const requestAcceptance = vi.fn(requestReadInterpretationAcceptance);
    const convertToToolRequest = vi.fn(convertReadInterpretationToToolRequest);
    const runRead = vi.fn().mockResolvedValue(EXECUTED_RESULT);

    const { output } = collectingOutput();
    const deps = fakeDeps();
    const write = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'Lis mes 5 derniers emails',
      deps,
      { input: Readable.from(['oui\n']), output },
      write,
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith('Lis mes 5 derniers emails');
    expect(requestAcceptance).toHaveBeenCalledTimes(1);
    expect(convertToToolRequest).toHaveBeenCalledTimes(1);
    expect(runRead).toHaveBeenCalledTimes(1);
    expect(runRead).toHaveBeenCalledWith(deps, { maxResults: 5 }, write, undefined);

    expect(result.status).toBe('read_result');
    if (result.status !== 'read_result') return;
    expect(result.result).toBe(EXECUTED_RESULT);
    expect(result.toolRequest).toEqual({ tool: 'gmail.read', input: { maxResults: 5 } });
  });
});

describe('runReadNaturalLanguageFlow — demande comprise mais refusée', () => {
  it('refus explicite → conversion et lecture jamais appelées', async () => {
    const understood = interpretReadRequest('lis mes derniers mails');
    const parse = vi.fn().mockReturnValue(understood);
    const requestAcceptance = vi.fn().mockResolvedValue({ accepted: false, reason: 'declined' });
    const convertToToolRequest = vi.fn(convertReadInterpretationToToolRequest);
    const runRead = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'lis mes derniers mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(requestAcceptance).toHaveBeenCalledTimes(1);
    expect(convertToToolRequest).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();

    expect(result.status).toBe('declined');
    if (result.status !== 'declined') return;
    expect(result.reason).toBe('declined');
  });
});

describe('runReadNaturalLanguageFlow — demande ambiguë', () => {
  it('« Regarde mes mails » → arrêt après le parser, aucune acceptation/conversion/lecture', async () => {
    const parse = vi.fn(interpretReadRequest);
    const requestAcceptance = vi.fn();
    const convertToToolRequest = vi.fn();
    const runRead = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'Regarde mes mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(requestAcceptance).not.toHaveBeenCalled();
    expect(convertToToolRequest).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();

    expect(result.status).toBe('ambiguous');
  });
});

describe('runReadNaturalLanguageFlow — demande non supportée', () => {
  it('« Supprime mes emails » → arrêt après le parser, aucune acceptation/conversion/exécution', async () => {
    const parse = vi.fn(interpretReadRequest);
    const requestAcceptance = vi.fn();
    const convertToToolRequest = vi.fn();
    const runRead = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'Supprime mes emails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(requestAcceptance).not.toHaveBeenCalled();
    expect(convertToToolRequest).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();

    expect(result.status).toBe('unsupported');
  });
});

describe('runReadNaturalLanguageFlow — erreur d’acceptation', () => {
  it('input-error → retourné proprement, conversion et lecture jamais appelées', async () => {
    const understood = interpretReadRequest('lis mes derniers mails');
    const parse = vi.fn().mockReturnValue(understood);
    const requestAcceptance = vi.fn().mockResolvedValue({ accepted: false, reason: 'input-error' });
    const convertToToolRequest = vi.fn();
    const runRead = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'lis mes derniers mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(convertToToolRequest).not.toHaveBeenCalled();
    expect(runRead).not.toHaveBeenCalled();

    expect(result.status).toBe('acceptance_error');
    if (result.status !== 'acceptance_error') return;
    expect(result.reason).toBe('input-error');
  });
});

describe('runReadNaturalLanguageFlow — échec de conversion', () => {
  it('acceptation positive mais conversion en échec → lecture jamais appelée, raison conservée', async () => {
    const understood = interpretReadRequest('lis mes derniers mails');
    const parse = vi.fn().mockReturnValue(understood);
    const requestAcceptance = vi.fn().mockResolvedValue({ accepted: true });
    const convertToToolRequest = vi.fn().mockReturnValue({
      ok: false,
      reason: 'raison de test — conversion refusée',
    });
    const runRead = vi.fn();

    const result = await runReadNaturalLanguageFlow(
      'lis mes derniers mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(requestAcceptance).toHaveBeenCalledTimes(1);
    expect(runRead).not.toHaveBeenCalled();

    expect(result.status).toBe('conversion_failed');
    if (result.status !== 'conversion_failed') return;
    expect(result.reason).toBe('raison de test — conversion refusée');
  });
});

describe('runReadNaturalLanguageFlow — résultat de lecture en erreur ou non exécuté', () => {
  it('propage un ToolExecutionResult « error » sans transformation ni succès artificiel', async () => {
    const understood = interpretReadRequest('lis mes derniers mails');
    const parse = vi.fn().mockReturnValue(understood);
    const requestAcceptance = vi.fn().mockResolvedValue({ accepted: true });
    const convertToToolRequest = vi.fn(convertReadInterpretationToToolRequest);
    const errorResult: ToolExecutionResult = { status: 'error', reason: 'panne simulée' };
    const runRead = vi.fn().mockResolvedValue(errorResult);

    const result = await runReadNaturalLanguageFlow(
      'lis mes derniers mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(result.status).toBe('read_result');
    if (result.status !== 'read_result') return;
    expect(result.result).toEqual(errorResult);
    expect(result.result.status).not.toBe('executed');
  });

  it('propage un ToolExecutionResult « denied » sans le réinterpréter', async () => {
    const understood = interpretReadRequest('lis mes derniers mails');
    const parse = vi.fn().mockReturnValue(understood);
    const requestAcceptance = vi.fn().mockResolvedValue({ accepted: true });
    const convertToToolRequest = vi.fn(convertReadInterpretationToToolRequest);
    const deniedResult: ToolExecutionResult = {
      status: 'denied',
      decision: 'deny',
      reason: 'refusé par la politique de permissions',
    };
    const runRead = vi.fn().mockResolvedValue(deniedResult);

    const result = await runReadNaturalLanguageFlow(
      'lis mes derniers mails',
      fakeDeps(),
      {},
      vi.fn(),
      undefined,
      { parse, requestAcceptance, convertToToolRequest, runRead },
    );

    expect(result.status).toBe('read_result');
    if (result.status !== 'read_result') return;
    expect(result.result).toEqual(deniedResult);
  });
});

describe('runReadNaturalLanguageFlow — inatteignabilité structurelle de gmail.send', () => {
  it(
    'ne transmet jamais de nom d’outil à runRead — seul un input de lecture est transmis, ' +
      'jamais toolRequest.tool ; propriété structurelle de cet orchestrateur uniquement, ' +
      'pas une preuve de sécurité de toute l’application',
    async () => {
      const understood = interpretReadRequest('affiche mes 3 derniers mails');
      const parse = vi.fn().mockReturnValue(understood);
      const requestAcceptance = vi.fn().mockResolvedValue({ accepted: true });
      const convertToToolRequest = vi.fn(convertReadInterpretationToToolRequest);
      const runRead = vi.fn().mockResolvedValue(EXECUTED_RESULT);
      const deps = fakeDeps();
      const write = vi.fn();

      await runReadNaturalLanguageFlow('affiche mes 3 derniers mails', deps, {}, write, undefined, {
        parse,
        requestAcceptance,
        convertToToolRequest,
        runRead,
      });

      expect(runRead).toHaveBeenCalledTimes(1);
      const callArgs = runRead.mock.calls[0]!;
      const [calledDeps, calledInput, calledWrite, calledConnect] = callArgs;

      // Seuls 4 arguments sont transmis à runRead, dans cet ordre exact —
      // aucun nom d'outil n'y figure nulle part.
      expect(callArgs).toHaveLength(4);
      expect(calledDeps).toBe(deps);
      expect(calledInput).toEqual({ maxResults: 3 });
      expect(calledInput).not.toHaveProperty('tool');
      expect(calledWrite).toBe(write);
      expect(calledConnect).toBeUndefined();
    },
  );
});
