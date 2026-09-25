import { describe, expect, it } from 'vitest';

import { validateLegalDocument } from './legal-document.js';
import { validateLegalEvidence } from './legal-evidence.js';
import { validateLegalFact } from './legal-fact.js';
import {
  deterministic,
  documentRef,
  llm,
  makeDocument,
  makeDocumentaryEvidence,
  makeFact,
  makeNonDocumentaryEvidence,
  tool,
  omit,
} from './testing/legal-v3-fixtures.js';

describe('LegalFact', () => {
  it('accepte un fait de chaque origin', () => {
    for (const provenance of [makeFact('f-h').provenance, tool(), deterministic(), llm()]) {
      expect(validateLegalFact(makeFact('f-1', provenance), 'f')).toEqual({ ok: true });
    }
  });

  it('accepte une temporalité point, interval ou unknown', () => {
    expect(
      validateLegalFact(
        makeFact('f-1', undefined, {
          temporal: { kind: 'point', precision: 'month', value: '2025-03' },
        }),
        'f',
      ),
    ).toEqual({ ok: true });
    expect(
      validateLegalFact(
        makeFact('f-1', undefined, {
          temporal: {
            kind: 'interval',
            start: { precision: 'day', value: '2025-03-12' },
            end: { precision: 'month', value: '2025-06' },
          },
        }),
        'f',
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    ['status', { status: 'established' }],
    ['certainty', { certainty: 'high' }],
    ['epistemicState', { epistemicState: 'alleged' }],
    ['confidence', { confidence: 0.93 }],
    ['sourceRef (v2)', { sourceRef: 'doc-1' }],
    [
      'fingerprint stocké',
      { fingerprint: { algorithm: 'sha256', canonicalization: 1, value: 'a'.repeat(64) } },
    ],
    ['clé quelconque', { extra: 1 }],
  ])('rejette un fait portant « %s » : aucun état ni champ étranger stocké', (_label, extra) => {
    const result = validateLegalFact({ ...makeFact('f-1'), ...extra }, 'f');
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('clé inconnue') });
  });

  it('rejette un fait v2 : sans provenance ni temporalité', () => {
    expect(validateLegalFact({ id: 'fact-1', statement: 'Un fait v2.' }, 'f').ok).toBe(false);
    expect(validateLegalFact({ id: 'fact-1', statement: 'x', sourceRef: 'doc' }, 'f').ok).toBe(
      false,
    );
  });

  it('rejette temporal absent, provenance absente, recordedAt invalide, énoncé vide, id invalide', () => {
    const noTemporal = omit(makeFact('f-1'), 'temporal');
    const noProvenance = omit(makeFact('f-1'), 'provenance');
    expect(validateLegalFact(noTemporal, 'f').ok).toBe(false);
    expect(validateLegalFact(noProvenance, 'f').ok).toBe(false);
    expect(
      validateLegalFact(makeFact('f-1', undefined, { recordedAt: '2026-09-24' }), 'f').ok,
    ).toBe(false);
    expect(validateLegalFact(makeFact('f-1', undefined, { statement: '  ' }), 'f').ok).toBe(false);
    expect(validateLegalFact(makeFact('f 1'), 'f').ok).toBe(false);
  });

  it('rejette une temporalité invalide et une précision incohérente', () => {
    expect(
      validateLegalFact(
        makeFact('f-1', undefined, {
          temporal: { kind: 'point', precision: 'day', value: '2025-03' },
        }),
        'f',
      ).ok,
    ).toBe(false);
    expect(
      validateLegalFact(
        makeFact('f-1', undefined, {
          temporal: {
            kind: 'interval',
            start: { precision: 'year', value: '2025' },
            end: { precision: 'year', value: '2019' },
          },
        }),
        'f',
      ).ok,
    ).toBe(false);
  });

  it('rejette un origin inconnu et « document » comme origin', () => {
    expect(
      validateLegalFact(
        makeFact('f-1', { ...makeFact('x').provenance, origin: 'robot' } as never),
        'f',
      ).ok,
    ).toBe(false);
    expect(
      validateLegalFact(
        makeFact('f-1', { origin: 'document', documentId: 'doc-1', inputReferences: [] } as never),
        'f',
      ).ok,
    ).toBe(false);
  });

  it('rejette une clé étrangère de provenance', () => {
    expect(
      validateLegalFact(makeFact('f-1', { ...makeFact('x').provenance, model: 'm' } as never), 'f')
        .ok,
    ).toBe(false);
  });

  it('un fait tiré d’un document garde le producteur comme origin et référence le document', () => {
    const fact = makeFact('f-1', deterministic([documentRef('doc-1')]));
    expect(fact.provenance.origin).toBe('deterministic');
    expect(validateLegalFact(fact, 'f')).toEqual({ ok: true });
  });
});

