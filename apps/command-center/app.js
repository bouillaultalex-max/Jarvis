import {
  MAX_BATCH_SIZE,
  describeMailboxOption,
  parseBatchSize,
  toMailboxList,
  toRunView,
} from './inbox-run.js';
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

// Centre de commandement Jarvis — prototype 100% local.
// Seuls appels réseau de ce script : les deux routes Inbox de l'API Jarvis de
// ce poste, via le relais de serve.mjs. Rien n'est persisté : un lot ne vit
// que dans la mémoire de cette page.

const state = {
  route: 'home',
  inbox: {
    status: 'empty', // empty | invalid | loading | ready | error
    mailboxes: [], // boîtes renvoyées par l'API — jamais une liste locale
    mailboxError: null,
    run: null, // dernière exécution renvoyée par l'API (vue de inbox-run.js)
    failure: null, // échec sans exécution (API arrêtée, entrée refusée…)
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
    title: 'Inbox Intelligence — boîte fictive',
    status: 'fonctionnel',
    description:
      "Lot manuel de 10 messages au plus, lu dans une boîte fictive puis classé par le vrai pipeline Inbox via l'API Jarvis locale. Les messages sont synthétiques ; le classement est calculé.",
  },
  {
    title: 'Inbox Intelligence — classification et résumé par LLM',
    status: 'non-raccorde',
    description:
      "Le classifieur et le résumeur existent dans le code, mais aucun LLM n'est branché sur ce parcours : sans règle connue, chaque message reste « incertain ».",
  },
  {
    title: 'Inbox Intelligence — boîte Gmail réelle',
    status: 'prevu',
    description:
      "Aucune boîte réelle n'est proposée. Demande une autorisation d'accès en lecture seule, non accordée à ce stade.",
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

// `status: 0` = l'appel n'a pas abouti ; un corps non JSON donne `payload: null`.
async function callInboxApi(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    return { status: 0, payload: null };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Corps non JSON : traité plus loin comme une réponse inattendue.
  }
  return { status: response.status, payload };
}

function initInbox() {
  qs('#inbox-batch').max = String(MAX_BATCH_SIZE);
  qs('#launch-run').addEventListener('click', launchRun);
  qs('#reload-mailboxes').addEventListener('click', loadMailboxes);
  loadMailboxes();
}

async function loadMailboxes() {
  state.inbox.mailboxes = [];
  state.inbox.mailboxError = null;
  renderMailboxPicker('Chargement des boîtes…');

  const { status, payload } = await callInboxApi('/api/inbox/mailboxes');
  const view = toMailboxList(status, payload);
  if (view.kind === 'failure') {
    state.inbox.mailboxError = view.message;
  } else {
    state.inbox.mailboxes = view.mailboxes;
  }
  renderMailboxPicker();
  renderInbox();
}

function renderMailboxPicker(placeholder = 'Aucune boîte disponible') {
  const { mailboxes, mailboxError } = state.inbox;
  const select = qs('#inbox-mailbox');
  select.innerHTML =
    mailboxes.length === 0
      ? `<option value="">${escapeHtml(placeholder)}</option>`
      : mailboxes
          .map(
            (m) =>
              `<option value="${escapeHtml(m.id)}">${escapeHtml(describeMailboxOption(m))}</option>`,
          )
          .join('');
  select.disabled = mailboxes.length === 0;
  qs('#launch-run').disabled = mailboxes.length === 0;
  qs('#reload-mailboxes').hidden = mailboxError === null;
}

async function launchRun() {
  // Un seul lot à la fois. Le bouton reste actif pendant le lot : le
  // désactiver ferait perdre le focus à qui navigue au clavier.
  if (state.inbox.status === 'loading') return;

  const size = parseBatchSize(qs('#inbox-batch').value);
  // Le résultat précédent est effacé avant toute tentative : un lot refusé
  // ou en échec ne laisse jamais l'ancien à l'écran.
  state.inbox.run = null;
  state.inbox.failure = null;
  if (size === null) {
    state.inbox.status = 'invalid';
    state.inbox.failure = `Taille de lot invalide : entier attendu entre 1 et ${MAX_BATCH_SIZE}.`;
    renderInbox();
    renderMission();
    return;
  }

  state.inbox.status = 'loading';
  renderInbox();
  renderMission();

  // Le navigateur n'envoie que l'identifiant de boîte et la taille du lot.
  const { status, payload } = await callInboxApi('/api/inbox/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailboxId: qs('#inbox-mailbox').value, maxResults: size }),
  });
  const view = toRunView(status, payload);
  if (view.kind === 'failure') {
    state.inbox.failure = view.message;
    state.inbox.status = 'error';
  } else {
    state.inbox.run = view;
    state.inbox.status = view.failed ? 'error' : 'ready';
  }

  renderInbox();
  renderMission();
}

