import type { LegalFactConflict } from './legal-conflict.js';
import type { LegalFact } from './legal-fact.js';
import type { LegalFactValidation } from './legal-fact-validation.js';
import {
  buildReferenceIndex,
  resolveProvenanceReferences,
  type LegalFactReferenceIndex,
} from './legal-fact-refs-validation.js';
import { verifyLegalFingerprint } from './legal-fingerprint.js';
import type { LegalRelation } from './legal-relation.js';
import {
  validateOutcomePartition,
  type LegalFactResolution,
  type LegalResolutionProposal,
} from './legal-resolution.js';
import type { LegalRuleExecution } from './legal-rule.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Validation **sémantique** des relations et des événements append-only du modèle
 * Fact (LegalCase v3) : relations, validations, conflits, exécutions de règle,
 * propositions, résolutions. Suppose la **forme** de chaque entité déjà validée.
 *
 * Invariants vérifiés :
 *   - relations : faits et questions existants, paire unique, corrections
 *     acycliques ;
 *   - validations : fait existant, empreinte épinglée = recalcul ;
 *   - conflits : membres existants et épinglés, aucun conflit entre un fait et
 *     celui qui le corrige ;
 *   - exécutions / propositions / résolutions : conflit existant et épinglé,
 *     partition **totale** des membres ;
 *   - résolutions : **une seule effective** par conflit ; toute résolution suivante
 *     remplace l'effective courante (`supersedesResolutionId`, cible **antérieure**
 *     dans la liste : aucun cycle possible) ; une résolution **déterministe ne
 *     remplace pas une résolution humaine** ; déterministe ⇒ exécution `resolved`
 *     du même conflit, d'issue identique et de trace cohérente ; humaine ⇒
 *     proposition référencée du même conflit.
 *
 * L'appartenance d'une règle à la whitelist n'est **pas** vérifiée ici : elle l'est
 * à l'ajout (`legal-case-append-only.ts`), pour qu'un dossier dont une règle a été
 * retirée reste lisible.
 */
export interface LegalFactEventModel {
  readonly facts: readonly LegalFact[];
  readonly questions: readonly { readonly id: string }[];
  readonly relations: readonly LegalRelation[];
  readonly factValidations: readonly LegalFactValidation[];
  readonly conflicts: readonly LegalFactConflict[];
  readonly resolutionProposals: readonly LegalResolutionProposal[];
  readonly ruleExecutions: readonly LegalRuleExecution[];
  readonly resolutions: readonly LegalFactResolution[];
}

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

function validateRelations(
  model: LegalFactEventModel,
  factIds: ReadonlySet<string>,
): LegalCaseValidation {
  const questionIds = new Set(model.questions.map((question) => question.id));
  const seenPairs = new Set<string>();
  const corrections = new Map<string, string[]>();

  for (let i = 0; i < model.relations.length; i += 1) {
    const relation = model.relations[i]!;
    const path = `relations[${i}]`;
    if (relation.kind === 'fact_question') {
      if (!factIds.has(relation.factId))
        return invalid(`${path}.factId : fait inconnu « ${relation.factId} ».`);
      if (!questionIds.has(relation.questionId)) {
        return invalid(`${path}.questionId : question inconnue « ${relation.questionId} ».`);
      }
      const key = pairKey(`q:${relation.factId}`, relation.questionId);
      if (seenPairs.has(key)) {
        return invalid(
          `${path} : relation fait/question dupliquée (« ${relation.factId} », « ${relation.questionId} »).`,
        );
      }
      seenPairs.add(key);
    } else {
      if (!factIds.has(relation.factId))
        return invalid(`${path}.factId : fait inconnu « ${relation.factId} ».`);
      if (!factIds.has(relation.correctsFactId)) {
        return invalid(`${path}.correctsFactId : fait inconnu « ${relation.correctsFactId} ».`);
      }
      const key = pairKey(`c:${relation.factId}`, relation.correctsFactId);
      if (seenPairs.has(key)) {
        return invalid(
          `${path} : correction dupliquée (« ${relation.factId} » corrige « ${relation.correctsFactId} »).`,
        );
      }
      seenPairs.add(key);
      corrections.set(relation.factId, [
        ...(corrections.get(relation.factId) ?? []),
        relation.correctsFactId,
      ]);
    }
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string, trail: readonly string[]): string | undefined => {
    const current = state.get(node);
    if (current === 'done') return undefined;
    if (current === 'visiting') return [...trail, node].join(' → ');
    state.set(node, 'visiting');
    for (const next of corrections.get(node) ?? []) {
      const cycle = visit(next, [...trail, node]);
      if (cycle !== undefined) return cycle;
    }
    state.set(node, 'done');
    return undefined;
  };
  for (const node of corrections.keys()) {
    const cycle = visit(node, []);
    if (cycle !== undefined)
      return invalid(`relations : cycle de corrections interdit (${cycle}).`);
  }
  return OK;
}

