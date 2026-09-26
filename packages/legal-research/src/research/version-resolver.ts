import type {
  IndeterminateVersionReason,
  NoApplicableVersionReason,
  SourceVersionRef,
  VersionHistory,
  VersionResolution,
  VersionResolver,
} from './temporal-types.js';

/**
 * Resolver temporel **pur** — « quelle version d'une source s'applique à
 * `asOf` ? » (ADR-0018, ADR-0014).
 *
 * Aucune I/O, aucune horloge (`Date.now` n'est jamais lu), aucune mutation de
 * l'entrée : le résultat ne dépend que de `history` et de `asOf`, jamais de
 * l'ordre des versions.
 *
 * ## Entrée
 * - `history.versions` : {@link SourceVersionRef}[] ; `history.completeness` :
 *   `complete | unknown`, **fournie par l'appelant**. Le resolver ne déduit
 *   **jamais** l'exhaustivité, et ne conclut donc jamais qu'un trou est réel
 *   sur un historique `unknown`.
 * - `asOf` : ISO 8601 — date seule (`2019-05-24`) ou date-heure **avec**
 *   décalage explicite (`Z`, `+02:00`, `+0200`). Une date-heure sans décalage
 *   est refusée (`RangeError`) : son interprétation dépendrait du fuseau de la
 *   machine.
 *
 * ## Granularité (technique, pas juridique)
 * Toutes les dates sont comparées comme des instants UTC. Une date seule vaut
 * minuit UTC. **Cette normalisation est purement technique : elle ne prétend
 * rien sur la sémantique juridique des dates de Légifrance** (fuseau réel et
 * inclusivité des bornes non établis).
 *
 * ## Intervalle d'une version
 * `[effectiveFrom, effectiveTo]` ; `effectiveTo` absent = intervalle **ouvert**.
 * La sentinelle Légifrance 2999-01-01 n'arrive pas ici (l'adaptateur la
 * convertit en absence) : une date `effectiveTo` fournie est une date normale.
 *
 * ## Convention de bords : conservatrice
 * L'inclusivité réelle des bornes n'a jamais été observée. Une date **exactement
 * égale** à un `effectiveFrom` ou à un `effectiveTo` (de n'importe quelle
 * version) donne `indeterminate / boundary_date`, jamais une affirmation.
 * « Couvre » signifie donc *strictement à l'intérieur* de l'intervalle.
 *
 * ## Résultats (ordre de décision)
 * 1. données inexploitables → `indeterminate` : `insufficient_version_data`
 *    (historique vide, id absent, doublons contradictoires, date de version
 *    absente ou illisible), puis `invalid_interval` (`effectiveTo` <=
 *    `effectiveFrom`). Un seul défaut, où qu'il soit dans l'historique, suffit :
 *    on ne résout pas sur un historique dont on ne peut pas se fier à l'ordre ;
 * 2. `asOf` sur une borne → `indeterminate / boundary_date` ;
 * 3. plusieurs versions couvrent `asOf` → `indeterminate / ambiguous_overlap` —
 *    jamais de choix selon l'état, le numéro de version ou l'ordre d'entrée ;
 * 4. exactement une → `resolved` ;
 * 5. aucune : `none_applicable` (`before_first_version`, `gap_between_versions`
 *    ou `after_last_version`) **uniquement si** `completeness === 'complete'` ;
 *    sinon `indeterminate / incomplete_history`.
 *
 * Limite : sur un historique `unknown`, `resolved` repose sur les seules
 * versions listées (une version absente de la liste ne peut pas être détectée).
 *
 * ## Champs ignorés
 * `state` (vocabulaire ouvert, aucune sémantique déduite), et — par
 * construction — `dateVersion`, `consultedAt`, `publicationDate`, qui ne font
 * pas partie de {@link SourceVersionRef}.
 *
 * ## Doublons
 * Un même `id` répété avec des données identiques (`version`, `state`, dates)
 * est dédupliqué ; des données contradictoires donnent `indeterminate /
 * insufficient_version_data`.
 */

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2}))?$/;

/**
 * Analyse stricte d'une date ISO 8601 en instant UTC (ms). `undefined` si la
 * valeur n'est pas exactement de la forme acceptée ou n'existe pas au
 * calendrier. N'utilise jamais `Date.parse` (dépendant de l'environnement pour
 * les formes sans décalage).
 */
function parseInstant(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_INSTANT.exec(value);
  if (match === null) return undefined;

  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h === undefined ? 0 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = s === undefined ? 0 : Number(s);
  const millisecond = fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, '0'));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return undefined;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  let offsetMs = 0;
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutes = Number(digits.slice(2, 4));
    if (offsetHours > 23 || offsetMinutes > 59) return undefined;
    offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  }
  return date.getTime() - offsetMs;
}

interface Interval {
  readonly ref: SourceVersionRef;
  readonly fromMs: number;
  /** `undefined` = intervalle ouvert. */
  readonly toMs: number | undefined;
}

