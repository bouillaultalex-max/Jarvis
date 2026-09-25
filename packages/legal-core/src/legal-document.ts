import {
  FACT_PROVENANCE_ORIGINS,
  NON_LLM_PROVENANCE_ORIGINS,
  validateLegalProvenance,
  type LegalFactProvenance,
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
 * Document versé au dossier — LegalCase v3.
 *
 * Le document est une **matière d'entrée** (référence `document` d'une
 * `LegalInputReference`, cible d'une `LegalEvidence` documentaire) : ce n'est
 * **jamais** une valeur de `provenance.origin`. `legal-core` ne stocke aucun
 * contenu de document : il n'en porte que l'identité (`contentHash`).
 *
 *   - `kind` : `provided` (fourni : par un humain ou un outil) ou `drafted`
 *     (rédigé par le moteur). Une pièce ne peut viser qu'un document `provided` :
 *     un fait ne peut pas être fondé sur un document que JARVIS a lui-même produit
 *     (circularité).
 *   - `contentHash` : SHA-256 hexadécimal du contenu **externe** ; optionnel (sans
 *     étape d'ingestion, l'exiger est impossible) mais requis dès qu'une
 *     `characterRange` cible le document.
 *   - `provenance` : qui a introduit ce document dans le dossier. Un document
 *     `provided` n'est jamais produit par un LLM.
 *
 * Immuable une fois ajouté (append-only).
 */
export type LegalDocumentKind = 'provided' | 'drafted';

export const LEGAL_DOCUMENT_KINDS: readonly LegalDocumentKind[] = ['provided', 'drafted'];

export interface LegalDocument {
  readonly id: string;
  readonly title: string;
  readonly addedAt: LegalInstant;
  readonly kind: LegalDocumentKind;
  readonly contentHash?: string;
  readonly provenance: LegalFactProvenance;
}

const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'addedAt',
  'kind',
  'contentHash',
  'provenance',
]);
const HEX_64 = /^[0-9a-f]{64}$/;

/** Valide un document v3 non fiable. Clés fermées ; ne lève jamais. */
export function validateLegalDocument(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, DOCUMENT_KEYS, path);
  if (!closed.ok) return closed;
  const record = value as Record<string, unknown>;

  for (const result of [
    validateLegalOpaqueId(record.id, `${path}.id`),
    validateRequiredText(record.title, `${path}.title`),
    validateLegalInstant(record.addedAt, `${path}.addedAt`),
  ]) {
    if (!result.ok) return result;
  }
  if (!LEGAL_DOCUMENT_KINDS.includes(record.kind as LegalDocumentKind)) {
    return invalid(`${path}.kind : « provided » ou « drafted » attendu.`);
  }
  if (
    record.contentHash !== undefined &&
    !(typeof record.contentHash === 'string' && HEX_64.test(record.contentHash))
  ) {
    return invalid(
      `${path}.contentHash : empreinte SHA-256 hexadécimale minuscule (64 caractères) attendue.`,
    );
  }
  const allowed = record.kind === 'provided' ? NON_LLM_PROVENANCE_ORIGINS : FACT_PROVENANCE_ORIGINS;
  const provenance = validateLegalProvenance(record.provenance, `${path}.provenance`, allowed);
  if (!provenance.ok) return provenance;
  return OK;
}
