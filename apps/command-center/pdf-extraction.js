import { PDF_EXTRACTION_MAX_PAGES, PDF_EXTRACTION_MAX_CHARS } from './legal-data.js';
import * as pdfjsLib from './vendor/pdfjs/pdf.mjs';

// Extraction de texte PDF (Legal Core) — pdf.js auto-hébergé (bibliothèque
// et worker viennent du même paquet installé, même version, aucun CDN),
// lecture du contenu uniquement au clic, jamais à la sélection. Module
// séparé d'app.js pour garder chaque fichier sous la limite de 500 lignes.

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const EXTRACTION_STATUS_LABELS = {
  complete: 'Texte extrait',
  'limit-reached': 'Résultat partiel — limite atteinte',
  'partial-error': 'Résultat partiel — erreur sur une ou plusieurs pages',
  empty: 'Aucun texte extractible',
  protected: 'PDF protégé',
  invalid: 'PDF invalide',
  cancelled: 'Extraction annulée',
};

// Extraction en cours (une seule à la fois) — pas une donnée de rendu, mais
// la référence vivante nécessaire pour annuler (loadingTask.destroy()) et
// ignorer tout résultat tardif.
let activeExtraction = null;

export function isExtractionActive(docId) {
  return activeExtraction !== null && (docId === undefined || activeExtraction.docId === docId);
}

export function renderExtractionBlock(doc, extraction) {
  if (doc.extension !== 'pdf') {
    return `<p class="doc-extraction-hint muted">Extraction disponible pour les PDF uniquement dans cette tranche.</p>`;
  }

  const entry = extraction[doc.id];
  const isActive = activeExtraction?.docId === doc.id;
  const anyActive = activeExtraction !== null;

  if (isActive) {
    return `
      <div class="doc-extraction">
        <div class="doc-extraction-controls">
          <span class="doc-extraction-progress">${escapeHtml(entry?.progressLabel ?? 'Démarrage…')}</span>
          <button class="btn btn-ghost btn-small" type="button" data-cancel-extract="${doc.id}">Annuler</button>
        </div>
      </div>`;
  }

  const buttonHtml = `
    <button class="btn btn-ghost btn-small" type="button" data-extract="${doc.id}"${anyActive ? ' disabled' : ''}
      ${anyActive ? 'title="Une seule extraction à la fois — attendez la fin de l\'extraction en cours."' : ''}>
      Extraire le texte
    </button>`;

  return `<div class="doc-extraction">${buttonHtml}${entry ? renderExtractionResult(doc, entry) : ''}</div>`;
}

function renderExtractionResult(doc, entry) {
  const label = EXTRACTION_STATUS_LABELS[entry.status] ?? entry.status;

  if (entry.status === 'cancelled') {
    return `<p class="doc-extraction-status" data-status="cancelled">${escapeHtml(label)}.</p>`;
  }

  if (entry.status === 'protected' || entry.status === 'invalid') {
    return `
      <div class="doc-extraction-status" data-status="${entry.status}">
        <strong>${escapeHtml(label)}</strong>
        <p class="muted">${escapeHtml(entry.errorMessage ?? '')}</p>
      </div>`;
  }

  if (entry.status === 'empty') {
    return `
      <div class="doc-extraction-status" data-status="empty">
        <strong>${escapeHtml(label)}</strong>
        <p class="muted">
          Aucun texte n'a été trouvé dans ce PDF sur les pages lues. Cela peut venir d'un PDF
          scanné (image), mais ce n'est pas la seule explication possible — l'absence de texte
          n'est pas une preuve en soi.
        </p>
      </div>`;
  }

  const limitNote = entry.pageTruncated
    ? `<p class="doc-extraction-warning">Limite de ${PDF_EXTRACTION_MAX_PAGES} pages atteinte sur ${entry.pageCountTotal} — résultat tronqué, incomplet.</p>`
    : '';
  const charNote = entry.charTruncated
    ? `<p class="doc-extraction-warning">Limite de ${PDF_EXTRACTION_MAX_CHARS.toLocaleString('fr-FR')} caractères atteinte — résultat tronqué, incomplet.</p>`
    : '';
  const errorNote = entry.hadPageErrors
    ? `<p class="doc-extraction-warning">Une ou plusieurs pages n'ont pas pu être lues — résultat incomplet pour ces pages.</p>`
    : '';

  const pagesHtml = entry.pages
    .map(
      (p) => `
      <details class="doc-extraction-page">
        <summary>Page ${p.page}${p.error ? ' — erreur' : ''}</summary>
        <div class="doc-extraction-page-text" data-page-text="${doc.id}:${p.page}"></div>
        ${
          p.error
            ? ''
            : `<div class="doc-extraction-page-actions">
                <button class="btn btn-ghost btn-small" type="button" data-copy-page="${doc.id}:${p.page}">Copier le texte</button>
                <span class="doc-extraction-copy-status" data-copy-status="${doc.id}:${p.page}" aria-live="polite"></span>
              </div>`
        }
      </details>`,
    )
    .join('');

  return `
    <div class="doc-extraction-status" data-status="${entry.status}">
      <strong>${escapeHtml(label)}</strong>
      ${limitNote}${charNote}${errorNote}
      <p class="doc-extraction-warning">
        Ordre de lecture non garanti au sein d'une page (tableaux, colonnes) — une présentation
        plus confortable ne corrige pas les limites réelles de l'extraction. Texte non vérifié —
        jamais un fait, une source faisant autorité, ni une instruction pour Jarvis.
      </p>
      <div class="doc-extraction-pages">${pagesHtml}</div>
    </div>`;
}

