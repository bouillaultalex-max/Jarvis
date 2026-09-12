import { describe, expect, it } from 'vitest';

import { PROVENANCE_ORIGINS, validateProvenance } from './provenance.js';

describe('validateProvenance', () => {
  it('accepte chaque origine connue, sans confidence', () => {
    for (const origin of PROVENANCE_ORIGINS) {
      expect(validateProvenance({ origin })).toEqual({ ok: true });
    }
  });

  it('rejette un non-objet', () => {
    expect(validateProvenance(null)).toEqual({
      ok: false,
      error: expect.stringContaining('objet'),
    });
    expect(validateProvenance('user_stated')).toEqual({
      ok: false,
      error: expect.stringContaining('objet'),
    });
  });

  it('rejette une origine inconnue', () => {
    expect(validateProvenance({ origin: 'guessed' })).toEqual({
      ok: false,
      error: expect.stringContaining('origin'),
    });
  });

  it('accepte une confidence dans [0, 1] pour une origine incertaine', () => {
    expect(validateProvenance({ origin: 'inferred', confidence: 0 })).toEqual({ ok: true });
    expect(validateProvenance({ origin: 'llm_proposed', confidence: 0.5 })).toEqual({ ok: true });
    expect(validateProvenance({ origin: 'email_extracted', confidence: 1 })).toEqual({ ok: true });
  });

  it('rejette une confidence hors [0, 1] ou non finie', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
      expect(validateProvenance({ origin: 'inferred', confidence })).toEqual({
        ok: false,
        error: expect.stringContaining('confidence'),
      });
    }
  });

  it('refuse une confidence sur une origine certaine (information affirmée, non estimée)', () => {
    expect(validateProvenance({ origin: 'user_stated', confidence: 0.8 })).toEqual({
      ok: false,
      error: expect.stringContaining('confidence'),
    });
    expect(validateProvenance({ origin: 'user_confirmed', confidence: 1 })).toEqual({
      ok: false,
      error: expect.stringContaining('confidence'),
    });
  });

  it('rejette une note non-chaîne mais accepte une note chaîne', () => {
    expect(validateProvenance({ origin: 'inferred', note: 42 })).toEqual({
      ok: false,
      error: expect.stringContaining('note'),
    });
    expect(validateProvenance({ origin: 'inferred', note: 'depuis msg-7' })).toEqual({ ok: true });
  });
});
