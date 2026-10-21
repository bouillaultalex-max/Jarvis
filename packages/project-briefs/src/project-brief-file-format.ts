import {
  CURRENT_PROJECT_BRIEF_FILE_VERSION,
  LEGACY_PROJECT_BRIEF_FILE_VERSION,
  MAX_LINKS_PER_ITEM,
  type Decision,
  type DecisionStatus,
  type ItemRef,
  type ProjectBrief,
  type ProjectBriefFileVersion,
  type Question,
  type QuestionStatus,
  type SourcedItem,
  type TextItem,
} from './project-brief.js';
import { ProjectBriefFileError, type ProjectBriefFileErrorReason } from './project-brief-errors.js';

const DECISION_STATUSES: readonly DecisionStatus[] = ['proposed', 'validated', 'obsolete'];
const QUESTION_STATUSES: readonly QuestionStatus[] = ['open', 'resolved'];
const ITEM_REF_KINDS: readonly ItemRef['kind'][] = ['fact', 'hypothesis'];

const V1_BRIEF_KEYS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'formatVersion',
  'revision',
  'facts',
  'hypotheses',
  'decisions',
  'questions',
  'createdAt',
  'updatedAt',
]);
const V2_BRIEF_KEYS: ReadonlySet<string> = new Set([...V1_BRIEF_KEYS, 'sources']);
const TEXT_ITEM_KEYS: ReadonlySet<string> = new Set(['id', 'text']);
const V2_SOURCED_ITEM_KEYS: ReadonlySet<string> = new Set(['id', 'text', 'sourceIds']);
const V1_DECISION_KEYS: ReadonlySet<string> = new Set(['id', 'text', 'status']);
const V2_DECISION_KEYS: ReadonlySet<string> = new Set([
  'id',
  'text',
  'status',
  'basis',
  'validatedAt',
]);
const QUESTION_KEYS: ReadonlySet<string> = new Set(['id', 'text', 'status', 'answer']);
const ITEM_REF_KEYS: ReadonlySet<string> = new Set(['kind', 'id']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(reason: ProjectBriefFileErrorReason, filePath: string): never {
  throw new ProjectBriefFileError(reason, filePath);
}

function requireNonEmptyString(value: unknown, filePath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_structure', filePath);
  }
  return value;
}

function requireKnownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  filePath: string,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      fail('invalid_structure', filePath);
    }
  }
}

function requireDuplicateFree(items: readonly TextItem[], filePath: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      fail('duplicate_id', filePath);
    }
    seen.add(item.id);
  }
}

/** Liste de liens présente : jamais vide sur disque (absence = champ omis), bornée, sans doublon. */
function requireLinkList(value: unknown, filePath: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINKS_PER_ITEM) {
    fail('invalid_structure', filePath);
  }
  return value;
}

function parseTextItem(value: unknown, filePath: string): TextItem {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(value, TEXT_ITEM_KEYS, filePath);
  return {
    id: requireNonEmptyString(value.id, filePath),
    text: requireNonEmptyString(value.text, filePath),
  };
}

function parseSourcedItem(value: unknown, filePath: string): SourcedItem {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(value, V2_SOURCED_ITEM_KEYS, filePath);
  const item = {
    id: requireNonEmptyString(value.id, filePath),
    text: requireNonEmptyString(value.text, filePath),
  };
  if (value.sourceIds === undefined) {
    return item;
  }
  const sourceIds = requireLinkList(value.sourceIds, filePath).map((raw) =>
    requireNonEmptyString(raw, filePath),
  );
  if (new Set(sourceIds).size !== sourceIds.length) {
    fail('duplicate_reference', filePath);
  }
  return { ...item, sourceIds };
}

function parseItemRef(value: unknown, filePath: string): ItemRef {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(value, ITEM_REF_KEYS, filePath);
  const { kind } = value;
  if (typeof kind !== 'string' || !ITEM_REF_KINDS.includes(kind as ItemRef['kind'])) {
    fail('invalid_structure', filePath);
  }
  return { kind: kind as ItemRef['kind'], id: requireNonEmptyString(value.id, filePath) };
}

