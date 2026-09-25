import type { LegalSource } from './legal-case.js';
import type { LegalDocument } from './legal-document.js';
import type { LegalEvidence } from './legal-evidence.js';
import type { LegalFact } from './legal-fact.js';
import { verifyLegalFingerprint } from './legal-fingerprint.js';
import type { LegalInputReference } from './legal-input-reference.js';
import type { LegalFactProvenance } from './legal-provenance.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Validation **sémantique** des références d'entrée (LegalCase v3) — chaque
 * référence doit désigner un objet réellement présent dans le dossier, avec les
 * bonnes versions et les bonnes empreintes. Les cycles sont refusés.
 *
 * Les provenances de **tous** les objets du modèle Fact (faits, pièces, documents,
 * relations, conflits, propositions, exécutions, résolutions) sont résolues ici.
 *
 * ## Cycles
 * Explicites, sur le graphe `fait / pièce / document → fait / pièce / document`
 * (références `fact`, `evidence`, `document`). Les empreintes épinglées rendent
 * déjà impossible un cycle entre objets épinglés, mais un document est référencé
 * sans être épinglé par empreinte d'objet (son `contentHash` est celui d'un contenu
 * externe) : le contrôle explicite couvre tous les cas.
 */
export interface LegalFactReferenceIndex {
  readonly facts: ReadonlyMap<string, LegalFact>;
  readonly evidence: ReadonlyMap<string, LegalEvidence>;
  readonly documents: ReadonlyMap<string, LegalDocument>;
  readonly sources: ReadonlyMap<string, LegalSource>;
  readonly questionIds: ReadonlySet<string>;
}

export function buildReferenceIndex(model: {
  readonly facts: readonly LegalFact[];
  readonly evidence: readonly LegalEvidence[];
  readonly documents: readonly LegalDocument[];
  readonly sources: readonly LegalSource[];
  readonly questions: readonly { readonly id: string }[];
}): LegalFactReferenceIndex {
  return {
    facts: new Map(model.facts.map((fact) => [fact.id, fact])),
    evidence: new Map(model.evidence.map((item) => [item.id, item])),
    documents: new Map(model.documents.map((document) => [document.id, document])),
    sources: new Map(model.sources.map((source) => [source.id, source])),
    questionIds: new Set(model.questions.map((question) => question.id)),
  };
}

/**
 * Résout une référence d'entrée. `ownerKey` (ex. `fact:f-1`) sert à refuser
 * l'auto-référence.
 */
export function resolveInputReference(
  reference: LegalInputReference,
  path: string,
  index: LegalFactReferenceIndex,
  ownerKey?: string,
): LegalCaseValidation {
  switch (reference.kind) {
    case 'evidence': {
      const target = index.evidence.get(reference.evidenceId);
      if (target === undefined)
        return invalid(`${path} : pièce inconnue « ${reference.evidenceId} ».`);
      if (ownerKey === `evidence:${reference.evidenceId}`)
        return invalid(`${path} : auto-référence interdite.`);
      return verifyLegalFingerprint(target, reference.evidenceFingerprint)
        ? OK
        : invalid(`${path} : empreinte incohérente avec la pièce « ${reference.evidenceId} ».`);
    }
    case 'document': {
      const target = index.documents.get(reference.documentId);
      if (target === undefined)
        return invalid(`${path} : document inconnu « ${reference.documentId} ».`);
      if (ownerKey === `document:${reference.documentId}`)
        return invalid(`${path} : auto-référence interdite.`);
      if (reference.location.kind === 'characterRange' && target.contentHash === undefined) {
        return invalid(
          `${path}.location : une plage de caractères exige un contentHash sur le document « ${reference.documentId} ».`,
        );
      }
      if (reference.contentHash !== undefined && reference.contentHash !== target.contentHash) {
        return invalid(
          `${path}.contentHash : incohérent avec le document « ${reference.documentId} ».`,
        );
      }
      return OK;
    }
    case 'source': {
      const target = index.sources.get(reference.sourceId);
      if (target === undefined)
        return invalid(`${path} : source inconnue « ${reference.sourceId} ».`);
      if (target.version !== reference.sourceVersion) {
        return invalid(
          `${path}.sourceVersion : incohérente — la source « ${reference.sourceId} » est en version « ${target.version} ».`,
        );
      }
      if (reference.contentHash !== undefined && reference.contentHash !== target.contentHash) {
        return invalid(
          `${path}.contentHash : incohérent avec la source « ${reference.sourceId} ».`,
        );
      }
      return OK;
    }
    case 'fact': {
      const target = index.facts.get(reference.factId);
      if (target === undefined) return invalid(`${path} : fait inconnu « ${reference.factId} ».`);
      if (ownerKey === `fact:${reference.factId}`)
        return invalid(`${path} : auto-référence interdite.`);
      return verifyLegalFingerprint(target, reference.factFingerprint)
        ? OK
        : invalid(`${path} : empreinte incohérente avec le fait « ${reference.factId} ».`);
    }
    case 'question':
      return index.questionIds.has(reference.questionId)
        ? OK
        : invalid(`${path} : question inconnue « ${reference.questionId} ».`);
    case 'tool_invocation':
      // Aucun journal d'appels n'existe : seule la forme est vérifiable.
      return OK;
  }
}

