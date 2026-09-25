import type { LegalFactConflict } from './legal-conflict.js';
import type { LegalFact } from './legal-fact.js';
import {
  computeLegalFingerprint,
  validateLegalFingerprint,
  type LegalFingerprint,
} from './legal-fingerprint.js';
import { validateLegalProvenance, type LegalDeterministicProvenance } from './legal-provenance.js';
import {
  validateOutcomePartition,
  validateOutcomeShape,
  type LegalResolutionOutcome,
} from './legal-resolution.js';
import {
  isLegalOpaqueId,
  validateClosedObject,
  validateLegalInstant,
  validateLegalOpaqueId,
  type LegalInstant,
} from './legal-primitives.js';
import {
  invalid,
  isNonEmptyString,
  OK,
  type LegalCaseValidation,
} from './legal-validation-shared.js';

/**
 * Catalogue de règles déterministes — LegalCase v3 (Q8).
 *
 * Une règle est **identifiée** (`ruleId`), **versionnée** (`version` entier ≥ 1),
 * **whitelistée** (elle n'existe que dans un {@link LegalRuleRegistry}), **pure**
 * (aucune I/O, aucune horloge, aucun LLM, aucun aléa : mêmes entrées → même
 * résultat), et ne produit **jamais de score** : trois résultats seulement.
 *
 * ```
 * RuleDefinition  — le code (registre) : ruleId, version, scope, reads, evaluate
 * RuleExecution   — la trace persistée d'une tentative (LegalRuleExecution)
 * RuleResult      — resolved | indeterminate | not_applicable
 * ```
 *
 * ## Whitelist à l'ajout, pas à la lecture
 * Le registre est consulté quand une exécution est **ajoutée** au dossier. Un
 * dossier dont une règle a été retirée reste lisible : les validateurs ne vérifient
 * que la forme et la cohérence des traces persistées.
 *
 * ## Entrées : des données structurées seulement
 * Une règle lit des champs structurés (`temporal`, `provenance.inputReferences`…) —
 * jamais le texte libre `statement`, jamais `provenance.origin` (une hiérarchie
 * d'origines ne doit pas devenir une règle de vérité). Le vocabulaire `reads` le
 * déclare, et la création du registre refuse ces deux champs.
 *
 * Aucun catalogue de règles concrètes n'est défini par ce module : il fournit le
 * contrat. Une proposition de résolution d'un LLM n'est jamais une exécution de règle.
 */
export type LegalRuleScope = 'fact_conflict';

export interface LegalRuleInput {
  readonly conflict: LegalFactConflict;
  /** Les faits membres du conflit (mêmes ids que `conflict.facts`). */
  readonly facts: readonly LegalFact[];
}

export type LegalRuleResult =
  | {
      readonly status: 'resolved';
      readonly outcome: LegalResolutionOutcome;
      readonly retainedFactIds: readonly string[];
      readonly discardedFactIds: readonly string[];
      readonly reasonCode: string;
    }
  | { readonly status: 'indeterminate'; readonly reasonCode: string }
  | { readonly status: 'not_applicable'; readonly reasonCode: string };

export interface LegalRuleDefinition {
  readonly ruleId: string;
  /** Entier >= 1 ; toute modification de comportement = nouvelle version. */
  readonly version: number;
  readonly scope: LegalRuleScope;
  /** Champs structurés lus (déclaratif). Jamais `statement` ni `provenance.origin`. */
  readonly reads: readonly string[];
  evaluate(input: LegalRuleInput): LegalRuleResult;
}

export interface LegalRuleRegistry {
  has(ruleId: string, version: number): boolean;
  get(ruleId: string, version: number): LegalRuleDefinition | undefined;
  list(): readonly LegalRuleDefinition[];
}

const FORBIDDEN_READS: ReadonlySet<string> = new Set(['statement', 'provenance.origin']);

function ruleKey(ruleId: string, version: number): string {
  return JSON.stringify([ruleId, version]);
}

/**
 * Construit le registre (la whitelist).
 *
 * @throws {RangeError} identifiant invalide, version non entière ou < 1, portée
 *   inconnue, `reads` vide ou interdit, doublon `(ruleId, version)`.
 */
