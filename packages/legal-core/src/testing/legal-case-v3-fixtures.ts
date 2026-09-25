import { createLegalCase } from '../legal-case-factory.js';
import type { LegalCase, LegalSource } from '../legal-case.js';
import type { LegalFactConflict } from '../legal-conflict.js';
import type { LegalFactValidation } from '../legal-fact-validation.js';
import type { LegalFact } from '../legal-fact.js';
import type { LegalRelation } from '../legal-relation.js';
import type { LegalFactResolution, LegalResolutionProposal } from '../legal-resolution.js';
import { buildLegalRuleExecution, type LegalRuleExecution } from '../legal-rule.js';
import {
  deterministic,
  documentRef,
  evidenceRef,
  factRef,
  FIXTURE_INSTANT,
  fp,
  human,
  llm,
  makeDocument,
  makeDocumentaryEvidence,
  makeFact,
  makeNonDocumentaryEvidence,
  sourceRef,
  tool,
  toolRef,
} from './legal-v3-fixtures.js';

/** Hash de contenu externe fictif (SHA-256 hex, 64 caractères). */
export const DOC_HASH = 'd'.repeat(64);

export const SOURCE: LegalSource = {
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

/**
 * Dossier v3 **complet et valide** : document → pièce → fait, faits de chaque origine,
 * relations, validation, conflit, proposition LLM, exécution de règle, résolutions
 * (déterministe puis humaine qui la remplace).
 */
export function buildFullLegalCaseV3(): LegalCase {
  const base = createLegalCase({
    title: 'Dossier v3 complet',
    id: 'case-v3',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const documents = [
    makeDocument('doc-1', { title: 'Contrat de travail', contentHash: DOC_HASH }),
    makeDocument('doc-2', { title: 'Note rédigée', kind: 'drafted', provenance: llm() }),
  ];
  const evidenceDoc = makeDocumentaryEvidence('evi-doc', 'doc-1', {
    documentContentHash: DOC_HASH,
    location: { kind: 'characterRange', start: 0, end: 40 },
  });
  const evidenceNon = makeNonDocumentaryEvidence('evi-non');

  const factA: LegalFact = makeFact('fact-a', human([evidenceRef('evi-doc', evidenceDoc)]), {
    statement: 'Le contrat a été signé le 12 mars 2025.',
    temporal: { kind: 'point', precision: 'day', value: '2025-03-12' },
  });
  const factB: LegalFact = makeFact(
    'fact-b',
    tool([toolRef('inv-1'), evidenceRef('evi-non', evidenceNon)]),
    {
      statement: 'Le salarié travaillait dans l’entreprise de 2019 à 2024.',
      temporal: {
        kind: 'interval',
        start: { precision: 'year', value: '2019' },
        end: { precision: 'year', value: '2024' },
      },
    },
  );
  const factC: LegalFact = makeFact('fact-c', deterministic([factRef('fact-a', factA)]), {
    statement: 'Le contrat est antérieur à la période de travail.',
  });
  const factD: LegalFact = makeFact(
    'fact-d',
    llm([documentRef('doc-1'), sourceRef('src-1', '2008-05-01')]),
    {
      statement: 'Un préavis d’un mois s’applique.',
      temporal: { kind: 'point', precision: 'month', value: '2025-03' },
    },
  );

  const relations: LegalRelation[] = [
    ...(['fact-a', 'fact-b', 'fact-c', 'fact-d'] as const).map((factId): LegalRelation => ({
      kind: 'fact_question',
      id: `rel-${factId}-q1`,
      factId,
      questionId: 'q-1',
      provenance: human(),
      recordedAt: FIXTURE_INSTANT,
    })),
    {
      kind: 'fact_correction',
      id: 'rel-corr',
      factId: 'fact-d',
      correctsFactId: 'fact-c',
      correction: 'corrects',
      provenance: human(),
      recordedAt: FIXTURE_INSTANT,
    },
  ];

  const validation: LegalFactValidation = {
    id: 'val-1',
    factId: 'fact-a',
    factFingerprint: fp(factA),
    decision: 'confirm',
    actorId: 'actor-1',
    interactionId: 'interaction-3',
    timestamp: FIXTURE_INSTANT,
  };

  const conflict: LegalFactConflict = {
    id: 'conf-1',
    facts: [
      { factId: 'fact-a', factFingerprint: fp(factA) },
      { factId: 'fact-b', factFingerprint: fp(factB) },
    ],
    detectedBy: human(),
    recordedAt: FIXTURE_INSTANT,
  };

  const proposal: LegalResolutionProposal = {
    id: 'prop-1',
    conflictId: 'conf-1',
    conflictFingerprint: fp(conflict),
    outcome: 'retain',
    retainedFactIds: ['fact-b'],
    discardedFactIds: ['fact-a'],
    provenance: llm([factRef('fact-a', factA), factRef('fact-b', factB)]),
    recordedAt: FIXTURE_INSTANT,
  };

  const execution: LegalRuleExecution = buildLegalRuleExecution({
    id: 'rx-1',
    conflict,
    ruleId: 'rule-test',
    version: 1,
    executionId: 'exec-9',
    result: {
      status: 'resolved',
      outcome: 'retain',
      retainedFactIds: ['fact-a'],
      discardedFactIds: ['fact-b'],
      reasonCode: 'test-rule',
    },
    recordedAt: FIXTURE_INSTANT,
  });

  const deterministicResolution: LegalFactResolution = {
    id: 'res-1',
    conflictId: 'conf-1',
    conflictFingerprint: fp(conflict),
    outcome: 'retain',
    retainedFactIds: ['fact-a'],
    discardedFactIds: ['fact-b'],
    provenance: execution.provenance,
    ruleExecutionId: 'rx-1',
    recordedAt: FIXTURE_INSTANT,
  };

  const humanResolution: LegalFactResolution = {
    id: 'res-2',
    conflictId: 'conf-1',
    conflictFingerprint: fp(conflict),
    outcome: 'retain_multiple',
    retainedFactIds: ['fact-a', 'fact-b'],
    discardedFactIds: [],
    provenance: human(),
    basedOnProposalId: 'prop-1',
    supersedesResolutionId: 'res-1',
    recordedAt: FIXTURE_INSTANT,
  };

  return {
    ...base,
    facts: [factA, factB, factC, factD],
    documents,
    evidence: [evidenceDoc, evidenceNon],
    questions: [
      { id: 'q-1', question: 'Le préavis a-t-il été respecté ?', status: 'open' },
      { id: 'q-2', question: 'Quelle est l’ancienneté ?', status: 'open' },
    ],
    relations,
    factValidations: [validation],
    conflicts: [conflict],
    resolutionProposals: [proposal],
    ruleExecutions: [execution],
    resolutions: [deterministicResolution, humanResolution],
    sources: [SOURCE],
  };
}