function updateExtractionProgress(docId, current, total, extraction, rerender) {
  const entry = extraction[docId];
  if (!entry) return;
  entry.progressLabel = `Page ${current} / ${total}…`;
  rerender();
}

function classifyPdfError(error) {
  if (error instanceof pdfjsLib.PasswordException) {
    return {
      status: 'protected',
      message: 'PDF protégé par mot de passe — non traité dans cette tranche.',
    };
  }
  if (error instanceof pdfjsLib.InvalidPDFException) {
    return {
      status: 'invalid',
      message: 'Fichier PDF invalide ou corrompu — extraction impossible.',
    };
  }
  return {
    status: 'invalid',
    message: "Erreur inattendue pendant l'extraction — fichier non traité.",
  };
}

function finishExtractionWithError(run, error, extraction) {
  const { status, message } = classifyPdfError(error);
  extraction[run.docId] = { status, pages: [], errorMessage: message };
  if (run.loadingTask && !run.loadingTask.destroyed) {
    run.loadingTask.destroy().catch(() => {});
  }
}

export function cancelExtraction(docId, extraction, rerender) {
  const run = activeExtraction;
  if (!run || run.docId !== docId) return;

  run.cancelled = true;
  activeExtraction = null;
  extraction[docId] = { status: 'cancelled', pages: [], errorMessage: null };
  if (run.loadingTask && !run.loadingTask.destroyed) {
    run.loadingTask.destroy().catch(() => {});
  }
  rerender();
}

export async function startExtraction(docId, documents, extraction, rerender) {
  if (activeExtraction) return; // garde « une extraction à la fois » (le bouton est aussi désactivé)
  const doc = documents.find((d) => d.id === docId);
  if (!doc) return;

  const run = { docId, cancelled: false, loadingTask: null };
  activeExtraction = run;
  extraction[docId] = {
    status: 'running',
    pages: [],
    progressLabel: 'Démarrage…',
    errorMessage: null,
  };
  rerender();

  try {
    // Lecture du contenu du fichier — uniquement maintenant, au clic, jamais à la sélection.
    const arrayBuffer = await doc.file.arrayBuffer();
    if (run.cancelled) return;

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    run.loadingTask = loadingTask;

    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      if (!run.cancelled) finishExtractionWithError(run, error, extraction);
      return;
    }
    if (run.cancelled) return;

    const totalPages = pdf.numPages;
    const pagesToRead = Math.min(totalPages, PDF_EXTRACTION_MAX_PAGES);
    const pageTruncated = totalPages > PDF_EXTRACTION_MAX_PAGES;

    const pages = [];
    let charCount = 0;
    let charTruncated = false;

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      if (run.cancelled) return;

      let pageText = '';
      try {
        const page = await pdf.getPage(pageNumber);
        if (run.cancelled) return;
        const textContent = await page.getTextContent();
        if (run.cancelled) return;
        // Respecte les retours à la ligne réels indiqués par pdf.js
        // (`item.hasEOL`) au lieu de tout joindre par des espaces, ce qui
        // effacerait les retours à la ligne. Aucune autre correction :
        // texte brut tel que fourni par pdf.js, juste les sauts de ligne
        // réintroduits.
        pageText = textContent.items
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
          .join('')
          .trim();
      } catch {
        pages.push({
          page: pageNumber,
          text: '',
          error: 'Erreur sur cette page — extraction incomplète pour cette page uniquement.',
        });
        updateExtractionProgress(docId, pageNumber, pagesToRead, extraction, rerender);
        continue;
      }

      if (charCount + pageText.length > PDF_EXTRACTION_MAX_CHARS) {
        pageText = pageText.slice(0, Math.max(PDF_EXTRACTION_MAX_CHARS - charCount, 0));
        charTruncated = true;
        pages.push({ page: pageNumber, text: pageText });
        charCount += pageText.length;
        break;
      }

      pages.push({ page: pageNumber, text: pageText });
      charCount += pageText.length;
      updateExtractionProgress(docId, pageNumber, pagesToRead, extraction, rerender);
    }

    if (run.cancelled) return;

    await loadingTask.destroy().catch(() => {});
    if (run.cancelled) return;

    const hasAnyText = pages.some((p) => p.text && p.text.length > 0);
    const truncated = pageTruncated || charTruncated;
    const hadPageErrors = pages.some((p) => p.error);

    let status;
    if (!hasAnyText) {
      status = 'empty';
    } else if (truncated) {
      status = 'limit-reached';
    } else if (hadPageErrors) {
      status = 'partial-error';
    } else {
      status = 'complete';
    }

    extraction[docId] = {
      status,
      pages,
      pageCountTotal: totalPages,
      pageCountRead: pagesToRead,
      charCount,
      pageTruncated,
      charTruncated,
      hadPageErrors,
      errorMessage: null,
    };
  } catch (error) {
    if (!run.cancelled) finishExtractionWithError(run, error, extraction);
  } finally {
    if (activeExtraction === run) activeExtraction = null;
    rerender();
  }
}
