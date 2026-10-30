import { DEMO_CATEGORIES, DEMO_MESSAGES, DEMO_SOURCES, buildDemoMissionSteps } from './data.js';
import {
  LEGAL_CAPABILITIES,
  LEGAL_DEMO_RESULTS,
  LEGAL_DEMO_CASE,
  LEGAL_PROVENANCE_LABELS,
  VERSION_STATUS_LABELS,
  LEGAL_DOCUMENT_ACCEPTED_FORMATS,
  LEGAL_DOCUMENT_MAX_FILES,
  LEGAL_DOCUMENT_MAX_SIZE_BYTES,
  LEGAL_DOCUMENT_NEXT_STEPS,
} from './legal-data.js';
import {
  renderExtractionBlock,
  startExtraction,
  cancelExtraction,
  isExtractionActive,
} from './pdf-extraction.js';
import { detectElements, hasDetectableText, renderDetectionBlock } from './pdf-detection.js';

// Centre de commandement Jarvis — prototype statique, 100% local.
// Aucun appel réseau n'est fait par ce script : tout ce qui est « démo »
// vient de data.js et reste en mémoire du navigateur (jamais persisté).

const state = {
  route: 'home',
  inbox: {
    status: 'empty', // empty | loading | ready | error
    messages: [],
    selectedId: null,
    activeFilter: null,
  },
  corrections: {}, // { [messageId]: category } — correction locale, non apprise
  mission: {
    hasRun: false,
    steps: [],
    error: null,
  },
  legal: {
    status: 'empty', // empty | invalid | loading | error | ready
    query: '',
    documents: [], // { id, name, extension, size, file } — `file` est une
    // référence File non lue : son contenu n'est lu qu'au clic sur
    // « Extraire le texte », jamais à la sélection.
    rejections: [],
    extraction: {}, // { [docId]: { status, pages, ... } } — résultats d'extraction, en mémoire uniquement
    detection: {}, // { [docId]: { byType, truncated, ... } } — repérage déterministe, invalidé au retrait/ré-extraction/remise à zéro
  },
};

let documentCounter = 0;

const CAPABILITIES = [
  {
    title: "Discuter avec l'agent (API /chat)",
    status: 'non-raccorde',
    description:
      "Le serveur @jarvis/api expose déjà /chat (AgentLoop + outil factice). Cette interface web ne l'appelle pas encore.",
  },
  {
    title: 'Inbox Intelligence — démonstration',
    status: 'fonctionnel',
    description:
      "Parcours Inbox en mode démonstration : messages fictifs, catégories fixées à l'avance, interactions réelles (sélection, filtres, correction locale).",
  },
  {
    title: 'Inbox Intelligence — analyse réelle',
    status: 'prevu',
    description:
      "Le pipeline existe dans packages/inbox et apps/desktop (CLI), mais aucun endpoint HTTP ne le relie à ce navigateur pour l'instant.",
  },
  {
    title: 'Historique des exécutions',
    status: 'prevu',
    description: 'Explicitement hors périmètre de cette tranche, selon la roadmap active.',
  },
];

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------- Navigation ----------

function setRoute(route) {
  state.route = route;
  qsa('.view').forEach((section) => {
    section.hidden = section.dataset.view !== route;
  });
  qsa('.nav-link').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.route === route);
  });
  if (route === 'mission') {
    renderMission();
  }
}

function initNav() {
  qsa('.nav-link').forEach((link) => {
    link.addEventListener('click', () => setRoute(link.dataset.route));
  });
}

// ---------- Accueil ----------

function renderCapabilities() {
  const grid = qs('#capability-grid');
  const labels = {
    fonctionnel: 'Fonctionnel',
    'non-raccorde': 'Présent, non raccordé',
    prevu: 'Prévu',
  };

  grid.innerHTML = CAPABILITIES.map(
    (cap) => `
      <article class="capability-card">
        <span class="status-pill" data-status="${cap.status}">${labels[cap.status]}</span>
        <h3>${escapeHtml(cap.title)}</h3>
        <p>${escapeHtml(cap.description)}</p>
      </article>
    `,
  ).join('');
}

// ---------- Inbox ----------

function initInbox() {
  qs('#launch-demo').addEventListener('click', launchDemo);
  qs('#simulate-error').addEventListener('click', simulateInboxError);
}

