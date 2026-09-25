import { validateLegalInputReferences, type LegalInputReference } from './legal-input-reference.js';
import { validateClosedObject, validateLegalOpaqueId } from './legal-primitives.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Provenance d'un fait (et, avec des sous-ensembles d'origines, d'une pièce, d'un
 * document, d'une relation, d'un conflit, d'une résolution) — LegalCase v3.
 *
 * ## Discriminant unique (Q1)
 * `provenance.origin` est le **seul** discriminant. Il n'existe aucune seconde
 * source de vérité : une clé appartenant à une autre variante est une clé inconnue
 * et fait rejeter la valeur (`origin:'human'` avec un `model` est invalide **par
 * construction**).
 *
 * ## Quatre origins, rien d'autre (Q2)
 * `human`, `tool`, `deterministic`, `llm`. **`document` n'est pas un origin** : un
 * fait tiré d'un document conserve pour origin le producteur réel (humain, règle,
 * LLM…) et référence le document via `inputReferences`.
 *
 * ## Représentation de données, pas dépendance
 * Cette provenance ne référence aucun type d'`@jarvis/llm`, `@jarvis/core` ou
 * `@jarvis/connectors` : ce sont des identifiants opaques. `legal-core` reste une
 * feuille ; les producteurs (ToolExecutor, couche LLM, applications) vivent
 * au-dessus.
 *
 * ## Données sensibles à ne jamais exposer
 * Aucun jeton, secret, clé d'API, prompt, sortie brute de modèle, entrée ou sortie
 * d'outil. `accountId` est un identifiant **technique** (`Account.id`) ; jamais
 * `Account.accountIdentifier` (adresse e-mail) — le format d'identifiant opaque la
 * rejette structurellement. `interactionId` ne doit pas être un `confirmationId`
 * (jeton porteur).
 */
export type LegalProvenanceOrigin = 'human' | 'tool' | 'deterministic' | 'llm';

/** Ensemble des origins — exposé pour la validation et les tests. */
export const LEGAL_PROVENANCE_ORIGINS: readonly LegalProvenanceOrigin[] = [
  'human',
  'tool',
  'deterministic',
  'llm',
];

interface LegalProvenanceBase {
  readonly inputReferences: readonly LegalInputReference[];
}

export interface LegalHumanProvenance extends LegalProvenanceBase {
  readonly origin: 'human';
  readonly actorId: string;
  readonly interactionId: string;
}

export interface LegalToolProvenance extends LegalProvenanceBase {
  readonly origin: 'tool';
  readonly toolName: string;
  readonly invocationId: string;
  readonly connectorId: string;
  /** Conditionnel : présent seulement si l'outil utilise réellement un compte. Jamais inventé. */
  readonly accountId?: string;
}

export interface LegalDeterministicProvenance extends LegalProvenanceBase {
  readonly origin: 'deterministic';
  readonly operationId: string;
  readonly operationVersion: string;
  readonly executionId: string;
}

export interface LegalLlmProvenance extends LegalProvenanceBase {
  readonly origin: 'llm';
  readonly provider: string;
  readonly model: string;
  readonly invocationId: string;
  readonly instructionVersion: string;
}

/** Provenance d'un `LegalFact` : les quatre variantes. */
export type LegalFactProvenance =
  LegalHumanProvenance | LegalToolProvenance | LegalDeterministicProvenance | LegalLlmProvenance;

/** Alias général. */
export type LegalProvenance = LegalFactProvenance;

/** Pièce, relation `fact_question` : jamais `llm`. */
export type LegalNonLlmProvenance =
  LegalHumanProvenance | LegalToolProvenance | LegalDeterministicProvenance;

/** Correction, détection de conflit, résolution : humain ou règle déterministe seulement. */
export type LegalAuthoritativeProvenance = LegalHumanProvenance | LegalDeterministicProvenance;

