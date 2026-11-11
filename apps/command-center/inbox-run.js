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
          sourceText: SOURCES[item.source] ?? item.source,
          summary: item.summary ?? null,
        })),
    sourceLines: [
      `Boîte : ${payload.mailbox?.label ?? '?'} (${KINDS[payload.mailbox?.kind] ?? payload.mailbox?.kind ?? '?'})`,
      `Outil de lecture : ${payload.source?.tool ?? '?'}`,
      `Messages demandés : ${payload.source?.requested ?? '?'} — lus : ${payload.source?.returned ?? '?'}`,
    ],
  };
}