/** Analyse stricte d'une date ISO 8601 : exactement la forme de toISOString(), et date réelle. */
function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function parseDecision(
  value: unknown,
  filePath: string,
  version: ProjectBriefFileVersion,
): Decision {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(
    value,
    version === LEGACY_PROJECT_BRIEF_FILE_VERSION ? V1_DECISION_KEYS : V2_DECISION_KEYS,
    filePath,
  );
  const { status } = value;
  if (typeof status !== 'string' || !DECISION_STATUSES.includes(status as DecisionStatus)) {
    fail('invalid_structure', filePath);
  }
  const decision: Decision = {
    id: requireNonEmptyString(value.id, filePath),
    text: requireNonEmptyString(value.text, filePath),
    status: status as DecisionStatus,
  };
  let result: Decision = decision;
  if (value.validatedAt !== undefined) {
    const validatedAt = requireNonEmptyString(value.validatedAt, filePath);
    if (!isStrictIsoDate(validatedAt)) {
      fail('invalid_structure', filePath);
    }
    result = { ...result, validatedAt };
  }
  if (value.basis === undefined) {
    return result;
  }
  const basis = requireLinkList(value.basis, filePath).map((raw) => parseItemRef(raw, filePath));
  if (new Set(basis.map(itemRefKey)).size !== basis.length) {
    fail('duplicate_reference', filePath);
  }
  return { ...result, basis };
}

function parseQuestion(value: unknown, filePath: string): Question {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(value, QUESTION_KEYS, filePath);
  const { status, answer } = value;
  if (typeof status !== 'string' || !QUESTION_STATUSES.includes(status as QuestionStatus)) {
    fail('invalid_structure', filePath);
  }
  if (answer !== undefined && typeof answer !== 'string') {
    fail('invalid_structure', filePath);
  }
  return {
    id: requireNonEmptyString(value.id, filePath),
    text: requireNonEmptyString(value.text, filePath),
    status: status as QuestionStatus,
    ...(answer !== undefined ? { answer } : {}),
  };
}

function parseArray<T>(
  value: unknown,
  filePath: string,
  parseOne: (raw: unknown, filePath: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) {
    fail('invalid_structure', filePath);
  }
  return value.map((raw) => parseOne(raw, filePath));
}

function itemRefKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Toute référence pointe vers un élément existant de la bonne catégorie. */
function requireResolvedReferences(brief: ProjectBrief, filePath: string): void {
  const sourceIds = new Set(brief.sources.map((s) => s.id));
  for (const item of [...brief.facts, ...brief.hypotheses]) {
    if (item.sourceIds?.some((id) => !sourceIds.has(id))) {
      fail('dangling_reference', filePath);
    }
  }
  const factIds = new Set(brief.facts.map((f) => f.id));
  const hypothesisIds = new Set(brief.hypotheses.map((h) => h.id));
  for (const decision of brief.decisions) {
    const dangling = decision.basis?.some((ref) =>
      ref.kind === 'fact' ? !factIds.has(ref.id) : !hypothesisIds.has(ref.id),
    );
    if (dangling) {
      fail('dangling_reference', filePath);
    }
  }
}

/** Vrai si la fiche utilise une notion v2 (source, lien ou justification). */
export function usesV2Features(brief: ProjectBrief): boolean {
  return (
    brief.sources.length > 0 ||
    [...brief.facts, ...brief.hypotheses].some((i) => i.sourceIds !== undefined) ||
    brief.decisions.some((d) => d.basis !== undefined || d.validatedAt !== undefined)
  );
}

/**
 * Valide et convertit le contenu **déjà `JSON.parse`'d** d'un fichier de
 * fiche projet. Fonction **pure**, sans I/O.
 *
 * Accepte v1 (format historique, strict : aucune clé v2 tolérée) et v2
 * (`sources`, `sourceIds`, `basis`). Un fichier v1 est restitué avec
 * `sources` vide et `formatVersion: 1` — jamais réécrit par la lecture.
 *
 * @throws {ProjectBriefFileError}
 *   - `unknown_version` si `formatVersion` n'est ni 1 ni 2 ;
 *   - `invalid_structure` si une clé est inconnue (dont une clé v2 dans un
 *     fichier v1) ou un champ mal formé ;
 *   - `duplicate_id` si deux éléments d'une même catégorie partagent un id ;
 *   - `duplicate_reference` si une liste de liens répète une référence ;
 *   - `dangling_reference` si un lien pointe vers un élément absent.
 */
