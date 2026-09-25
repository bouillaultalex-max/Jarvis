import { describe, expect, it } from 'vitest';

import { createLegalCase } from './legal-case-factory.js';
import { LEGAL_CASE_V3_KEYS, validateLegalCaseV3 } from './legal-case-validation.js';
import type { LegalCase } from './legal-case.js';
import { buildLegalCaseV2Fixture } from './testing/legal-case-v2-fixtures.js';
import { buildFullLegalCaseV3, DOC_HASH } from './testing/legal-case-v3-fixtures.js';
import {
  documentRef,
  evidenceRef,
  factRef,
  FIXTURE_INSTANT,
  fp,
  human,
  makeDocument,
  makeDocumentaryEvidence,
  makeFact,
  makeNonDocumentaryEvidence,
  omit,
  sourceRef,
} from './testing/legal-v3-fixtures.js';

const valid = (value: unknown) => validateLegalCaseV3(value);
const errorOf = (value: unknown): string => {
  const result = validateLegalCaseV3(value);
  return result.ok ? '' : result.error;
};

describe('validateLegalCaseV3 — dossier complet', () => {
  it('accepte le dossier complet (document → pièce → fait, relations, conflit, résolutions)', () => {
    expect(valid(buildFullLegalCaseV3())).toEqual({ ok: true });
  });

  it('accepte un dossier vide', () => {
    expect(valid(createLegalCase({ title: 'Vide' }))).toEqual({ ok: true });
  });

  it('la racine a exactement les 25 champs du contrat', () => {
    expect(LEGAL_CASE_V3_KEYS).toHaveLength(25);
    expect(Object.keys(buildFullLegalCaseV3()).sort()).toEqual([...LEGAL_CASE_V3_KEYS].sort());
  });
});

describe('séparation v2 / v3 : aucun accueil implicite', () => {
  it('rejette un dossier v2 (facts en quatre listes)', () => {
    expect(valid(buildLegalCaseV2Fixture()).ok).toBe(false);
  });

  it('rejette un dossier v2 même complété des nouvelles listes : les faits v2 n’ont ni provenance ni temporalité', () => {
    const v2 = buildLegalCaseV2Fixture();
    const upgraded = {
      ...v2,
      facts: [...v2.facts.established, ...v2.facts.alleged, ...v2.facts.unknown],
      relations: [],
      factValidations: [],
      conflicts: [],
      resolutionProposals: [],
      ruleExecutions: [],
      resolutions: [],
    };
    expect(valid(upgraded).ok).toBe(false);
    expect(errorOf(upgraded)).toMatch(/facts\[0\]/);
  });

  it('rejette des documents et pièces v2', () => {
    const base = createLegalCase({ title: 'x' });
    expect(
      valid({
        ...base,
        documents: [{ id: 'doc-1', title: 'T', addedAt: '2026-01-01T00:00:00.000Z' }],
      }).ok,
    ).toBe(false);
    expect(
      valid({
        ...base,
        evidence: [{ id: 'evi-1', description: 'd', addedAt: '2026-01-01T00:00:00.000Z' }],
      }).ok,
    ).toBe(false);
  });

  it.each(['status', 'certainty', 'epistemicState', 'confidence', 'established', 'facts_state'])(
    'rejette une clé racine d’état (%s) : aucun état épistémique stocké',
    (key) => {
      expect(valid({ ...createLegalCase({ title: 'x' }), [key]: 'established' }).ok).toBe(false);
    },
  );

  it('rejette toute clé racine inconnue', () => {
    expect(errorOf({ ...createLegalCase({ title: 'x' }), extra: 1 })).toMatch(/clé inconnue/);
  });

  it('rejette une liste du modèle Fact manquante (aucun défaut)', () => {
    expect(valid(omit(buildFullLegalCaseV3(), 'relations')).ok).toBe(false);
  });
});

