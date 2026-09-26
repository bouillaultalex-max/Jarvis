import {
  buildLegalRuleExecution,
  computeLegalFingerprint,
  validateLegalCaseV3,
  type LegalCase,
  type LegalHumanProvenance,
  type LegalLlmProvenance,
} from '@jarvis/legal-core';

import { T0, caseWithQuestions, question } from './engine-fixtures.js';

/**
 * Dossier v3 **valide** dont chaque liste append-only du modèle Fact porte un objet, chacun
 * avec un instant **choisi séparément** : sert à prouver que le contrôle chronologique de D6
 * regarde bien toutes les listes et retient le plus tardif. `updatedAt` reste `T0` : seul le
 * contrôle « objets déjà enregistrés » peut donc refuser une écriture.
 *
 * Structures réelles de `legal-core` : `LEGAL_CASE_APPEND_ONLY_LISTS`.
 */
export const STAMPED_LISTS = [
  'facts',
  'documents',
  'evidence',
  'relations',
  'factValidations',
  'conflicts',
  'resolutionProposals',
  'ruleExecutions',
  'resolutions',
] as const;

export type StampedList = (typeof STAMPED_LISTS)[number];
export type Stamps = Readonly<Record<StampedList, string>>;

/** Tous les objets à `early`, sauf ceux de `overrides`. */
export function stamps(early: string, overrides: Partial<Stamps> = {}): Stamps {
  const all = Object.fromEntries(STAMPED_LISTS.map((list) => [list, early])) as Record<
    StampedList,
    string
  >;
  return { ...all, ...overrides };
}

const fp = computeLegalFingerprint;

const human: LegalHumanProvenance = {
  origin: 'human',
  actorId: 'actor-1',
  interactionId: 'interaction-1',
  inputReferences: [],
};

export function stampedCase(at: Stamps): LegalCase {
  const factA = {
    id: 'f-a',
    statement: 'Fait A.',
    temporal: { kind: 'unknown' } as const,
    provenance: human,
    recordedAt: at.facts,
  };
  const factB = { ...factA, id: 'f-b', statement: 'Fait B.' };
  const conflict = {
    id: 'c-1',
    facts: [
      { factId: 'f-a', factFingerprint: fp(factA) },
      { factId: 'f-b', factFingerprint: fp(factB) },
    ],
    detectedBy: human,
    recordedAt: at.conflicts,
  };
  const llm: LegalLlmProvenance = {
    origin: 'llm',
    provider: 'fournisseur',
    model: 'modele',
    invocationId: 'inv-1',
    instructionVersion: 'v1',
    inputReferences: [{ kind: 'fact', factId: 'f-a', factFingerprint: fp(factA) }],
  };

  const legalCase: LegalCase = {
    ...caseWithQuestions(question('q1'), question('q2')),
    facts: [factA, factB],
    documents: [
      { id: 'd-1', title: 'Document', addedAt: at.documents, kind: 'provided', provenance: human },
    ],
    evidence: [
      {
        kind: 'non_documentary',
        id: 'e-1',
        description: 'Témoignage',
        addedAt: at.evidence,
        provenance: human,
      },
    ],
    relations: [
      {
        kind: 'fact_question',
        id: 'r-1',
        factId: 'f-a',
        questionId: 'q1',
        provenance: human,
        recordedAt: at.relations,
      },
    ],
    factValidations: [
      {
        id: 'v-1',
        factId: 'f-a',
        factFingerprint: fp(factA),
        decision: 'confirm',
        actorId: 'actor-1',
        interactionId: 'interaction-1',
        timestamp: at.factValidations,
      },
    ],
    conflicts: [conflict],
    resolutionProposals: [
      {
        id: 'p-1',
        conflictId: 'c-1',
        conflictFingerprint: fp(conflict),
        outcome: 'retain',
        retainedFactIds: ['f-a'],
        discardedFactIds: ['f-b'],
        provenance: llm,
        recordedAt: at.resolutionProposals,
      },
    ],
    ruleExecutions: [
      buildLegalRuleExecution({
        id: 'x-1',
        conflict,
        ruleId: 'regle-1',
        version: 1,
        executionId: 'exec-1',
        result: { status: 'indeterminate', reasonCode: 'donnees_insuffisantes' },
        recordedAt: at.ruleExecutions,
      }),
    ],
    resolutions: [
      {
        id: 'rs-1',
        conflictId: 'c-1',
        conflictFingerprint: fp(conflict),
        outcome: 'retain',
        retainedFactIds: ['f-a'],
        discardedFactIds: ['f-b'],
        provenance: human,
        recordedAt: at.resolutions,
      },
    ],
    updatedAt: T0,
  };
  const validation = validateLegalCaseV3(legalCase);
  if (!validation.ok) throw new Error(`fixture invalide : ${validation.error}`);
  return legalCase;
}
