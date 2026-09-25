import { describe, expect, it } from 'vitest';

import { validateLegalDocumentLocation } from './legal-document-location.js';
import {
  isSubstantialInputReference,
  SUBSTANTIAL_INPUT_REFERENCE_KINDS,
  validateLegalInputReference,
  validateLegalInputReferences,
} from './legal-input-reference.js';
import {
  AUTHORITATIVE_PROVENANCE_ORIGINS,
  LEGAL_PROVENANCE_ORIGINS,
  LLM_ONLY_PROVENANCE_ORIGINS,
  NON_LLM_PROVENANCE_ORIGINS,
  validateLegalProvenance,
} from './legal-provenance.js';
import {
  deterministic,
  documentRef,
  evidenceRef,
  factRef,
  fp,
  human,
  llm,
  questionRef,
  sourceRef,
  tool,
  toolRef,
  omit,
} from './testing/legal-v3-fixtures.js';

const check = (value: unknown, allowed?: Parameters<typeof validateLegalProvenance>[2]) =>
  validateLegalProvenance(value, 'p', allowed);

describe('LegalDocumentLocation', () => {
  it.each([
    { kind: 'whole' },
    { kind: 'page', page: 3 },
    { kind: 'page', page: 3, endPage: 3 },
    { kind: 'page', page: 3, endPage: 7 },
    { kind: 'characterRange', start: 0, end: 1 },
    { kind: 'characterRange', start: 10, end: 250 },
  ])('accepte %j', (value) => {
    expect(validateLegalDocumentLocation(value, 'l')).toEqual({ ok: true });
  });

  it.each([
    undefined,
    null,
    'whole',
    {},
    { kind: 'section', label: 'x' },
    { kind: 'whole', page: 1 },
    { kind: 'page', page: 0 },
    { kind: 'page', page: 1.5 },
    { kind: 'page', page: 3, endPage: 2 },
    { kind: 'page', page: 3, endPage: 'x' },
    { kind: 'characterRange', start: -1, end: 5 },
    { kind: 'characterRange', start: 5, end: 5 },
    { kind: 'characterRange', start: 5, end: 4 },
    { kind: 'characterRange', start: 0 },
    { kind: 'characterRange', start: 0, end: 5, unit: 'utf16' },
  ])('rejette %j', (value) => {
    expect(validateLegalDocumentLocation(value, 'l').ok).toBe(false);
  });
});

describe('LegalInputReference', () => {
  it('accepte les six variantes', () => {
    for (const reference of [
      evidenceRef('evi-1', { id: 'evi-1' }),
      documentRef('doc-1'),
      { ...documentRef('doc-1'), contentHash: 'a'.repeat(64) },
      toolRef('inv-9'),
      sourceRef('src-1', '2016-10-01'),
      { ...sourceRef('src-1', '2016-10-01'), contentHash: 'b'.repeat(64) },
      factRef('fact-1', { id: 'fact-1' }),
      questionRef('q-1'),
    ]) {
      expect(validateLegalInputReference(reference, 'r')).toEqual({ ok: true });
    }
  });

  it.each([
    ['kind inconnu', { kind: 'citation', citationId: 'c' }],
    ['kind absent', { evidenceId: 'e' }],
    ['evidence sans empreinte', { kind: 'evidence', evidenceId: 'e' }],
    ['fact sans empreinte', { kind: 'fact', factId: 'f' }],
    [
      'fact avec empreinte invalide',
      { kind: 'fact', factId: 'f', factFingerprint: { algorithm: 'sha256' } },
    ],
    ['document sans localisation', { kind: 'document', documentId: 'd' }],
    [
      'document avec localisation invalide',
      { kind: 'document', documentId: 'd', location: { kind: 'page', page: 0 } },
    ],
    ['document avec hash invalide', { ...documentRef('d'), contentHash: 'XYZ' }],
    ['tool_invocation avec id invalide', { kind: 'tool_invocation', invocationId: 'a b' }],
    ['source sans version', { kind: 'source', sourceId: 's' }],
    ['question vide', { kind: 'question', questionId: ' ' }],
    ['clé étrangère', { kind: 'question', questionId: 'q', factId: 'f' }],
    ['non objet', 'evidence'],
  ])('rejette : %s', (_label, value) => {
    expect(validateLegalInputReference(value, 'r').ok).toBe(false);
  });

  it('validateLegalInputReferences : liste, minimum, première erreur avec chemin', () => {
    expect(validateLegalInputReferences([], 'refs')).toEqual({ ok: true });
    expect(validateLegalInputReferences([], 'refs', 1).ok).toBe(false);
    expect(validateLegalInputReferences('x', 'refs').ok).toBe(false);
    const result = validateLegalInputReferences([questionRef('q'), { kind: 'nope' }], 'refs');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('refs[1]') });
  });
});