function launchDemo() {
  state.inbox.status = 'loading';
  state.inbox.selectedId = null;
  renderInbox();

  // Délai volontaire pour rendre l'état de chargement observable — aucune
  // opération réseau réelle n'a lieu ici.
  window.setTimeout(() => {
    state.inbox.messages = DEMO_MESSAGES.map((m) => ({ ...m }));
    state.inbox.status = 'ready';
    state.corrections = {};
    state.mission.hasRun = true;
    state.mission.error = null;
    state.mission.steps = buildDemoMissionSteps();
    renderInbox();
    if (state.route === 'mission') {
      renderMission();
    }
  }, 550);
}

function simulateInboxError() {
  state.inbox.status = 'error';
  state.inbox.messages = [];
  state.inbox.selectedId = null;
  state.mission.hasRun = true;
  state.mission.error = "Erreur simulée à la demande — aucune panne réelle ne s'est produite.";
  state.mission.steps = [
    {
      id: 'fetch',
      title: 'Récupération simulée des messages',
      status: 'error',
      result: 'Échec provoqué volontairement pour vérifier le traitement des erreurs.',
    },
  ];
  renderInbox();
  if (state.route === 'mission') {
    renderMission();
  }
}

function effectiveCategory(message) {
  return state.corrections[message.id] ?? message.category;
}

function visibleMessages() {
  const { messages, activeFilter } = state.inbox;
  if (!activeFilter) return messages;
  return messages.filter((m) => effectiveCategory(m) === activeFilter);
}

function renderInbox() {
  const layout = qs('#inbox-layout');
  const { status } = state.inbox;

  if (status === 'empty') {
    layout.innerHTML = `
      <div class="inbox-empty">
        <p>Aucun message chargé.</p>
        <p class="muted">Cliquez sur « Lancer la démonstration » pour afficher un petit lot de messages fictifs.</p>
      </div>`;
    return;
  }

  if (status === 'loading') {
    layout.innerHTML = `
      <div class="inbox-loading">
        <p>Chargement de la démonstration…</p>
        <p class="muted">Simulation locale, aucun appel réseau.</p>
      </div>`;
    return;
  }

  if (status === 'error') {
    layout.innerHTML = `
      <div class="inbox-error">
        <p>La démonstration n'a pas pu charger de messages.</p>
        <p class="muted">${escapeHtml(state.mission.error ?? '')} Consultez l'onglet Mission pour le détail.</p>
      </div>`;
    return;
  }

  layout.innerHTML = `
    <div class="inbox-list-pane">
      <div class="inbox-filters" id="inbox-filters"></div>
      <ul class="message-list" id="message-list"></ul>
    </div>
    <div class="message-detail" id="message-detail"></div>
  `;

  renderFilters();
  renderMessageList();
  renderDetail();
}

function renderFilters() {
  const container = qs('#inbox-filters');
  const chips = ['Toutes', ...DEMO_CATEGORIES];
  container.innerHTML = chips
    .map((label) => {
      const value = label === 'Toutes' ? '' : label;
      const isActive = (state.inbox.activeFilter ?? '') === value;
      return `<button class="filter-chip${isActive ? ' is-active' : ''}" data-filter="${escapeHtml(value)}" type="button">${escapeHtml(label)}</button>`;
    })
    .join('');

  qsa('.filter-chip', container).forEach((chip) => {
    chip.addEventListener('click', () => {
      state.inbox.activeFilter = chip.dataset.filter || null;
      renderFilters();
      renderMessageList();
    });
  });
}

