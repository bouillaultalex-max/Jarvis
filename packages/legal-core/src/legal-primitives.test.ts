import { describe, expect, it } from 'vitest';

import { daysInMonth, isLeapYear, isValidCalendarDay } from './legal-calendar.js';
import {
  firstFailure,
  isLegalInstant,
  isLegalOpaqueId,
  validateClosedObject,
  validateLegalInstant,
  validateLegalOpaqueId,
  validateRequiredText,
} from './legal-primitives.js';

describe('legal-calendar', () => {
  it('années bissextiles grégoriennes', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('jours par mois', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it('valide un jour calendaire réel seulement', () => {
    expect(isValidCalendarDay(2024, 2, 29)).toBe(true);
    expect(isValidCalendarDay(2025, 2, 29)).toBe(false);
    expect(isValidCalendarDay(2025, 13, 1)).toBe(false);
    expect(isValidCalendarDay(2025, 4, 31)).toBe(false);
    expect(isValidCalendarDay(0, 1, 1)).toBe(false);
    expect(isValidCalendarDay(10000, 1, 1)).toBe(false);
    expect(isValidCalendarDay(2025, 1, 1.5)).toBe(false);
  });
});

describe('LegalInstant', () => {
  it.each([
    '2026-09-24T10:00:00.000Z',
    '2026-09-24T10:00:00Z',
    '2026-09-24T10:00Z',
    '2026-09-24T10:00:00+02:00',
    '2026-09-24T10:00:00.123456789-05:30',
    '2024-02-29T23:59:59Z',
  ])('accepte %s', (value) => {
    expect(isLegalInstant(value)).toBe(true);
    expect(validateLegalInstant(value, 'x')).toEqual({ ok: true });
  });

  it.each([
    '2026-09-24',
    '2026-09-24T10:00:00',
    '2026-09-24 10:00:00Z',
    '2026-09-24T10:00:00+0200',
    '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-09-24T24:00:00Z',
    '2026-09-24T10:60:00Z',
    '2026-09-24T10:00:60Z',
    '2026-09-24T10:00:00+24:00',
    'March 2026',
    '',
  ])('rejette %s', (value) => {
    expect(isLegalInstant(value)).toBe(false);
    expect(validateLegalInstant(value, 'x').ok).toBe(false);
  });

  it('rejette un non-texte', () => {
    expect(isLegalInstant(1_700_000_000_000)).toBe(false);
    expect(isLegalInstant(undefined)).toBe(false);
  });
});

describe('LegalOpaqueId', () => {
  it.each([
    'inv-42',
    'legifrance.get_article',
    'gmail.prepare_reply',
    'a',
    'claude-sonnet-5',
    '2026-09-24.1',
    'k3Y_-abc:1',
  ])('accepte %s', (value) => {
    expect(isLegalOpaqueId(value)).toBe(true);
  });

  it.each([
    '',
    ' a',
    'a b',
    'user@example.com',
    '-abc',
    '.abc',
    'a/b',
    'a+b',
    'a='.repeat(2),
    'x'.repeat(129),
  ])('rejette %j', (value) => {
    expect(isLegalOpaqueId(value)).toBe(false);
    expect(validateLegalOpaqueId(value, 'id').ok).toBe(false);
  });

  it('accepte 128 caractères, refuse 129', () => {
    expect(isLegalOpaqueId('a'.repeat(128))).toBe(true);
    expect(isLegalOpaqueId('a'.repeat(129))).toBe(false);
  });

  it('rejette un non-texte', () => {
    expect(isLegalOpaqueId(12)).toBe(false);
    expect(isLegalOpaqueId(null)).toBe(false);
  });
});

describe('clés fermées et aides', () => {
  const allowed = new Set(['a', 'b']);

  it('accepte un objet dont toutes les clés sont autorisées', () => {
    expect(validateClosedObject({ a: 1 }, allowed, 'x')).toEqual({ ok: true });
  });

  it('rejette toute clé inconnue, en nommant la clé', () => {
    const result = validateClosedObject({ a: 1, secret: 'x' }, allowed, 'x');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('« secret »') });
  });

  it('rejette un tableau, null et un non-objet', () => {
    expect(validateClosedObject([], allowed, 'x').ok).toBe(false);
    expect(validateClosedObject(null, allowed, 'x').ok).toBe(false);
    expect(validateClosedObject('a', allowed, 'x').ok).toBe(false);
  });

  it('validateRequiredText et firstFailure', () => {
    expect(validateRequiredText('  ', 'x').ok).toBe(false);
    expect(validateRequiredText('ok', 'x').ok).toBe(true);
    const failure = firstFailure(
      validateRequiredText('ok', 'a'),
      validateRequiredText('', 'b'),
      validateRequiredText('', 'c'),
    );
    expect(failure).toEqual({ ok: false, error: expect.stringContaining('b') });
    expect(firstFailure()).toEqual({ ok: true });
  });
});