function validateValidations(
  model: LegalFactEventModel,
  facts: ReadonlyMap<string, LegalFact>,
): LegalCaseValidation {
  for (let i = 0; i < model.factValidations.length; i += 1) {
    const validation = model.factValidations[i]!;
    const path = `factValidations[${i}]`;
    const fact = facts.get(validation.factId);
    if (fact === undefined)
      return invalid(`${path}.factId : fait inconnu « ${validation.factId} ».`);
    if (!verifyLegalFingerprint(fact, validation.factFingerprint)) {
      return invalid(
        `${path}.factFingerprint : empreinte incohérente avec le fait « ${validation.factId} ».`,
      );
    }
  }
  return OK;
}

function validateConflicts(
  model: LegalFactEventModel,
  facts: ReadonlyMap<string, LegalFact>,
): LegalCaseValidation {
  const corrected = new Set<string>();
  for (const relation of model.relations) {
    if (relation.kind === 'fact_correction')
      corrected.add(pairKey(relation.factId, relation.correctsFactId));
  }
  for (let i = 0; i < model.conflicts.length; i += 1) {
    const conflict = model.conflicts[i]!;
    const path = `conflicts[${i}]`;
    for (let j = 0; j < conflict.facts.length; j += 1) {
      const member = conflict.facts[j]!;
      const fact = facts.get(member.factId);
      if (fact === undefined)
        return invalid(`${path}.facts[${j}].factId : fait inconnu « ${member.factId} ».`);
      if (!verifyLegalFingerprint(fact, member.factFingerprint)) {
        return invalid(
          `${path}.facts[${j}].factFingerprint : empreinte incohérente avec le fait « ${member.factId} ».`,
        );
      }
    }
    for (const a of conflict.facts) {
      for (const b of conflict.facts) {
        if (a !== b && corrected.has(pairKey(a.factId, b.factId))) {
          return invalid(
            `${path} : « ${a.factId} » corrige « ${b.factId} » — une correction n'est pas un conflit.`,
          );
        }
      }
    }
  }
  return OK;
}

type FoundConflict =
  | { readonly ok: true; readonly conflict: LegalFactConflict }
  | { readonly ok: false; readonly error: string };

function findConflict(
  conflicts: ReadonlyMap<string, LegalFactConflict>,
  conflictId: string,
  fingerprint: LegalFactResolution['conflictFingerprint'],
  path: string,
): FoundConflict {
  const conflict = conflicts.get(conflictId);
  if (conflict === undefined) {
    return { ok: false, error: `${path}.conflictId : conflit inconnu « ${conflictId} ».` };
  }
  if (!verifyLegalFingerprint(conflict, fingerprint)) {
    return {
      ok: false,
      error: `${path}.conflictFingerprint : empreinte incohérente avec le conflit « ${conflictId} ».`,
    };
  }
  return { ok: true, conflict };
}

