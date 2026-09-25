import { describe, expect, it } from 'vitest';

import { validateLegalFactConflict, type LegalFactConflict } from './legal-conflict.js';
import { validateLegalFactValidation, type LegalFactValidation } from './legal-fact-validation.js';
import { computeLegalFingerprint } from './legal-fingerprint.js';
import { validateLegalRelation } from './legal-relation.js';
import {
  validateLegalFactResolution,
  validateLegalResolutionProposal,
  validateOutcomePartition,
  validateOutcomeShape,
} from './legal-resolution.js';
import {
  buildLegalRuleExecution,
  createLegalRuleRegistry,
  evaluateLegalRule,
  validateLegalRuleExecution,
  type LegalRuleDefinition,
} from './legal-rule.js';
import {
  deterministic,
  FIXTURE_INSTANT,
  fp,
  human,
  llm,
  makeFact,
  tool,
  omit,
} from './testing/legal-v3-fixtures.js';

const factA = makeFact('fact-a');
const factB = makeFact('fact-b');

const conflict = (): LegalFactConflict => ({
  id: 'conf-1',
  facts: [
    { factId: 'fact-a', factFingerprint: fp(factA) },
    { factId: 'fact-b', factFingerprint: fp(factB) },
  ],
  detectedBy: human(),
  recordedAt: FIXTURE_INSTANT,
});

describe('LegalRelation', () => {
  const questionRelation = {
    kind: 'fact_question',
    id: 'rel-1',
    factId: 'fact-a',
    questionId: 'q-1',
    provenance: human(),
    recordedAt: FIXTURE_INSTANT,
  };
  const correction = {
    kind: 'fact_correction',
    id: 'rel-2',
    factId: 'fact-b',
    correctsFactId: 'fact-a',
    correction: 'corrects',
    provenance: human(),
    recordedAt: FIXTURE_INSTANT,
  };

  it('accepte fact_question (humain, outil, déterministe) et fact_correction (humain, déterministe)', () => {
    for (const provenance of [human(), tool(), deterministic()]) {
      expect(validateLegalRelation({ ...questionRelation, provenance }, 'r')).toEqual({ ok: true });
    }
    expect(validateLegalRelation(correction, 'r')).toEqual({ ok: true });
    expect(validateLegalRelation({ ...correction, provenance: deterministic() }, 'r')).toEqual({
      ok: true,
    });
  });

  it('une relation fact_question par un LLM est rejetée (elle déterminerait l’état dérivé)', () => {
    expect(validateLegalRelation({ ...questionRelation, provenance: llm() }, 'r').ok).toBe(false);
  });

  it('une correction par un LLM ou un outil est rejetée', () => {
    expect(validateLegalRelation({ ...correction, provenance: llm() }, 'r').ok).toBe(false);
    expect(validateLegalRelation({ ...correction, provenance: tool() }, 'r').ok).toBe(false);
  });

  it.each([
    ['kind inconnu', { ...questionRelation, kind: 'conflict_question' }],
    ['fact_question avec correctsFactId', { ...questionRelation, correctsFactId: 'x' }],
    [
      'relation Conflict → Question',
      { kind: 'conflict_question', id: 'r', conflictId: 'c', questionId: 'q' },
    ],
    ['questionId dans un fait (clé étrangère)', { ...questionRelation, factIds: ['f'] }],
    ['correction sans correctsFactId', omit(correction, 'correctsFactId')],
    ['correction de type inconnu', { ...correction, correction: 'replaces' }],
    ['auto-correction', { ...correction, correctsFactId: 'fact-b' }],
    ['provenance absente', omit(questionRelation, 'provenance')],
    ['recordedAt invalide', { ...questionRelation, recordedAt: 'hier' }],
    ['id invalide', { ...questionRelation, id: 'r 1' }],
  ])('rejette : %s', (_label, value) => {
    expect(validateLegalRelation(value, 'r').ok).toBe(false);
  });
});