function renderRunItem(item) {
  return `
    <li class="message-item run-item">
      <div class="msg-top">
        <span>${escapeHtml(item.sender)}</span>
        <span class="category-tag">${escapeHtml(formatDate(item.receivedAt))}</span>
      </div>
      <span class="msg-subject">${escapeHtml(item.subject)}</span>
      <span class="run-label" data-label="${escapeHtml(item.label)}">${escapeHtml(item.labelText)}</span>
      <span class="msg-preview">Raison : ${escapeHtml(item.reason)}</span>
      <span class="msg-preview">Provenance : ${escapeHtml(item.sourceText)}</span>
      ${item.summary ? `<span class="msg-preview">Résumé : ${escapeHtml(item.summary)}</span>` : ''}
    </li>`;
}

function renderInbox() {
  const layout = qs('#inbox-layout');
  const { status, run, failure, mailboxError } = state.inbox;

  if (mailboxError !== null) {
    layout.innerHTML = `
      <div class="inbox-error" role="alert">
        <p>Impossible de charger les boîtes : ${escapeHtml(mailboxError)}</p>
        <p class="muted">Aucun lot ne peut être lancé tant que l'API Jarvis locale ne répond pas.</p>
      </div>`;
    return;
  }

  if (status === 'empty') {
    layout.innerHTML = `
      <div class="inbox-empty">
        <p>Aucun lot lancé.</p>
        <p class="muted">Choisissez une boîte et une taille de lot, puis cliquez sur « Lancer le lot ».</p>
      </div>`;
    return;
  }

  if (status === 'invalid') {
    layout.innerHTML = `
      <div class="inbox-error" role="alert">
        <p>Taille de lot invalide : saisissez un entier entre 1 et ${MAX_BATCH_SIZE}.</p>
        <p class="muted">Aucun lot n'a été lancé.</p>
      </div>`;
    return;
  }

  if (status === 'loading') {
    layout.innerHTML = `
      <div class="inbox-loading" role="status">
        <p>Lot en cours…</p>
        <p class="muted">Lecture puis classification par l'API Jarvis locale.</p>
      </div>`;
    return;
  }

  if (status === 'error') {
    layout.innerHTML = `
      <div class="inbox-error" role="alert">
        <p>Le lot n'a produit aucun résultat.</p>
        <p>${escapeHtml(run ? run.error : failure)}</p>
        ${
          run
            ? `<p class="muted">Exécution <span class="run-id">${escapeHtml(run.runId)}</span> — le détail des étapes est dans l'onglet Mission.</p>`
            : `<p class="muted">Aucune exécution n'a été créée.</p>`
        }
      </div>`;
    return;
  }

  layout.innerHTML = `
    <div class="inbox-run">
      <p class="muted">
        ${escapeHtml(run.mailboxLabel)} — ${run.items.length} message(s) —
        exécution <span class="run-id">${escapeHtml(run.runId)}</span>
      </p>
      ${
        run.items.length === 0
          ? `<div class="inbox-empty"><p>La boîte n'a renvoyé aucun message.</p></div>`
          : `<ul class="message-list">${run.items.map(renderRunItem).join('')}</ul>`
      }
    </div>`;
}

// ---------- Mission ----------

const STEP_DISPLAY = {
  executed: { status: 'ok', icon: '✓' },
  refused: { status: 'error', icon: '!' },
  failed: { status: 'error', icon: '!' },
};

function renderMission() {
  const panel = qs('#mission-panel');
  const { run, failure, status } = state.inbox;

  if (!run) {
    const message =
      status === 'loading'
        ? 'Lot en cours…'
        : failure
          ? `Dernière tentative sans exécution : ${failure}`
          : "Aucun lot lancé pour l'instant. Rendez-vous dans l'onglet Inbox pour en démarrer un.";
    panel.innerHTML = `<div class="mission-empty">${escapeHtml(message)}</div>`;
    return;
  }

  const stepsHtml = run.steps
    .map((step) => {
      const display = STEP_DISPLAY[step.status] ?? { status: 'idle', icon: '–' };
      return `
        <li class="mission-step" data-status="${display.status}">
          <span class="step-icon">${display.icon}</span>
          <div>
            <div class="step-title">${escapeHtml(step.title)} — ${escapeHtml(step.statusLabel)}</div>
            <div class="step-result">${escapeHtml(step.detail)}</div>
          </div>
        </li>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="mission-meta-row">
      <div class="mission-meta-item">
        <span class="label">Type de mission</span>
        Lot Inbox — ${escapeHtml(run.mailboxLabel)}
      </div>
      <div class="mission-meta-item">
        <span class="label">Statut</span>
        ${escapeHtml(run.statusLabel)}
      </div>
      <div class="mission-meta-item">
        <span class="label">Identifiant d'exécution</span>
        <span class="run-id">${escapeHtml(run.runId)}</span>
      </div>
    </div>
    <div class="mission-section-title">Étapes</div>
    <ul class="mission-steps">${stepsHtml}</ul>
    <div class="mission-section-title">Sources</div>
    <ul class="source-list">
      ${run.sourceLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
    </ul>
    <div class="mission-section-title">Erreurs</div>
    ${
      run.error
        ? `<ul class="error-list"><li>${escapeHtml(run.error)}</li></ul>`
        : `<p class="muted">Aucune erreur sur cette exécution.</p>`
    }
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