describe('références substantielles (U1-A1ter)', () => {
  it('sont exactement evidence, document, tool_invocation, source, fact', () => {
    expect([...SUBSTANTIAL_INPUT_REFERENCE_KINDS].sort()).toEqual(
      ['document', 'evidence', 'fact', 'source', 'tool_invocation'].sort(),
    );
  });

  it('question n’est jamais substantielle ; fact l’est inconditionnellement', () => {
    expect(isSubstantialInputReference(questionRef('q'))).toBe(false);
    expect(isSubstantialInputReference(factRef('f', { id: 'f' }))).toBe(true);
    expect(isSubstantialInputReference(evidenceRef('e', {}))).toBe(true);
    expect(isSubstantialInputReference(documentRef('d'))).toBe(true);
    expect(isSubstantialInputReference(toolRef('i'))).toBe(true);
    expect(isSubstantialInputReference(sourceRef('s', '1'))).toBe(true);
  });

  it('le critère ne lit que le kind : une référence fact à un fingerprint inexistant reste substantielle', () => {
    expect(isSubstantialInputReference({ kind: 'fact' })).toBe(true);
    expect(isSubstantialInputReference({ kind: 'question' })).toBe(false);
  });
});

describe('LegalFactProvenance — quatre variantes', () => {
  it('accepte human, tool (avec et sans accountId), deterministic, llm', () => {
    expect(check(human())).toEqual({ ok: true });
    expect(check(human([documentRef('doc-1')]))).toEqual({ ok: true });
    expect(check(tool())).toEqual({ ok: true });
    expect(check(tool([], 'acct-1'))).toEqual({ ok: true });
    expect(check(deterministic())).toEqual({ ok: true });
    expect(check(llm())).toEqual({ ok: true });
  });

  it('origin est exactement human / tool / deterministic / llm', () => {
    expect([...LEGAL_PROVENANCE_ORIGINS]).toEqual(['human', 'tool', 'deterministic', 'llm']);
  });

  it('un tool sans compte (cas Légifrance) est valide et ne fabrique aucun accountId', () => {
    const legifrance = {
      origin: 'tool',
      toolName: 'legifrance.get_article',
      invocationId: 'inv-7',
      connectorId: 'legifrance',
      inputReferences: [],
    };
    expect(check(legifrance)).toEqual({ ok: true });
    expect(legifrance).not.toHaveProperty('accountId');
  });

  it('rejette un origin inconnu', () => {
    expect(check({ ...human(), origin: 'robot' }).ok).toBe(false);
    expect(check({ ...human(), origin: undefined }).ok).toBe(false);
  });

  it('rejette « document » comme origin', () => {
    const result = check({ origin: 'document', documentId: 'doc-1', inputReferences: [] });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("« document » n'est pas un origin"),
    });
  });

  it.each([
    ['human + clé llm', { ...human(), model: 'claude-sonnet-5' }],
    ['human + clé tool', { ...human(), toolName: 'gmail.read' }],
    ['llm + actorId', { ...llm(), actorId: 'actor-1' }],
    ['deterministic + provider', { ...deterministic(), provider: 'anthropic' }],
    ['tool + interactionId', { ...tool(), interactionId: 'i-1' }],
    ['clé étrangère quelconque', { ...human(), token: 'sk-secret' }],
    ['metadata libre', { ...tool(), metadata: { a: 1 } }],
  ])('rejette une clé appartenant à une autre variante : %s', (_label, value) => {
    const result = check(value);
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('clé inconnue') });
  });

  it.each([
    ['human sans actorId', omit(human(), 'actorId')],
    ['human sans interactionId', omit(human(), 'interactionId')],
    ['tool sans invocationId', omit(tool(), 'invocationId')],
    ['tool sans connectorId', omit(tool(), 'connectorId')],
    ['tool sans toolName', omit(tool(), 'toolName')],
    ['deterministic sans executionId', omit(deterministic(), 'executionId')],
    ['deterministic sans operationVersion', omit(deterministic(), 'operationVersion')],
    ['llm sans model', omit(llm(), 'model')],
    ['llm sans instructionVersion', omit(llm(), 'instructionVersion')],
    ['llm sans provider', omit(llm(), 'provider')],
    ['human sans inputReferences', omit(human(), 'inputReferences')],
  ])('rejette un champ obligatoire absent : %s', (_label, value) => {
    expect(check(value).ok).toBe(false);
  });

  it('deterministic et llm exigent au moins une référence d’entrée', () => {
    expect(check({ ...deterministic(), inputReferences: [] }).ok).toBe(false);
    expect(check({ ...llm(), inputReferences: [] }).ok).toBe(false);
    expect(check({ ...human(), inputReferences: [] })).toEqual({ ok: true });
    expect(check({ ...tool(), inputReferences: [] })).toEqual({ ok: true });
  });

  it('rejette des identifiants non opaques : e-mail (accountIdentifier), espace, secret de forme invalide', () => {
    expect(check(tool([], 'alice@example.com')).ok).toBe(false);
    expect(check({ ...human(), actorId: 'Alice Martin' }).ok).toBe(false);
    expect(check({ ...tool(), accountId: '' }).ok).toBe(false);
    expect(check({ ...llm(), model: 'claude sonnet' }).ok).toBe(false);
    expect(check({ ...tool(), invocationId: 'a'.repeat(129) }).ok).toBe(false);
  });

  it('rejette une référence d’entrée invalide dans la provenance', () => {
    expect(check(human([{ kind: 'fact', factId: 'f' } as never])).ok).toBe(false);
  });

  it('accepte une référence fact épinglée dans une provenance deterministic', () => {
    const upstream = { id: 'fact-a' };
    expect(check(deterministic([factRef('fact-a', upstream)]))).toEqual({ ok: true });
    expect(fp(upstream).value).toHaveLength(64);
  });

  it('rejette un non-objet', () => {
    expect(check('human').ok).toBe(false);
    expect(check(null).ok).toBe(false);
    expect(check([]).ok).toBe(false);
  });
});

