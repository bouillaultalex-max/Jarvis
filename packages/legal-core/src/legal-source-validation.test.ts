import { describe, expect, it } from 'vitest';

import type { LegalSource } from './legal-case.js';
import { validateSource, validateSourceList } from './legal-source-validation.js';

function buildSampleSource(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
    id: 'src-1',
    sourceType: 'code_article',
    authority: 'legifrance',
    title: 'Code du travail — Article L1243-1',
    identifier: 'LEGIARTI000006901247',
    reference: 'Code du travail, art. L1243-1',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901247',
    publicationDate: '2008-05-01T00:00:00.000Z',
    effectiveFrom: '2008-05-01T00:00:00.000Z',
    consultedAt: '2026-01-01T00:00:00.000Z',
    version: '2008-05-01',
    reliability: 'primary_institutional',
    ...overrides,
  };
}

describe('validateSource — création et forme', () => {
  it('accepte une source minimale valide', () => {
    expect(validateSource(buildSampleSource(), 'source')).toEqual({ ok: true });
  });

  it('rejette une valeur non-objet', () => {
    expect(validateSource(null, 'source').ok).toBe(false);
    expect(validateSource('not-a-source', 'source').ok).toBe(false);
  });

  it('rejette un sourceType hors de l’union fermée', () => {
    const source = { ...buildSampleSource(), sourceType: 'blog_post' };
    const result = validateSource(source, 'source');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sourceType/);
  });

  it('accepte chacun des sept sourceType requis', () => {
    const types: LegalSource['sourceType'][] = [
      'legislative_text',
      'code_article',
      'regulatory_text',
      'case_law',
      'collective_agreement',
      'administrative_decision',
      'administrative_source',
    ];
    for (const sourceType of types) {
      expect(validateSource(buildSampleSource({ sourceType }), 'source')).toEqual({ ok: true });
    }
  });

  it('rejette une authority hors de l’union fermée', () => {
    const result = validateSource({ ...buildSampleSource(), authority: 'wikipedia' }, 'source');
    expect(result.ok).toBe(false);
  });

  it('accepte authority « other »', () => {
    expect(validateSource(buildSampleSource({ authority: 'other' }), 'source')).toEqual({
      ok: true,
    });
  });

  it('rejette une reliability hors de l’union fermée', () => {
    const result = validateSource({ ...buildSampleSource(), reliability: 'trusted' }, 'source');
    expect(result.ok).toBe(false);
  });

  it('rejette un identifier vide', () => {
    expect(validateSource(buildSampleSource({ identifier: '' }), 'source').ok).toBe(false);
  });

  it('accepte l’absence de reference/url (tous deux optionnels)', () => {
    const withoutOptional: LegalSource = {
      id: 'src-1',
      sourceType: 'code_article',
      authority: 'legifrance',
      title: 'Code du travail — Article L1243-1',
      identifier: 'LEGIARTI000006901247',
      publicationDate: '2008-05-01T00:00:00.000Z',
      effectiveFrom: '2008-05-01T00:00:00.000Z',
      consultedAt: '2026-01-01T00:00:00.000Z',
      version: '2008-05-01',
      reliability: 'primary_institutional',
    };
    expect(validateSource(withoutOptional, 'source')).toEqual({ ok: true });
  });

  it('accepte l’absence de publicationDate (LEGAL-02B.3 : aucune sémantique confirmée côté Légifrance)', () => {
    const withoutPublicationDate: LegalSource = {
      id: 'src-1',
      sourceType: 'code_article',
      authority: 'legifrance',
      title: 'Code du travail — Article L1243-1',
      identifier: 'LEGIARTI000006901247',
      effectiveFrom: '2008-05-01T00:00:00.000Z',
      consultedAt: '2026-01-01T00:00:00.000Z',
      version: '2008-05-01',
      reliability: 'primary_institutional',
    };
    expect(validateSource(withoutPublicationDate, 'source')).toEqual({ ok: true });
  });

  it('rejette publicationDate non interprétable comme date, si présente', () => {
    expect(
      validateSource(buildSampleSource({ publicationDate: 'pas une date' }), 'source').ok,
    ).toBe(false);
  });
});

