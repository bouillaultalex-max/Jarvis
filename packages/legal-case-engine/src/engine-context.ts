import {
  isLegalInstant,
  validateLegalCaseV3,
  validateLegalOpaqueId,
  type LegalCase,
  type LegalHumanProvenance,
  type LegalInputReference,
  type LegalInstant,
} from '@jarvis/legal-core';

import { LegalCaseEngineError } from './errors.js';

/**
 * Contexte injecté par l'appelant (décision D2) : l'identité humaine et l'interaction à
 * l'origine de l'opération. Le moteur ne génère **jamais** ces identifiants et ne peut pas
 * les authentifier : il n'en contrôle que le **format** (identifiant opaque de `legal-core`,
 * qui rejette notamment une adresse e-mail). `interactionId` ne doit pas être un
 * `confirmationId` (jeton porteur) — c'est à l'appelant d'y veiller.
 */
export interface LegalEngineContext {
  readonly actorId: string;
  readonly interactionId: string;
}

/** Horloge injectée : renvoie un instant ISO 8601 avec décalage explicite. */
export type LegalEngineClock = () => LegalInstant;

/** Options communes à toutes les opérations d'écriture du moteur. */
export interface LegalEngineOptions {
  readonly context: LegalEngineContext;
  /** Obligatoire : aucune horloge cachée. Voir `systemClock` pour l'horloge réelle. */
  readonly now: LegalEngineClock;
}

/** Options validées : le contexte recopié et **l'unique** instant de l'opération. */
export interface ResolvedEngineOptions {
  readonly context: LegalEngineContext;
  readonly at: LegalInstant;
}

const CONTEXT_KEYS: ReadonlySet<string> = new Set(['actorId', 'interactionId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateContext(value: unknown): LegalEngineContext {
  if (!isRecord(value)) {
    throw new LegalCaseEngineError('invalid_context', 'contexte absent (objet attendu).');
  }
  for (const key of Object.keys(value)) {
    if (!CONTEXT_KEYS.has(key)) {
      throw new LegalCaseEngineError(
        'invalid_context',
        `clé inconnue « ${key} » dans le contexte.`,
      );
    }
  }
  for (const field of ['actorId', 'interactionId'] as const) {
    const result = validateLegalOpaqueId(value[field], `context.${field}`);
    if (!result.ok) throw new LegalCaseEngineError('invalid_context', result.error);
  }
  return { actorId: value.actorId as string, interactionId: value.interactionId as string };
}

/**
 * Valide le contexte et l'horloge, et lit l'horloge **une seule fois** : tous les objets
 * d'une opération partagent ainsi le même instant (pas de dérive interne).
 *
 * @throws {LegalCaseEngineError} `invalid_context` ou `invalid_clock`.
 */
export function resolveEngineOptions(options: unknown): ResolvedEngineOptions {
  if (!isRecord(options)) {
    throw new LegalCaseEngineError('invalid_context', 'options absentes (objet attendu).');
  }
  const context = validateContext(options.context);
  if (typeof options.now !== 'function') {
    throw new LegalCaseEngineError(
      'invalid_clock',
      'horloge injectée absente (fonction attendue).',
    );
  }
  let at: unknown;
  try {
    at = (options.now as LegalEngineClock)();
  } catch {
    throw new LegalCaseEngineError('invalid_clock', "l'horloge injectée a levé une erreur.");
  }
  if (!isLegalInstant(at)) {
    throw new LegalCaseEngineError(
      'invalid_clock',
      "l'horloge doit renvoyer un instant ISO 8601 avec décalage explicite (Z ou ±hh:mm).",
    );
  }
  return { context, at };
}

/**
 * Provenance **humaine** construite à partir du seul contexte fourni : rien n'est inventé
 * (les identifiants viennent de l'appelant, les références d'entrée de l'opération).
 */
export function buildHumanProvenance(
  context: LegalEngineContext,
  inputReferences: readonly LegalInputReference[] = [],
): LegalHumanProvenance {
  return {
    origin: 'human',
    actorId: context.actorId,
    interactionId: context.interactionId,
    inputReferences,
  };
}

/**
 * Le dossier fourni est-il un `LegalCase` v3 valide, ses dates `createdAt` et `updatedAt` sont-elles
 * des instants (jamais une date seule, jamais convertie), et l'instant `at` n'est-il pas antérieur à
 * sa dernière mise à jour ni aux objets déjà enregistrés (chronologie à l'écriture, décision D6) ? Le validateur v3 est
 * **gelé** et n'impose pas ce contrôle : il est fait ici, uniquement pour les écritures du
 * moteur. L'égalité est admise.
 *
 * @throws {LegalCaseEngineError} `invalid_case` ou `chronology`.
 */
export function assertWritableCase(legalCase: LegalCase, at: LegalInstant): void {
  const validation = validateLegalCaseV3(legalCase);
  if (!validation.ok) {
    throw new LegalCaseEngineError('invalid_case', validation.error);
  }
  // `legal-core` accepte n'importe quelle chaîne non vide pour `createdAt` : une date seule
  // (« 2026-09-24 ») n'est pas un instant. Le moteur ne l'interprète ni ne la convertit jamais.
  if (!isLegalInstant(legalCase.createdAt)) {
    throw new LegalCaseEngineError(
      'chronology',
      "« createdAt » du dossier n'est pas un instant valide (ISO 8601 avec décalage explicite, " +
        'une date seule ne suffit pas) : chronologie invérifiable.',
    );
  }
  if (!isLegalInstant(legalCase.updatedAt)) {
    throw new LegalCaseEngineError(
      'chronology',
      "« updatedAt » du dossier n'est pas un instant valide : chronologie invérifiable.",
    );
  }
  if (Date.parse(at) < Date.parse(legalCase.updatedAt)) {
    throw new LegalCaseEngineError(
      'chronology',
      "l'instant de l'opération est antérieur à « updatedAt » du dossier.",
    );
  }
  const latest = latestRecordedInstant(legalCase);
  if (latest !== undefined && Date.parse(at) < Date.parse(latest)) {
    throw new LegalCaseEngineError(
      'chronology',
      "l'instant de l'opération est antérieur à un objet déjà enregistré dans le dossier " +
        '(ordre d’ajout et ordre chronologique doivent rester cohérents).',
    );
  }
}

/**
 * Instant le plus tardif porté par les objets append-only du modèle Fact (déjà validés comme
 * instants par `validateLegalCaseV3`). Sert au contrôle chronologique de D6.
 */
function latestRecordedInstant(legalCase: LegalCase): LegalInstant | undefined {
  const instants: LegalInstant[] = [
    ...legalCase.facts.map((item) => item.recordedAt),
    ...legalCase.documents.map((item) => item.addedAt),
    ...legalCase.evidence.map((item) => item.addedAt),
    ...legalCase.relations.map((item) => item.recordedAt),
    ...legalCase.factValidations.map((item) => item.timestamp),
    ...legalCase.conflicts.map((item) => item.recordedAt),
    ...legalCase.resolutionProposals.map((item) => item.recordedAt),
    ...legalCase.ruleExecutions.map((item) => item.recordedAt),
    ...legalCase.resolutions.map((item) => item.recordedAt),
  ];
  let latest: LegalInstant | undefined;
  for (const instant of instants) {
    if (latest === undefined || Date.parse(instant) > Date.parse(latest)) latest = instant;
  }
  return latest;
}