describe('autorité : origins autorisés selon l’objet porteur', () => {
  it('pièce et relation fact_question : jamais llm', () => {
    expect(check(human(), NON_LLM_PROVENANCE_ORIGINS)).toEqual({ ok: true });
    expect(check(tool(), NON_LLM_PROVENANCE_ORIGINS)).toEqual({ ok: true });
    expect(check(llm(), NON_LLM_PROVENANCE_ORIGINS).ok).toBe(false);
  });

  it('correction, détection de conflit, résolution : humain ou déterministe seulement', () => {
    expect(check(human(), AUTHORITATIVE_PROVENANCE_ORIGINS)).toEqual({ ok: true });
    expect(check(deterministic(), AUTHORITATIVE_PROVENANCE_ORIGINS)).toEqual({ ok: true });
    expect(check(llm(), AUTHORITATIVE_PROVENANCE_ORIGINS).ok).toBe(false);
    expect(check(tool(), AUTHORITATIVE_PROVENANCE_ORIGINS).ok).toBe(false);
  });

  it('proposition de résolution : llm seulement', () => {
    expect(check(llm(), LLM_ONLY_PROVENANCE_ORIGINS)).toEqual({ ok: true });
    expect(check(human(), LLM_ONLY_PROVENANCE_ORIGINS).ok).toBe(false);
  });
});
