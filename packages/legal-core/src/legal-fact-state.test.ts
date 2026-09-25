import { describe, expect, it } from 'vitest';

import type { LegalFactConflict } from './legal-conflict.js';
import type { LegalFact } from './legal-fact.js';
import type { LegalFactValidation } from './legal-fact-validation.js';
import {
  deriveFactEpistemicDerivation,
  deriveFactEpistemicState,
  type LegalFactStateContext,
} from './legal-fact-state.js';
import type { LegalRelation } from './legal-relation.js';
import type { LegalFactResolution, LegalResolutionOutcome } from './legal-resolution.js';
import {
  deterministic,
  documentRef,
  evidenceRef,
  factRef,
  FIXTURE_INSTANT,
  fp,
  human,
  llm,
  makeFact,
  questionRef,
  sourceRef,
  tool,
  toolRef,
} from './testing/legal-v3-fixtures.js';

// --- constructeurs de contexte ---------------------------------------------------------------

const Q1 = { id: 'q-1' };
const Q2 = { id: 'q-2' };

const link = (factId: string, questionId: string): LegalRelation => ({
  kind: 'fact_question',
  id: `link-${factId}-${questionId}`,
  factId,
  questionId,
  provenance: human(),
  recordedAt: FIXTURE_INSTANT,
});

const correction = (newFactId: string, oldFactId: string): LegalRelation => ({
  kind: 'fact_correction',
  id: `corr-${newFactId}-${oldFactId}`,
  factId: newFactId,
  correctsFactId: oldFactId,
  correction: 'corrects',
  provenance: human(),
  recordedAt: FIXTURE_INSTANT,
});

const validation = (
  factId: string,
  decision: 'confirm' | 'reject',
  n = 1,
): LegalFactValidation => ({
  id: `val-${factId}-${n}`,
  factId,
  factFingerprint: fp({ id: factId }),
  decision,
  actorId: 'actor-1',
  interactionId: `interaction-${n}`,
  timestamp: FIXTURE_INSTANT,
});

const conflict = (id: string, factIds: readonly string[]): LegalFactConflict => ({
  id,
  facts: factIds.map((factId) => ({ factId, factFingerprint: fp({ id: factId }) })),
  detectedBy: human(),
  recordedAt: FIXTURE_INSTANT,
});

const resolution = (
  id: string,
  conflictId: string,
  outcome: LegalResolutionOutcome,
  retained: readonly string[],
  discarded: readonly string[],
  extra: Partial<LegalFactResolution> = {},
): LegalFactResolution => ({
  id,
  conflictId,
  conflictFingerprint: fp({ id: conflictId }),
  outcome,
  retainedFactIds: retained,
  discardedFactIds: discarded,
  provenance: human(),
  recordedAt: FIXTURE_INSTANT,
  ...extra,
});

const context = (parts: Partial<LegalFactStateContext> = {}): LegalFactStateContext => ({
  relations: [],
  factValidations: [],
  conflicts: [],
  resolutions: [],
  ...parts,
});

const A = makeFact('fact-a', human([documentRef('doc-1')]));
const B = makeFact('fact-b', human([documentRef('doc-1')]));
const bare = (id: string): LegalFact => makeFact(id, human());

const derive = (fact: LegalFact, ctx: LegalFactStateContext, question = Q1) =>
  deriveFactEpistemicDerivation(fact, question, ctx);

// --- cas U1 ------------------------------------------------------------------------------------