function renderMessageList() {
  const list = qs('#message-list');
  const messages = visibleMessages();

  if (messages.length === 0) {
    list.innerHTML = `<li class="inbox-empty" style="border:none;">Aucun message pour ce filtre.</li>`;
    return;
  }

  list.innerHTML = messages
    .map((m) => {
      const isSelected = m.id === state.inbox.selectedId;
      return `
        <li class="message-item${isSelected ? ' is-selected' : ''}" data-id="${m.id}" tabindex="0" role="button">
          <div class="msg-top">
            <span>${escapeHtml(m.from)}</span>
            <span class="category-tag">${escapeHtml(effectiveCategory(m))}</span>
          </div>
          <span class="msg-subject">${escapeHtml(m.subject)}</span>
          <span class="msg-preview">${escapeHtml(m.preview)}</span>
        </li>`;
    })
    .join('');

  qsa('.message-item', list).forEach((item) => {
    const open = () => {
      state.inbox.selectedId = item.dataset.id;
      renderMessageList();
      renderDetail();
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderDetail() {
  const pane = qs('#message-detail');
  const message = state.inbox.messages.find((m) => m.id === state.inbox.selectedId);

  if (!message) {
    pane.innerHTML = `<p class="detail-placeholder">Sélectionnez un message dans la liste.</p>`;
    return;
  }

  const correction = state.corrections[message.id];

  pane.innerHTML = `
    <button class="btn btn-ghost btn-small detail-close" id="detail-close" type="button">Fermer</button>
    <div class="detail-header">
      <div>
        <h2 class="detail-subject">${escapeHtml(message.subject)}</h2>
        <div class="detail-meta">${escapeHtml(message.from)} · ${escapeHtml(message.fromEmail)} · ${formatDate(message.date)}</div>
      </div>
    </div>
    <div class="detail-body">${escapeHtml(message.body)}</div>
    <div class="category-picker">
      <span class="category-picker-label">Catégorie proposée (démonstration) — correction locale uniquement, non apprise :</span>
      <div class="category-options" id="category-options"></div>
      ${correction ? `<p class="correction-note">Corrigé localement en « ${escapeHtml(correction)} ». Cette correction reste dans cette page, elle ne modifie aucun modèle.</p>` : ''}
    </div>
  `;

  qs('#detail-close').addEventListener('click', () => {
    state.inbox.selectedId = null;
    renderMessageList();
    renderDetail();
  });

  const optionsContainer = qs('#category-options');
  optionsContainer.innerHTML = DEMO_CATEGORIES.map((cat) => {
    const isActive = effectiveCategory(message) === cat;
    return `<button class="filter-chip${isActive ? ' is-active' : ''}" data-category="${escapeHtml(cat)}" type="button">${escapeHtml(cat)}</button>`;
  }).join('');

  qsa('.filter-chip', optionsContainer).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.corrections[message.id] = btn.dataset.category;
      renderMessageList();
      renderDetail();
    });
  });
}

// ---------- Mission ----------

function renderMission() {
  const panel = qs('#mission-panel');

  if (!state.mission.hasRun) {
    panel.innerHTML = `
      <div class="mission-empty">
        Aucune démonstration lancée pour l'instant. Rendez-vous dans l'onglet Inbox pour en
        démarrer une.
      </div>`;
    return;
  }

  const stepsHtml = state.mission.steps
    .map((step) => {
      const icon = step.status === 'ok' ? '✓' : step.status === 'error' ? '!' : '…';
      return `
        <li class="mission-step" data-status="${step.status}">
          <span class="step-icon">${icon}</span>
          <div>
            <div class="step-title">${escapeHtml(step.title)}</div>
            <div class="step-result">${escapeHtml(step.result)}</div>
          </div>
        </li>`;
    })
    .join('');

  const sourcesHtml =
    state.inbox.status === 'error'
      ? ''
      : `
        <div class="mission-section-title">Sources disponibles</div>
        <ul class="source-list">
          ${DEMO_SOURCES.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>`;

  const errorsHtml = state.mission.error
    ? `
        <div class="mission-section-title">Erreurs</div>
        <ul class="error-list"><li>${escapeHtml(state.mission.error)}</li></ul>`
    : `
        <div class="mission-section-title">Erreurs</div>
        <p class="muted">Aucune erreur sur cette exécution.</p>`;

  panel.innerHTML = `
    <div class="mission-meta-row">
      <div class="mission-meta-item">
        <span class="label">Type de mission</span>
        Démonstration Inbox (locale)
      </div>
      <div class="mission-meta-item">
        <span class="label">Statut</span>
        ${state.mission.error ? 'Terminée avec erreur' : 'Terminée'}
      </div>
    </div>
    <div class="mission-section-title">Étapes</div>
    <ul class="mission-steps">${stepsHtml}</ul>
    ${sourcesHtml}
    ${errorsHtml}
  `;
}

// ---------- Legal Core ----------

function renderLegalCapabilities() {
  const grid = qs('#legal-capability-grid');
  const labels = {
    fonctionnel: 'Fonctionnel',
    'non-raccorde': 'Présent, non raccordé',
    prevu: 'Prévu',
  };

  grid.innerHTML = LEGAL_CAPABILITIES.map(
    (cap) => `
      <article class="capability-card">
        <span class="status-pill" data-status="${cap.status}">${labels[cap.status]}</span>
        <h3>${escapeHtml(cap.title)}</h3>
        <p>${escapeHtml(cap.description)}</p>
      </article>
    `,
  ).join('');
}

