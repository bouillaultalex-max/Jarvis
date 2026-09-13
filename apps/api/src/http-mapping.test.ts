import { describe, expect, it } from 'vitest';

import type { ToolExecutionResult } from '@jarvis/core';
import type { ConfirmAndExecuteResult, ConfirmationRequest } from '@jarvis/connectors';

import {
  confirmationDeniedResponse,
  mapChatToolBlockedResult,
  mapConfirmAndExecuteResult,
  mapToolBlockedWithoutOutcome,
} from './http-mapping.js';

const FAKE_CONFIRMATION_REQUEST: ConfirmationRequest = Object.freeze({
  confirmationId: 'conf-1',
  toolName: 'internal.fake_execute',
  action: 'execute',
  account: Object.freeze({
    accountId: 'internal-fake-tool',
    provider: 'internal',
    accountIdentifier: 'internal-fake-tool',
  }),
  summary: Object.freeze({ fields: Object.freeze([]) }),
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:05:00.000Z',
});

describe('mapChatToolBlockedResult', () => {
  it('renvoie 202 avec la confirmation pour awaiting_confirmation', () => {
    const last: ToolExecutionResult = {
      status: 'awaiting_confirmation',
      decision: 'require_confirmation',
      toolName: 'internal.fake_execute',
      action: 'execute',
      input: { mode: 'confirm' },
      reason: 'peu importe, jamais recopié',
    };

    const result = mapChatToolBlockedResult(last, FAKE_CONFIRMATION_REQUEST);

    expect(result).toEqual({
      code: 202,
      body: { status: 'confirmation_required', confirmation: FAKE_CONFIRMATION_REQUEST },
    });
  });

  it('renvoie 500 générique si awaiting_confirmation sans ConfirmationRequest fourni', () => {
    const last: ToolExecutionResult = {
      status: 'awaiting_confirmation',
      decision: 'require_confirmation',
      toolName: 'internal.fake_execute',
      action: 'execute',
      input: {},
      reason: 'peu importe',
    };

    expect(mapChatToolBlockedResult(last)).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
  });

  it('renvoie 403 avec le message fixe pour denied, jamais le reason brut', () => {
    const last: ToolExecutionResult = {
      status: 'denied',
      decision: 'deny',
      reason: 'Action « internal.fake_execute » refusée par la politique de permissions.',
    };

    expect(mapChatToolBlockedResult(last)).toEqual({
      code: 403,
      body: { status: 'tool_denied', reason: 'Action denied by policy.' },
    });
  });

  it('renvoie 422 avec le message fixe pour invalid_input, jamais le reason brut', () => {
    const last: ToolExecutionResult = {
      status: 'invalid_input',
      reason: '« mode » doit valoir « confirm » ou « error ».',
    };

    expect(mapChatToolBlockedResult(last)).toEqual({
      code: 422,
      body: { status: 'invalid_tool_input', reason: 'Invalid tool input.' },
    });
  });

  it('renvoie 500 générique pour unknown_tool, sans jamais le nom d’outil', () => {
    const last: ToolExecutionResult = {
      status: 'unknown_tool',
      reason: 'Outil inconnu : « some.other.tool ».',
    };

    const result = mapChatToolBlockedResult(last);

    expect(result).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
    expect(JSON.stringify(result.body)).not.toContain('some.other.tool');
  });

  it('renvoie 502 avec le message fixe pour error, jamais le détail de l’exception', () => {
    const last: ToolExecutionResult = {
      status: 'error',
      reason: 'Erreur de test interne délibérée (outil factice).',
    };

    const result = mapChatToolBlockedResult(last);

    expect(result).toEqual({
      code: 502,
      body: { status: 'tool_execution_failed', reason: 'Tool execution failed.' },
    });
    expect(JSON.stringify(result.body)).not.toContain('délibérée');
  });

  it('renvoie 500 générique quand aucun toolOutcome exploitable n’est disponible', () => {
    expect(mapChatToolBlockedResult(undefined)).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
  });

  it('renvoie 500 générique (défense en profondeur) si le dernier outcome est executed', () => {
    const last: ToolExecutionResult = {
      status: 'executed',
      decision: 'allow',
      output: { ok: true },
    };

    expect(mapChatToolBlockedResult(last)).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
  });
});

describe('mapConfirmAndExecuteResult', () => {
  it('renvoie 200 avec la sortie brute de l’outil pour executed', () => {
    const result: ConfirmAndExecuteResult = {
      status: 'executed',
      decision: 'require_confirmation',
      output: { ok: true, mode: 'confirm' },
    };

    expect(mapConfirmAndExecuteResult(result)).toEqual({
      code: 200,
      body: { ok: true, mode: 'confirm' },
    });
  });

  it('renvoie 502 avec le message fixe pour error', () => {
    const result: ConfirmAndExecuteResult = { status: 'error', reason: 'boom' };

    expect(mapConfirmAndExecuteResult(result)).toEqual({
      code: 502,
      body: { status: 'tool_execution_failed', reason: 'Tool execution failed.' },
    });
  });

  it('renvoie 404 pour confirmation_failed / not_found', () => {
    const result: ConfirmAndExecuteResult = {
      status: 'confirmation_failed',
      failureReason: 'not_found',
      reason: 'Invalid or expired confirmation',
    };

    expect(mapConfirmAndExecuteResult(result)).toEqual({
      code: 404,
      body: { status: 'confirmation_not_found' },
    });
  });

  it.each(['expired', 'payload_mismatch', 'denied', 'revoked', 'already_consumed'] as const)(
    'renvoie 409 générique pour confirmation_failed / %s',
    (failureReason) => {
      const result: ConfirmAndExecuteResult = {
        status: 'confirmation_failed',
        failureReason,
        reason: 'Invalid or expired confirmation',
      };

      expect(mapConfirmAndExecuteResult(result)).toEqual({
        code: 409,
        body: { status: 'confirmation_conflict' },
      });
    },
  );

  it.each(['denied', 'invalid_input', 'unknown_tool'] as const)(
    'renvoie 500 générique pour %s après un verify() réussi (ADR-0009 §10)',
    (status) => {
      const result = { status, reason: 'peu importe' } as unknown as ConfirmAndExecuteResult;

      expect(mapConfirmAndExecuteResult(result)).toEqual({
        code: 500,
        body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
      });
    },
  );

  it('renvoie 500 générique (défense en profondeur) si awaiting_confirmation réapparaît après verify()', () => {
    const result: ConfirmAndExecuteResult = {
      status: 'awaiting_confirmation',
      decision: 'require_confirmation',
      toolName: 'internal.fake_execute',
      action: 'execute',
      input: {},
      reason: 'ne devrait jamais arriver ici',
    };

    expect(mapConfirmAndExecuteResult(result)).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
  });
});

describe('confirmationDeniedResponse / mapToolBlockedWithoutOutcome', () => {
  it('renvoie le corps exact du refus explicite', () => {
    expect(confirmationDeniedResponse()).toEqual({
      code: 200,
      body: { status: 'confirmation_denied' },
    });
  });

  it('renvoie le corps exact du cas limite tool_blocked sans toolOutcome', () => {
    expect(mapToolBlockedWithoutOutcome()).toEqual({
      code: 500,
      body: { status: 'internal_tool_error', reason: 'Internal tool error.' },
    });
  });
});
