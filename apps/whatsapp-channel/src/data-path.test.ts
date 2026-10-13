import { describe, expect, it } from 'vitest';

import {
  defaultMessagesDbPath,
  defaultSendAttemptBudgetDbPath,
  resolveMessagesDbPath,
  resolveSendAttemptBudgetDbPath,
} from './data-path.js';

describe('data-path — séparation simulé/réel par défaut', () => {
  it("le store de messages simulé et le store réel ne sont jamais le même fichier par défaut — empêche l'envoi réel de travaux simulés préexistants", () => {
    const simulated = defaultMessagesDbPath('simulated');
    const real = defaultMessagesDbPath('real');
    expect(simulated).not.toBe(real);
    expect(real).toContain('real-trial');
    expect(simulated).not.toContain('real-trial');
  });

  it('le budget de tentative suit la même séparation par défaut', () => {
    expect(defaultSendAttemptBudgetDbPath('simulated')).not.toBe(
      defaultSendAttemptBudgetDbPath('real'),
    );
  });

  it('un override explicite (WHATSAPP_MESSAGES_DB_PATH) prime sur le défaut dépendant du mode — décision assumée de l’opérateur', () => {
    const previous = process.env.WHATSAPP_MESSAGES_DB_PATH;
    process.env.WHATSAPP_MESSAGES_DB_PATH = '/tmp/exemple-synthetique/messages.db';
    try {
      expect(resolveMessagesDbPath('simulated')).toBe('/tmp/exemple-synthetique/messages.db');
      expect(resolveMessagesDbPath('real')).toBe('/tmp/exemple-synthetique/messages.db');
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_MESSAGES_DB_PATH;
      else process.env.WHATSAPP_MESSAGES_DB_PATH = previous;
    }
  });

  it('un override explicite du budget prime pareillement', () => {
    const previous = process.env.WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH;
    process.env.WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH = '/tmp/exemple-synthetique/budget.db';
    try {
      expect(resolveSendAttemptBudgetDbPath('real')).toBe('/tmp/exemple-synthetique/budget.db');
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH;
      else process.env.WHATSAPP_SEND_ATTEMPT_BUDGET_DB_PATH = previous;
    }
  });
});