/** Origins autorisés selon l'objet porteur (le LLM n'a jamais autorité sur ceux-ci). */
export const FACT_PROVENANCE_ORIGINS: readonly LegalProvenanceOrigin[] = LEGAL_PROVENANCE_ORIGINS;
/** Pièce, relation `fact_question` : jamais `llm`. */
export const NON_LLM_PROVENANCE_ORIGINS: readonly LegalProvenanceOrigin[] = [
  'human',
  'tool',
  'deterministic',
];
/** Correction, détection de conflit, résolution : humain ou règle déterministe seulement. */
export const AUTHORITATIVE_PROVENANCE_ORIGINS: readonly LegalProvenanceOrigin[] = [
  'human',
  'deterministic',
];
/** Proposition de résolution : LLM seulement (jamais une résolution). */
export const LLM_ONLY_PROVENANCE_ORIGINS: readonly LegalProvenanceOrigin[] = ['llm'];

const HUMAN_KEYS: ReadonlySet<string> = new Set([
  'origin',
  'actorId',
  'interactionId',
  'inputReferences',
]);
const TOOL_KEYS: ReadonlySet<string> = new Set([
  'origin',
  'toolName',
  'invocationId',
  'connectorId',
  'accountId',
  'inputReferences',
]);
const DETERMINISTIC_KEYS: ReadonlySet<string> = new Set([
  'origin',
  'operationId',
  'operationVersion',
  'executionId',
  'inputReferences',
]);
const LLM_KEYS: ReadonlySet<string> = new Set([
  'origin',
  'provider',
  'model',
  'invocationId',
  'instructionVersion',
  'inputReferences',
]);

function ids(
  record: Record<string, unknown>,
  path: string,
  fields: readonly string[],
): LegalCaseValidation {
  for (const field of fields) {
    const result = validateLegalOpaqueId(record[field], `${path}.${field}`);
    if (!result.ok) return result;
  }
  return OK;
}

/**
 * Valide une provenance non fiable.
 *
 * @param allowedOrigins origins acceptés pour l'objet porteur ; un origin connu
 *   mais non autorisé ici est rejeté (autorité : le LLM ne valide, ne résout, ne
 *   corrige jamais).
 */
export function validateLegalProvenance(
  value: unknown,
  path: string,
  allowedOrigins: readonly LegalProvenanceOrigin[] = FACT_PROVENANCE_ORIGINS,
): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu.`);
  }
  const record = value as Record<string, unknown>;
  const origin = record.origin;

  if (!LEGAL_PROVENANCE_ORIGINS.includes(origin as LegalProvenanceOrigin)) {
    return invalid(
      `${path}.origin : l'une de ${LEGAL_PROVENANCE_ORIGINS.join(', ')} attendue (« document » n'est pas un origin).`,
    );
  }
  if (!allowedOrigins.includes(origin as LegalProvenanceOrigin)) {
    return invalid(
      `${path}.origin : « ${String(origin)} » non autorisé ici (autorisés : ${allowedOrigins.join(', ')}).`,
    );
  }

  switch (origin) {
    case 'human': {
      const closed = validateClosedObject(value, HUMAN_KEYS, path);
      if (!closed.ok) return closed;
      const fields = ids(record, path, ['actorId', 'interactionId']);
      if (!fields.ok) return fields;
      return validateLegalInputReferences(record.inputReferences, `${path}.inputReferences`, 0);
    }
    case 'tool': {
      const closed = validateClosedObject(value, TOOL_KEYS, path);
      if (!closed.ok) return closed;
      const fields = ids(record, path, ['toolName', 'invocationId', 'connectorId']);
      if (!fields.ok) return fields;
      if (record.accountId !== undefined) {
        const account = validateLegalOpaqueId(record.accountId, `${path}.accountId`);
        if (!account.ok) return account;
      }
      return validateLegalInputReferences(record.inputReferences, `${path}.inputReferences`, 0);
    }
    case 'deterministic': {
      const closed = validateClosedObject(value, DETERMINISTIC_KEYS, path);
      if (!closed.ok) return closed;
      const fields = ids(record, path, ['operationId', 'operationVersion', 'executionId']);
      if (!fields.ok) return fields;
      return validateLegalInputReferences(record.inputReferences, `${path}.inputReferences`, 1);
    }
    default: {
      const closed = validateClosedObject(value, LLM_KEYS, path);
      if (!closed.ok) return closed;
      const fields = ids(record, path, ['provider', 'model', 'invocationId', 'instructionVersion']);
      if (!fields.ok) return fields;
      return validateLegalInputReferences(record.inputReferences, `${path}.inputReferences`, 1);
    }
  }
}