describe('unicité des identifiants par liste', () => {
  const dup = <T extends { id: string }>(items: readonly T[]) => [...items, items[0]!];

  it.each([
    'facts',
    'documents',
    'evidence',
    'questions',
    'relations',
    'factValidations',
    'conflicts',
    'resolutionProposals',
    'ruleExecutions',
    'resolutions',
  ])('rejette un id dupliqué dans %s', (list) => {
    const base = buildFullLegalCaseV3() as unknown as Record<string, readonly { id: string }[]>;
    const result = validateLegalCaseV3({ ...base, [list]: dup(base[list]!) });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('id dupliqué') });
  });

  it('un même id peut exister dans deux listes différentes (les références portent un kind)', () => {
    const base = buildFullLegalCaseV3();
    const twin = makeNonDocumentaryEvidence('fact-a');
    expect(valid({ ...base, evidence: [...base.evidence, twin] })).toEqual({ ok: true });
  });
});

describe('références d’entrée', () => {
  const withFact = (fact: unknown) => {
    const base = buildFullLegalCaseV3();
    return { ...base, facts: [...base.facts, fact] };
  };

  it('rejette une pièce, un document, un fait, une source, une question inconnus', () => {
    expect(errorOf(withFact(makeFact('fact-x', human([evidenceRef('evi-absente', {})]))))).toMatch(
      /pièce inconnue/,
    );
    expect(errorOf(withFact(makeFact('fact-x', human([documentRef('doc-absent')]))))).toMatch(
      /document inconnu/,
    );
    expect(errorOf(withFact(makeFact('fact-x', human([factRef('fact-absent', {})]))))).toMatch(
      /fait inconnu/,
    );
    expect(errorOf(withFact(makeFact('fact-x', human([sourceRef('src-absente', '1')]))))).toMatch(
      /source inconnue/,
    );
    expect(
      errorOf(withFact(makeFact('fact-x', human([{ kind: 'question', questionId: 'q-absente' }])))),
    ).toMatch(/question inconnue/);
  });

  it('accepte une référence tool_invocation (forme seulement : aucun journal d’appels)', () => {
    expect(
      valid(
        withFact(
          makeFact('fact-x', human([{ kind: 'tool_invocation', invocationId: 'inv-inconnue' }])),
        ),
      ),
    ).toEqual({ ok: true });
  });

  it('rejette une empreinte de pièce ou de fait incohérente', () => {
    const base = buildFullLegalCaseV3();
    const evi = base.evidence[0]!;
    expect(
      errorOf(
        withFact(
          makeFact('fact-x', human([evidenceRef('evi-doc', { ...evi, description: 'autre' })])),
        ),
      ),
    ).toMatch(/empreinte incohérente/);
    expect(
      errorOf(
        withFact(
          makeFact('fact-x', human([factRef('fact-a', { ...base.facts[0]!, statement: 'autre' })])),
        ),
      ),
    ).toMatch(/empreinte incohérente/);
  });

  it('rejette une version de source ou un hash incohérents', () => {
    expect(
      errorOf(withFact(makeFact('fact-x', human([sourceRef('src-1', '1999-01-01')])))),
    ).toMatch(/incohérente/);
    expect(
      errorOf(
        withFact(
          makeFact(
            'fact-x',
            human([{ ...sourceRef('src-1', '2008-05-01'), contentHash: 'e'.repeat(64) } as never]),
          ),
        ),
      ),
    ).toMatch(/incohérent/);
  });

  it('rejette un hash de document de référence incohérent et une plage sans hash de document', () => {
    expect(
      errorOf(
        withFact(
          makeFact(
            'fact-x',
            human([{ ...documentRef('doc-1'), contentHash: 'e'.repeat(64) } as never]),
          ),
        ),
      ),
    ).toMatch(/incohérent/);
    const base = buildFullLegalCaseV3();
    const noHash = {
      ...base,
      documents: [makeDocument('doc-1', { title: 'sans hash' }), base.documents[1]!],
      evidence: [base.evidence[1]!],
    };
    const ref = {
      kind: 'document',
      documentId: 'doc-1',
      location: { kind: 'characterRange', start: 0, end: 5 },
    };
    expect(
      errorOf({
        ...noHash,
        facts: [makeFact('fact-x', human([ref as never]))],
        relations: [],
        factValidations: [],
        conflicts: [],
        resolutionProposals: [],
        ruleExecutions: [],
        resolutions: [],
      }),
    ).toMatch(/contentHash/);
  });

  it('un fait tiré d’un document garde le producteur comme origin', () => {
    const base = buildFullLegalCaseV3();
    const factD = base.facts.find((fact) => fact.id === 'fact-d')!;
    expect(factD.provenance.origin).toBe('llm');
    expect(factD.provenance.inputReferences.some((ref) => ref.kind === 'document')).toBe(true);
  });
});

