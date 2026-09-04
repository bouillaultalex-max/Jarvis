import { describe, expect, it } from 'vitest';
import type { ClassificationResult } from '@jarvis/classification';
import type { EmailMessage } from '@jarvis/types';

import { filterEmailsNeedingAttention, needsAttention } from './attention.js';
import type { ClassifiedEmail } from './classified-email.js';

function email(id: string): EmailMessage {
  return {
    id,
    sender: 'someone@example.test',
    recipients: [],
    subject: 'Sujet',
    body: 'Corps',
    receivedAt: '2026-09-04T09:00:00.000Z',
  };
}

function classified(id: string, classification: ClassificationResult): ClassifiedEmail {
  return { email: email(id), classification };
}

const important = classified('m1', { label: 'important', source: 'explicit_rule', reason: 'r' });
const notImportant = classified('m2', { label: 'not_important', source: 'explicit_rule', reason: 'r' });
const uncertain = classified('m3', { label: 'uncertain', source: 'default', reason: 'r' });

describe('needsAttention', () => {
  it('un email "important" est retenu par défaut', () => {
    expect(needsAttention(important)).toBe(true);
  });

  it('un email "not_important" est exclu par défaut', () => {
    expect(needsAttention(notImportant)).toBe(false);
  });

  it('un email "uncertain" est exclu par défaut', () => {
    expect(needsAttention(uncertain)).toBe(false);
  });

  it('une policy personnalisée peut inclure "uncertain"', () => {
    const policy = { labels: ['important', 'uncertain'] as const };

    expect(needsAttention(uncertain, policy)).toBe(true);
    expect(needsAttention(notImportant, policy)).toBe(false);
  });
});

describe('filterEmailsNeedingAttention', () => {
  it('ne garde que les emails "important" par défaut', () => {
    const result = filterEmailsNeedingAttention([important, notImportant, uncertain]);

    expect(result).toEqual([important]);
  });

  it('lot vide → résultat vide', () => {
    expect(filterEmailsNeedingAttention([])).toEqual([]);
  });

  it('préserve l’ordre d’origine du lot', () => {
    const batch = [notImportant, important, uncertain, important];

    const result = filterEmailsNeedingAttention(batch, { labels: ['important', 'not_important'] });

    expect(result.map((c) => c.email.id)).toEqual(['m2', 'm1', 'm1']);
  });

  it('ne mute jamais le lot d’origine', () => {
    const batch = [important, notImportant, uncertain];
    const snapshot = [...batch];

    filterEmailsNeedingAttention(batch, { labels: ['important', 'not_important', 'uncertain'] });

    expect(batch).toEqual(snapshot);
    expect(batch).toHaveLength(3);
  });

  it('une policy personnalisée modifie les labels retenus', () => {
    const result = filterEmailsNeedingAttention([important, notImportant, uncertain], {
      labels: ['not_important'],
    });

    expect(result).toEqual([notImportant]);
  });
});
