import type { ClassificationResult } from '@jarvis/classification';
import type { ClassifiedEmail } from '@jarvis/inbox';
import type { EmailMessage } from '@jarvis/types';
import { describe, expect, it } from 'vitest';

import { describeInboxResult } from './inbox-view.js';

/**
 * `describeInboxResult` — fonction pure de formatage. Vérifie le contrat
 * d'affichage : exactement expéditeur / objet / libellé / raison / provenance,
 * jamais un champ sensible (corps, extrait, destinataires, threadId, token).
 *
 * Toutes les valeurs sont artificielles.
 */

function email(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-SECRET-9f2c',
    sender: 'alice@example.test',
    recipients: ['moi@example.test', 'confidentiel@example.test'],
    subject: 'Point projet',
    body: 'CORPS-CONFIDENTIEL : ne doit jamais apparaître.',
    receivedAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  };
}

function classified(
  classification: ClassificationResult,
  overrides: Partial<EmailMessage> = {},
): ClassifiedEmail {
  return { email: email(overrides), classification };
}

describe('describeInboxResult', () => {
  it('boîte vide → une seule ligne informative, aucune ligne fictive', () => {
    expect(describeInboxResult([])).toEqual(['Aucun email trouvé.']);
  });

  it('un email → exactement 5 champs, dans l’ordre, sans donnée sensible', () => {
    const lines = describeInboxResult([
      classified({
        label: 'important',
        source: 'llm',
        reason: 'Demande directe nécessitant une réponse.',
        confidence: 0.9,
      }),
    ]);

    expect(lines).toEqual([
      'Expéditeur : alice@example.test',
      'Objet : Point projet',
      'Libellé : important',
      'Raison : Demande directe nécessitant une réponse.',
      'Provenance : LLM',
    ]);
    const joined = lines.join('\n');
    expect(joined).not.toContain('CORPS-CONFIDENTIEL');
    expect(joined).not.toContain('confidentiel@example.test');
    expect(joined).not.toContain('thread-SECRET-9f2c');
    expect(joined).not.toContain('0.9');
  });

  it('traduit chaque libellé et chaque provenance', () => {
    const cases: ReadonlyArray<{
      readonly classification: ClassificationResult;
      readonly label: string;
      readonly provenance: string;
    }> = [
      {
        classification: { label: 'important', source: 'explicit_rule', reason: 'r' },
        label: 'important',
        provenance: 'règle explicite',
      },
      {
        classification: { label: 'not_important', source: 'user_correction', reason: 'r' },
        label: 'non important',
        provenance: 'correction utilisateur',
      },
      {
        classification: { label: 'uncertain', source: 'default', reason: 'r' },
        label: 'incertain',
        provenance: 'repli par défaut',
      },
    ];

    for (const c of cases) {
      const lines = describeInboxResult([classified(c.classification)]);
      expect(lines).toContain(`Libellé : ${c.label}`);
      expect(lines).toContain(`Provenance : ${c.provenance}`);
    }
  });

  it('plusieurs emails → séparés par une ligne vide, jamais de corps', () => {
    const lines = describeInboxResult([
      classified({ label: 'important', source: 'llm', reason: 'A' }, { sender: 'a@example.test' }),
      classified(
        { label: 'not_important', source: 'llm', reason: 'B' },
        { sender: 'b@example.test' },
      ),
    ]);

    expect(lines.filter((l) => l === '')).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('CORPS-CONFIDENTIEL');
  });
});
