import { validateLegalFingerprint, type LegalFingerprint } from './legal-fingerprint.js';
import {
  AUTHORITATIVE_PROVENANCE_ORIGINS,
  LLM_ONLY_PROVENANCE_ORIGINS,
  validateLegalProvenance,
  type LegalAuthoritativeProvenance,
  type LegalLlmProvenance,
} from './legal-provenance.js';
import {
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
 * Résolution de conflit — LegalCase v3 (Q8 / B2 / D18).
 *
 * **Trois notions distinctes, jamais confondues :**
 *   - validation d'un fait : `confirm | reject` (`legal-fact-validation.ts`) ;
 *   - résolution d'un conflit : `retain | discard | retain_multiple` (ici) ;
 *   - état épistémique : **dérivé**, jamais stocké (`legal-fact-state.ts`).
 *
 * ## Issues — la résolution est **totale**
 * Chaque membre du conflit est soit retenu, soit écarté (jamais supprimé) :
 *   - `retain` : exactement **un** fait retenu, les autres écartés ;
 *   - `retain_multiple` : **deux ou plus** retenus, le reste éventuellement écarté ;
 *   - `discard` : **aucun** retenu, tous écartés.
 *
 * ## Proposition ≠ résolution
 * Une {@link LegalResolutionProposal} (provenance `llm` seulement) vit dans sa propre
 * liste et son propre type : elle n'a **aucun** effet sur l'état dérivé. Seule une
 * {@link LegalFactResolution} (provenance humaine ou déterministe) est effective.
 *
 *   - résolution **déterministe** : exige une exécution de règle `resolved`
 *     (`ruleExecutionId`) dont l'issue est identique ;
 *   - résolution **humaine** : peut référencer une proposition
 *     (`basedOnProposalId`) sans s'y conformer ;
 *   - `supersedesResolutionId` remplace la résolution effective précédente du même
 *     conflit ; une résolution déterministe ne remplace **pas** une résolution
 *     humaine.
 */
export type LegalResolutionOutcome = 'retain' | 'discard' | 'retain_multiple';

export const LEGAL_RESOLUTION_OUTCOMES: readonly LegalResolutionOutcome[] = [
  'retain',
  'discard',
  'retain_multiple',
];

export interface LegalResolutionProposal {
  readonly id: string;
  readonly conflictId: string;
  readonly conflictFingerprint: LegalFingerprint;
  readonly outcome: LegalResolutionOutcome;
  readonly retainedFactIds: readonly string[];
  readonly discardedFactIds: readonly string[];
  readonly provenance: LegalLlmProvenance;
  readonly recordedAt: LegalInstant;
}

export interface LegalFactResolution {
  readonly id: string;
  readonly conflictId: string;
  readonly conflictFingerprint: LegalFingerprint;
  readonly outcome: LegalResolutionOutcome;
  readonly retainedFactIds: readonly string[];
  readonly discardedFactIds: readonly string[];
  readonly provenance: LegalAuthoritativeProvenance;
  /** Requis si et seulement si `provenance.origin === 'deterministic'`. */
  readonly ruleExecutionId?: string;
  /** Permis seulement si `provenance.origin === 'human'`. */
  readonly basedOnProposalId?: string;
  /** Remplace la résolution effective précédente du même conflit. */
  readonly supersedesResolutionId?: string;
  readonly recordedAt: LegalInstant;
}

const PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'id',
  'conflictId',
  'conflictFingerprint',
  'outcome',
  'retainedFactIds',
  'discardedFactIds',
  'provenance',
  'recordedAt',
]);
const RESOLUTION_KEYS: ReadonlySet<string> = new Set([
  ...PROPOSAL_KEYS,
  'ruleExecutionId',
  'basedOnProposalId',
  'supersedesResolutionId',
]);

function idList(value: unknown, path: string): LegalCaseValidation {
  if (!Array.isArray(value)) return invalid(`${path} : liste attendue.`);
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!isNonEmptyString(item)) return invalid(`${path}[${i}] : chaîne non vide attendue.`);
    if (seen.has(item)) return invalid(`${path}[${i}] : identifiant dupliqué « ${item} ».`);
    seen.add(item);
  }
  return OK;
}

/**
 * Forme d'une issue : cardinalité des faits retenus selon l'issue, ensembles
 * disjoints. La **partition totale** vis-à-vis des membres du conflit se vérifie
 * au niveau du dossier ({@link validateOutcomePartition}).
 */
