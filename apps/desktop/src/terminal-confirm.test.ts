import { Readable, Writable } from 'node:stream';

import { buildConfirmationRequest, buildGmailSendConfirmationSummary, type Account } from '@jarvis/connectors';
import { describe, expect, it } from 'vitest';

import { createTerminalConfirm } from './terminal-confirm.js';

/**
 * M8-B5 — confirmation terminal. Flux injectés (aucun vrai TTY).
 * Valeurs strictement artificielles.
 */

const ACCOUNT: Account = {
  id: 'acc-1',
  provider: 'gmail',
  accountIdentifier: 'alice@example.test',
  status: 'connected',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(body = 'Contenu du message', threadId?: string) {
  return buildConfirmationRequest({
    confirmationId: 'CONFIRMATION-ID-NE-DOIT-PAS-S-AFFICHER',
    createdAt: '2026-02-02T10:00:00.000Z',
    expiresAt: '2026-02-02T10:05:00.000Z',
    toolName: 'gmail.send',
    action: 'execute',
    account: ACCOUNT,
    summary: buildGmailSendConfirmationSummary({
      to: 'dest@example.test',
      subject: 'Objet de test',
      body,
      ...(threadId !== undefined ? { threadId } : {}),
    }),
  });
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

function answerStream(answer?: string): Readable {
  return Readable.from(answer === undefined ? [] : [answer]);
}

describe('createTerminalConfirm — M8-B5', () => {
  it('affiche l’outil/action, l’identifiant de compte et chaque champ du résumé', async () => {
    const { output, readText } = collectingOutput();
    const confirm = createTerminalConfirm({ input: answerStream('y\n'), output });

    await confirm(makeRequest('Bonjour', 'thread-42'));
    const rendered = readText();

    expect(rendered).toContain('gmail.send');
    expect(rendered).toContain('execute');
    expect(rendered).toContain('alice@example.test');
    expect(rendered).toContain('Destinataire : dest@example.test');
    expect(rendered).toContain('Objet : Objet de test');
    expect(rendered).toContain('Corps du message : Bonjour');
    expect(rendered).toContain('Fil de discussion : thread-42');
    expect(rendered).toContain("Confirmer l'envoi ? [y/N]");
  });

  it('n’affiche jamais le confirmationId, ni les horodatages, ni une sérialisation de l’objet', async () => {
    const { output, readText } = collectingOutput();
    const confirm = createTerminalConfirm({ input: answerStream('n\n'), output });

    await confirm(makeRequest());
    const rendered = readText();

    expect(rendered).not.toContain('CONFIRMATION-ID-NE-DOIT-PAS-S-AFFICHER');
    expect(rendered).not.toContain('2026-02-02T10:00:00.000Z');
    expect(rendered).not.toContain('2026-02-02T10:05:00.000Z');
    expect(rendered).not.toContain('{');
    expect(rendered).not.toContain('confirmationId');
  });

  it('accepte y / yes / oui (insensible à la casse et aux espaces de bord)', async () => {
    for (const answer of ['y\n', 'Y\n', 'yes\n', 'YES\n', ' oui \n', 'Oui\n']) {
      const { output } = collectingOutput();
      const confirm = createTerminalConfirm({ input: answerStream(answer), output });
      await expect(confirm(makeRequest())).resolves.toBe(true);
    }
  });

  it('refuse toute autre réponse, une ligne vide, ou EOF', async () => {
    for (const answer of ['n\n', 'no\n', 'non\n', 'blabla\n', '\n', ' \n', 'yesss\n']) {
      const { output } = collectingOutput();
      const confirm = createTerminalConfirm({ input: answerStream(answer), output });
      await expect(confirm(makeRequest())).resolves.toBe(false);
    }

    const { output } = collectingOutput();
    const confirmEof = createTerminalConfirm({ input: answerStream(undefined), output });
    await expect(confirmEof(makeRequest())).resolves.toBe(false);
  });

  it('ne lève jamais, même sur flux d’entrée vide', async () => {
    const { output } = collectingOutput();
    const confirm = createTerminalConfirm({ input: answerStream(''), output });
    await expect(confirm(makeRequest())).resolves.toBe(false);
  });

  it('un corps très long est affiché tronqué (marqueur […]) — provient du résumé gelé, jamais du fingerprint', async () => {
    const { output, readText } = collectingOutput();
    const confirm = createTerminalConfirm({ input: answerStream('y\n'), output });

    await confirm(makeRequest('x'.repeat(2000)));
    expect(readText()).toContain('Corps du message : ');
    expect(readText()).toContain('[…]');
  });
});
