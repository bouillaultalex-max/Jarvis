import { computeLegalFingerprint, type LegalFingerprint } from '../legal-fingerprint.js';
import type { LegalDocument } from '../legal-document.js';
import type { LegalEvidence } from '../legal-evidence.js';
import type { LegalFact } from '../legal-fact.js';
import type { LegalInputReference } from '../legal-input-reference.js';
import type {
  LegalDeterministicProvenance,
  LegalFactProvenance,
  LegalHumanProvenance,
  LegalLlmProvenance,
  LegalToolProvenance,
} from '../legal-provenance.js';
import type { LegalFactTemporal } from '../legal-temporal.js';

/**
 * Fixtures **de test** du modèle v3 (non exportées par `index.ts`) — même
 * convention que `legal-research/src/research/testing/`.
 */

export const FIXTURE_INSTANT = '2026-09-24T10:00:00.000Z';

export function fp(value: unknown): LegalFingerprint {
  return computeLegalFingerprint(value);
}

export const evidenceRef = (evidenceId: string, evidence: unknown): LegalInputReference => ({
  kind: 'evidence',
  evidenceId,
  evidenceFingerprint: fp(evidence),
});

export const factRef = (factId: string, fact: unknown): LegalInputReference => ({
  kind: 'fact',
  factId,
  factFingerprint: fp(fact),
});

export const documentRef = (documentId: string): LegalInputReference => ({
  kind: 'document',
  documentId,
  location: { kind: 'whole' },
});

export const questionRef = (questionId: string): LegalInputReference => ({
  kind: 'question',
  questionId,
});

export const toolRef = (invocationId: string): LegalInputReference => ({
  kind: 'tool_invocation',
  invocationId,
});

export const sourceRef = (sourceId: string, sourceVersion: string): LegalInputReference => ({
  kind: 'source',
  sourceId,
  sourceVersion,
});

export function human(inputReferences: readonly LegalInputReference[] = []): LegalHumanProvenance {
  return { origin: 'human', actorId: 'actor-1', interactionId: 'interaction-1', inputReferences };
}

export function tool(
  inputReferences: readonly LegalInputReference[] = [],
  accountId?: string,
): LegalToolProvenance {
  return {
    origin: 'tool',
    toolName: 'gmail.read',
    invocationId: 'inv-1',
    connectorId: 'gmail',
    ...(accountId !== undefined ? { accountId } : {}),
    inputReferences,
  };
}

export function deterministic(
  inputReferences: readonly LegalInputReference[] = [documentRef('doc-1')],
): LegalDeterministicProvenance {
  return {
    origin: 'deterministic',
    operationId: 'op-extract',
    operationVersion: '1',
    executionId: 'exec-1',
    inputReferences,
  };
}

export function llm(
  inputReferences: readonly LegalInputReference[] = [documentRef('doc-1')],
): LegalLlmProvenance {
  return {
    origin: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    invocationId: 'llm-inv-1',
    instructionVersion: '2026-09-24.1',
    inputReferences,
  };
}

// ---------------------------------------------------------------------------
// Entités v3 minimales
// ---------------------------------------------------------------------------

export const UNKNOWN_TEMPORAL: LegalFactTemporal = { kind: 'unknown' };

export function makeFact(
  id: string,
  provenance: LegalFactProvenance = human(),
  overrides: Partial<LegalFact> = {},
): LegalFact {
  return {
    id,
    statement: `Énoncé de ${id}.`,
    temporal: UNKNOWN_TEMPORAL,
    provenance,
    recordedAt: FIXTURE_INSTANT,
    ...overrides,
  };
}

export function makeDocument(id: string, overrides: Partial<LegalDocument> = {}): LegalDocument {
  return {
    id,
    title: `Document ${id}`,
    addedAt: FIXTURE_INSTANT,
    kind: 'provided',
    provenance: human(),
    ...overrides,
  };
}

export function makeDocumentaryEvidence(
  id: string,
  documentId: string,
  overrides: Partial<Extract<LegalEvidence, { kind: 'document' }>> = {},
): LegalEvidence {
  return {
    kind: 'document',
    id,
    description: `Pièce ${id}`,
    addedAt: FIXTURE_INSTANT,
    documentId,
    location: { kind: 'page', page: 2 },
    provenance: human(),
    ...overrides,
  };
}

export function makeNonDocumentaryEvidence(
  id: string,
  overrides: Partial<Extract<LegalEvidence, { kind: 'non_documentary' }>> = {},
): LegalEvidence {
  return {
    kind: 'non_documentary',
    id,
    description: `Témoignage ${id}`,
    addedAt: FIXTURE_INSTANT,
    provenance: human(),
    ...overrides,
  };
}

/** Copie de `value` sans la clé `key` (fabrication de cas invalides dans les tests). */
export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

/** Copie de `value` sans les clés `keys`. */
export function omitKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => !(keys as readonly string[]).includes(name)),
  ) as Omit<T, K>;
}