describe('cycles interdits', () => {
  it('rejette l’auto-référence d’un fait', () => {
    const fact = makeFact('fact-self', human([factRef('fact-self', {})]));
    const base = createLegalCase({ title: 'x' });
    expect(errorOf({ ...base, facts: [fact] })).toMatch(/cycle|auto-référence/);
  });

  it('rejette un cycle fait → pièce → fait (empreintes arbitraires : le cycle est refusé avant)', () => {
    const base = createLegalCase({ title: 'x' });
    const factF = makeFact('fact-f', human([evidenceRef('evi-e', {})]));
    const evidenceE = makeNonDocumentaryEvidence('evi-e', {
      provenance: human([factRef('fact-f', factF)]),
    });
    expect(errorOf({ ...base, facts: [factF], evidence: [evidenceE] })).toMatch(/cycle/);
  });

  it('rejette un cycle fait → document → fait, que les empreintes rendraient pourtant cohérentes', () => {
    const base = createLegalCase({ title: 'x' });
    const factF = makeFact('fact-f', human([documentRef('doc-d')]));
    // Le document est référencé sans épinglage d'objet : son hash de contenu est externe.
    const documentD = makeDocument('doc-d', { provenance: human([factRef('fact-f', factF)]) });
    const result = errorOf({ ...base, facts: [factF], documents: [documentD] });
    expect(result).toMatch(/cycle/);
  });

  it('rejette un cycle de corrections A → B → A', () => {
    const base = buildFullLegalCaseV3();
    const cyc = (id: string, factId: string, correctsFactId: string) => ({
      kind: 'fact_correction',
      id,
      factId,
      correctsFactId,
      correction: 'corrects',
      provenance: human(),
      recordedAt: FIXTURE_INSTANT,
    });
    expect(
      errorOf({ ...base, relations: [...base.relations, cyc('rel-c1', 'fact-c', 'fact-d')] }),
    ).toMatch(/cycle de corrections/);
  });
});