function initLegalSearch() {
  qs('#legal-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = qs('#legal-query').value.trim();

    if (query.length === 0) {
      state.legal.status = 'invalid';
      renderLegalResults();
      return;
    }

    state.legal.query = query;
    state.legal.status = 'loading';
    renderLegalResults();

    window.setTimeout(() => {
      state.legal.status = 'ready';
      renderLegalResults();
    }, 550);
  });

  qs('#legal-simulate-error').addEventListener('click', () => {
    state.legal.status = 'error';
    renderLegalResults();
  });
}

function renderLegalResults() {
  const container = qs('#legal-results');
  const { status, query } = state.legal;

  if (status === 'empty') {
    container.innerHTML = `
      <div class="legal-state-box">
        <p>Aucune recherche lancée.</p>
        <p class="muted">Saisissez une requête et une date de référence, puis lancez la démonstration.</p>
      </div>`;
    return;
  }

  if (status === 'invalid') {
    container.innerHTML = `
      <div class="legal-state-box" data-tone="invalid">
        <p>La requête est vide.</p>
        <p class="muted">Saisissez au moins quelques mots avant de lancer la démonstration.</p>
      </div>`;
    return;
  }

  if (status === 'loading') {
    container.innerHTML = `
      <div class="legal-state-box">
        <p>Chargement de la démonstration…</p>
        <p class="muted">Simulation locale, aucune requête envoyée à Légifrance.</p>
      </div>`;
    return;
  }

  if (status === 'error') {
    container.innerHTML = `
      <div class="legal-state-box" data-tone="error">
        <p>La démonstration n'a pas pu produire de résultats.</p>
        <p class="muted">Erreur simulée à la demande — aucune panne réelle ne s'est produite.</p>
      </div>`;
    return;
  }

  const hasPartial = LEGAL_DEMO_RESULTS.some((r) => r.partial);

  container.innerHTML = `
    <p class="muted" style="margin: 0 0 var(--space-sm);">
      Résultats fictifs pour « ${escapeHtml(query)} »${hasPartial ? ' — un résultat est partiel.' : ''}
    </p>
    <ul class="legal-results-list">
      ${LEGAL_DEMO_RESULTS.map(
        (r) => `
        <li>
          <details class="legal-result-item" data-partial="${r.partial ? 'true' : 'false'}">
            <summary>
              <span class="legal-result-reference">${escapeHtml(r.reference)}</span>
              <span class="legal-result-title">${escapeHtml(r.title)}</span>
              <span class="version-tag" data-status="${r.versionStatus}">${escapeHtml(VERSION_STATUS_LABELS[r.versionStatus])}</span>
            </summary>
            <div class="legal-result-detail">
              <div class="detail-row">
                <span class="detail-label">Résolution temporelle</span>
                ${escapeHtml(r.versionNote)}
              </div>
              <div class="detail-row">
                <span class="detail-label">Source</span>
                ${escapeHtml(r.source)}
              </div>
              <div class="detail-row">
                <span class="detail-label">Limites</span>
                ${escapeHtml(r.limits)}
              </div>
            </div>
          </details>
        </li>`,
      ).join('')}
    </ul>
  `;
}

function formatTemporal(temporal) {
  if (temporal.kind === 'unknown') return 'Date inconnue dans cette démonstration';
  if (temporal.kind === 'point') return `${temporal.value} (précision : ${temporal.precision})`;
  return `du ${temporal.start} au ${temporal.end}`;
}

function renderLegalCase() {
  const container = qs('#legal-case-demo');
  const demoCase = LEGAL_DEMO_CASE;

  container.innerHTML = `
    <div class="legal-case-card">
      <div class="legal-case-header">
        <div>
          <h3 class="legal-case-title">${escapeHtml(demoCase.title)}</h3>
          <span class="muted">Démonstration — structure illustrative, aucun dossier réel chargé.</span>
        </div>
        <span class="workflow-tag">Étape : ${escapeHtml(demoCase.status)}</span>
      </div>

      <div class="legal-case-section-title">Questions ouvertes</div>
      <ul class="legal-question-list">
        ${demoCase.openQuestions
          .map(
            (q) => `
          <li class="legal-question-item">
            <span>${escapeHtml(q.question)}</span>
            <span class="question-status">${q.status === 'open' ? 'Ouverte' : 'Répondue'}</span>
          </li>`,
          )
          .join('')}
      </ul>

      <div class="legal-case-section-title">Faits</div>
      <ul class="legal-fact-list">
        ${demoCase.facts
          .map(
            (f) => `
          <li>
            <details class="legal-fact-item">
              <summary>${escapeHtml(f.summary)}</summary>
              <div class="legal-fact-detail">
                <span class="tag-pair">Provenance : ${escapeHtml(LEGAL_PROVENANCE_LABELS[f.provenanceOrigin] ?? f.provenanceOrigin)}</span>
                <span class="tag-pair">Temporalité : ${escapeHtml(formatTemporal(f.temporal))}</span>
              </div>
            </details>
          </li>`,
          )
          .join('')}
      </ul>
    </div>
  `;
}