/** Résout toutes les références d'une provenance. */
export function resolveProvenanceReferences(
  provenance: LegalFactProvenance,
  path: string,
  index: LegalFactReferenceIndex,
  ownerKey?: string,
): LegalCaseValidation {
  for (let i = 0; i < provenance.inputReferences.length; i += 1) {
    const result = resolveInputReference(
      provenance.inputReferences[i]!,
      `${path}.inputReferences[${i}]`,
      index,
      ownerKey,
    );
    if (!result.ok) return result;
  }
  return OK;
}

function edgeTarget(reference: LegalInputReference): string | undefined {
  switch (reference.kind) {
    case 'fact':
      return `fact:${reference.factId}`;
    case 'evidence':
      return `evidence:${reference.evidenceId}`;
    case 'document':
      return `document:${reference.documentId}`;
    default:
      return undefined;
  }
}

/** Refuse tout cycle dans le graphe des références entre faits, pièces et documents. */
export function validateReferenceGraphAcyclic(model: {
  readonly facts: readonly LegalFact[];
  readonly evidence: readonly LegalEvidence[];
  readonly documents: readonly LegalDocument[];
}): LegalCaseValidation {
  const edges = new Map<string, readonly string[]>();
  const add = (key: string, provenance: LegalFactProvenance): void => {
    const targets = provenance.inputReferences
      .map(edgeTarget)
      .filter((target): target is string => target !== undefined);
    edges.set(key, targets);
  };
  for (const fact of model.facts) add(`fact:${fact.id}`, fact.provenance);
  for (const item of model.evidence) add(`evidence:${item.id}`, item.provenance);
  for (const document of model.documents) add(`document:${document.id}`, document.provenance);

  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string, trail: readonly string[]): string | undefined => {
    const current = state.get(node);
    if (current === 'done') return undefined;
    if (current === 'visiting') return [...trail, node].join(' → ');
    state.set(node, 'visiting');
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next, [...trail, node]);
      if (cycle !== undefined) return cycle;
    }
    state.set(node, 'done');
    return undefined;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node, []);
    if (cycle !== undefined) return invalid(`références : cycle interdit (${cycle}).`);
  }
  return OK;
}

/**
 * Cohérence pièce ↔ document et résolution des références des faits, pièces et
 * documents. Suppose la **forme** des entités déjà validée.
 */
export function validateFactModelReferences(model: {
  readonly facts: readonly LegalFact[];
  readonly documents: readonly LegalDocument[];
  readonly evidence: readonly LegalEvidence[];
  readonly questions: readonly { readonly id: string }[];
  readonly sources: readonly LegalSource[];
}): LegalCaseValidation {
  const index = buildReferenceIndex(model);

  // Pièce documentaire → document `provided`, hash épinglé et localisation cohérents.
  for (let i = 0; i < model.evidence.length; i += 1) {
    const item = model.evidence[i]!;
    const path = `evidence[${i}]`;
    if (item.kind !== 'document') continue;
    const document = index.documents.get(item.documentId);
    if (document === undefined)
      return invalid(`${path}.documentId : document inconnu « ${item.documentId} ».`);
    if (document.kind !== 'provided') {
      return invalid(
        `${path}.documentId : le document « ${item.documentId} » n'est pas « provided » (un fait ne peut pas être fondé sur un document rédigé par le moteur).`,
      );
    }
    if (item.location.kind === 'characterRange' && document.contentHash === undefined) {
      return invalid(
        `${path}.location : une plage de caractères exige un contentHash sur le document « ${item.documentId} ».`,
      );
    }
    if (
      item.documentContentHash !== undefined &&
      item.documentContentHash !== document.contentHash
    ) {
      return invalid(
        `${path}.documentContentHash : incohérent avec le document « ${item.documentId} ».`,
      );
    }
    // Un seul lien vers le document : toute référence `document` de la provenance désigne le même.
    for (let j = 0; j < item.provenance.inputReferences.length; j += 1) {
      const reference = item.provenance.inputReferences[j]!;
      if (reference.kind === 'document' && reference.documentId !== item.documentId) {
        return invalid(
          `${path}.provenance.inputReferences[${j}] : une pièce documentaire ne peut référencer que son propre document « ${item.documentId} ».`,
        );
      }
    }
  }

  const acyclic = validateReferenceGraphAcyclic(model);
  if (!acyclic.ok) return acyclic;

  for (let i = 0; i < model.facts.length; i += 1) {
    const fact = model.facts[i]!;
    const result = resolveProvenanceReferences(
      fact.provenance,
      `facts[${i}].provenance`,
      index,
      `fact:${fact.id}`,
    );
    if (!result.ok) return result;
  }
  for (let i = 0; i < model.evidence.length; i += 1) {
    const item = model.evidence[i]!;
    const result = resolveProvenanceReferences(
      item.provenance,
      `evidence[${i}].provenance`,
      index,
      `evidence:${item.id}`,
    );
    if (!result.ok) return result;
  }
  for (let i = 0; i < model.documents.length; i += 1) {
    const document = model.documents[i]!;
    const result = resolveProvenanceReferences(
      document.provenance,
      `documents[${i}].provenance`,
      index,
      `document:${document.id}`,
    );
    if (!result.ok) return result;
  }
  return OK;
}