function validateResolutions(model: LegalFactEventModel): LegalCaseValidation {
  const conflicts = new Map(model.conflicts.map((conflict) => [conflict.id, conflict]));
  const proposals = new Map(model.resolutionProposals.map((proposal) => [proposal.id, proposal]));
  const executions = new Map(model.ruleExecutions.map((execution) => [execution.id, execution]));

  for (let i = 0; i < model.resolutionProposals.length; i += 1) {
    const proposal = model.resolutionProposals[i]!;
    const path = `resolutionProposals[${i}]`;
    const found = findConflict(conflicts, proposal.conflictId, proposal.conflictFingerprint, path);
    if (!found.ok) return found;
    const partition = validateOutcomePartition(
      proposal.retainedFactIds,
      proposal.discardedFactIds,
      found.conflict.facts.map((member) => member.factId),
      path,
    );
    if (!partition.ok) return partition;
  }

  for (let i = 0; i < model.ruleExecutions.length; i += 1) {
    const execution = model.ruleExecutions[i]!;
    const path = `ruleExecutions[${i}]`;
    const found = findConflict(
      conflicts,
      execution.conflictId,
      execution.conflictFingerprint,
      path,
    );
    if (!found.ok) return found;
    if (execution.result === 'resolved') {
      const partition = validateOutcomePartition(
        execution.retainedFactIds,
        execution.discardedFactIds,
        found.conflict.facts.map((member) => member.factId),
        path,
      );
      if (!partition.ok) return partition;
    }
  }

  const effective = new Map<string, LegalFactResolution>();
  const earlier = new Map<string, LegalFactResolution>();
  for (let i = 0; i < model.resolutions.length; i += 1) {
    const resolution = model.resolutions[i]!;
    const path = `resolutions[${i}]`;
    const found = findConflict(
      conflicts,
      resolution.conflictId,
      resolution.conflictFingerprint,
      path,
    );
    if (!found.ok) return found;
    const partition = validateOutcomePartition(
      resolution.retainedFactIds,
      resolution.discardedFactIds,
      found.conflict.facts.map((member) => member.factId),
      path,
    );
    if (!partition.ok) return partition;

    const current = effective.get(resolution.conflictId);
    if (resolution.supersedesResolutionId === undefined) {
      if (current !== undefined) {
        return invalid(
          `${path} : résolution concurrente pour le conflit « ${resolution.conflictId} » — une résolution suivante doit remplacer la résolution effective (supersedesResolutionId).`,
        );
      }
    } else {
      const target = earlier.get(resolution.supersedesResolutionId);
      if (target === undefined) {
        return invalid(
          `${path}.supersedesResolutionId : résolution antérieure inconnue « ${resolution.supersedesResolutionId} ».`,
        );
      }
      if (target.conflictId !== resolution.conflictId) {
        return invalid(
          `${path}.supersedesResolutionId : la résolution remplacée concerne un autre conflit.`,
        );
      }
      if (current === undefined || current.id !== target.id) {
        return invalid(
          `${path}.supersedesResolutionId : « ${target.id} » n'est pas la résolution effective courante du conflit.`,
        );
      }
      if (
        resolution.provenance.origin === 'deterministic' &&
        target.provenance.origin === 'human'
      ) {
        return invalid(
          `${path} : une résolution déterministe ne remplace pas une résolution humaine.`,
        );
      }
    }

    if (resolution.provenance.origin === 'deterministic') {
      const execution = executions.get(resolution.ruleExecutionId ?? '');
      if (execution === undefined) {
        return invalid(
          `${path}.ruleExecutionId : exécution de règle inconnue « ${String(resolution.ruleExecutionId)} ».`,
        );
      }
      if (execution.conflictId !== resolution.conflictId) {
        return invalid(`${path}.ruleExecutionId : l'exécution concerne un autre conflit.`);
      }
      if (execution.result !== 'resolved') {
        return invalid(`${path}.ruleExecutionId : l'exécution n'a pas le résultat « resolved ».`);
      }
      const sameOutcome =
        execution.outcome === resolution.outcome &&
        JSON.stringify([...execution.retainedFactIds].sort()) ===
          JSON.stringify([...resolution.retainedFactIds].sort()) &&
        JSON.stringify([...execution.discardedFactIds].sort()) ===
          JSON.stringify([...resolution.discardedFactIds].sort());
      if (!sameOutcome) {
        return invalid(
          `${path} : l'issue diffère de celle de l'exécution de règle « ${execution.id} ».`,
        );
      }
      if (
        execution.provenance.operationId !== resolution.provenance.operationId ||
        execution.provenance.operationVersion !== resolution.provenance.operationVersion ||
        execution.provenance.executionId !== resolution.provenance.executionId
      ) {
        return invalid(
          `${path}.provenance : incohérente avec la trace de l'exécution « ${execution.id} ».`,
        );
      }
    } else if (resolution.basedOnProposalId !== undefined) {
      const proposal = proposals.get(resolution.basedOnProposalId);
      if (proposal === undefined) {
        return invalid(
          `${path}.basedOnProposalId : proposition inconnue « ${resolution.basedOnProposalId} ».`,
        );
      }
      if (proposal.conflictId !== resolution.conflictId) {
        return invalid(`${path}.basedOnProposalId : la proposition concerne un autre conflit.`);
      }
    }

    effective.set(resolution.conflictId, resolution);
    earlier.set(resolution.id, resolution);
  }
  return OK;
}

/** Résout les références d'entrée des provenances des relations et événements. */
function validateEventProvenances(
  model: LegalFactEventModel,
  index: LegalFactReferenceIndex,
): LegalCaseValidation {
  const groups: readonly (readonly [
    string,
    readonly { readonly provenance?: unknown; readonly detectedBy?: unknown }[],
  ])[] = [
    ['relations', model.relations],
    ['conflicts', model.conflicts],
    ['resolutionProposals', model.resolutionProposals],
    ['ruleExecutions', model.ruleExecutions],
    ['resolutions', model.resolutions],
  ];
  for (const [name, items] of groups) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const provenance = (item.provenance ?? item.detectedBy) as Parameters<
        typeof resolveProvenanceReferences
      >[0];
      const key = name === 'conflicts' ? 'detectedBy' : 'provenance';
      const result = resolveProvenanceReferences(provenance, `${name}[${i}].${key}`, index);
      if (!result.ok) return result;
    }
  }
  return OK;
}

export function validateFactEventModel(
  model: LegalFactEventModel & Parameters<typeof buildReferenceIndex>[0],
): LegalCaseValidation {
  const facts = new Map(model.facts.map((fact) => [fact.id, fact]));
  const factIds = new Set(facts.keys());
  const index = buildReferenceIndex(model);

  for (const result of [
    validateRelations(model, factIds),
    validateValidations(model, facts),
    validateConflicts(model, facts),
    validateResolutions(model),
    validateEventProvenances(model, index),
  ]) {
    if (!result.ok) return result;
  }
  return OK;
}