describe('LegalFactValidation', () => {
  const validation = (): LegalFactValidation => ({
    id: 'val-1',
    factId: 'fact-a',
    factFingerprint: fp(factA),
    decision: 'confirm',
    actorId: 'actor-1',
    interactionId: 'interaction-2',
    timestamp: FIXTURE_INSTANT,
  });

  it('accepte confirm et reject', () => {
    expect(validateLegalFactValidation(validation(), 'v')).toEqual({ ok: true });
    expect(validateLegalFactValidation({ ...validation(), decision: 'reject' }, 'v')).toEqual({
      ok: true,
    });
  });

  it.each([
    ['décision d’état', { decision: 'established' }],
    ['décision de résolution', { decision: 'retain' }],
    ['décision vide', { decision: '' }],
    ['empreinte absente', { factFingerprint: undefined }],
    [
      'empreinte invalide',
      { factFingerprint: { algorithm: 'sha256', canonicalization: 1, value: 'x' } },
    ],
    ['acteur absent', { actorId: undefined }],
    ['interaction e-mail', { interactionId: 'a@b.fr' }],
    ['timestamp sans décalage', { timestamp: '2026-09-24T10:00:00' }],
    ['provenance llm (clé étrangère)', { provenance: llm() }],
    ['model (clé étrangère)', { model: 'claude' }],
  ])('rejette : %s', (_label, patch) => {
    expect(validateLegalFactValidation({ ...validation(), ...patch }, 'v').ok).toBe(false);
  });
});

describe('LegalFactConflict', () => {
  it('accepte un conflit de deux ou trois faits, détecté par un humain ou une règle', () => {
    expect(validateLegalFactConflict(conflict(), 'c')).toEqual({ ok: true });
    expect(validateLegalFactConflict({ ...conflict(), detectedBy: deterministic() }, 'c')).toEqual({
      ok: true,
    });
    const factC = makeFact('fact-c');
    expect(
      validateLegalFactConflict(
        {
          ...conflict(),
          facts: [...conflict().facts, { factId: 'fact-c', factFingerprint: fp(factC) }],
        },
        'c',
      ),
    ).toEqual({ ok: true });
  });

  it('n’a aucun questionId (la pertinence est dérivée de fact_question)', () => {
    expect(validateLegalFactConflict({ ...conflict(), questionId: 'q-1' }, 'c').ok).toBe(false);
    expect(validateLegalFactConflict({ ...conflict(), questionIds: ['q-1'] }, 'c').ok).toBe(false);
  });

  it.each([
    ['un seul fait', { facts: [conflict().facts[0]] }],
    ['aucun fait', { facts: [] }],
    ['fait dupliqué', { facts: [conflict().facts[0], conflict().facts[0]] }],
    ['empreinte de membre absente', { facts: [{ factId: 'fact-a' }, conflict().facts[1]] }],
    ['détecté par un LLM', { detectedBy: llm() }],
    ['détecté par un outil', { detectedBy: tool() }],
    ['detectedBy absent', { detectedBy: undefined }],
    ['id invalide', { id: 'c 1' }],
  ])('rejette : %s', (_label, patch) => {
    expect(validateLegalFactConflict({ ...conflict(), ...patch }, 'c').ok).toBe(false);
  });
});