describe('évidence : document → pièce → fait', () => {
  const caseWith = (patch: Partial<Record<keyof LegalCase, unknown>>) => ({
    ...buildFullLegalCaseV3(),
    ...patch,
  });

  it('rejette une pièce documentaire dont le document est absent', () => {
    const evi = makeDocumentaryEvidence('evi-x', 'doc-absent');
    expect(errorOf(caseWith({ evidence: [evi] }))).toMatch(/document inconnu/);
  });

  it('rejette une pièce vers un document rédigé par le moteur (circularité)', () => {
    const base = buildFullLegalCaseV3();
    const evi = makeDocumentaryEvidence('evi-x', 'doc-2');
    const result = errorOf(caseWith({ evidence: [...base.evidence, evi] }));
    expect(result).toMatch(/n'est pas « provided »/);
  });

  it('rejette une plage de caractères si le document n’a pas de contentHash', () => {
    const evi = makeDocumentaryEvidence('evi-x', 'doc-1', {
      location: { kind: 'characterRange', start: 0, end: 3 },
    });
    const documents = [makeDocument('doc-1', { title: 'sans hash' })];
    expect(
      errorOf(
        caseWith({
          documents,
          evidence: [evi],
          facts: [],
          relations: [],
          factValidations: [],
          conflicts: [],
          resolutionProposals: [],
          ruleExecutions: [],
          resolutions: [],
        }),
      ),
    ).toMatch(/contentHash/);
  });

  it('rejette un hash de document épinglé incohérent', () => {
    const evi = makeDocumentaryEvidence('evi-x', 'doc-1', { documentContentHash: 'e'.repeat(64) });
    expect(
      errorOf(
        caseWith({
          documents: [makeDocument('doc-1', { contentHash: DOC_HASH })],
          evidence: [evi],
          facts: [],
          relations: [],
          factValidations: [],
          conflicts: [],
          resolutionProposals: [],
          ruleExecutions: [],
          resolutions: [],
        }),
      ),
    ).toMatch(/incohérent/);
  });

  it('rejette une pièce documentaire dont la provenance référence un autre document', () => {
    const evi = makeDocumentaryEvidence('evi-x', 'doc-1', {
      provenance: human([documentRef('doc-2')]),
    });
    expect(
      errorOf(
        caseWith({
          documents: [makeDocument('doc-1'), makeDocument('doc-2')],
          evidence: [evi],
          facts: [],
          relations: [],
          factValidations: [],
          conflicts: [],
          resolutionProposals: [],
          ruleExecutions: [],
          resolutions: [],
        }),
      ),
    ).toMatch(/propre document/);
  });

  it('une pièce non documentaire n’exige aucun document', () => {
    const base = createLegalCase({ title: 'x' });
    expect(valid({ ...base, evidence: [makeNonDocumentaryEvidence('evi-n')] })).toEqual({
      ok: true,
    });
  });

  it('la même pièce peut soutenir plusieurs faits, un fait peut avoir plusieurs pièces', () => {
    const base = createLegalCase({ title: 'x' });
    const documents = [makeDocument('doc-1')];
    const e1 = makeDocumentaryEvidence('evi-1', 'doc-1');
    const e2 = makeNonDocumentaryEvidence('evi-2');
    const f1 = makeFact('fact-1', human([evidenceRef('evi-1', e1), evidenceRef('evi-2', e2)]));
    const f2 = makeFact('fact-2', human([evidenceRef('evi-1', e1)]));
    expect(valid({ ...base, documents, evidence: [e1, e2], facts: [f1, f2] })).toEqual({
      ok: true,
    });
  });
});

describe('relations question ↔ fait', () => {
  const relation = (id: string, factId: string, questionId: string) => ({
    kind: 'fact_question',
    id,
    factId,
    questionId,
    provenance: human(),
    recordedAt: FIXTURE_INSTANT,
  });

  it('N:N : un fait, deux questions ; une question, plusieurs faits', () => {
    const base = buildFullLegalCaseV3();
    const next = {
      ...base,
      relations: [
        ...base.relations,
        relation('rel-a-q2', 'fact-a', 'q-2'),
        relation('rel-b-q2', 'fact-b', 'q-2'),
      ],
    };
    expect(valid(next)).toEqual({ ok: true });
  });

  it('rejette une paire fait/question dupliquée (id différent)', () => {
    const base = buildFullLegalCaseV3();
    expect(
      errorOf({ ...base, relations: [...base.relations, relation('rel-dup', 'fact-a', 'q-1')] }),
    ).toMatch(/dupliquée/);
  });

  it('rejette une question absente ou un fait absent', () => {
    const base = buildFullLegalCaseV3();
    expect(
      errorOf({
        ...base,
        relations: [...base.relations, relation('rel-x', 'fact-a', 'q-absente')],
      }),
    ).toMatch(/question inconnue/);
    expect(
      errorOf({ ...base, relations: [...base.relations, relation('rel-y', 'fact-absent', 'q-1')] }),
    ).toMatch(/fait inconnu/);
  });

  it('rejette une correction dupliquée ou vers un fait inconnu', () => {
    const base = buildFullLegalCaseV3();
    const corr = (id: string, factId: string, correctsFactId: string) => ({
      kind: 'fact_correction',
      id,
      factId,
      correctsFactId,
      correction: 'corrects',
      provenance: human(),
      recordedAt: FIXTURE_INSTANT,
    });
    expect(
      errorOf({ ...base, relations: [...base.relations, corr('rel-dup', 'fact-d', 'fact-c')] }),
    ).toMatch(/dupliquée/);
    expect(
      errorOf({ ...base, relations: [...base.relations, corr('rel-z', 'fact-d', 'fact-zzz')] }),
    ).toMatch(/fait inconnu/);
  });
});

describe('validations : empreinte du fait', () => {
  it('rejette une validation dont le fait a changé depuis (empreinte incohérente)', () => {
    const base = buildFullLegalCaseV3();
    const [factA, ...rest] = base.facts;
    // Le fait est « modifié » : une autre valeur porte le même id.
    const tampered = { ...factA!, statement: 'Énoncé altéré.' };
    // Les références aux anciennes empreintes de fact-a échoueraient aussi : on retire ce qui en dépend
    // pour isoler la validation.
    const isolated = {
      ...base,
      facts: [tampered, ...rest.filter((fact) => fact.id === 'fact-b')],
      relations: [],
      conflicts: [],
      resolutionProposals: [],
      ruleExecutions: [],
      resolutions: [],
    };
    expect(errorOf(isolated)).toMatch(/factValidations\[0\]\.factFingerprint/);
  });

  it('rejette une validation vers un fait absent', () => {
    const base = buildFullLegalCaseV3();
    const bad = { ...base.factValidations[0]!, id: 'val-x', factId: 'fact-absent' };
    expect(errorOf({ ...base, factValidations: [...base.factValidations, bad] })).toMatch(
      /fait inconnu/,
    );
  });

  it('accepte plusieurs validations d’un même fait (append-only)', () => {
    const base = buildFullLegalCaseV3();
    const again = { ...base.factValidations[0]!, id: 'val-2', decision: 'reject' as const };
    expect(valid({ ...base, factValidations: [...base.factValidations, again] })).toEqual({
      ok: true,
    });
  });
});

describe('conflits', () => {
  it('rejette un conflit dont une empreinte de membre est incohérente ou un membre absent', () => {
    const base = buildFullLegalCaseV3();
    const conflict = base.conflicts[0]!;
    const bad = {
      ...conflict,
      facts: [{ ...conflict.facts[0]!, factFingerprint: fp({ x: 1 }) }, conflict.facts[1]!],
    };
    const isolated = {
      ...base,
      conflicts: [bad],
      resolutionProposals: [],
      ruleExecutions: [],
      resolutions: [],
    };
    expect(errorOf(isolated)).toMatch(/empreinte incohérente/);
    const missing = {
      ...conflict,
      facts: [conflict.facts[0]!, { factId: 'fact-absent', factFingerprint: fp({}) }],
    };
    expect(errorOf({ ...isolated, conflicts: [missing] })).toMatch(/fait inconnu/);
  });

  it('rejette un conflit entre un fait et celui qui le corrige : une correction n’est pas un conflit', () => {
    const base = buildFullLegalCaseV3();
    const c = {
      id: 'conf-x',
      facts: [
        { factId: 'fact-c', factFingerprint: fp(base.facts[2]!) },
        { factId: 'fact-d', factFingerprint: fp(base.facts[3]!) },
      ],
      detectedBy: human(),
      recordedAt: FIXTURE_INSTANT,
    };
    expect(errorOf({ ...base, conflicts: [...base.conflicts, c] })).toMatch(
      /une correction n'est pas un conflit/,
    );
  });

  it('un conflit non résolu est valide et reste dans le dossier', () => {
    const base = buildFullLegalCaseV3();
    const open = { ...base, resolutionProposals: [], ruleExecutions: [], resolutions: [] };
    expect(valid(open)).toEqual({ ok: true });
    expect(open.conflicts).toHaveLength(1);
  });
});
