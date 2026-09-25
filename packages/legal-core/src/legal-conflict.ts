import { validateLegalFingerprint, type LegalFingerprint } from './legal-fingerprint.js';
import {
  AUTHORITATIVE_PROVENANCE_ORIGINS,
  validateLegalProvenance,
  type LegalAuthoritativeProvenance,
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
 * Conflit entre faits — objet **immuable, append-only** (LegalCase v3, Q8 / D16).
 *
 * Un conflit **n'a pas de `questionId`** : sa pertinence pour une question est
 * *dérivée* de `fact_question` (deux faits liés à la même question — règle
 * appliquée paire par paire pour plus de deux membres). Il n'y a donc aucune
 * relation Conflict → Question.
 *
 *   - `facts` : au moins **deux** faits distincts, chacun épinglé par empreinte ;
 *   - `detectedBy` : humain ou règle déterministe — jamais `llm` (la détection
 *     fait passer l'état dérivé à `contradictory` : un LLM peut suggérer, il
 *     n'enregistre pas de conflit) ;
 *   - un conflit ne se supprime jamais. Il est **ouvert** tant qu'aucune
 *     résolution effective ne le ferme (état dérivé, jamais stocké).
 *
 * Une correction (`fact_correction`) ne crée pas de conflit, et un conflit ne peut
 * pas relier un fait à celui qui le corrige (validation au niveau du dossier).
 */
export interface LegalFactConflictMember {
  readonly factId: string;
  readonly factFingerprint: LegalFingerprint;
}

export interface LegalFactConflict {
  readonly id: string;
  readonly facts: readonly LegalFactConflictMember[];
  readonly detectedBy: LegalAuthoritativeProvenance;
  readonly recordedAt: LegalInstant;
}

const CONFLICT_KEYS: ReadonlySet<string> = new Set(['id', 'facts', 'detectedBy', 'recordedAt']);
const MEMBER_KEYS: ReadonlySet<string> = new Set(['factId', 'factFingerprint']);

/** Valide la forme d'un conflit non fiable. Clés fermées ; ne lève jamais. */
export function validateLegalFactConflict(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, CONFLICT_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;

  const id = validateLegalOpaqueId(record.id, `${path}.id`);
  if (!id.ok) return id;

  if (!Array.isArray(record.facts)) return invalid(`${path}.facts : liste attendue.`);
  if (record.facts.length < 2) {
    return invalid(`${path}.facts : au moins deux faits attendus.`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < record.facts.length; i += 1) {
    const memberPath = `${path}.facts[${i}]`;
    const memberClosed = validateClosedObject(record.facts[i], MEMBER_KEYS, memberPath);
    if (!memberClosed.ok) return memberClosed;
    const member = record.facts[i] as Record<string, unknown>;
    if (!isNonEmptyString(member.factId)) {
      return invalid(`${memberPath}.factId : chaîne non vide attendue.`);
    }
    if (seen.has(member.factId)) {
      return invalid(`${memberPath}.factId : fait dupliqué « ${member.factId} » dans le conflit.`);
    }
    seen.add(member.factId);
    const fingerprint = validateLegalFingerprint(
      member.factFingerprint,
      `${memberPath}.factFingerprint`,
    );
    if (!fingerprint.ok) return fingerprint;
  }

  const detected = validateLegalProvenance(
    record.detectedBy,
    `${path}.detectedBy`,
    AUTHORITATIVE_PROVENANCE_ORIGINS,
  );
  if (!detected.ok) return detected;
  const at = validateLegalInstant(record.recordedAt, `${path}.recordedAt`);
  return at.ok ? OK : at;
}