describe('LegalDocument', () => {
  it('accepte un document fourni (humain, outil) avec ou sans hash', () => {
    expect(validateLegalDocument(makeDocument('doc-1'), 'd')).toEqual({ ok: true });
    expect(validateLegalDocument(makeDocument('doc-1', { provenance: tool() }), 'd')).toEqual({
      ok: true,
    });
    expect(
      validateLegalDocument(makeDocument('doc-1', { contentHash: 'a'.repeat(64) }), 'd'),
    ).toEqual({ ok: true });
  });

  it('un document rédigé peut être produit par un LLM ; un document fourni jamais', () => {
    expect(
      validateLegalDocument(makeDocument('doc-1', { kind: 'drafted', provenance: llm() }), 'd'),
    ).toEqual({ ok: true });
    expect(
      validateLegalDocument(makeDocument('doc-1', { kind: 'provided', provenance: llm() }), 'd').ok,
    ).toBe(false);
  });

  it.each([
    ['kind absent', omit(makeDocument('doc-1'), 'kind')],
    ['kind inconnu', { ...makeDocument('doc-1'), kind: 'scanned' }],
    ['provenance absente', omit(makeDocument('doc-1'), 'provenance')],
    ['hash invalide', { ...makeDocument('doc-1'), contentHash: 'abc' }],
    ['addedAt sans décalage', { ...makeDocument('doc-1'), addedAt: '2026-09-24T10:00:00' }],
    [
      'document v2 (sans kind ni provenance)',
      { id: 'doc-1', title: 'T', addedAt: '2026-01-01T00:00:00.000Z' },
    ],
    ['contenu stocké', { ...makeDocument('doc-1'), content: 'texte' }],
    [
      'origin document',
      { ...makeDocument('doc-1'), provenance: { origin: 'document', inputReferences: [] } },
    ],
  ])('rejette : %s', (_label, value) => {
    expect(validateLegalDocument(value, 'd').ok).toBe(false);
  });
});

describe('LegalEvidence — deux formes', () => {
  it('accepte une pièce documentaire (page, plage de caractères, document entier)', () => {
    expect(validateLegalEvidence(makeDocumentaryEvidence('evi-1', 'doc-1'), 'e')).toEqual({
      ok: true,
    });
    expect(
      validateLegalEvidence(
        makeDocumentaryEvidence('evi-1', 'doc-1', {
          location: { kind: 'characterRange', start: 0, end: 12 },
          documentContentHash: 'a'.repeat(64),
        }),
        'e',
      ),
    ).toEqual({ ok: true });
    expect(
      validateLegalEvidence(
        makeDocumentaryEvidence('evi-1', 'doc-1', { location: { kind: 'whole' } }),
        'e',
      ),
    ).toEqual({ ok: true });
  });

  it('accepte une pièce non documentaire, sans document, humaine ou outil', () => {
    expect(validateLegalEvidence(makeNonDocumentaryEvidence('evi-2'), 'e')).toEqual({ ok: true });
    expect(
      validateLegalEvidence(
        makeNonDocumentaryEvidence('evi-3', { provenance: tool(), contentHash: 'b'.repeat(64) }),
        'e',
      ),
    ).toEqual({ ok: true });
  });

  it('la variante non documentaire n’impose ni documentId ni localisation, et les refuse', () => {
    expect(
      validateLegalEvidence({ ...makeNonDocumentaryEvidence('evi-2'), documentId: 'doc-1' }, 'e')
        .ok,
    ).toBe(false);
    expect(
      validateLegalEvidence(
        { ...makeNonDocumentaryEvidence('evi-2'), location: { kind: 'whole' } },
        'e',
      ).ok,
    ).toBe(false);
  });

  it('la variante documentaire exige documentId et localisation explicite', () => {
    const base = makeDocumentaryEvidence('evi-1', 'doc-1') as unknown as Record<string, unknown>;
    const noDoc = omit(base, 'documentId');
    const noLocation = omit(base, 'location');
    expect(validateLegalEvidence(noDoc, 'e').ok).toBe(false);
    expect(validateLegalEvidence(noLocation, 'e').ok).toBe(false);
  });

  it.each([
    ['kind absent', omit(makeNonDocumentaryEvidence('evi-2'), 'kind')],
    ['kind inconnu', { ...makeNonDocumentaryEvidence('evi-2'), kind: 'oral' }],
    ['provenance absente', omit(makeNonDocumentaryEvidence('evi-2'), 'provenance')],
    ['provenance llm', makeNonDocumentaryEvidence('evi-2', { provenance: llm() as never })],
    [
      'localisation invalide',
      makeDocumentaryEvidence('evi-1', 'doc-1', { location: { kind: 'page', page: 0 } }),
    ],
    [
      'hash épinglé invalide',
      makeDocumentaryEvidence('evi-1', 'doc-1', { documentContentHash: 'zz' }),
    ],
    [
      'pièce v2 (description + addedAt seulement)',
      { id: 'evi-1', description: 'd', addedAt: '2026-01-01T00:00:00.000Z' },
    ],
    ['clé étrangère', { ...makeNonDocumentaryEvidence('evi-2'), factIds: ['f-1'] }],
    ['id invalide', makeNonDocumentaryEvidence('evi 2')],
  ])('rejette : %s', (_label, value) => {
    expect(validateLegalEvidence(value, 'e').ok).toBe(false);
  });
});
