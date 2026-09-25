import {
  validateLegalDocumentLocation,
  type LegalDocumentLocation,
} from './legal-document-location.js';
import {
  NON_LLM_PROVENANCE_ORIGINS,
  validateLegalProvenance,
  type LegalNonLlmProvenance,
} from './legal-provenance.js';
import {
  validateClosedObject,
  validateLegalInstant,
  validateLegalOpaqueId,
  validateRequiredText,
  type LegalInstant,
} from './legal-primitives.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Pièce / preuve versée au dossier — LegalCase v3 (B4). Deux formes, discriminant
 * unique `kind` :
 *
 * ```
 * Document ── documentId + location ──► LegalEvidence (kind:'document')
 *                                            │  (référence d'entrée `evidence`, épinglée)
 *                                            ▼
 *                                        LegalFact
 *
 * LegalEvidence (kind:'non_documentary')  — aucun document imposé
 * ```
 *
 *   - `document` : `documentId` + `location` explicite (`whole` pour tout le
 *     document) + éventuellement `documentContentHash` qui **épingle** l'identité de
 *     contenu du document au versement (comme `LegalCitation` épingle la source).
 *   - `non_documentary` : témoignage, déclaration, observation, résultat d'outil…
 *     Aucune taxonomie : la nature se lit dans `description` et dans `provenance`
 *     (humain : témoignage/déclaration/observation ; outil : résultat d'outil).
 *     `contentHash` optionnel : hash d'un matériau **externe** conservé hors du
 *     dossier, opaque pour `legal-core`.
 *
 * ## Provenance obligatoire et traçable
 * Chaque pièce porte la provenance de son introduction dans le dossier :
 * `human`, `tool` ou `deterministic` — **jamais `llm`** (un LLM peut proposer un
 * fait, il ne crée pas une pièce).
 *
 * ## Relation Evidence → Fact
 * Uniquement par `fact.provenance.inputReferences` (`kind:'evidence'`) : la pièce ne
 * porte aucun `factIds`. Plusieurs faits peuvent référencer la même pièce, et un
 * fait plusieurs pièces. Cette relation signifie « produit **à partir de** » — pas
 * « prouve » : la force probante appartient à ANALYZE.
 *
 * Immuable une fois ajoutée (append-only) et épinglée par fingerprint par les
 * faits qui la référencent.
 */
export type LegalEvidenceProvenance = LegalNonLlmProvenance;

interface LegalEvidenceBase {
  readonly id: string;
  readonly description: string;
  readonly addedAt: LegalInstant;
  readonly provenance: LegalEvidenceProvenance;
}

export interface LegalDocumentaryEvidence extends LegalEvidenceBase {
  readonly kind: 'document';
  readonly documentId: string;
  readonly location: LegalDocumentLocation;
  readonly documentContentHash?: string;
}

export interface LegalNonDocumentaryEvidence extends LegalEvidenceBase {
  readonly kind: 'non_documentary';
  readonly contentHash?: string;
}

export type LegalEvidence = LegalDocumentaryEvidence | LegalNonDocumentaryEvidence;

const COMMON_KEYS = ['id', 'description', 'addedAt', 'provenance', 'kind'] as const;
const DOCUMENTARY_KEYS: ReadonlySet<string> = new Set([
  ...COMMON_KEYS,
  'documentId',
  'location',
  'documentContentHash',
]);
const NON_DOCUMENTARY_KEYS: ReadonlySet<string> = new Set([...COMMON_KEYS, 'contentHash']);
const HEX_64 = /^[0-9a-f]{64}$/;

function optionalHash(value: unknown, path: string): LegalCaseValidation {
  if (value === undefined) return OK;
  return typeof value === 'string' && HEX_64.test(value)
    ? OK
    : invalid(`${path} : empreinte SHA-256 hexadécimale minuscule (64 caractères) attendue.`);
}

/** Valide une pièce non fiable (forme). Clés fermées par variante ; ne lève jamais. */
export function validateLegalEvidence(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu.`);
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'document' && record.kind !== 'non_documentary') {
    return invalid(`${path}.kind : « document » ou « non_documentary » attendu.`);
  }
  const closed = validateClosedObject(
    value,
    record.kind === 'document' ? DOCUMENTARY_KEYS : NON_DOCUMENTARY_KEYS,
    path,
  );
  if (!closed.ok) return closed;

  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    validateRequiredText(record.description, `${path}.description`),
    validateLegalInstant(record.addedAt, `${path}.addedAt`),
    validateLegalProvenance(record.provenance, `${path}.provenance`, NON_LLM_PROVENANCE_ORIGINS),
  ]) {
    if (!result.ok) return result;
  }

  if (record.kind === 'document') {
    for (const result of [
      validateRequiredText(record.documentId, `${path}.documentId`),
      validateLegalDocumentLocation(record.location, `${path}.location`),
      optionalHash(record.documentContentHash, `${path}.documentContentHash`),
    ]) {
      if (!result.ok) return result;
    }
    return OK;
  }
  return optionalHash(record.contentHash, `${path}.contentHash`);
}