export function createLegalRuleRegistry(
  definitions: readonly LegalRuleDefinition[],
): LegalRuleRegistry {
  const byKey = new Map<string, LegalRuleDefinition>();
  for (const definition of definitions) {
    if (!isLegalOpaqueId(definition.ruleId)) {
      throw new RangeError(
        `registre de règles : ruleId « ${String(definition.ruleId)} » invalide.`,
      );
    }
    if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
      throw new RangeError(
        `registre de règles : version de « ${definition.ruleId} » : entier >= 1 attendu.`,
      );
    }
    if (definition.scope !== 'fact_conflict') {
      throw new RangeError(`registre de règles : portée de « ${definition.ruleId} » inconnue.`);
    }
    if (
      !Array.isArray(definition.reads) ||
      definition.reads.length === 0 ||
      definition.reads.some((field) => !isNonEmptyString(field))
    ) {
      throw new RangeError(
        `registre de règles : « ${definition.ruleId} » doit déclarer les champs lus.`,
      );
    }
    const forbidden = definition.reads.find((field) => FORBIDDEN_READS.has(field));
    if (forbidden !== undefined) {
      throw new RangeError(
        `registre de règles : « ${definition.ruleId} » ne peut pas lire « ${forbidden} » (texte libre ou origine).`,
      );
    }
    if (typeof definition.evaluate !== 'function') {
      throw new RangeError(
        `registre de règles : « ${definition.ruleId} » sans fonction d'évaluation.`,
      );
    }
    const key = ruleKey(definition.ruleId, definition.version);
    if (byKey.has(key)) {
      throw new RangeError(
        `registre de règles : règle « ${definition.ruleId} » version ${definition.version} dupliquée.`,
      );
    }
    byKey.set(key, definition);
  }
  const frozen = [...byKey.values()];
  return {
    has: (ruleId, version) => byKey.has(ruleKey(ruleId, version)),
    get: (ruleId, version) => byKey.get(ruleKey(ruleId, version)),
    list: () => frozen,
  };
}

function checkResult(result: LegalRuleResult, input: LegalRuleInput, label: string): void {
  const fail = (detail: string): never => {
    throw new TypeError(`règle ${label} : résultat invalide — ${detail}`);
  };
  if (typeof result !== 'object' || result === null) return fail('objet attendu.');
  const record = result as unknown as Record<string, unknown>;
  const allowed =
    record.status === 'resolved'
      ? ['status', 'outcome', 'retainedFactIds', 'discardedFactIds', 'reasonCode']
      : ['status', 'reasonCode'];
  if (
    record.status !== 'resolved' &&
    record.status !== 'indeterminate' &&
    record.status !== 'not_applicable'
  ) {
    return fail('statut « resolved », « indeterminate » ou « not_applicable » attendu.');
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(`clé « ${key} » interdite (aucun score, aucun champ libre).`);
  }
  if (!isLegalOpaqueId(record.reasonCode)) fail('reasonCode invalide.');
  if (record.status === 'resolved') {
    const shape = validateOutcomeShape(
      record.outcome,
      record.retainedFactIds,
      record.discardedFactIds,
      'résultat',
    );
    if (!shape.ok) fail(shape.error);
    const partition = validateOutcomePartition(
      record.retainedFactIds as readonly string[],
      record.discardedFactIds as readonly string[],
      input.conflict.facts.map((member) => member.factId),
      'résultat',
    );
    if (!partition.ok) fail(partition.error);
  }
}

/**
 * Évalue une règle **whitelistée** — une seule fois, sans I/O. Vérifie la forme du
 * résultat (statut, absence de score, partition totale des membres du conflit).
 *
 * @throws {RangeError} règle absente du registre (non whitelistée).
 * @throws {TypeError} la règle a renvoyé un résultat invalide.
 */
export function evaluateLegalRule(
  registry: LegalRuleRegistry,
  ruleId: string,
  version: number,
  input: LegalRuleInput,
): LegalRuleResult {
  const definition = registry.get(ruleId, version);
  if (definition === undefined) {
    throw new RangeError(`règle « ${ruleId} » version ${String(version)} non whitelistée.`);
  }
  const result = definition.evaluate(input);
  checkResult(result, input, `« ${ruleId} » v${version}`);
  return result;
}