export function parseProjectBriefFile(parsed: unknown, filePath: string): ProjectBrief {
  if (!isPlainObject(parsed)) {
    fail('invalid_structure', filePath);
  }
  const version = parsed.formatVersion;
  if (
    version !== LEGACY_PROJECT_BRIEF_FILE_VERSION &&
    version !== CURRENT_PROJECT_BRIEF_FILE_VERSION
  ) {
    fail('unknown_version', filePath);
  }
  const isLegacy = version === LEGACY_PROJECT_BRIEF_FILE_VERSION;
  requireKnownKeys(parsed, isLegacy ? V1_BRIEF_KEYS : V2_BRIEF_KEYS, filePath);
  if (
    typeof parsed.revision !== 'number' ||
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 1
  ) {
    fail('invalid_structure', filePath);
  }

  const parseItem = isLegacy ? parseTextItem : parseSourcedItem;
  const sources = isLegacy ? [] : parseArray(parsed.sources, filePath, parseTextItem);
  const facts = parseArray(parsed.facts, filePath, parseItem);
  const hypotheses = parseArray(parsed.hypotheses, filePath, parseItem);
  const decisions = parseArray(parsed.decisions, filePath, (raw, path) =>
    parseDecision(raw, path, version),
  );
  const questions = parseArray(parsed.questions, filePath, parseQuestion);
  requireDuplicateFree(sources, filePath);
  requireDuplicateFree(facts, filePath);
  requireDuplicateFree(hypotheses, filePath);
  requireDuplicateFree(decisions, filePath);
  requireDuplicateFree(questions, filePath);

  const brief: ProjectBrief = {
    id: requireNonEmptyString(parsed.id, filePath),
    name: requireNonEmptyString(parsed.name, filePath),
    formatVersion: version,
    revision: parsed.revision,
    sources,
    facts,
    hypotheses,
    decisions,
    questions,
    createdAt: requireNonEmptyString(parsed.createdAt, filePath),
    updatedAt: requireNonEmptyString(parsed.updatedAt, filePath),
  };
  requireResolvedReferences(brief, filePath);
  return brief;
}

function serializeSourcedItem(item: SourcedItem): SourcedItem {
  return {
    id: item.id,
    text: item.text,
    ...(item.sourceIds !== undefined ? { sourceIds: [...item.sourceIds] } : {}),
  };
}

/**
 * Champ par champ — jamais `{ ...brief }` — pour qu'un champ superflu ajouté
 * par erreur en mémoire ne fuite jamais sur disque. Écrit dans la version
 * portée par la fiche : un v1 reste v1 (sans aucune clé v2), un v2 reste v2.
 *
 * @throws {Error} si une fiche v1 porte une notion v2 — erreur de
 *   programmation (le store passe toujours en v2 avant), jamais un
 *   abaissement silencieux qui perdrait des liens.
 */
export function serializeProjectBriefFile(brief: ProjectBrief): string {
  const isLegacy = brief.formatVersion === LEGACY_PROJECT_BRIEF_FILE_VERSION;
  if (isLegacy && usesV2Features(brief)) {
    throw new Error('serializeProjectBriefFile : fiche v1 portant des sources ou des liens (v2).');
  }
  const payload = {
    id: brief.id,
    name: brief.name,
    formatVersion: brief.formatVersion,
    revision: brief.revision,
    ...(isLegacy ? {} : { sources: brief.sources.map((s) => ({ id: s.id, text: s.text })) }),
    facts: brief.facts.map(serializeSourcedItem),
    hypotheses: brief.hypotheses.map(serializeSourcedItem),
    decisions: brief.decisions.map((d) => ({
      id: d.id,
      text: d.text,
      status: d.status,
      ...(d.basis !== undefined ? { basis: d.basis.map((r) => ({ kind: r.kind, id: r.id })) } : {}),
      ...(d.validatedAt !== undefined ? { validatedAt: d.validatedAt } : {}),
    })),
    questions: brief.questions.map((q) => ({
      id: q.id,
      text: q.text,
      status: q.status,
      ...(q.answer !== undefined ? { answer: q.answer } : {}),
    })),
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
  };
  return JSON.stringify(payload, null, 2);
}
