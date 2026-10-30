import { DETECTION_MAX_OCCURRENCES_PER_TYPE } from './legal-data.js';

// Repérage déterministe d'éléments (Legal Core) — module pur : uniquement
// des expressions régulières sur le texte déjà extrait, déjà en mémoire.
// Aucun DOM, aucun réseau, aucun modèle, aucune invention de structure.
//
// Parties / personnes / organisations : volontairement absentes — aucune
// règle suffisamment précise n'est établie. Mieux ne rien proposer que
// d'inventer une identification.
//
// Chaque valeur est conservée telle qu'extraite (aucune conversion de
// date, aucune résolution d'ambiguïté jour/mois, aucune reformulation).

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const MONTHS =
  'janvier|février|fevrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre';

// `\s` en JavaScript couvre déjà l'espace insécable (U+00A0) et l'espace
// fine insécable (U+202F) — toutes deux de catégorie Unicode Zs — donc
// aucune classe de caractères personnalisée n'est nécessaire ici.
const PATTERNS = {
  date: new RegExp(
    `\\b\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b`,
    'gi',
  ),
  // `(?!\w)` plutôt que `\b` final : « € » n'est pas un caractère de mot
  // (un `\b` juste après lui échouerait presque toujours), et la
  // lookahead négative évite aussi de ne capturer que le début d'un mot
  // plus long (« 50 EUR » dans « 50 EUROPE » ne doit pas matcher).
  amount: /\b\d{1,3}(?:\s\d{3})*(?:,\d{1,2})?\s?(?:€|EUR|euros?|francs?)(?!\w)/gi,
  article: /\b(?:article|art\.)\s+(?:L\.?\s?)?\d+(?:[-‑]\d+)*\b/gi,
};

export const DETECTION_TYPES = ['date', 'amount', 'article'];

export const TYPE_LABELS = {
  date: 'Dates',
  amount: 'Montants',
  article: "Références d'articles",
};

function findOccurrences(text, pattern) {
  const results = [];
  for (const match of text.matchAll(pattern)) {
    results.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return results;
}

/**
 * Repère dates/montants/références d'articles dans les pages déjà
 * extraites (forme `{ page, text, error? }`, telle que produite par
 * `pdf-extraction.js`). Déduplique les doublons techniques (même type,
 * même page, même position exacte) ; conserve toute occurrence distincte,
 * y compris une valeur identique répétée sur une autre page ou ailleurs
 * sur la même page.
 */
export function detectElements(pages) {
  const byType = { date: [], amount: [], article: [] };
  const truncated = { date: false, amount: false, article: false };
  const seen = new Set();

  for (const p of pages) {
    if (p.error || !p.text) continue; // page en erreur : rien à repérer dessus
    for (const type of DETECTION_TYPES) {
      for (const occ of findOccurrences(p.text, PATTERNS[type])) {
        const key = `${type}:${p.page}:${occ.start}:${occ.end}`;
        if (seen.has(key)) continue; // doublon technique exact — jamais une occurrence distincte
        seen.add(key);
        if (byType[type].length >= DETECTION_MAX_OCCURRENCES_PER_TYPE) {
          truncated[type] = true;
          continue;
        }
        byType[type].push({ page: p.page, value: occ.value });
      }
    }
  }

  return { byType, truncated };
}

/** Un bouton « Repérer les éléments » n'a de sens que si du texte réel a été extrait. */
export function hasDetectableText(extractionEntry) {
  return Boolean(
    extractionEntry &&
    ['complete', 'limit-reached', 'partial-error'].includes(extractionEntry.status) &&
    extractionEntry.pages?.some((p) => p.text && p.text.length > 0),
  );
}

function renderDetectionResult(doc, detectionEntry) {
  const { byType, truncated, extractionTruncated, extractionHadPageErrors } = detectionEntry;
  const totalCount = DETECTION_TYPES.reduce((n, type) => n + byType[type].length, 0);

  const limitNote =
    extractionTruncated || extractionHadPageErrors
      ? `<p class="doc-detection-warning">Basé sur une extraction incomplète (limite de pages/caractères atteinte ou pages en erreur) — le repérage ne couvre pas nécessairement le document entier.</p>`
      : '';

  const disclaimer = `<p class="doc-detection-disclaimer">Repérage automatique par règles. Ces éléments ne sont ni vérifiés ni interprétés juridiquement.</p>`;

  if (totalCount === 0) {
    return `
      <div class="doc-detection-result">
        ${limitNote}
        <p class="muted">Aucun élément repéré automatiquement.</p>
        ${disclaimer}
      </div>`;
  }

  const groupsHtml = DETECTION_TYPES.filter((type) => byType[type].length > 0)
    .map((type) => {
      const occurrences = byType[type];
      const typeTruncatedNote = truncated[type]
        ? `<p class="doc-detection-warning">Limite de ${DETECTION_MAX_OCCURRENCES_PER_TYPE} occurrences atteinte pour « ${escapeHtml(TYPE_LABELS[type])} » — résultat tronqué.</p>`
        : '';
      const articleNote =
        type === 'article'
          ? `<p class="muted">Mentions trouvées dans le document — pas des textes consultés ni vérifiés en vigueur.</p>`
          : '';
      const itemsHtml = occurrences
        .map(
          (occ, i) => `
          <li class="doc-detection-item">
            <span class="doc-detection-page">Page ${occ.page}</span>
            <span class="doc-detection-value" data-detection-value="${doc.id}:${type}:${i}"></span>
          </li>`,
        )
        .join('');

      return `
        <details class="doc-detection-group">
          <summary>${escapeHtml(TYPE_LABELS[type])} (${occurrences.length})</summary>
          ${articleNote}
          ${typeTruncatedNote}
          <ul class="doc-detection-list">${itemsHtml}</ul>
        </details>`;
    })
    .join('');

  return `
    <div class="doc-detection-result">
      ${limitNote}
      ${groupsHtml}
      ${disclaimer}
    </div>`;
}

/** Bloc complet (bouton + résultat éventuel) pour un document, sous forme de HTML. */
export function renderDetectionBlock(doc, extractionEntry, detectionEntry) {
  if (!hasDetectableText(extractionEntry)) return '';
  const buttonHtml = `<button class="btn btn-ghost btn-small" type="button" data-detect="${doc.id}">Repérer les éléments</button>`;
  return `<div class="doc-detection">${buttonHtml}${detectionEntry ? renderDetectionResult(doc, detectionEntry) : ''}</div>`;
}
