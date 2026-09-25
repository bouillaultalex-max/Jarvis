import { describe, expect, it } from 'vitest';

import type { LegalCitation, LegalSource } from './legal-case.js';
import { validateCitation, validateCitationList } from './legal-citation-validation.js';

function buildSampleSource(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
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
    ...overrides,
  };
}

function buildSampleCitation(overrides: Partial<LegalCitation> = {}): LegalCitation {
  return {
    id: 'cit-1',
    sourceId: 'src-1',
    sourceVersion: '2008-05-01',
    pinpoint: 'al. 1',
    quotedText: 'Le contrat de travail à durée déterminée…',
    consultedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function knownSources(...sources: LegalSource[]): ReadonlyMap<string, LegalSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

describe('validateCitation — création et forme', () => {
  it('accepte une citation valide pointant vers une source existante à la bonne version', () => {
    const result = validateCitation(
      buildSampleCitation(),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepte l’absence de pinpoint/quotedText (tous deux optionnels)', () => {
    const minimal: LegalCitation = {
      id: 'cit-1',
      sourceId: 'src-1',
      sourceVersion: '2008-05-01',
      consultedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = validateCitation(minimal, 'citation', knownSources(buildSampleSource()));
    expect(result).toEqual({ ok: true });
  });

  it('rejette une valeur non-objet', () => {
    expect(validateCitation(null, 'citation', knownSources()).ok).toBe(false);
  });

  it('rejette un id vide', () => {
    const result = validateCitation(
      buildSampleCitation({ id: '' }),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result.ok).toBe(false);
  });

  it('rejette un pinpoint ou un quotedText qui ne sont pas des chaînes', () => {
    const withBadPinpoint = { ...buildSampleCitation(), pinpoint: 42 };
    const withBadQuote = { ...buildSampleCitation(), quotedText: 42 };
    expect(
      validateCitation(withBadPinpoint, 'citation', knownSources(buildSampleSource())).ok,
    ).toBe(false);
    expect(validateCitation(withBadQuote, 'citation', knownSources(buildSampleSource())).ok).toBe(
      false,
    );
  });

  it('rejette un consultedAt non interprétable comme une date', () => {
    const result = validateCitation(
      buildSampleCitation({ consultedAt: 'pas une date' }),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result.ok).toBe(false);
  });
});

describe('validateCitation — sourceId et sourceVersion', () => {
  it('rejette un sourceId qui ne désigne aucune source connue', () => {
    const result = validateCitation(
      buildSampleCitation({ sourceId: 'src-does-not-exist' }),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/source inconnue/);
  });

  it('rejette une sourceVersion incohérente avec la version réelle de la source', () => {
    const result = validateCitation(
      buildSampleCitation({ sourceVersion: '1999-01-01' }),
      'citation',
      knownSources(buildSampleSource({ version: '2008-05-01' })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sourceVersion/);
  });

  it('accepte deux citations vers deux versions différentes de sources partageant le même identifier', () => {
    const v1 = buildSampleSource({ id: 'src-v1', version: '2008-05-01' });
    const v2 = buildSampleSource({ id: 'src-v2', version: '2020-01-01' });
    const citationToV1 = buildSampleCitation({
      id: 'cit-v1',
      sourceId: 'src-v1',
      sourceVersion: '2008-05-01',
    });
    const citationToV2 = buildSampleCitation({
      id: 'cit-v2',
      sourceId: 'src-v2',
      sourceVersion: '2020-01-01',
    });

    const sources = knownSources(v1, v2);
    expect(validateCitation(citationToV1, 'citation', sources)).toEqual({ ok: true });
    expect(validateCitation(citationToV2, 'citation', sources)).toEqual({ ok: true });
  });
});

describe('validateCitationList', () => {
  it('rejette un id dupliqué entre deux citations', () => {
    const citation = buildSampleCitation();
    const result = validateCitationList(
      [citation, { ...citation }],
      'citations',
      knownSources(buildSampleSource()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/id dupliqué/);
  });

  it('accepte une liste vide', () => {
    expect(validateCitationList([], 'citations', knownSources())).toEqual({ ok: true });
  });
});

describe('validateCitation — contentHash épinglé (ADR-0020)', () => {
  const HASH = 'a'.repeat(64);

  it('accepte un contentHash bien formé, identique à celui de la source', () => {
    const result = validateCitation(
      buildSampleCitation({ contentHash: HASH }),
      'citation',
      knownSources(buildSampleSource({ contentHash: HASH })),
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepte un contentHash quand la source n’en porte pas (rien à contredire)', () => {
    const result = validateCitation(
      buildSampleCitation({ contentHash: HASH }),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejette un contentHash mal formé', () => {
    for (const bad of ['pas-un-hash', 'A'.repeat(64), 'a'.repeat(63), 42]) {
      const result = validateCitation(
        { ...buildSampleCitation(), contentHash: bad },
        'citation',
        knownSources(buildSampleSource()),
      );
      expect(result.ok, String(bad)).toBe(false);
    }
  });

  it('rejette un contentHash incohérent avec l’empreinte de la source', () => {
    const result = validateCitation(
      buildSampleCitation({ contentHash: HASH }),
      'citation',
      knownSources(buildSampleSource({ contentHash: 'b'.repeat(64) })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contentHash.*incohérent/);
  });
});

describe('validateCitation — eligibility (source retrouvée + version applicable, ADR-0020)', () => {
  const questions = new Set(['q-1']);
  const eligibility = {
    questionId: 'q-1',
    asOf: '2020-01-01',
    resolution: 'resolved',
    historyCompleteness: 'unknown',
  } as const;
  const validate = (citation: unknown, known: ReadonlySet<string> = questions) =>
    validateCitation(citation, 'citation', knownSources(buildSampleSource()), known);

  it('accepte une citation de niveau source sans pinpoint ni quotedText, historique unknown', () => {
    const minimal: LegalCitation = {
      id: 'cit-1',
      sourceId: 'src-1',
      sourceVersion: '2008-05-01',
      consultedAt: '2026-01-01T00:00:00.000Z',
      eligibility,
    };
    expect(validate(minimal)).toEqual({ ok: true });
  });

  it('accepte historyCompleteness complete (distinct de unknown)', () => {
    const citation = buildSampleCitation({
      eligibility: { ...eligibility, historyCompleteness: 'complete' },
    });
    expect(validate(citation)).toEqual({ ok: true });
  });

  it('une citation sans eligibility reste valide (champ additif : compatibilité avec l’existant)', () => {
    expect(
      validateCitation(buildSampleCitation(), 'citation', knownSources(buildSampleSource())),
    ).toEqual({ ok: true });
  });

  it('rejette une question inconnue du dossier', () => {
    const result = validate(
      buildSampleCitation({ eligibility: { ...eligibility, questionId: 'q-absente' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/question inconnue/);
  });

  it('refuse eligibility quand les questions du dossier ne sont pas fournies (référence invérifiable)', () => {
    const result = validateCitation(
      buildSampleCitation({ eligibility }),
      'citation',
      knownSources(buildSampleSource()),
    );
    expect(result.ok).toBe(false);
  });

  it('rejette un asOf absent ou non interprétable comme une date (jamais implicite)', () => {
    for (const asOf of [undefined, '', 'pas une date', 42]) {
      const result = validate({ ...buildSampleCitation(), eligibility: { ...eligibility, asOf } });
      expect(result.ok, String(asOf)).toBe(false);
    }
  });

  it('rejette une résolution autre que resolved (indeterminate/none_applicable ne rendent jamais éligible)', () => {
    for (const resolution of ['indeterminate', 'none_applicable', undefined]) {
      const result = validate({
        ...buildSampleCitation(),
        eligibility: { ...eligibility, resolution },
      });
      expect(result.ok, String(resolution)).toBe(false);
    }
  });

  it('rejette une exhaustivité inconnue, absente, ou un score déguisé', () => {
    for (const historyCompleteness of ['partial', 0.9, undefined]) {
      const result = validate({
        ...buildSampleCitation(),
        eligibility: { ...eligibility, historyCompleteness },
      });
      expect(result.ok, String(historyCompleteness)).toBe(false);
    }
  });

  it('rejette eligibility si ce n’est pas un objet, ou si questionId est vide', () => {
    expect(validate({ ...buildSampleCitation(), eligibility: 'oui' }).ok).toBe(false);
    expect(validate({ ...buildSampleCitation(), eligibility: [] }).ok).toBe(false);
    expect(
      validate(buildSampleCitation({ eligibility: { ...eligibility, questionId: '' } })).ok,
    ).toBe(false);
  });

  it('validateCitationList transmet les questions du dossier', () => {
    const list = [buildSampleCitation({ eligibility })];
    expect(
      validateCitationList(list, 'citations', knownSources(buildSampleSource()), questions),
    ).toEqual({ ok: true });
    expect(
      validateCitationList(list, 'citations', knownSources(buildSampleSource()), new Set()).ok,
    ).toBe(false);
  });
});
