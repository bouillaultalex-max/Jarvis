// Mise en forme d'un lot Inbox renvoyé par l'API Jarvis locale. Fonctions
// pures : aucun accès réseau ni DOM ici, pour rester testables telles quelles.

export const MAX_BATCH_SIZE = 10;

const LABELS = {
  important: 'Important',
  not_important: 'Non important',
  uncertain: 'Incertain',
};

const SOURCES = {
  explicit_rule: 'règle explicite',
  user_correction: 'correction utilisateur',
  llm: 'LLM',
  default: 'repli par défaut',
};

const STEP_TITLES = {
  read: 'Lecture de la boîte',
  classify: 'Classification',
  llm_classification: 'Classification par LLM',
  summary: 'Résumé',
};

const STEP_STATUSES = {
  executed: 'Exécutée',
  refused: 'Refusée',
  failed: 'En échec',
  skipped: 'Non exécutée',
  not_enabled: 'Non activée',
};

const KINDS = { fixture: 'fictive' };

const SUMMARY_PREFIX = 'Résumé généré par le modèle (texte non vérifié, ne confirme aucune action)';

/** Libellé de la raison selon sa provenance : un texte du modèle n'est jamais présenté comme vérifié. */
function reasonPrefix(source) {
  return source === 'llm'
    ? 'Raison générée par le modèle · non vérifiée'
    : `Raison · ${SOURCES[source] ?? source}`;
}

const INBOX_MODE_LABEL = 'Boîte fictive';

const MODEL_STEPS = [
  ['llm_classification', 'Classement par modèle'],
  ['summary', 'Résumé par modèle'],
];

const MODEL_USE = {
  executed: 'utilisé',
  not_enabled: 'désactivé',
  skipped: 'non utilisé pour ce lot',
  failed: 'en erreur',
  refused: 'refusé',
};

// Provenances hors modèle, dans l'ordre d'affichage.
const CLASSIFIED_OTHERWISE = [
  ['explicit_rule', 'par règle'],
  ['user_correction', 'par correction utilisateur'],
  ['default', 'par défaut (repli, cause non transmise par l’API)'],
];

/**
 * Classement par modèle exécuté : chaque message est compté selon sa
 * provenance (modèle, règle, correction, défaut), pour que le total soit
 * entièrement expliqué. L'API ne transmet pas la cause d'un repli (erreur du
 * modèle ou réponse inexploitable) : on le dit, sans afficher d'échec supposé.
 */
function describeClassificationRun(items) {
  const count = (source) => items.filter((item) => item.source === source).length;
  const known = new Set(['llm', ...CLASSIFIED_OTHERWISE.map(([source]) => source)]);
  const byModel = count('llm');
  const parts = [
    `${byModel === 0 ? 'aucun' : byModel} sur ${items.length} message(s)`,
    ...CLASSIFIED_OTHERWISE.filter(([source]) => count(source) > 0).map(
      ([source, label]) => `${count(source)} ${label}`,
    ),
    ...[...new Set(items.map((item) => item.source))]
      .filter((source) => !known.has(source))
      .map((source) => `${count(source)} de provenance « ${source} »`),
  ];
  return { text: parts.join(' · '), status: count('default') > 0 ? 'fallback' : 'executed' };
}

/**
 * Mode de l'Inbox : « Boîte fictive », puis, après un lot, l'usage du modèle
 * tel que l'indiquent les étapes et les provenances renvoyées par l'API.
 * `run` vaut `null` avant le premier lot et pendant un nouveau lot.
 */
export function describeInboxMode(run) {
  const base = { text: INBOX_MODE_LABEL, status: null };
  if (!run) return [base];
  return [
    base,
    ...MODEL_STEPS.flatMap(([id, title]) => {
      const step = run.steps.find((s) => s.id === id);
      if (!step) return [];
      const use =
        id === 'llm_classification' && step.status === 'executed'
          ? describeClassificationRun(run.items)
          : { text: MODEL_USE[step.status] ?? step.status, status: step.status };
      return [{ text: `${title} : ${use.text}`, status: use.status }];
    }),
  ];
}

