import {
  validateLegalDocumentLocation,
  type LegalDocumentLocation,
} from './legal-document-location.js';
import { validateLegalFingerprint, type LegalFingerprint } from './legal-fingerprint.js';
import { validateClosedObject, validateLegalOpaqueId } from './legal-primitives.js';
import {
  invalid,
  isNonEmptyString,
  OK,
  type LegalCaseValidation,
} from './legal-validation-shared.js';

/**
 * Références d'entrée d'une provenance — LegalCase v3 (Q2).
 *
 *   `provenance.origin`    = le **producteur** du fait ;
 *   `inputReferences`      = la matière **utilisée** pour le produire.
 *
 * Un document n'est jamais un `origin` : il apparaît ici. Ce module ne valide que
 * la **forme** ; l'existence des cibles, la cohérence des versions et des
 * empreintes sont vérifiées au niveau du dossier (`legal-fact-refs-validation.ts`).
 *
 * ## Références substantielles (U1-A1ter) — critère syntaxique, sur le seul `kind`
 * `evidence`, `document`, `tool_invocation`, `source`, `fact` sont substantielles ;
 * `question` **ne l'est pas**. `fact` l'est **inconditionnellement** : sa
 * substantialité ne dépend jamais de l'état épistémique du fait référencé
 * (aucune récursion Fact → Fact).
 *
 * ## Épinglage
 * Les références à un objet immuable du dossier (`evidence`, `fact`) portent son
 * empreinte : un cycle est alors irreprésentable (chaque empreinte dépend de
 * l'autre) et une modification de la cible est détectée.
 */
export type LegalInputReference =
  | {
      readonly kind: 'evidence';
      readonly evidenceId: string;
      readonly evidenceFingerprint: LegalFingerprint;
    }
  | {
      readonly kind: 'document';
      readonly documentId: string;
      readonly location: LegalDocumentLocation;
      readonly contentHash?: string;
    }
  | { readonly kind: 'tool_invocation'; readonly invocationId: string }
  | {
      readonly kind: 'source';
      readonly sourceId: string;
      readonly sourceVersion: string;
      readonly contentHash?: string;
    }
  | { readonly kind: 'fact'; readonly factId: string; readonly factFingerprint: LegalFingerprint }
  | { readonly kind: 'question'; readonly questionId: string };

export type LegalInputReferenceKind = LegalInputReference['kind'];

/** Kinds de référence substantiels — exactement ceux de U1-A1ter. */
export const SUBSTANTIAL_INPUT_REFERENCE_KINDS: readonly LegalInputReferenceKind[] = [
  'evidence',
  'document',
  'tool_invocation',
  'source',
  'fact',
];

/**
 * Cette référence permet-elle d'étayer le contenu d'un fait ? Critère **syntaxique**
 * sur le `kind` uniquement — jamais sur l'état de la cible.
 */
export function isSubstantialInputReference(reference: Pick<LegalInputReference, 'kind'>): boolean {
  return SUBSTANTIAL_INPUT_REFERENCE_KINDS.includes(reference.kind);
}

const HEX_64 = /^[0-9a-f]{64}$/;

const EVIDENCE_KEYS: ReadonlySet<string> = new Set(['kind', 'evidenceId', 'evidenceFingerprint']);
const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'documentId',
  'location',
  'contentHash',
]);
const TOOL_KEYS: ReadonlySet<string> = new Set(['kind', 'invocationId']);
const SOURCE_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'sourceId',
  'sourceVersion',
  'contentHash',
]);
const FACT_KEYS: ReadonlySet<string> = new Set(['kind', 'factId', 'factFingerprint']);
const QUESTION_KEYS: ReadonlySet<string> = new Set(['kind', 'questionId']);

function requireText(value: unknown, path: string): LegalCaseValidation {
  return isNonEmptyString(value) ? OK : invalid(`${path} : chaîne non vide attendue.`);
}

function optionalContentHash(value: unknown, path: string): LegalCaseValidation {
  if (value === undefined) return OK;
  return typeof value === 'string' && HEX_64.test(value)
    ? OK
    : invalid(`${path} : empreinte SHA-256 hexadécimale minuscule (64 caractères) attendue.`);
}

function all(...results: readonly LegalCaseValidation[]): LegalCaseValidation {
  for (const result of results) if (!result.ok) return result;
  return OK;
}

/** Valide la **forme** d'une référence d'entrée. Clés fermées ; ne lève jamais. */
export function validateLegalInputReference(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu.`);
  }
  const record = value as Record<string, unknown>;

  switch (record.kind) {
    case 'evidence': {
      const closed = validateClosedObject(value, EVIDENCE_KEYS, path);
      if (!closed.ok) return closed;
      return all(
        requireText(record.evidenceId, `${path}.evidenceId`),
        validateLegalFingerprint(record.evidenceFingerprint, `${path}.evidenceFingerprint`),
      );
    }
    case 'document': {
      const closed = validateClosedObject(value, DOCUMENT_KEYS, path);
      if (!closed.ok) return closed;
      return all(
        requireText(record.documentId, `${path}.documentId`),
        validateLegalDocumentLocation(record.location, `${path}.location`),
        optionalContentHash(record.contentHash, `${path}.contentHash`),
      );
    }
    case 'tool_invocation': {
      const closed = validateClosedObject(value, TOOL_KEYS, path);
      if (!closed.ok) return closed;
      return validateLegalOpaqueId(record.invocationId, `${path}.invocationId`);
    }
    case 'source': {
      const closed = validateClosedObject(value, SOURCE_KEYS, path);
      if (!closed.ok) return closed;
      return all(
        requireText(record.sourceId, `${path}.sourceId`),
        requireText(record.sourceVersion, `${path}.sourceVersion`),
        optionalContentHash(record.contentHash, `${path}.contentHash`),
      );
    }
    case 'fact': {
      const closed = validateClosedObject(value, FACT_KEYS, path);
      if (!closed.ok) return closed;
      return all(
        requireText(record.factId, `${path}.factId`),
        validateLegalFingerprint(record.factFingerprint, `${path}.factFingerprint`),
      );
    }
    case 'question': {
      const closed = validateClosedObject(value, QUESTION_KEYS, path);
      if (!closed.ok) return closed;
      return requireText(record.questionId, `${path}.questionId`);
    }
    default:
      return invalid(
        `${path}.kind : « evidence », « document », « tool_invocation », « source », « fact » ou « question » attendu.`,
      );
  }
}

/**
 * Valide une liste de références. `minimum` = nombre minimal de références
 * (exigence de la variante de provenance).
 */
export function validateLegalInputReferences(
  value: unknown,
  path: string,
  minimum = 0,
): LegalCaseValidation {
  if (!Array.isArray(value)) return invalid(`${path} : liste attendue.`);
  if (value.length < minimum) {
    return invalid(`${path} : au moins ${minimum} référence(s) d'entrée attendue(s).`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const result = validateLegalInputReference(value[i], `${path}[${i}]`);
    if (!result.ok) return result;
  }
  return OK;
}
