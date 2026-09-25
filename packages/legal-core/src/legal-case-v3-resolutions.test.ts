import { describe, expect, it } from 'vitest';

import {
  appendToLegalCase,
  assertAppendOnly,
  checkAppendOnly,
  LEGAL_CASE_APPEND_ONLY_LISTS,
} from './legal-case-append-only.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';
import type { LegalCase } from './legal-case.js';
import { createLegalRuleRegistry, type LegalRuleDefinition } from './legal-rule.js';
import type { LegalFactResolution } from './legal-resolution.js';
import { buildFullLegalCaseV3 } from './testing/legal-case-v3-fixtures.js';
import {
  deterministic,
  FIXTURE_INSTANT,
  fp,
  human,
  llm,
  makeFact,
  omit,
  omitKeys,
  tool,
} from './testing/legal-v3-fixtures.js';

const errorOf = (value: unknown): string => {
  const result = validateLegalCaseV3(value);
  return result.ok ? '' : result.error;
};

describe('résolutions : effective, remplacement, autorité', () => {
  const full = buildFullLegalCaseV3();
  const [detRes, humanRes] = full.resolutions as readonly [
    LegalFactResolution,
    LegalFactResolution,
  ];

  it('accepte une résolution déterministe puis une résolution humaine qui la remplace', () => {
    expect(validateLegalCaseV3(full)).toEqual({ ok: true });
  });

  it('accepte une résolution unique, déterministe seule ou humaine seule', () => {
    expect(validateLegalCaseV3({ ...full, resolutions: [detRes] })).toEqual({ ok: true });
    const standalone = omit(humanRes, 'supersedesResolutionId');
    expect(validateLegalCaseV3({ ...full, resolutions: [standalone] })).toEqual({ ok: true });
  });

  it('rejette une résolution déterministe qui remplace une résolution humaine', () => {
    const firstHuman = omit(humanRes, 'supersedesResolutionId');
    const replacing: LegalFactResolution = {
      ...detRes,
      id: 'res-3',
      supersedesResolutionId: 'res-2',
    };
    expect(errorOf({ ...full, resolutions: [firstHuman, replacing] })).toMatch(
      /déterministe ne remplace pas une résolution humaine/,
    );
  });

  it('une résolution humaine peut remplacer une résolution humaine', () => {
    const firstHuman = omit(humanRes, 'supersedesResolutionId');
    const again: LegalFactResolution = {
      ...humanRes,
      id: 'res-3',
      outcome: 'retain',
      retainedFactIds: ['fact-b'],
      discardedFactIds: ['fact-a'],
      supersedesResolutionId: 'res-2',
    };
    delete (again as { basedOnProposalId?: string }).basedOnProposalId;
    expect(validateLegalCaseV3({ ...full, resolutions: [firstHuman, again] })).toEqual({
      ok: true,
    });
  });

  it('rejette deux résolutions concurrentes du même conflit (la seconde ne remplace pas la première)', () => {
    const second = omit(humanRes, 'supersedesResolutionId');
    expect(errorOf({ ...full, resolutions: [detRes, second] })).toMatch(/résolution concurrente/);
  });

  it('rejette un remplacement de résolution déjà remplacée (branche) ou inconnue ou postérieure', () => {
    const branch: LegalFactResolution = {
      ...humanRes,
      id: 'res-3',
      supersedesResolutionId: 'res-1',
    };
    expect(errorOf({ ...full, resolutions: [detRes, humanRes, branch] })).toMatch(
      /n'est pas la résolution effective courante/,
    );
    expect(
      errorOf({
        ...full,
        resolutions: [detRes, { ...humanRes, supersedesResolutionId: 'res-absente' }],
      }),
    ).toMatch(/antérieure inconnue/);
    // Remplacement d'une résolution qui apparaît plus tard dans la liste : impossible (aucun cycle).
    expect(errorOf({ ...full, resolutions: [humanRes, detRes] })).toMatch(/antérieure inconnue/);
  });

  it('rejette un remplacement qui vise une résolution d’un autre conflit', () => {
    const otherConflictId = 'conf-2';
    const factA = full.facts[0]!;
    const factC = full.facts[2]!;
    const conf2 = {
      id: otherConflictId,
      facts: [
        { factId: 'fact-a', factFingerprint: fp(factA) },
        { factId: 'fact-c', factFingerprint: fp(factC) },
      ],
      detectedBy: human(),
      recordedAt: FIXTURE_INSTANT,
    };
    const resOther: LegalFactResolution = {
      id: 'res-other',
      conflictId: otherConflictId,
      conflictFingerprint: fp(conf2),
      outcome: 'retain',
      retainedFactIds: ['fact-a'],
      discardedFactIds: ['fact-c'],
      provenance: human(),
      recordedAt: FIXTURE_INSTANT,
    };
    const crossing: LegalFactResolution = { ...humanRes, supersedesResolutionId: 'res-other' };
    expect(
      errorOf({
        ...full,
        conflicts: [...full.conflicts, conf2],
        resolutions: [resOther, crossing],
      }),
    ).toMatch(/autre conflit/);
  });

  it('rejette une partition incomplète ou hors conflit', () => {
    expect(errorOf({ ...full, resolutions: [{ ...detRes, discardedFactIds: [] }] })).toMatch(
      /couvrir tous les membres/,
    );
    expect(
      errorOf({ ...full, resolutions: [{ ...detRes, discardedFactIds: ['fact-zzz'] }] }),
    ).toMatch(/n'est pas membre/);
  });

  it('rejette une résolution vers un conflit inconnu ou d’empreinte incohérente', () => {
    expect(errorOf({ ...full, resolutions: [{ ...detRes, conflictId: 'conf-zzz' }] })).toMatch(
      /conflit inconnu/,
    );
    expect(
      errorOf({ ...full, resolutions: [{ ...detRes, conflictFingerprint: fp({ x: 1 }) }] }),
    ).toMatch(/empreinte incohérente/);
  });

  it('une résolution déterministe exige une exécution `resolved` cohérente', () => {
    expect(errorOf({ ...full, resolutions: [{ ...detRes, ruleExecutionId: 'rx-zzz' }] })).toMatch(
      /exécution de règle inconnue/,
    );
    // Issue différente de celle de l'exécution.
    expect(
      errorOf({
        ...full,
        resolutions: [
          {
            ...detRes,
            outcome: 'retain',
            retainedFactIds: ['fact-b'],
            discardedFactIds: ['fact-a'],
          },
        ],
      }),
    ).toMatch(/diffère de celle de l'exécution/);
    // Trace incohérente.
    expect(
      errorOf({
        ...full,
        resolutions: [
          { ...detRes, provenance: { ...detRes.provenance, executionId: 'exec-autre' } as never },
        ],
      }),
    ).toMatch(/incohérente avec la trace/);
  });

  it('une exécution indeterminate ne peut pas fonder une résolution déterministe', () => {
    const rx = full.ruleExecutions[0]!;
    const indeterminate = {
      ...omitKeys(rx as never as Record<string, unknown>, [
        'outcome',
        'retainedFactIds',
        'discardedFactIds',
      ]),
      result: 'indeterminate',
    };
    expect(errorOf({ ...full, ruleExecutions: [indeterminate], resolutions: [detRes] })).toMatch(
      /pas le résultat « resolved »/,
    );
  });

  it('une résolution humaine basée sur la proposition d’un autre conflit est rejetée', () => {
    const standalone = omit(humanRes, 'supersedesResolutionId');
    expect(
      errorOf({ ...full, resolutions: [{ ...standalone, basedOnProposalId: 'prop-zzz' }] }),
    ).toMatch(/proposition inconnue/);
  });

  it('une proposition LLM sans résolution reste valide et n’a aucun effet sur les listes effectives', () => {
    const noResolution = { ...full, ruleExecutions: [], resolutions: [] };
    expect(validateLegalCaseV3(noResolution)).toEqual({ ok: true });
    expect(noResolution.resolutionProposals).toHaveLength(1);
    expect(noResolution.resolutions).toHaveLength(0);
  });

  it('les provenances llm sont refusées pour une résolution, une relation fact_question, un conflit, une pièce', () => {
    expect(errorOf({ ...full, resolutions: [{ ...detRes, provenance: llm() }] })).toMatch(
      /non autorisé/,
    );
    const relation = { ...full.relations[0]!, provenance: llm() };
    expect(errorOf({ ...full, relations: [relation, ...full.relations.slice(1)] })).toMatch(
      /non autorisé/,
    );
    expect(errorOf({ ...full, conflicts: [{ ...full.conflicts[0]!, detectedBy: llm() }] })).toMatch(
      /non autorisé/,
    );
    expect(errorOf({ ...full, evidence: [{ ...full.evidence[1]!, provenance: llm() }] })).toMatch(
      /non autorisé/,
    );
  });

  it('une exécution ou une résolution d’une règle retirée du catalogue reste lisible (whitelist vérifiée à l’ajout)', () => {
    // Aucun registre n'est consulté par le validateur : le dossier complet est valide sans catalogue.
    expect(validateLegalCaseV3(full)).toEqual({ ok: true });
  });
});

describe('append-only', () => {
  const full = buildFullLegalCaseV3();

  const registry = (overrides: Partial<LegalRuleDefinition> = {}) =>
    createLegalRuleRegistry([
      {
        ruleId: 'rule-test',
        version: 1,
        scope: 'fact_conflict',
        reads: ['temporal'],
        evaluate: () => ({ status: 'indeterminate', reasonCode: 'x' }),
        ...overrides,
      },
    ]);

  it('checkAppendOnly accepte un dossier étendu et un dossier identique', () => {
    const extended = { ...full, facts: [...full.facts, makeFact('fact-new')] };
    expect(checkAppendOnly(full, extended)).toEqual({ ok: true });
    expect(checkAppendOnly(full, full)).toEqual({ ok: true });
  });

  it.each(LEGAL_CASE_APPEND_ONLY_LISTS)('détecte une suppression dans %s', (list) => {
    const list0 = full[list] as readonly unknown[];
    const next = { ...full, [list]: list0.slice(1) } as LegalCase;
    const result = checkAppendOnly(full, next);
    expect(result.ok).toBe(false);
  });

  it('détecte une modification de fait, un remplacement silencieux et un réordonnancement', () => {
    const modified = {
      ...full,
      facts: [{ ...full.facts[0]!, statement: 'Autre.' }, ...full.facts.slice(1)],
    };
    expect(checkAppendOnly(full, modified)).toEqual({
      ok: false,
      error: expect.stringContaining('facts[0]'),
    });
    const reordered = { ...full, facts: [full.facts[1]!, full.facts[0]!, ...full.facts.slice(2)] };
    expect(checkAppendOnly(full, reordered).ok).toBe(false);
    const provenanceChanged = {
      ...full,
      facts: [{ ...full.facts[0]!, provenance: human([]) }, ...full.facts.slice(1)],
    };
    expect(checkAppendOnly(full, provenanceChanged).ok).toBe(false);
  });

  it('assertAppendOnly lève sur une violation', () => {
    expect(() => assertAppendOnly(full, { ...full, facts: [] })).toThrow(/append-only/);
    expect(() => assertAppendOnly(full, full)).not.toThrow();
  });

  it('appendToLegalCase ajoute en fin de liste sans muter l’original', () => {
    const before = JSON.stringify(full);
    const fact = makeFact('fact-new', human());
    const next = appendToLegalCase(
      full,
      { facts: [fact] },
      { updatedAt: '2026-09-25T10:00:00.000Z' },
    );
    expect(next.facts).toHaveLength(full.facts.length + 1);
    expect(next.facts.at(-1)).toBe(fact);
    expect(next.facts.slice(0, -1)).toEqual(full.facts);
    expect(next.updatedAt).toBe('2026-09-25T10:00:00.000Z');
    expect(JSON.stringify(full)).toBe(before);
    expect(checkAppendOnly(full, next)).toEqual({ ok: true });
  });

  it('appendToLegalCase sans ajout renvoie le même dossier', () => {
    expect(appendToLegalCase(full, {})).toBe(full);
    expect(appendToLegalCase(full, { facts: [] })).toBe(full);
  });

  it('refuse tout remplacement silencieux : un id déjà présent, même identique', () => {
    expect(() => appendToLegalCase(full, { facts: [full.facts[0]!] })).toThrow(
      /aucun remplacement/,
    );
    expect(() => appendToLegalCase(full, { facts: [makeFact('n1'), makeFact('n1')] })).toThrow(
      /aucun remplacement/,
    );
  });

  it('refuse une liste qui n’est pas append-only et un ajout invalide', () => {
    expect(() => appendToLegalCase(full, { questions: [] } as never)).toThrow(
      /n'est pas une liste append-only/,
    );
    const orphan = makeFact('fact-orphan', human([{ kind: 'question', questionId: 'q-absente' }]));
    expect(() => appendToLegalCase(full, { facts: [orphan] })).toThrow(
      /dossier invalide après ajout/,
    );
  });

  it('un fait v2 (sans provenance) est refusé à l’ajout', () => {
    expect(() =>
      appendToLegalCase(full, { facts: [{ id: 'fact-v2', statement: 'Un fait v2.' } as never] }),
    ).toThrow(/dossier invalide après ajout/);
  });

  it('ajouter une exécution de règle exige un registre et une règle whitelistée', () => {
    const base = { ...full, ruleExecutions: [], resolutions: [] };
    const execution = full.ruleExecutions[0]!;
    expect(() => appendToLegalCase(base, { ruleExecutions: [execution] })).toThrow(
      /registre de règles/,
    );
    expect(() =>
      appendToLegalCase(
        base,
        { ruleExecutions: [execution] },
        { ruleRegistry: registry({ ruleId: 'rule-autre' }) },
      ),
    ).toThrow(/non whitelistée/);
    expect(() =>
      appendToLegalCase(
        base,
        { ruleExecutions: [execution] },
        { ruleRegistry: registry({ version: 2 }) },
      ),
    ).toThrow(/non whitelistée/);
    const next = appendToLegalCase(
      base,
      { ruleExecutions: [execution] },
      { ruleRegistry: registry() },
    );
    expect(next.ruleExecutions).toHaveLength(1);
  });

  it('une correction est un nouveau fait plus une relation : l’ancien fait n’est jamais réécrit', () => {
    const original = full.facts[0]!;
    const corrected = makeFact('fact-a2', human(), {
      statement: 'Le contrat a été signé le 13 mars 2025.',
    });
    const next = appendToLegalCase(full, {
      facts: [corrected],
      relations: [
        {
          kind: 'fact_correction',
          id: 'rel-fix',
          factId: 'fact-a2',
          correctsFactId: 'fact-a',
          correction: 'corrects',
          provenance: human(),
          recordedAt: FIXTURE_INSTANT,
        },
      ],
    });
    expect(next.facts.find((fact) => fact.id === 'fact-a')).toBe(original);
    expect(next.facts.find((fact) => fact.id === 'fact-a2')).toBe(corrected);
    expect(checkAppendOnly(full, next)).toEqual({ ok: true });
  });

  it('une validation est un nouvel objet : le fait n’est jamais modifié', () => {
    const factA = full.facts[0]!;
    const next = appendToLegalCase(full, {
      factValidations: [
        {
          id: 'val-new',
          factId: 'fact-a',
          factFingerprint: fp(factA),
          decision: 'reject',
          actorId: 'actor-1',
          interactionId: 'interaction-9',
          timestamp: FIXTURE_INSTANT,
        },
      ],
    });
    expect(next.facts[0]).toBe(factA);
    expect(next.factValidations).toHaveLength(2);
  });

  it('ajouter une pièce, un document et un outil provenance sans compte reste valide', () => {
    const next = appendToLegalCase(full, {
      facts: [makeFact('fact-t', tool([{ kind: 'tool_invocation', invocationId: 'inv-2' }]))],
    });
    expect(next.facts.at(-1)!.provenance).not.toHaveProperty('accountId');
    expect(deterministic().origin).toBe('deterministic');
  });
});