interface LegalRuleExecutionBase {
  readonly id: string;
  readonly conflictId: string;
  readonly conflictFingerprint: LegalFingerprint;
  /** `operationId` = `ruleId`, `operationVersion` = version ; `inputReferences` = faits du conflit épinglés. */
  readonly provenance: LegalDeterministicProvenance;
  readonly recordedAt: LegalInstant;
}

/** Trace persistée d'une tentative d'exécution de règle. */
export type LegalRuleExecution = LegalRuleExecutionBase &
  (
    | {
        readonly result: 'resolved';
        readonly outcome: LegalResolutionOutcome;
        readonly retainedFactIds: readonly string[];
        readonly discardedFactIds: readonly string[];
        readonly reasonCode: string;
      }
    | { readonly result: 'indeterminate'; readonly reasonCode: string }
    | { readonly result: 'not_applicable'; readonly reasonCode: string }
  );

export interface BuildLegalRuleExecutionInput {
  readonly id: string;
  readonly conflict: LegalFactConflict;
  readonly ruleId: string;
  readonly version: number;
  readonly executionId: string;
  readonly result: LegalRuleResult;
  /** Fourni par l'appelant : ce module n'a pas d'horloge. */
  readonly recordedAt: LegalInstant;
}

/** Construit la trace d'une exécution. Pure : identifiants et instant fournis par l'appelant. */
export function buildLegalRuleExecution(input: BuildLegalRuleExecutionInput): LegalRuleExecution {
  const base: LegalRuleExecutionBase = {
    id: input.id,
    conflictId: input.conflict.id,
    conflictFingerprint: computeLegalFingerprint(input.conflict),
    provenance: {
      origin: 'deterministic',
      operationId: input.ruleId,
      operationVersion: String(input.version),
      executionId: input.executionId,
      inputReferences: input.conflict.facts.map((member) => ({
        kind: 'fact' as const,
        factId: member.factId,
        factFingerprint: member.factFingerprint,
      })),
    },
    recordedAt: input.recordedAt,
  };
  const { result } = input;
  if (result.status === 'resolved') {
    return {
      ...base,
      result: 'resolved',
      outcome: result.outcome,
      retainedFactIds: result.retainedFactIds,
      discardedFactIds: result.discardedFactIds,
      reasonCode: result.reasonCode,
    };
  }
  return { ...base, result: result.status, reasonCode: result.reasonCode };
}

const EXECUTION_BASE_KEYS = [
  'id',
  'conflictId',
  'conflictFingerprint',
  'provenance',
  'recordedAt',
  'result',
  'reasonCode',
];
const RESOLVED_EXECUTION_KEYS: ReadonlySet<string> = new Set([
  ...EXECUTION_BASE_KEYS,
  'outcome',
  'retainedFactIds',
  'discardedFactIds',
]);
const OTHER_EXECUTION_KEYS: ReadonlySet<string> = new Set(EXECUTION_BASE_KEYS);

/** Valide la forme d'une trace d'exécution non fiable. Clés fermées ; aucun score ; ne lève jamais. */
export function validateLegalRuleExecution(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu.`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.result !== 'resolved' &&
    record.result !== 'indeterminate' &&
    record.result !== 'not_applicable'
  ) {
    return invalid(
      `${path}.result : « resolved », « indeterminate » ou « not_applicable » attendu.`,
    );
  }
  const closed = validateClosedObject(
    value,
    record.result === 'resolved' ? RESOLVED_EXECUTION_KEYS : OTHER_EXECUTION_KEYS,
    path,
  );
  if (!closed.ok) return closed;

  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    isNonEmptyString(record.conflictId)
      ? OK
      : invalid(`${path}.conflictId : chaîne non vide attendue.`),
    validateLegalFingerprint(record.conflictFingerprint, `${path}.conflictFingerprint`),
    validateLegalProvenance(record.provenance, `${path}.provenance`, ['deterministic']),
    validateLegalOpaqueId(record.reasonCode, `${path}.reasonCode`),
    validateLegalInstant(record.recordedAt, `${path}.recordedAt`),
  ]) {
    if (!result.ok) return result;
  }
  if (record.result === 'resolved') {
    return validateOutcomeShape(
      record.outcome,
      record.retainedFactIds,
      record.discardedFactIds,
      path,
    );
  }
  return OK;
}