// ---------- Legal Core — Ajouter des documents ----------
//
// Sélection locale : seules les métadonnées du navigateur (nom, taille,
// extension) sont lues via l'API File à la sélection. Le contenu d'un PDF
// n'est lu qu'au clic explicite sur « Extraire le texte » (voir plus bas),
// jamais transmis ni stocké — tout reste en mémoire de cette page.

function fileExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function handleIncomingFiles(fileList) {
  const rejections = [];

  for (const file of Array.from(fileList)) {
    const extension = fileExtension(file.name);

    if (!LEGAL_DOCUMENT_ACCEPTED_FORMATS.includes(extension)) {
      rejections.push({
        name: file.name,
        reason: `format « .${extension || '?'} » non pris en charge (PDF, DOCX, TXT uniquement).`,
      });
      continue;
    }

    if (file.size > LEGAL_DOCUMENT_MAX_SIZE_BYTES) {
      rejections.push({
        name: file.name,
        reason: `dépasse la taille maximale autorisée (${formatBytes(LEGAL_DOCUMENT_MAX_SIZE_BYTES)}).`,
      });
      continue;
    }

    if (state.legal.documents.length >= LEGAL_DOCUMENT_MAX_FILES) {
      rejections.push({
        name: file.name,
        reason: `limite de ${LEGAL_DOCUMENT_MAX_FILES} fichiers déjà atteinte.`,
      });
      continue;
    }

    documentCounter += 1;
    state.legal.documents.push({
      id: `doc-${documentCounter}`,
      name: file.name,
      extension,
      size: file.size,
      file, // référence seulement — lue uniquement au clic « Extraire le texte »
    });
  }

  state.legal.rejections = rejections;
  renderDocumentList();
  renderRejections();
}

function initDocumentUpload() {
  const input = qs('#legal-file-input');
  const dropzone = qs('#legal-dropzone');

  qs('#legal-dropzone-limits').textContent =
    `PDF, DOCX, TXT — ${LEGAL_DOCUMENT_MAX_FILES} fichiers maximum, ${formatBytes(LEGAL_DOCUMENT_MAX_SIZE_BYTES)} par fichier.`;

  input.addEventListener('change', () => {
    handleIncomingFiles(input.files);
    // Réinitialisé pour permettre de re-sélectionner un fichier déjà retiré.
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove('is-dragover');
    });
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (event.dataTransfer?.files) {
      handleIncomingFiles(event.dataTransfer.files);
    }
  });

  qs('#legal-clear-documents').addEventListener('click', () => {
    const runningId = state.legal.documents.find((d) => isExtractionActive(d.id))?.id;
    if (runningId) {
      cancelExtraction(runningId, state.legal.extraction, renderDocumentList);
    }
    state.legal.documents = [];
    state.legal.rejections = [];
    state.legal.extraction = {};
    state.legal.detection = {};
    renderDocumentList();
    renderRejections();
  });
}