function indeterminate(
  reason: IndeterminateVersionReason,
  ids: readonly string[] = [],
): VersionResolution {
  return ids.length > 0
    ? { status: 'indeterminate', reason, versionIds: [...ids].sort(compareStrings) }
    : { status: 'indeterminate', reason };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Signature normalisée : deux entrées de même `id` sont « les mêmes données » si leurs signatures sont égales. */
function signatureOf(ref: SourceVersionRef): string {
  const normalizeDate = (value: string | undefined): unknown => {
    if (value === undefined) return null;
    const instant = parseInstant(value);
    return instant !== undefined ? instant : `raw:${value}`;
  };
  return JSON.stringify([
    ref.version ?? null,
    ref.state ?? null,
    normalizeDate(ref.effectiveFrom),
    normalizeDate(ref.effectiveTo),
  ]);
}

/** Déduplique par `id`. Renvoie les entrées uniques (première occurrence) et les `id` en conflit. */
function dedupeById(versions: readonly SourceVersionRef[]): {
  unique: SourceVersionRef[];
  conflicting: string[];
} {
  const bySignature = new Map<string, { ref: SourceVersionRef; signature: string }>();
  const conflicting = new Set<string>();
  for (const ref of versions) {
    const signature = signatureOf(ref);
    const existing = bySignature.get(ref.id);
    if (existing === undefined) bySignature.set(ref.id, { ref, signature });
    else if (existing.signature !== signature) conflicting.add(ref.id);
  }
  return {
    unique: [...bySignature.values()].map((entry) => entry.ref),
    conflicting: [...conflicting],
  };
}

function classifyAbsence(sorted: readonly Interval[], asOfMs: number): NoApplicableVersionReason {
  if (asOfMs < sorted[0]!.fromMs) return 'before_first_version';
  return sorted.some((interval) => interval.fromMs > asOfMs)
    ? 'gap_between_versions'
    : 'after_last_version';
}

/**
 * Résout la version applicable à `asOf`. Fonction pure — voir l'en-tête du
 * module pour le contrat complet.
 *
 * @throws {RangeError} si `asOf` n'est pas un ISO 8601 interprétable, ou si
 *   `history` est mal formé (tableau `versions` absent, `completeness` inconnue).
 */
export function resolveVersion(history: VersionHistory, asOf: string): VersionResolution {
  const asOfMs = parseInstant(asOf);
  if (asOfMs === undefined) {
    throw new RangeError(
      `resolveVersion : « asOf » doit être une date ISO 8601 (date seule ou date-heure avec décalage explicite), reçu ${JSON.stringify(asOf)}.`,
    );
  }
  if (!Array.isArray(history?.versions)) {
    throw new RangeError('resolveVersion : « history.versions » doit être un tableau.');
  }
  if (history.completeness !== 'complete' && history.completeness !== 'unknown') {
    throw new RangeError(
      'resolveVersion : « history.completeness » doit valoir « complete » ou « unknown ».',
    );
  }

  if (history.versions.length === 0) return indeterminate('insufficient_version_data');

  const noId = history.versions.filter((ref) => typeof ref?.id !== 'string' || ref.id.length === 0);
  if (noId.length > 0) return indeterminate('insufficient_version_data');

  const { unique, conflicting } = dedupeById(history.versions);
  if (conflicting.length > 0) return indeterminate('insufficient_version_data', conflicting);

  // Dates de version : `effectiveFrom` obligatoire et lisible ; `effectiveTo` absent = ouvert, présent = lisible.
  const intervals: Interval[] = [];
  const unreadable: string[] = [];
  for (const ref of unique) {
    const fromMs = parseInstant(ref.effectiveFrom);
    const toMs = ref.effectiveTo === undefined ? undefined : parseInstant(ref.effectiveTo);
    if (fromMs === undefined || (ref.effectiveTo !== undefined && toMs === undefined))
      unreadable.push(ref.id);
    else intervals.push({ ref, fromMs, toMs });
  }
  if (unreadable.length > 0) return indeterminate('insufficient_version_data', unreadable);

  const invalid = intervals
    .filter((i) => i.toMs !== undefined && i.toMs <= i.fromMs)
    .map((i) => i.ref.id);
  if (invalid.length > 0) return indeterminate('invalid_interval', invalid);

  const sorted = [...intervals].sort(
    (a, b) => a.fromMs - b.fromMs || compareStrings(a.ref.id, b.ref.id),
  );

  const onBoundary = sorted.filter((i) => i.fromMs === asOfMs || i.toMs === asOfMs);
  if (onBoundary.length > 0)
    return indeterminate(
      'boundary_date',
      onBoundary.map((i) => i.ref.id),
    );

  const covering = sorted.filter(
    (i) => i.fromMs < asOfMs && (i.toMs === undefined || asOfMs < i.toMs),
  );
  if (covering.length > 1)
    return indeterminate(
      'ambiguous_overlap',
      covering.map((i) => i.ref.id),
    );
  if (covering.length === 1) return { status: 'resolved', version: covering[0]!.ref };

  if (history.completeness !== 'complete') return indeterminate('incomplete_history');
  return { status: 'none_applicable', reason: classifyAbsence(sorted, asOfMs) };
}

/** {@link resolveVersion} exposé sous la forme du contrat {@link VersionResolver}. */
export const versionResolver: VersionResolver = { resolve: resolveVersion };