describe('R6 / R7 — inputReference substantielle (U1-A1ter)', () => {
  const linked = (fact: LegalFact) => context({ relations: [link(fact.id, 'q-1')] });

  it('1. aucun inputReference → unknown (R7)', () => {
    expect(derive(bare('fact-x'), linked(bare('fact-x')))).toEqual({
      state: 'unknown',
      rule: 'R7',
    });
  });

  it.each([
    ['evidence', evidenceRef('evi-1', { id: 'evi-1' })],
    ['document', documentRef('doc-1')],
    ['tool_invocation', toolRef('inv-1')],
    ['source', sourceRef('src-1', '1')],
    ['fact', factRef('fact-z', { id: 'fact-z' })],
  ])('2-6. une référence %s → alleged (R6)', (_kind, reference) => {
    const fact = makeFact('fact-x', human([reference]));
    expect(derive(fact, linked(fact))).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('7. uniquement une référence question → unknown (R7) : question n’est jamais substantielle', () => {
    const fact = makeFact('fact-x', human([questionRef('q-1')]));
    expect(derive(fact, linked(fact))).toEqual({ state: 'unknown', rule: 'R7' });
    const many = makeFact('fact-y', human([questionRef('q-1'), questionRef('q-2')]));
    expect(derive(many, linked(many))).toEqual({ state: 'unknown', rule: 'R7' });
  });

  it('une seule référence substantielle parmi des questions suffit (alleged)', () => {
    const fact = makeFact('fact-x', human([questionRef('q-1'), toolRef('inv-1')]));
    expect(derive(fact, linked(fact))).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('fact est substantiel inconditionnellement : la cible peut elle-même être unknown, sans récursion', () => {
    const upstream = bare('fact-up'); // unknown pour son propre compte
    const downstream = makeFact('fact-down', deterministic([factRef('fact-up', upstream)]));
    const ctx = context({ relations: [link('fact-up', 'q-1'), link('fact-down', 'q-1')] });
    expect(derive(upstream, ctx)).toEqual({ state: 'unknown', rule: 'R7' });
    expect(derive(downstream, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('la référence fact n’est jamais résolue : même avec une cible absente du contexte', () => {
    const fact = makeFact('fact-x', llm([factRef('fact-inexistant', { id: 'nope' })]));
    expect(derive(fact, linked(fact))).toEqual({ state: 'alleged', rule: 'R6' });
  });
});

describe('validation (R4 / R5)', () => {
  const ctx = (validations: readonly LegalFactValidation[]) =>
    context({ relations: [link('fact-a', 'q-1')], factValidations: validations });

  it('8. confirm → established (R5)', () => {
    expect(derive(A, ctx([validation('fact-a', 'confirm')]))).toEqual({
      state: 'established',
      rule: 'R5',
    });
    expect(derive(bare('fact-a'), ctx([validation('fact-a', 'confirm')]))).toEqual({
      state: 'established',
      rule: 'R5',
    });
  });

  it('9. reject → alleged (R4), même sans base ; le fait est conservé', () => {
    expect(derive(A, ctx([validation('fact-a', 'reject')]))).toEqual({
      state: 'alleged',
      rule: 'R4',
    });
    expect(derive(bare('fact-a'), ctx([validation('fact-a', 'reject')]))).toEqual({
      state: 'alleged',
      rule: 'R4',
    });
  });

  it('reject ne crée pas de conflit et ne produit pas contradictory', () => {
    const c = ctx([validation('fact-a', 'reject')]);
    expect(c.conflicts).toHaveLength(0);
    expect(deriveFactEpistemicState(A, Q1, c)).not.toBe('contradictory');
  });

  it('la dernière validation, par position, est effective', () => {
    expect(
      derive(A, ctx([validation('fact-a', 'confirm', 1), validation('fact-a', 'reject', 2)])),
    ).toEqual({ state: 'alleged', rule: 'R4' });
    expect(
      derive(A, ctx([validation('fact-a', 'reject', 1), validation('fact-a', 'confirm', 2)])),
    ).toEqual({ state: 'established', rule: 'R5' });
  });

  it('les validations des autres faits n’ont aucun effet', () => {
    expect(derive(A, ctx([validation('fact-b', 'confirm')]))).toEqual({
      state: 'alleged',
      rule: 'R6',
    });
  });
});

describe('conflits (R1)', () => {
  const pair = conflict('conf-1', ['fact-a', 'fact-b']);

  it('10. conflit pertinent non résolu → contradictory (R1)', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1')],
      conflicts: [pair],
    });
    expect(derive(A, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
    expect(derive(B, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('R1 domine la confirmation : une validation seule ne suffit pas à établir', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1')],
      conflicts: [pair],
      factValidations: [validation('fact-a', 'confirm')],
    });
    expect(derive(A, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('R1 domine aussi un rejet et une correction', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), correction('fact-c', 'fact-a')],
      conflicts: [pair],
      factValidations: [validation('fact-a', 'reject')],
    });
    expect(derive(A, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('11. conflit non pertinent (l’autre fait n’est pas lié à la question) → règles R2–R7', () => {
    const ctx = context({ relations: [link('fact-a', 'q-1')], conflicts: [pair] });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
    expect(derive(bare('fact-a'), ctx)).toEqual({ state: 'unknown', rule: 'R7' });
    const confirmed = context({
      relations: [link('fact-a', 'q-1')],
      conflicts: [pair],
      factValidations: [validation('fact-a', 'confirm')],
    });
    expect(derive(A, confirmed)).toEqual({ state: 'established', rule: 'R5' });
  });

  it('conflit pertinent pour Q1 mais pas pour Q2 : l’état diffère par question', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), link('fact-a', 'q-2')],
      conflicts: [pair],
    });
    expect(derive(A, ctx, Q1)).toEqual({ state: 'contradictory', rule: 'R1' });
    expect(derive(A, ctx, Q2)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('18. fait lié à plusieurs questions : seule la pertinence des conflits fait varier l’état', () => {
    const ctx = context({
      relations: [
        link('fact-a', 'q-1'),
        link('fact-a', 'q-2'),
        link('fact-b', 'q-1'),
        link('fact-b', 'q-2'),
      ],
      conflicts: [pair],
      factValidations: [validation('fact-a', 'confirm')],
    });
    // Pertinent pour les deux questions → contradictory pour les deux.
    expect(derive(A, ctx, Q1).state).toBe('contradictory');
    expect(derive(A, ctx, Q2).state).toBe('contradictory');
    // Le reste (confirm) ne dépend pas de la question.
    const noConflict = context({
      relations: ctx.relations,
      factValidations: [validation('fact-a', 'confirm')],
    });
    expect(derive(A, noConflict, Q1)).toEqual(derive(A, noConflict, Q2));
  });

  it('plus de deux membres : règle paire par paire', () => {
    const triple = conflict('conf-3', ['fact-a', 'fact-b', 'fact-c']);
    // a et b liés à q-1, c non lié : a et b sont contradictoires pour q-1.
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), link('fact-c', 'q-2')],
      conflicts: [triple],
    });
    expect(derive(A, ctx, Q1)).toEqual({ state: 'contradictory', rule: 'R1' });
    // a seul lié à q-1 (les autres à q-2) : aucun conflit pertinent pour a et q-1.
    const alone = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-2'), link('fact-c', 'q-2')],
      conflicts: [triple],
    });
    expect(derive(A, alone, Q1)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('un conflit qui ne contient pas le fait n’a aucun effet', () => {
    const other = conflict('conf-x', ['fact-b', 'fact-c']);
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), link('fact-c', 'q-1')],
      conflicts: [other],
    });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
  });
});

describe('résolutions (R2)', () => {
  const pair = conflict('conf-1', ['fact-a', 'fact-b']);
  const relations = [link('fact-a', 'q-1'), link('fact-b', 'q-1')];

  it('12. résolution retain → established (R2), sans confirmation', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'established', rule: 'R2' });
    expect(derive(bare('fact-a'), ctx)).toEqual({ state: 'established', rule: 'R2' });
  });

  it('R2 s’applique pour toute autorité : résolution humaine ou déterministe', () => {
    for (const provenance of [human(), deterministic()]) {
      const ctx = context({
        relations,
        conflicts: [pair],
        resolutions: [
          resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'], {
            provenance,
            ...(provenance.origin === 'deterministic' ? { ruleExecutionId: 'rx-1' } : {}),
          }),
        ],
      });
      expect(derive(A, ctx)).toEqual({ state: 'established', rule: 'R2' });
    }
  });

  it('10 (déterministe). Fact + résolution déterministe retain → established', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [
        resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'], {
          provenance: deterministic(),
          ruleExecutionId: 'rx-1',
        }),
      ],
    });
    expect(derive(A, ctx)).toEqual({ state: 'established', rule: 'R2' });
  });

  it('13. résolution discard → R6/R7 (aucune règle propre)', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'discard', [], ['fact-a', 'fact-b'])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
    expect(derive(bare('fact-a'), ctx)).toEqual({ state: 'unknown', rule: 'R7' });
  });

  it('un conflit résolu ne rend plus contradictory (même sans retain sur ce fait)', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(B, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('10 (A/B). retain(A) : A established, B écarté mais conservé (alleged/unknown selon sa base)', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(A, ctx).state).toBe('established');
    expect(derive(B, ctx).state).toBe('alleged');
    expect(derive(bare('fact-b'), ctx).state).toBe('unknown');
  });

  it('retain_multiple n’a pas de règle propre : il ne déclenche pas R2', () => {
    const ctx = context({
      relations,
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain_multiple', ['fact-a', 'fact-b'], [])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('R2 est prioritaire sur reject, correction et confirm', () => {
    const ctx = context({
      relations: [...relations, correction('fact-c', 'fact-a')],
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
      factValidations: [validation('fact-a', 'reject')],
    });
    expect(derive(A, ctx)).toEqual({ state: 'established', rule: 'R2' });
  });

  it('une résolution remplacée n’est plus effective : la remplaçante s’applique', () => {
    const first = resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b']);
    const second = resolution('res-2', 'conf-1', 'retain', ['fact-b'], ['fact-a'], {
      supersedesResolutionId: 'res-1',
    });
    const ctx = context({ relations, conflicts: [pair], resolutions: [first, second] });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
    expect(derive(B, ctx)).toEqual({ state: 'established', rule: 'R2' });
  });

  it('R1 prime sur R2 : retenu dans un conflit, mais impliqué dans un autre conflit ouvert et pertinent', () => {
    const other = conflict('conf-2', ['fact-a', 'fact-c']);
    const ctx = context({
      relations: [...relations, link('fact-c', 'q-1')],
      conflicts: [pair, other],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('un conflit résolu pour Q reste sans effet sur Q2 (indépendance de la question pour retain)', () => {
    const ctx = context({
      relations: [...relations, link('fact-a', 'q-2')],
      conflicts: [pair],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(A, ctx, Q1).state).toBe('established');
    expect(derive(A, ctx, Q2).state).toBe('established');
  });
});

describe('correction (R3)', () => {
  it('14. corrects → l’ancien fait devient alleged (R3), même confirmé (15 : avant la confirmation)', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), correction('fact-c', 'fact-a')],
      factValidations: [validation('fact-a', 'confirm')],
    });
    expect(derive(A, ctx)).toEqual({ state: 'alleged', rule: 'R3' });
    expect(derive(bare('fact-a'), ctx)).toEqual({ state: 'alleged', rule: 'R3' });
  });

  it('15. corrects + conflit pertinent non résolu → contradictory (R1)', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), correction('fact-c', 'fact-a')],
      conflicts: [conflict('conf-1', ['fact-a', 'fact-b'])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('16. corrects + resolution(retain) → established (R2)', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1'), correction('fact-c', 'fact-a')],
      conflicts: [conflict('conf-1', ['fact-a', 'fact-b'])],
      resolutions: [resolution('res-1', 'conf-1', 'retain', ['fact-a'], ['fact-b'])],
    });
    expect(derive(A, ctx)).toEqual({ state: 'established', rule: 'R2' });
  });

  it('le nouveau fait (le correcteur) n’est pas affecté par la correction', () => {
    const newFact = makeFact('fact-c', human([documentRef('doc-1')]));
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-c', 'q-1'), correction('fact-c', 'fact-a')],
    });
    expect(derive(newFact, ctx)).toEqual({ state: 'alleged', rule: 'R6' });
  });

  it('la correction ne crée pas de conflit', () => {
    const ctx = context({ relations: [link('fact-a', 'q-1'), correction('fact-c', 'fact-a')] });
    expect(ctx.conflicts).toHaveLength(0);
    expect(derive(A, ctx).rule).toBe('R3');
  });

  it('le fait corrigé n’est pas modifié (immutabilité)', () => {
    const frozen = Object.freeze({ ...A });
    const before = JSON.stringify(frozen);
    derive(frozen, context({ relations: [link('fact-a', 'q-1'), correction('fact-c', 'fact-a')] }));
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('proposition LLM et autres garanties', () => {
  it('17. une proposition LLM seule ne change aucun état (elle n’est même pas dans le contexte)', () => {
    const pair = conflict('conf-1', ['fact-a', 'fact-b']);
    const base = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1')],
      conflicts: [pair],
    });
    const withProposal = {
      ...base,
      resolutionProposals: [
        {
          id: 'prop-1',
          conflictId: 'conf-1',
          conflictFingerprint: fp(pair),
          outcome: 'retain',
          retainedFactIds: ['fact-a'],
          discardedFactIds: ['fact-b'],
          provenance: llm(),
          recordedAt: FIXTURE_INSTANT,
        },
      ],
    } as LegalFactStateContext;
    expect(derive(A, withProposal)).toEqual(derive(A, base));
    expect(derive(A, withProposal)).toEqual({ state: 'contradictory', rule: 'R1' });
  });

  it('précondition : le fait doit être lié à la question, sinon RangeError', () => {
    expect(() => derive(A, context())).toThrow(RangeError);
    expect(() => derive(A, context({ relations: [link('fact-a', 'q-2')] }), Q1)).toThrow(
      RangeError,
    );
    expect(() => derive(A, context({ relations: [link('fact-b', 'q-1')] }), Q1)).toThrow(
      RangeError,
    );
  });

  it('provenance.origin n’intervient jamais : toutes les origines donnent le même état', () => {
    const provenances = [
      human([documentRef('d')]),
      tool([documentRef('d')]),
      deterministic([documentRef('d')]),
      llm([documentRef('d')]),
    ];
    const ctxFor = (id: string) => context({ relations: [link(id, 'q-1')] });
    const states = provenances.map((provenance) =>
      deriveFactEpistemicState(makeFact('fact-o', provenance), Q1, ctxFor('fact-o')),
    );
    expect(new Set(states)).toEqual(new Set(['alleged']));
    const bareStates = [human(), tool()].map((provenance) =>
      deriveFactEpistemicState(makeFact('fact-o', provenance), Q1, ctxFor('fact-o')),
    );
    expect(new Set(bareStates)).toEqual(new Set(['unknown']));
  });

  it('est déterministe et pure : le contexte n’est pas modifié', () => {
    const ctx = context({
      relations: [link('fact-a', 'q-1'), link('fact-b', 'q-1')],
      conflicts: [conflict('conf-1', ['fact-a', 'fact-b'])],
    });
    const snapshot = JSON.stringify(ctx);
    const first = derive(A, ctx);
    const second = derive(A, ctx);
    expect(first).toEqual(second);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it('l’état est un résultat : LegalFact ne porte aucun état stocké', () => {
    for (const key of ['status', 'certainty', 'epistemicState', 'confidence', 'state']) {
      expect(A).not.toHaveProperty(key);
    }
  });

  it('deriveFactEpistemicState renvoie seulement l’état', () => {
    expect(deriveFactEpistemicState(A, Q1, context({ relations: [link('fact-a', 'q-1')] }))).toBe(
      'alleged',
    );
  });
});
