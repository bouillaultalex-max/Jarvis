import { daysInMonth, isValidCalendarDay, isValidYear } from './legal-calendar.js';
import { validateClosedObject } from './legal-primitives.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Temporalité d'un `LegalFact` — LegalCase v3 (décisions Q4 / B3).
 *
 * ```
 * LegalFactTemporal = point | interval | unknown
 * précision         = day | month | year        (par borne pour un intervalle)
 * ```
 *
 * ## Ce que représente une valeur
 * Une **position calendaire** à une précision donnée : `2025-03` désigne « quelque
 * part en mars 2025 », **pas** le 1er mars. La précision est une information
 * sémantique et n'est **jamais** convertie : `2025` ≠ `2025-01-01`, `2025-03` ≠
 * `2025-03-01`. Aucun fuseau, aucune heure : un jour calendaire n'est pas un
 * instant (voir `LegalInstant`), et n'est jamais un `asOf` (`SearchQuery.asOf`,
 * `VersionResolver`) ni une borne `effectiveFrom`/`effectiveTo`.
 *
 * ## Intervalles
 * Toujours **fermés** : `start` et `end` sont obligatoires (aucun `end` nul, aucun
 * intervalle ouvert en v3). Chaque borne a sa propre précision. Règle `start <= end`,
 * la seule qui n'affirme aucune date : l'intervalle est valide s'il **existe** une
 * position de départ dans son unité au plus égale à une position de fin dans la
 * sienne. Pour ce test seulement, on compare le premier jour possible de l'unité de
 * début au dernier jour possible de l'unité de fin ; ces jours ne sont jamais
 * stockés ni exposés. L'égalité est admise (`start == end`) : c'est une plage
 * d'une unité, distincte d'un point.
 *
 * ## Inconnu
 * `temporal` est **obligatoire** ; « inconnu » s'écrit `{ kind: 'unknown' }` et rien
 * d'autre. Son absence est invalide (aucun défaut).
 */
export type LegalTemporalPrecision = 'day' | 'month' | 'year';

/** Ensemble des précisions connues — exposé pour la validation et les tests. */
export const LEGAL_TEMPORAL_PRECISIONS: readonly LegalTemporalPrecision[] = [
  'day',
  'month',
  'year',
];

/** Une position calendaire : `value` a la forme imposée par `precision`. */
export interface LegalTemporalBound {
  readonly precision: LegalTemporalPrecision;
  /** `YYYY-MM-DD` (day), `YYYY-MM` (month) ou `YYYY` (year). */
  readonly value: string;
}

export interface LegalTemporalPoint {
  readonly kind: 'point';
  readonly precision: LegalTemporalPrecision;
  readonly value: string;
}

export interface LegalTemporalInterval {
  readonly kind: 'interval';
  readonly start: LegalTemporalBound;
  readonly end: LegalTemporalBound;
}

export interface LegalTemporalUnknown {
  readonly kind: 'unknown';
}

export type LegalFactTemporal = LegalTemporalPoint | LegalTemporalInterval | LegalTemporalUnknown;

/** Alias : `LegalFact.temporal`. */
export type LegalTemporal = LegalFactTemporal;

const YEAR_PATTERN = /^(\d{4})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarPosition {
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
}

/** Analyse **stricte** d'une valeur pour sa précision ; jamais `Date.parse`. `undefined` si invalide. */
function parsePosition(precision: unknown, value: unknown): CalendarPosition | undefined {
  if (typeof value !== 'string') return undefined;
  if (precision === 'year') {
    const match = YEAR_PATTERN.exec(value);
    if (match === null) return undefined;
    const year = Number(match[1]);
    return isValidYear(year) ? { year } : undefined;
  }
  if (precision === 'month') {
    const match = MONTH_PATTERN.exec(value);
    if (match === null) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return isValidYear(year) && month >= 1 && month <= 12 ? { year, month } : undefined;
  }
  if (precision === 'day') {
    const match = DAY_PATTERN.exec(value);
    if (match === null) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidCalendarDay(year, month, day) ? { year, month, day } : undefined;
  }
  return undefined;
}