/** Taille de lot saisie → entier entre 1 et MAX_BATCH_SIZE, sinon `null`. */
export function parseBatchSize(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const size = Number(text);
  return size >= 1 && size <= MAX_BATCH_SIZE ? size : null;
}

/** Libellé d'une boîte pour le sélecteur : « Boîte fictive (fictive) » n'ajoute rien, on garde le nom. */
export function describeMailboxOption(mailbox) {
  const kind = KINDS[mailbox.kind] ?? mailbox.kind;
  return mailbox.label.toLowerCase().includes(kind) ? mailbox.label : `${mailbox.label} (${kind})`;
}

function failure(message) {
  return { kind: 'failure', message };
}

/**
 * Réponse de `GET /api/inbox/mailboxes` → `{ kind: 'mailboxes', mailboxes }`
 * ou `{ kind: 'failure', message }`. `status` vaut 0 si l'appel n'a pas abouti.
 */
export function toMailboxList(status, payload) {
  if (status === 200 && Array.isArray(payload?.mailboxes) && payload.mailboxes.length > 0) {
    return { kind: 'mailboxes', mailboxes: payload.mailboxes };
  }
  return failure(describeHttpFailure(status, payload));
}

function describeHttpFailure(status, payload) {
  if (status === 0) return 'Centre de commandement injoignable.';
  const detail = typeof payload?.error === 'string' ? payload.error : 'réponse inattendue';
  return `${detail} (HTTP ${status})`;
}

/**
 * Réponse de `POST /api/inbox/runs` → vue d'exécution. Une réponse sans
 * identifiant d'exécution n'est jamais présentée comme un lot : c'est un
 * échec (`kind: 'failure'`), sans message ni étape inventés.
 */
export function toRunView(status, payload) {
  if (typeof payload?.runId !== 'string' || !Array.isArray(payload.steps)) {
    return failure(describeHttpFailure(status, payload));
  }

  const failed = payload.status !== 'completed';
  return {
    kind: 'run',
    runId: payload.runId,
    failed,
    statusLabel: failed ? 'Terminée avec erreur' : 'Terminée',
    mailboxLabel: payload.mailbox?.label ?? '?',
    error: failed ? (payload.error ?? 'Exécution en échec.') : null,
    steps: payload.steps.map((step) => ({
      id: step.id,
      title: STEP_TITLES[step.id] ?? step.id,
      status: step.status,
      statusLabel: STEP_STATUSES[step.status] ?? step.status,
      detail: step.detail ?? '',
    })),
    // Un lot en échec n'affiche aucun message, quoi que contienne la réponse.
    items: failed
      ? []
      : (payload.items ?? []).map((item) => ({
          id: item.id,
          sender: item.sender,
          subject: item.subject,
          receivedAt: item.receivedAt,
          label: item.label,
          labelText: LABELS[item.label] ?? item.label,
          reason: item.reason,
          reasonText: `${reasonPrefix(item.source)} : ${item.reason}`,
          source: item.source,
          sourceText: SOURCES[item.source] ?? item.source,
          // Ligne « Provenance » omise quand le libellé de la raison la répète déjà.
          provenanceText: reasonPrefix(item.source).endsWith(SOURCES[item.source] ?? item.source)
            ? null
            : `Provenance : ${SOURCES[item.source] ?? item.source}`,
          summary: item.summary ?? null,
          // Le résumé est un texte libre du modèle, nourri par le corps du mail :
          // il peut dire « Réponse envoyée » sans qu'aucune action n'ait eu lieu.
          summaryText: item.summary ? `${SUMMARY_PREFIX} : ${item.summary}` : null,
        })),
    sourceLines: [
      `Boîte : ${payload.mailbox?.label ?? '?'} (${KINDS[payload.mailbox?.kind] ?? payload.mailbox?.kind ?? '?'})`,
      `Outil de lecture : ${payload.source?.tool ?? '?'}`,
      `Messages demandés : ${payload.source?.requested ?? '?'} — lus : ${payload.source?.returned ?? '?'}`,
    ],
  };
}
