import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { interpretReadRequest, type ReadInterpretation } from './read-intent-parser.js';
import {
  describeReadInterpretationProposal,
  requestReadInterpretationAcceptance,
} from './read-interpretation-acceptance.js';

/**
 * Tests de `requestReadInterpretationAcceptance` — VS-02c
 * (`docs/second-readonly-vertical-slice.md`). Aucun terminal réel : flux
 * `readline` entièrement simulés (même patron que `terminal-confirm.test.ts`).
 * Aucun réseau, aucun LLM, aucun `ToolExecutor`/`PermissionManager`/
 * `ConfirmationService`/`AgentLoop`.
 */

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

/** `undefined` simule un flux fermé sans aucune ligne (EOF avant toute saisie). */
function answerStream(answer?: string): Readable {
  return Readable.from(answer === undefined ? [] : [answer]);
}

const UNDERSTOOD_WITH_LIMIT: ReadInterpretation = interpretReadRequest(
  'affiche mes 5 derniers mails',
);
const UNDERSTOOD_WITHOUT_LIMIT: ReadInterpretation = interpretReadRequest('lis mes derniers mails');
const AMBIGUOUS: ReadInterpretation = interpretReadRequest('regarde mes mails');
const UNSUPPORTED: ReadInterpretation = interpretReadRequest('supprime mes anciens mails');

describe('requestReadInterpretationAcceptance — réponses affirmatives', () => {
  it('« oui » → accepted true', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('oui\n'),
      output,
    });
    expect(result).toEqual({ accepted: true });
  });

  it('« o » → accepted true', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('o\n'),
      output,
    });
    expect(result).toEqual({ accepted: true });
  });

  it('« yes » → accepted true', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('yes\n'),
      output,
    });
    expect(result).toEqual({ accepted: true });
  });

  it('variantes de casse et d’espaces (« Y », «  Oui  ») → accepted true', async () => {
    for (const answer of ['Y\n', '  Oui  \n', 'YES\n']) {
      const { output } = collectingOutput();
      const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
        input: answerStream(answer),
        output,
      });
      expect(result).toEqual({ accepted: true });
    }
  });
});

describe('requestReadInterpretationAcceptance — réponses refusées (declined)', () => {
  it('« non » → accepted false, reason declined', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('non\n'),
      output,
    });
    expect(result).toEqual({ accepted: false, reason: 'declined' });
  });

  it('réponse vide (ligne vide tapée) → accepted false, reason declined', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('\n'),
      output,
    });
    expect(result).toEqual({ accepted: false, reason: 'declined' });
  });

  it('réponse inconnue → accepted false, reason declined', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('blabla\n'),
      output,
    });
    expect(result).toEqual({ accepted: false, reason: 'declined' });
  });

  it('réponse conditionnelle (« peut-être », « ok mais seulement si… ») → accepted false, declined, jamais interprétée', async () => {
    for (const answer of [
      'peut-être\n',
      'ok mais seulement si tu es sûr\n',
      'oui mais pas maintenant\n',
    ]) {
      const { output } = collectingOutput();
      const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
        input: answerStream(answer),
        output,
      });
      expect(result).toEqual({ accepted: false, reason: 'declined' });
    }
  });
});

describe('requestReadInterpretationAcceptance — absence de réponse', () => {
  it('EOF (flux fermé avant toute saisie) → accepted false, reason input-error', async () => {
    const { output } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream(undefined),
      output,
    });
    expect(result).toEqual({ accepted: false, reason: 'input-error' });
  });

  it('erreur readline (flux d’entrée émettant « error ») → résultat fermé et sûr, jamais d’exception', async () => {
    const { output } = collectingOutput();
    const failingInput = new Readable({
      read(): void {
        this.emit('error', new Error('lecture simulée en échec'));
      },
    });

    await expect(
      requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
        input: failingInput,
        output,
      }),
    ).resolves.toEqual({ accepted: false, reason: 'input-error' });
  });
});

describe('requestReadInterpretationAcceptance — interprétations non éligibles (aucune question posée)', () => {
  it('ambiguous → refus immédiat, aucune écriture sur output', async () => {
    const { output, readText } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(AMBIGUOUS, { output });

    expect(result).toEqual({ accepted: false, reason: 'invalid-interpretation' });
    expect(readText()).toBe('');
  });

  it('unsupported → refus immédiat, aucune écriture sur output', async () => {
    const { output, readText } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(UNSUPPORTED, { output });

    expect(result).toEqual({ accepted: false, reason: 'invalid-interpretation' });
    expect(readText()).toBe('');
  });

  it('understood sans proposedRead → refus immédiat, aucune écriture sur output', async () => {
    const forged: ReadInterpretation = {
      status: 'understood',
      originalRequest: 'texte forgé',
      explanation: 'forgé pour test',
      proposedRead: undefined,
    };
    const { output, readText } = collectingOutput();
    const result = await requestReadInterpretationAcceptance(forged, { output });

    expect(result).toEqual({ accepted: false, reason: 'invalid-interpretation' });
    expect(readText()).toBe('');
  });
});

describe('describeReadInterpretationProposal — texte de proposition', () => {
  it('understood avec maxResults → mentionne le nombre demandé', () => {
    const lines = describeReadInterpretationProposal(UNDERSTOOD_WITH_LIMIT);

    expect(lines).toBeDefined();
    expect(lines).toContain('Nombre maximal : 5.');
  });

  it('understood sans maxResults → aucune ligne « Nombre maximal »', () => {
    const lines = describeReadInterpretationProposal(UNDERSTOOD_WITHOUT_LIMIT);

    expect(lines).toBeDefined();
    expect(lines?.some((line) => line.startsWith('Nombre maximal'))).toBe(false);
  });

  it('ambiguous/unsupported → undefined (aucun texte de proposition)', () => {
    expect(describeReadInterpretationProposal(AMBIGUOUS)).toBeUndefined();
    expect(describeReadInterpretationProposal(UNSUPPORTED)).toBeUndefined();
  });

  it('ne prétend jamais que l’action a déjà été exécutée, parle de proposition/intention, sans vocabulaire d’autorisation', () => {
    const lines = describeReadInterpretationProposal(UNDERSTOOD_WITH_LIMIT) ?? [];
    const text = lines.join(' ').toLowerCase();

    expect(text).toContain('je vais lire');
    for (const forbidden of [
      'exécuté',
      'autorisé',
      'autorisation',
      'permission',
      'confirmé',
      'confirmation',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('requestReadInterpretationAcceptance — garanties structurelles', () => {
  it('n’écrit jamais un vocabulaire d’autorisation générale dans la sortie affichée', async () => {
    const { output, readText } = collectingOutput();
    await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('non\n'),
      output,
    });
    const rendered = readText().toLowerCase();

    for (const forbidden of ['exécuté', 'autorisation', 'ticket', 'permission']) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it('le résultat est toujours un objet fermé { accepted } ou { accepted, reason }, jamais un ToolRequest ni une exécution', async () => {
    const { output } = collectingOutput();
    const accepted = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('oui\n'),
      output,
    });
    const refused = await requestReadInterpretationAcceptance(UNDERSTOOD_WITH_LIMIT, {
      input: answerStream('non\n'),
      output,
    });

    expect(accepted).not.toHaveProperty('tool');
    expect(accepted).not.toHaveProperty('input');
    expect(accepted).not.toHaveProperty('output');
    expect(refused).not.toHaveProperty('tool');
    expect(refused).not.toHaveProperty('input');
  });
});