describe('issues de résolution', () => {
  it('retain : un seul fait retenu', () => {
    expect(validateOutcomeShape('retain', ['a'], ['b'], 'o')).toEqual({ ok: true });
    expect(validateOutcomeShape('retain', ['a', 'b'], [], 'o').ok).toBe(false);
    expect(validateOutcomeShape('retain', [], ['a', 'b'], 'o').ok).toBe(false);
  });

  it('retain_multiple : au moins deux retenus', () => {
    expect(validateOutcomeShape('retain_multiple', ['a', 'b'], [], 'o')).toEqual({ ok: true });
    expect(validateOutcomeShape('retain_multiple', ['a', 'b'], ['c'], 'o')).toEqual({ ok: true });
    expect(validateOutcomeShape('retain_multiple', ['a'], ['b'], 'o').ok).toBe(false);
  });

  it('discard : aucun retenu', () => {
    expect(validateOutcomeShape('discard', [], ['a', 'b'], 'o')).toEqual({ ok: true });
    expect(validateOutcomeShape('discard', ['a'], ['b'], 'o').ok).toBe(false);
  });

  it('vocabulaire fermé : aucun état ni décision de validation', () => {
    for (const outcome of [
      'resolved',
      'unresolved',
      'established',
      'alleged',
      'contradictory',
      'unknown',
      'confirm',
      'reject',
      '',
    ]) {
      expect(validateOutcomeShape(outcome, ['a'], ['b'], 'o').ok).toBe(false);
    }
  });

  it('ensembles disjoints, identifiants non dupliqués', () => {
    expect(validateOutcomeShape('retain_multiple', ['a', 'b'], ['b'], 'o').ok).toBe(false);
    expect(validateOutcomeShape('retain_multiple', ['a', 'a'], [], 'o').ok).toBe(false);
  });

  it('partition totale : retenus ∪ écartés = membres du conflit', () => {
    expect(validateOutcomePartition(['a'], ['b'], ['a', 'b'], 'o')).toEqual({ ok: true });
    expect(validateOutcomePartition(['a'], [], ['a', 'b'], 'o').ok).toBe(false);
    expect(validateOutcomePartition(['a'], ['z'], ['a', 'b'], 'o').ok).toBe(false);
  });
});

describe('LegalResolutionProposal et LegalFactResolution', () => {
  const base = () => ({
    id: 'prop-1',
    conflictId: 'conf-1',
    conflictFingerprint: fp(conflict()),
    outcome: 'retain',
    retainedFactIds: ['fact-a'],
    discardedFactIds: ['fact-b'],
    provenance: llm(),
    recordedAt: FIXTURE_INSTANT,
  });

  it('une proposition est une provenance llm seulement', () => {
    expect(validateLegalResolutionProposal(base(), 'p')).toEqual({ ok: true });
    expect(validateLegalResolutionProposal({ ...base(), provenance: human() }, 'p').ok).toBe(false);
    expect(
      validateLegalResolutionProposal({ ...base(), provenance: deterministic() }, 'p').ok,
    ).toBe(false);
  });

  it('une proposition ne porte ni ruleExecutionId ni basedOnProposalId ni supersedes', () => {
    expect(validateLegalResolutionProposal({ ...base(), ruleExecutionId: 'x' }, 'p').ok).toBe(
      false,
    );
    expect(
      validateLegalResolutionProposal({ ...base(), supersedesResolutionId: 'x' }, 'p').ok,
    ).toBe(false);
  });

  it('une résolution humaine (avec ou sans proposition)', () => {
    const human1 = { ...base(), id: 'res-1', provenance: human() };
    expect(validateLegalFactResolution(human1, 'r')).toEqual({ ok: true });
    expect(validateLegalFactResolution({ ...human1, basedOnProposalId: 'prop-1' }, 'r')).toEqual({
      ok: true,
    });
    expect(
      validateLegalFactResolution({ ...human1, supersedesResolutionId: 'res-0' }, 'r'),
    ).toEqual({ ok: true });
  });

  it('une résolution déterministe exige une exécution et refuse basedOnProposalId', () => {
    const det = { ...base(), id: 'res-2', provenance: deterministic() };
    expect(validateLegalFactResolution(det, 'r').ok).toBe(false);
    expect(validateLegalFactResolution({ ...det, ruleExecutionId: 'exec-r' }, 'r')).toEqual({
      ok: true,
    });
    expect(
      validateLegalFactResolution(
        { ...det, ruleExecutionId: 'exec-r', basedOnProposalId: 'prop-1' },
        'r',
      ).ok,
    ).toBe(false);
  });

  it('une résolution humaine refuse ruleExecutionId', () => {
    expect(
      validateLegalFactResolution({ ...base(), provenance: human(), ruleExecutionId: 'x' }, 'r').ok,
    ).toBe(false);
  });

  it('une résolution n’est jamais produite par un LLM ni par un outil', () => {
    expect(validateLegalFactResolution({ ...base(), provenance: llm() }, 'r').ok).toBe(false);
    expect(validateLegalFactResolution({ ...base(), provenance: tool() }, 'r').ok).toBe(false);
  });

  it('rejette une issue invalide et l’absence d’empreinte de conflit', () => {
    expect(
      validateLegalFactResolution({ ...base(), provenance: human(), outcome: 'resolved' }, 'r').ok,
    ).toBe(false);
    expect(
      validateLegalFactResolution(
        { ...base(), provenance: human(), conflictFingerprint: undefined },
        'r',
      ).ok,
    ).toBe(false);
    expect(
      validateLegalFactResolution({ ...base(), provenance: human(), status: 'resolved' }, 'r').ok,
    ).toBe(false);
  });
});

