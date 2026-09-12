import { describe, expect, it } from 'vitest';

import { validateMemoryCandidate } from './memory-candidate.js';

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'fact',
    subject: 'projet-phoenix',
    statement: 'Le projet Phoenix est prioritaire ce trimestre.',
    provenance: { origin: 'llm_proposed', confidence: 0.6 },
    ...overrides,
  };
}

/** Copie du candidat sans la clé indiquée (pour tester une propriété absente). */
function withoutKey(key: string): Record<string, unknown> {
  const copy = candidate();
  delete copy[key];
  return copy;
}

describe('validateMemoryCandidate — acceptation', () => {
  it('accepte un candidat bien formé et renvoie une copie propre', () => {
    const result = validateMemoryCandidate(candidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      kind: 'fact',
      subject: 'projet-phoenix',
      statement: 'Le projet Phoenix est prioritaire ce trimestre.',
      provenance: { origin: 'llm_proposed', confidence: 0.6 },
    });
  });

  it('confidence absente → valeur sans confidence', () => {
    const result = validateMemoryCandidate(candidate({ provenance: { origin: 'inferred' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance).toEqual({ origin: 'inferred' });
  });
});

describe('validateMemoryCandidate — rejets', () => {
  it('non-objet / null / tableau', () => {
    for (const bad of [null, 'x', 42, [candidate()]]) {
      expect(validateMemoryCandidate(bad)).toMatchObject({ ok: false });
    }
  });

  it('kind invalide ou absent', () => {
    expect(validateMemoryCandidate(candidate({ kind: 'note' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('kind'),
    });
    expect(validateMemoryCandidate(withoutKey('kind'))).toMatchObject({ ok: false });
  });

  it('subject vide, espaces, ou absent', () => {
    expect(validateMemoryCandidate(candidate({ subject: '' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('subject'),
    });
    expect(validateMemoryCandidate(candidate({ subject: '   ' }))).toMatchObject({ ok: false });
    expect(validateMemoryCandidate(withoutKey('subject'))).toMatchObject({ ok: false });
  });

  it('statement vide ou absent', () => {
    expect(validateMemoryCandidate(candidate({ statement: '  ' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('statement'),
    });
    expect(validateMemoryCandidate(withoutKey('statement'))).toMatchObject({ ok: false });
  });

  it('provenance invalide : origine inconnue', () => {
    expect(validateMemoryCandidate(candidate({ provenance: { origin: 'magic' } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('origin'),
    });
  });

  it('provenance invalide : confidence hors [0,1] ou non numérique', () => {
    for (const confidence of [-0.2, 1.5, 'high', Number.NaN]) {
      expect(
        validateMemoryCandidate(candidate({ provenance: { origin: 'llm_proposed', confidence } })),
      ).toMatchObject({ ok: false, error: expect.stringContaining('confidence') });
    }
  });

  it('provenance invalide : confidence sur une origine certaine', () => {
    expect(
      validateMemoryCandidate(
        candidate({ provenance: { origin: 'user_stated', confidence: 0.9 } }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('confidence') });
  });

  it('propriété inattendue au niveau du candidat (schéma fermé)', () => {
    expect(validateMemoryCandidate(candidate({ priority: 'high' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('priority'),
    });
  });

  it('propriété inattendue dans provenance (schéma fermé)', () => {
    expect(
      validateMemoryCandidate(
        candidate({ provenance: { origin: 'llm_proposed', source: 'email-42' } }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('source') });
  });

  it('déterministe : deux validations identiques → même résultat', () => {
    const value = candidate();
    expect(validateMemoryCandidate(value)).toEqual(validateMemoryCandidate(value));
  });
});