type DayTuple = readonly [number, number, number];

/** Premier jour **possible** de l'unité — borne de comparaison uniquement, jamais exposée. */
function earliestPossible(position: CalendarPosition): DayTuple {
  return [position.year, position.month ?? 1, position.day ?? 1];
}

/** Dernier jour **possible** de l'unité — borne de comparaison uniquement, jamais exposée. */
function latestPossible(position: CalendarPosition): DayTuple {
  const month = position.month ?? 12;
  return [position.year, month, position.day ?? daysInMonth(position.year, month)];
}

function isAfter(a: DayTuple, b: DayTuple): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

const BOUND_KEYS: ReadonlySet<string> = new Set(['precision', 'value']);
const POINT_KEYS: ReadonlySet<string> = new Set(['kind', 'precision', 'value']);
const INTERVAL_KEYS: ReadonlySet<string> = new Set(['kind', 'start', 'end']);
const UNKNOWN_KEYS: ReadonlySet<string> = new Set(['kind']);

function validatePrecisionAndValue(
  precision: unknown,
  value: unknown,
  path: string,
): CalendarPosition | LegalCaseValidation {
  if (!LEGAL_TEMPORAL_PRECISIONS.includes(precision as LegalTemporalPrecision)) {
    return invalid(`${path}.precision : « day », « month » ou « year » attendu.`);
  }
  const position = parsePosition(precision, value);
  if (position === undefined) {
    return invalid(
      `${path}.value : valeur invalide pour la précision « ${String(precision)} » ` +
        '(YYYY-MM-DD, YYYY-MM ou YYYY, jour calendaire existant, aucune heure ni fuseau).',
    );
  }
  return position;
}

function isFailure(value: CalendarPosition | LegalCaseValidation): value is LegalCaseValidation & {
  readonly ok: false;
} {
  return 'ok' in value && value.ok === false;
}

/** Valide une borne d'intervalle `{ precision, value }`. */
export function validateLegalTemporalBound(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, BOUND_KEYS, path);
  if (!closed.ok) return closed;
  const { precision, value: raw } = value as Record<string, unknown>;
  const parsed = validatePrecisionAndValue(precision, raw, path);
  return isFailure(parsed) ? parsed : OK;
}

/**
 * Valide un `LegalFactTemporal` non fiable. Clés fermées ; absent = invalide ;
 * `Date.parse` jamais utilisé ; ne lève jamais.
 */
export function validateLegalFactTemporal(value: unknown, path: string): LegalCaseValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} : objet attendu (point, interval ou unknown — jamais absent).`);
  }
  const kind = (value as Record<string, unknown>).kind;

  if (kind === 'unknown') return validateClosedObject(value, UNKNOWN_KEYS, path);

  if (kind === 'point') {
    const closed = validateClosedObject(value, POINT_KEYS, path);
    if (!closed.ok) return closed;
    const { precision, value: raw } = value as Record<string, unknown>;
    const parsed = validatePrecisionAndValue(precision, raw, path);
    return isFailure(parsed) ? parsed : OK;
  }

  if (kind === 'interval') {
    const closed = validateClosedObject(value, INTERVAL_KEYS, path);
    if (!closed.ok) return closed;
    const { start, end } = value as Record<string, unknown>;
    const startResult = validateLegalTemporalBound(start, `${path}.start`);
    if (!startResult.ok) return startResult;
    const endResult = validateLegalTemporalBound(end, `${path}.end`);
    if (!endResult.ok) return endResult;

    const startBound = start as LegalTemporalBound;
    const endBound = end as LegalTemporalBound;
    const startPosition = parsePosition(startBound.precision, startBound.value)!;
    const endPosition = parsePosition(endBound.precision, endBound.value)!;
    if (isAfter(earliestPossible(startPosition), latestPossible(endPosition))) {
      return invalid(`${path} : intervalle impossible (le début ne peut pas précéder la fin).`);
    }
    return OK;
  }

  return invalid(`${path}.kind : « point », « interval » ou « unknown » attendu.`);
}