describe('catalogue de règles', () => {
  const rule = (overrides: Partial<LegalRuleDefinition> = {}): LegalRuleDefinition => ({
    ruleId: 'rule-single-substantial',
    version: 1,
    scope: 'fact_conflict',
    reads: ['provenance.inputReferences'],
    evaluate: ({ facts }) => {
      const backed = facts.filter((fact) =>
        fact.provenance.inputReferences.some((ref) => ref.kind !== 'question'),
      );
      if (backed.length !== 1)
        return { status: 'indeterminate', reasonCode: 'no-single-backed-fact' };
      return {
        status: 'resolved',
        outcome: 'retain',
        retainedFactIds: [backed[0]!.id],
        discardedFactIds: facts.filter((f) => f !== backed[0]).map((f) => f.id),
        reasonCode: 'single-backed-fact',
      };
    },
    ...overrides,
  });

  const backedFact = makeFact(
    'fact-a',
    human([{ kind: 'tool_invocation', invocationId: 'inv-1' }]),
  );
  const bareFact = makeFact('fact-b');
  const registryConflict = (): LegalFactConflict => ({
    ...conflict(),
    facts: [
      { factId: 'fact-a', factFingerprint: fp(backedFact) },
      { factId: 'fact-b', factFingerprint: fp(bareFact) },
    ],
  });

  it('crée un registre versionné et refuse les doublons, versions et portées invalides', () => {
    const registry = createLegalRuleRegistry([rule(), rule({ version: 2 })]);
    expect(registry.has('rule-single-substantial', 1)).toBe(true);
    expect(registry.has('rule-single-substantial', 2)).toBe(true);
    expect(registry.has('rule-single-substantial', 3)).toBe(false);
    expect(registry.list()).toHaveLength(2);
    expect(() => createLegalRuleRegistry([rule(), rule()])).toThrow(RangeError);
    expect(() => createLegalRuleRegistry([rule({ version: 0 })])).toThrow(RangeError);
    expect(() => createLegalRuleRegistry([rule({ version: 1.5 })])).toThrow(RangeError);
    expect(() => createLegalRuleRegistry([rule({ ruleId: 'bad id' })])).toThrow(RangeError);
    expect(() => createLegalRuleRegistry([rule({ scope: 'question' as never })])).toThrow(
      RangeError,
    );
  });

  it('refuse une règle qui lirait le texte libre ou l’origine', () => {
    expect(() => createLegalRuleRegistry([rule({ reads: ['statement'] })])).toThrow(RangeError);
    expect(() =>
      createLegalRuleRegistry([rule({ reads: ['temporal', 'provenance.origin'] })]),
    ).toThrow(RangeError);
    expect(() => createLegalRuleRegistry([rule({ reads: [] })])).toThrow(RangeError);
  });

  it('évalue une règle whitelistée : resolved', () => {
    const registry = createLegalRuleRegistry([rule()]);
    const result = evaluateLegalRule(registry, 'rule-single-substantial', 1, {
      conflict: registryConflict(),
      facts: [backedFact, bareFact],
    });
    expect(result).toEqual({
      status: 'resolved',
      outcome: 'retain',
      retainedFactIds: ['fact-a'],
      discardedFactIds: ['fact-b'],
      reasonCode: 'single-backed-fact',
    });
  });

  it('indeterminate quand la règle ne peut pas trancher ; aucun score', () => {
    const registry = createLegalRuleRegistry([rule()]);
    const result = evaluateLegalRule(registry, 'rule-single-substantial', 1, {
      conflict: conflict(),
      facts: [factA, factB],
    });
    expect(result).toEqual({ status: 'indeterminate', reasonCode: 'no-single-backed-fact' });
    expect(result).not.toHaveProperty('confidence');
  });

  it('une règle non whitelistée (ou d’une autre version) ne s’exécute pas', () => {
    const registry = createLegalRuleRegistry([rule()]);
    expect(() =>
      evaluateLegalRule(registry, 'rule-unknown', 1, {
        conflict: conflict(),
        facts: [factA, factB],
      }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateLegalRule(registry, 'rule-single-substantial', 2, {
        conflict: conflict(),
        facts: [factA, factB],
      }),
    ).toThrow(RangeError);
  });

  it('refuse un résultat de règle avec score, clé libre, partition incomplète ou statut inconnu', () => {
    const run = (evaluate: LegalRuleDefinition['evaluate']) =>
      evaluateLegalRule(
        createLegalRuleRegistry([rule({ evaluate })]),
        'rule-single-substantial',
        1,
        {
          conflict: conflict(),
          facts: [factA, factB],
        },
      );
    expect(() =>
      run(() => ({ status: 'indeterminate', reasonCode: 'x', confidence: 0.93 }) as never),
    ).toThrow(TypeError);
    expect(() =>
      run(() => ({
        status: 'resolved',
        outcome: 'retain',
        retainedFactIds: ['fact-a'],
        discardedFactIds: [],
        reasonCode: 'x',
      })),
    ).toThrow(TypeError);
    expect(() => run(() => ({ status: 'maybe', reasonCode: 'x' }) as never)).toThrow(TypeError);
    expect(() => run(() => ({ status: 'not_applicable', reasonCode: 'a b' }))).toThrow(TypeError);
  });

  it('reproductibilité : mêmes entrées → même résultat (deux évaluations)', () => {
    const registry = createLegalRuleRegistry([rule()]);
    const input = { conflict: registryConflict(), facts: [backedFact, bareFact] };
    const first = evaluateLegalRule(registry, 'rule-single-substantial', 1, input);
    const second = evaluateLegalRule(registry, 'rule-single-substantial', 1, input);
    expect(computeLegalFingerprint(first)).toEqual(computeLegalFingerprint(second));
  });

  it('construit une trace d’exécution valide, sans horloge ni identifiant généré', () => {
    const registry = createLegalRuleRegistry([rule()]);
    const c = registryConflict();
    const result = evaluateLegalRule(registry, 'rule-single-substantial', 1, {
      conflict: c,
      facts: [backedFact, bareFact],
    });
    const execution = buildLegalRuleExecution({
      id: 'rx-1',
      conflict: c,
      ruleId: 'rule-single-substantial',
      version: 1,
      executionId: 'exec-77',
      result,
      recordedAt: FIXTURE_INSTANT,
    });
    expect(validateLegalRuleExecution(execution, 'x')).toEqual({ ok: true });
    expect(execution.provenance).toMatchObject({
      origin: 'deterministic',
      operationId: 'rule-single-substantial',
      operationVersion: '1',
      executionId: 'exec-77',
    });
    expect(execution.provenance.inputReferences).toHaveLength(2);
    expect(execution.conflictFingerprint).toEqual(computeLegalFingerprint(c));
  });

  it('valide les traces indeterminate et not_applicable ; refuse score et clés étrangères', () => {
    const c = conflict();
    for (const status of ['indeterminate', 'not_applicable'] as const) {
      const execution = buildLegalRuleExecution({
        id: 'rx-2',
        conflict: c,
        ruleId: 'rule-x',
        version: 3,
        executionId: 'exec-2',
        result: { status, reasonCode: 'no-info' },
        recordedAt: FIXTURE_INSTANT,
      });
      expect(validateLegalRuleExecution(execution, 'x')).toEqual({ ok: true });
      expect(validateLegalRuleExecution({ ...execution, confidence: 0.9 }, 'x').ok).toBe(false);
      expect(validateLegalRuleExecution({ ...execution, outcome: 'retain' }, 'x').ok).toBe(false);
    }
    expect(validateLegalRuleExecution({ result: 'resolved' }, 'x').ok).toBe(false);
    expect(validateLegalRuleExecution({ result: 'pending' }, 'x').ok).toBe(false);
  });
});