describe('validateSource — temporalité', () => {
  it('1. accepte une source sans effectiveTo (toujours en vigueur)', () => {
    const source = buildSampleSource();
    expect('effectiveTo' in source).toBe(false);
    expect(validateSource(source, 'source')).toEqual({ ok: true });
  });

  it('2. accepte une source avec effectiveTo valide et postérieur à effectiveFrom', () => {
    const source = buildSampleSource({ effectiveTo: '2020-01-01T00:00:00.000Z' });
    expect(validateSource(source, 'source')).toEqual({ ok: true });
  });

  it('3. rejette effectiveTo antérieur ou égal à effectiveFrom', () => {
    const before = buildSampleSource({
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: '2019-01-01T00:00:00.000Z',
    });
    const equal = buildSampleSource({
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: '2020-01-01T00:00:00.000Z',
    });

    const beforeResult = validateSource(before, 'source');
    const equalResult = validateSource(equal, 'source');
    expect(beforeResult.ok).toBe(false);
    expect(equalResult.ok).toBe(false);
    if (!beforeResult.ok) expect(beforeResult.error).toMatch(/effectiveTo/);
  });

  it('4. rejette une version vide', () => {
    expect(validateSource(buildSampleSource({ version: '' }), 'source').ok).toBe(false);
  });

  it('5. rejette un contentHash invalide, accepte un contentHash valide (SHA-256 hex 64 caractères)', () => {
    const invalidHash = buildSampleSource({ contentHash: 'not-a-hash' });
    const validHash = buildSampleSource({ contentHash: 'a'.repeat(64) });

    expect(validateSource(invalidHash, 'source').ok).toBe(false);
    expect(validateSource(validHash, 'source')).toEqual({ ok: true });
  });

  it('6. accepte publicationDate antérieure à effectiveFrom (chronologie normale : publication puis entrée en vigueur)', () => {
    const source = buildSampleSource({
      publicationDate: '2008-04-01T00:00:00.000Z',
      effectiveFrom: '2008-05-01T00:00:00.000Z',
    });
    expect(validateSource(source, 'source')).toEqual({ ok: true });
  });

  it('7. consultedAt est indépendant de effectiveFrom/effectiveTo : aucune contrainte d’ordre n’est appliquée entre eux', () => {
    const source = buildSampleSource({
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      consultedAt: '2010-01-01T00:00:00.000Z',
    });
    expect(validateSource(source, 'source')).toEqual({ ok: true });
  });

  it('rejette des dates non interprétables', () => {
    expect(
      validateSource(buildSampleSource({ publicationDate: 'pas une date' }), 'source').ok,
    ).toBe(false);
    expect(validateSource(buildSampleSource({ effectiveFrom: 'pas une date' }), 'source').ok).toBe(
      false,
    );
    expect(validateSource(buildSampleSource({ consultedAt: 'pas une date' }), 'source').ok).toBe(
      false,
    );
  });
});

describe('validateSourceList — versions multiples et intégrité', () => {
  it('8. accepte plusieurs versions d’une même source (même identifier, id/version distincts)', () => {
    const v1 = buildSampleSource({
      id: 'src-1-v1',
      version: '2008-05-01',
      effectiveFrom: '2008-05-01T00:00:00.000Z',
      effectiveTo: '2020-01-01T00:00:00.000Z',
    });
    const v2 = buildSampleSource({
      id: 'src-1-v2',
      version: '2020-01-01',
      effectiveFrom: '2020-01-01T00:00:00.000Z',
    });

    expect(validateSourceList([v1, v2], 'sources')).toEqual({ ok: true });
  });

  it('rejette un id dupliqué entre deux sources', () => {
    const source = buildSampleSource();
    const result = validateSourceList([source, { ...source, version: '2020-01-01' }], 'sources');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/id dupliqué/);
  });
});