function renderRejections() {
  const container = qs('#legal-rejections');
  const rejections = state.legal.rejections;

  if (!rejections || rejections.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <ul class="rejection-list">
      ${rejections
        .map(
          (r) =>
            `<li class="rejection-item">Refusé — ${escapeHtml(r.name)} : ${escapeHtml(r.reason)}</li>`,
        )
        .join('')}
    </ul>`;
}

function renderDocumentList() {
  const list = qs('#legal-document-list');
  const clearButton = qs('#legal-clear-documents');
  const docs = state.legal.documents;

  clearButton.disabled = docs.length === 0;

  if (docs.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = `
    <ul class="document-list">
      ${docs
        .map(
          (d) => `
        <li class="document-item" data-id="${d.id}">
          <div class="document-item-row">
            <div class="doc-info">
              <span class="category-tag">${escapeHtml(d.extension.toUpperCase())}</span>
              <span class="doc-name">${escapeHtml(d.name)}</span>
              <span class="doc-meta">${formatBytes(d.size)}</span>
            </div>
            <button class="doc-remove" type="button" data-remove="${d.id}" aria-label="Retirer ${escapeHtml(d.name)}">
              <svg aria-hidden="true"><use href="#icon-close" /></svg>
            </button>
          </div>
          ${renderExtractionBlock(d, state.legal.extraction)}
          ${renderDetectionBlock(d, state.legal.extraction[d.id], state.legal.detection[d.id])}
        </li>`,
        )
        .join('')}
    </ul>`;

  qsa('[data-remove]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.remove;
      if (isExtractionActive(id)) {
        cancelExtraction(id, state.legal.extraction, renderDocumentList);
      }
      state.legal.documents = state.legal.documents.filter((d) => d.id !== id);
      delete state.legal.extraction[id];
      delete state.legal.detection[id];
      renderDocumentList();
    });
  });

  qsa('[data-extract]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      // Une nouvelle extraction invalide tout repérage fondé sur l'ancienne.
      delete state.legal.detection[btn.dataset.extract];
      startExtraction(
        btn.dataset.extract,
        state.legal.documents,
        state.legal.extraction,
        renderDocumentList,
      );
    });
  });

  qsa('[data-detect]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      const docId = btn.dataset.detect;
      const entry = state.legal.extraction[docId];
      if (!hasDetectableText(entry)) return;
      state.legal.detection[docId] = {
        ...detectElements(entry.pages),
        extractionTruncated: Boolean(entry.pageTruncated || entry.charTruncated),
        extractionHadPageErrors: Boolean(entry.hadPageErrors),
      };
      renderDocumentList();
    });
  });

  qsa('[data-cancel-extract]', list).forEach((btn) => {
    btn.addEventListener('click', () =>
      cancelExtraction(btn.dataset.cancelExtract, state.legal.extraction, renderDocumentList),
    );
  });

  // Affectation en textContent (jamais en HTML) du texte réellement extrait
  // d'un PDF — contenu non fiable, jamais interprété comme balisage.
  qsa('[data-page-text]', list).forEach((node) => {
    const [docId, pageKey] = node.dataset.pageText.split(':');
    const entry = state.legal.extraction[docId];
    const page = entry?.pages.find((p) => String(p.page) === pageKey);
    node.textContent = page?.error ?? page?.text ?? '';
  });

  // Affectation en textContent (jamais en HTML) des valeurs repérées
  // automatiquement — même discipline que le texte extrait.
  qsa('[data-detection-value]', list).forEach((node) => {
    const [docId, type, indexStr] = node.dataset.detectionValue.split(':');
    const entry = state.legal.detection[docId];
    const occ = entry?.byType?.[type]?.[Number(indexStr)];
    node.textContent = occ?.value ?? '';
  });

  // Copie du texte extrait — uniquement sur clic, jamais automatique.
  // Copie exactement le texte brut extrait, jamais une version reformulée.
  qsa('[data-copy-page]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      const [docId, pageKey] = btn.dataset.copyPage.split(':');
      const entry = state.legal.extraction[docId];
      const page = entry?.pages.find((p) => String(p.page) === pageKey);
      const statusEl = qs(`[data-copy-status="${docId}:${pageKey}"]`, list);
      const reportStatus = (message) => {
        if (!statusEl) return;
        statusEl.textContent = message;
        window.setTimeout(() => {
          statusEl.textContent = '';
        }, 2500);
      };

      if (!navigator.clipboard?.writeText) {
        reportStatus('Copie indisponible dans ce navigateur.');
        return;
      }
      navigator.clipboard
        .writeText(page?.text ?? '')
        .then(() => reportStatus('Copié.'))
        .catch(() => reportStatus('Échec de la copie.'));
    });
  });
}

function renderLegalNextSteps() {
  const list = qs('#legal-next-steps');
  list.innerHTML = LEGAL_DOCUMENT_NEXT_STEPS.map(
    (s) => `
      <li class="legal-step-item" data-status="${s.status}">
        <span class="legal-step-number">${s.step}</span>
        <div>
          <div class="legal-step-title">${escapeHtml(s.title)}</div>
          <div class="legal-step-desc">${escapeHtml(s.description)}</div>
        </div>
      </li>`,
  ).join('');
}

// ---------- Boot ----------

function boot() {
  initNav();
  renderCapabilities();
  initInbox();
  renderInbox();
  renderMission();
  renderLegalCapabilities();
  initLegalSearch();
  renderLegalResults();
  renderLegalCase();
  initDocumentUpload();
  renderDocumentList();
  renderRejections();
  renderLegalNextSteps();
  setRoute('home');
}

boot();
