import {
  CURRENT_PROJECT_BRIEF_FILE_VERSION,
  type Decision,
  type DecisionStatus,
  type ProjectBrief,
  type Question,
  type QuestionStatus,
  type TextItem,
} from './project-brief.js';
import { ProjectBriefFileError, type ProjectBriefFileErrorReason } from './project-brief-errors.js';

const DECISION_STATUSES: readonly DecisionStatus[] = ['proposed', 'validated', 'obsolete'];
const QUESTION_STATUSES: readonly QuestionStatus[] = ['open', 'resolved'];

const BRIEF_KEYS: ReadonlySet<string> = new Set([
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
const TEXT_ITEM_KEYS: ReadonlySet<string> = new Set(['id', 'text']);
const DECISION_KEYS: ReadonlySet<string> = new Set(['id', 'text', 'status']);
const QUESTION_KEYS: ReadonlySet<string> = new Set(['id', 'text', 'status', 'answer']);

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

function parseDecision(value: unknown, filePath: string): Decision {
  if (!isPlainObject(value)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(value, DECISION_KEYS, filePath);
  const { status } = value;
  if (typeof status !== 'string' || !DECISION_STATUSES.includes(status as DecisionStatus)) {
    fail('invalid_structure', filePath);
  }
  return {
    id: requireNonEmptyString(value.id, filePath),
    text: requireNonEmptyString(value.text, filePath),
    status: status as DecisionStatus,
  };
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

/**
 * Valide et convertit le contenu **déjà `JSON.parse`'d** d'un fichier de
 * fiche projet. Fonction **pure**, sans I/O.
 *
 * @throws {ProjectBriefFileError}
 *   - `unknown_version` si `formatVersion` ≠ {@link CURRENT_PROJECT_BRIEF_FILE_VERSION} ;
 *   - `invalid_structure` si une clé est inconnue ou un champ mal formé ;
 *   - `duplicate_id` si deux éléments d'une même catégorie partagent un id.
 */
export function parseProjectBriefFile(parsed: unknown, filePath: string): ProjectBrief {
  if (!isPlainObject(parsed)) {
    fail('invalid_structure', filePath);
  }
  requireKnownKeys(parsed, BRIEF_KEYS, filePath);
  if (parsed.formatVersion !== CURRENT_PROJECT_BRIEF_FILE_VERSION) {
    fail('unknown_version', filePath);
  }
  if (
    typeof parsed.revision !== 'number' ||
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 1
  ) {
    fail('invalid_structure', filePath);
  }

  const facts = parseArray(parsed.facts, filePath, parseTextItem);
  const hypotheses = parseArray(parsed.hypotheses, filePath, parseTextItem);
  const decisions = parseArray(parsed.decisions, filePath, parseDecision);
  const questions = parseArray(parsed.questions, filePath, parseQuestion);
  requireDuplicateFree(facts, filePath);
  requireDuplicateFree(hypotheses, filePath);
  requireDuplicateFree(decisions, filePath);
  requireDuplicateFree(questions, filePath);

  return {
    id: requireNonEmptyString(parsed.id, filePath),
    name: requireNonEmptyString(parsed.name, filePath),
    formatVersion: CURRENT_PROJECT_BRIEF_FILE_VERSION,
    revision: parsed.revision,
    facts,
    hypotheses,
    decisions,
    questions,
    createdAt: requireNonEmptyString(parsed.createdAt, filePath),
    updatedAt: requireNonEmptyString(parsed.updatedAt, filePath),
  };
}

/** Champ par champ — jamais `{ ...brief }` — pour qu'un champ superflu ajouté par erreur en mémoire ne fuite jamais sur disque. */
export function serializeProjectBriefFile(brief: ProjectBrief): string {
  const payload: ProjectBrief = {
    id: brief.id,
    name: brief.name,
    formatVersion: CURRENT_PROJECT_BRIEF_FILE_VERSION,
    revision: brief.revision,
    facts: brief.facts.map((f) => ({ id: f.id, text: f.text })),
    hypotheses: brief.hypotheses.map((h) => ({ id: h.id, text: h.text })),
    decisions: brief.decisions.map((d) => ({ id: d.id, text: d.text, status: d.status })),
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
