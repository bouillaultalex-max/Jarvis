import { describe, expect, it } from 'vitest';

import { MAX_SUMMARY_FIELD_VALUE_CHARS } from '../confirmation/text-preview.js';
import type { GmailSendInput } from './gmail-connector.js';
import { buildGmailSendConfirmationSummary } from './gmail-send-confirmation-summary.js';

/**
 * M8-B4 — Adaptateur `GmailSendInput` → `ConfirmationInputSummary`.
 *
 * Valeurs strictement artificielles : aucun destinataire, contenu ou
 * credential réel.
 */

const BASE_INPUT: GmailSendInput = {
  to: 'dest@example.test',
  subject: 'Objet de test',
  body: 'Corps de test',
};

describe('buildGmailSendConfirmationSummary — M8-B4', () => {
  it('construit un résumé avec exactement les champs to / subject / body quand threadId est absent', () => {
    const summary = buildGmailSendConfirmationSummary(BASE_INPUT);

    expect(summary.fields.map((f) => f.key)).toEqual(['to', 'subject', 'body']);
    expect(summary.fields.map((f) => f.label)).toEqual(['Destinataire', 'Objet', 'Corps du message']);
  });

  it('champ « to » : label « Destinataire », valeur intégrale, jamais tronquée', () => {
    const longAddress = `${'a'.repeat(MAX_SUMMARY_FIELD_VALUE_CHARS + 50)}@example.test`;
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, to: longAddress });

    const toField = summary.fields.find((f) => f.key === 'to');
    expect(toField).toEqual({ key: 'to', label: 'Destinataire', value: longAddress });
    expect(toField?.truncated).toBeUndefined();
  });

  it('champ « subject » : label « Objet », valeur issue de buildTextPreview', () => {
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, subject: 'Sujet précis' });

    const subjectField = summary.fields.find((f) => f.key === 'subject');
    expect(subjectField).toEqual({ key: 'subject', label: 'Objet', value: 'Sujet précis' });
  });

  it('champ « body » : label « Corps du message », valeur issue de buildTextPreview', () => {
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, body: 'Contenu court' });

    const bodyField = summary.fields.find((f) => f.key === 'body');
    expect(bodyField).toEqual({ key: 'body', label: 'Corps du message', value: 'Contenu court' });
  });

  it('threadId présent → champ « threadId » ajouté en dernier, label « Fil de discussion », valeur intégrale', () => {
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, threadId: 'thread-abc-123' });

    expect(summary.fields.map((f) => f.key)).toEqual(['to', 'subject', 'body', 'threadId']);
    const threadField = summary.fields.at(-1);
    expect(threadField).toEqual({ key: 'threadId', label: 'Fil de discussion', value: 'thread-abc-123' });
  });

  it('threadId absent → aucun champ « threadId »', () => {
    const summary = buildGmailSendConfirmationSummary(BASE_INPUT);
    expect(summary.fields.some((f) => f.key === 'threadId')).toBe(false);
  });

  it('corps plus long que la limite → tronqué à MAX_SUMMARY_FIELD_VALUE_CHARS points de code, truncated=true', () => {
    const longBody = 'x'.repeat(MAX_SUMMARY_FIELD_VALUE_CHARS + 1);
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, body: longBody });

    const bodyField = summary.fields.find((f) => f.key === 'body');
    expect(bodyField?.truncated).toBe(true);
    expect(Array.from(bodyField?.value ?? '')).toHaveLength(MAX_SUMMARY_FIELD_VALUE_CHARS);
    expect(longBody.startsWith(bodyField?.value ?? '')).toBe(true);
  });

  it('objet plus long que la limite → tronqué, truncated=true (même règle que le corps)', () => {
    const longSubject = 's'.repeat(MAX_SUMMARY_FIELD_VALUE_CHARS + 10);
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, subject: longSubject });

    const subjectField = summary.fields.find((f) => f.key === 'subject');
    expect(subjectField?.truncated).toBe(true);
    expect(Array.from(subjectField?.value ?? '')).toHaveLength(MAX_SUMMARY_FIELD_VALUE_CHARS);
  });

  it('corps court → aucun marqueur truncated', () => {
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, body: 'trois mots ici' });

    const bodyField = summary.fields.find((f) => f.key === 'body');
    expect(bodyField?.truncated).toBeUndefined();
    expect('truncated' in (bodyField ?? {})).toBe(false);
  });

  it('ne mute jamais l’input fourni', () => {
    const input: GmailSendInput = {
      to: 'dest@example.test',
      subject: 's'.repeat(MAX_SUMMARY_FIELD_VALUE_CHARS + 5),
      body: 'b'.repeat(MAX_SUMMARY_FIELD_VALUE_CHARS + 5),
      threadId: 'thread-xyz',
    };
    const snapshot = structuredClone(input);

    buildGmailSendConfirmationSummary(input);

    expect(input).toEqual(snapshot);
  });

  it('déterministe : deux appels avec le même input produisent des résultats structurellement égaux', () => {
    const input: GmailSendInput = { ...BASE_INPUT, threadId: 'thread-1' };
    const a = buildGmailSendConfirmationSummary(input);
    const b = buildGmailSendConfirmationSummary(input);

    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('sortie gelée : racine, tableau fields et chaque champ sont immuables', () => {
    const summary = buildGmailSendConfirmationSummary({ ...BASE_INPUT, threadId: 'thread-1' });

    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.fields)).toBe(true);
    for (const field of summary.fields) {
      expect(Object.isFrozen(field)).toBe(true);
    }
    expect(() => {
      (summary.fields as unknown as unknown[]).push({ key: 'x', label: 'x', value: 'x' });
    }).toThrow();
    expect(() => {
      (summary.fields[0] as unknown as { value: string }).value = 'altéré';
    }).toThrow();
  });
});