export function validateOutcomeShape(
  outcome: unknown,
  retainedFactIds: unknown,
  discardedFactIds: unknown,
  path: string,
): LegalCaseValidation {
  if (!LEGAL_RESOLUTION_OUTCOMES.includes(outcome as LegalResolutionOutcome)) {
    return invalid(`${path}.outcome : « retain », « discard » ou « retain_multiple » attendu.`);
  }
  for (const result of [
    idList(retainedFactIds, `${path}.retainedFactIds`),
    idList(discardedFactIds, `${path}.discardedFactIds`),
  ]) {
    if (!result.ok) return result;
  }
  const retained = retainedFactIds as readonly string[];
  const discarded = discardedFactIds as readonly string[];
  if (retained.some((id) => discarded.includes(id))) {
    return invalid(`${path} : un fait ne peut pas être à la fois retenu et écarté.`);
  }
  if (outcome === 'retain' && retained.length !== 1) {
    return invalid(`${path}.retainedFactIds : exactement un fait retenu attendu pour « retain ».`);
  }
  if (outcome === 'retain_multiple' && retained.length < 2) {
    return invalid(
      `${path}.retainedFactIds : au moins deux faits retenus attendus pour « retain_multiple ».`,
    );
  }
  if (outcome === 'discard' && retained.length !== 0) {
    return invalid(`${path}.retainedFactIds : aucun fait retenu attendu pour « discard ».`);
  }
  return OK;
}

/** La résolution est **totale** : `retained ∪ discarded` = membres du conflit. */
export function validateOutcomePartition(
  retainedFactIds: readonly string[],
  discardedFactIds: readonly string[],
  memberFactIds: readonly string[],
  path: string,
): LegalCaseValidation {
  const members = new Set(memberFactIds);
  const listed = [...retainedFactIds, ...discardedFactIds];
  for (const id of listed) {
    if (!members.has(id))
      return invalid(`${path} : le fait « ${id} » n'est pas membre du conflit.`);
  }
  if (new Set(listed).size !== members.size) {
    return invalid(
      `${path} : la résolution doit couvrir tous les membres du conflit (retenus ∪ écartés).`,
    );
  }
  return OK;
}

function commonFields(record: Record<string, unknown>, path: string): LegalCaseValidation {
  const conflictId = isNonEmptyString(record.conflictId)
    ? OK
    : invalid(`${path}.conflictId : chaîne non vide attendue.`);
  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    conflictId,
    validateLegalFingerprint(record.conflictFingerprint, `${path}.conflictFingerprint`),
    validateOutcomeShape(record.outcome, record.retainedFactIds, record.discardedFactIds, path),
    validateLegalInstant(record.recordedAt, `${path}.recordedAt`),
  ]) {
    if (!result.ok) return result;
  }
  return OK;
}

/** Valide la forme d'une proposition. Provenance `llm` seulement ; clés fermées ; ne lève jamais. */
export function validateLegalResolutionProposal(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, PROPOSAL_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;
  const common = commonFields(record, path);
  if (!common.ok) return common;
  return validateLegalProvenance(
    record.provenance,
    `${path}.provenance`,
    LLM_ONLY_PROVENANCE_ORIGINS,
  );
}

/** Valide la forme d'une résolution. Provenance humaine ou déterministe ; clés fermées ; ne lève jamais. */
export function validateLegalFactResolution(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, RESOLUTION_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;
  const common = commonFields(record, path);
  if (!common.ok) return common;
  const provenance = validateLegalProvenance(
    record.provenance,
    `${path}.provenance`,
    AUTHORITATIVE_PROVENANCE_ORIGINS,
  );
  if (!provenance.ok) return provenance;

  const origin = (record.provenance as { origin: string }).origin;
  if (origin === 'deterministic') {
    if (!isNonEmptyString(record.ruleExecutionId)) {
      return invalid(`${path}.ruleExecutionId : requis pour une résolution déterministe.`);
    }
    if (record.basedOnProposalId !== undefined) {
      return invalid(`${path}.basedOnProposalId : réservé à une résolution humaine.`);
    }
  } else {
    if (record.ruleExecutionId !== undefined) {
      return invalid(`${path}.ruleExecutionId : réservé à une résolution déterministe.`);
    }
    if (record.basedOnProposalId !== undefined && !isNonEmptyString(record.basedOnProposalId)) {
      return invalid(`${path}.basedOnProposalId : chaîne non vide attendue.`);
    }
  }
  if (
    record.supersedesResolutionId !== undefined &&
    !isNonEmptyString(record.supersedesResolutionId)
  ) {
    return invalid(`${path}.supersedesResolutionId : chaîne non vide attendue.`);
  }
  return OK;
}
