// Mise en forme d'une réponse `POST /api/inbox/draft`. Fonctions pures :
// aucun accès réseau ni DOM ici, pour rester testables telles quelles — même
// discipline que `inbox-run.js`.

function describeHttpFailure(status, payload) {
  if (status === 0) return 'Centre de commandement injoignable.';
  const detail = typeof payload?.error === 'string' ? payload.error : 'réponse inattendue';
  return `${detail} (HTTP ${status})`;
}

function failure(message) {
  return { kind: 'failure', message };
}

/**
 * Réponse de `POST /api/inbox/draft` → une vue à quatre formes :
 * - `draft`               : brouillon modifiable (`body`, `subject` optionnel) ;
 * - `needs_clarification` : information indispensable manquante — `questions`,
 *   jamais de brouillon ;
 * - `blocked`              : affirmation non corroborée par un fait confirmé —
 *   `reason`, jamais de brouillon (voir `confirmed-fact-guard.ts`) ;
 * - `failure`              : échec technique ou réponse du serveur en erreur.
 *
 * `status` vaut 0 si l'appel n'a pas abouti. Une réponse HTTP 200 dont la
 * forme ne correspond à aucun statut connu devient aussi une `failure` —
 * jamais un brouillon ou une clarification inventés.
 */
export function toDraftView(status, payload) {
  if (status !== 200 || typeof payload?.status !== 'string') {
    return failure(describeHttpFailure(status, payload));
  }
  if (payload.status === 'ok' && payload.draft && typeof payload.draft.body === 'string') {
    return {
      kind: 'draft',
      body: payload.draft.body,
      subject: typeof payload.draft.subject === 'string' ? payload.draft.subject : null,
    };
  }
  if (payload.status === 'needs_clarification' && Array.isArray(payload.questions)) {
    return { kind: 'needs_clarification', questions: payload.questions };
  }
  if (payload.status === 'blocked') {
    return {
      kind: 'blocked',
      reason: typeof payload.reason === 'string' ? payload.reason : 'Brouillon bloqué.',
    };
  }
  if (payload.status === 'error') {
    return failure(
      typeof payload.reason === 'string' ? payload.reason : 'Échec de la génération du brouillon.',
    );
  }
  return failure('Réponse inattendue du serveur.');
}

/** Libellé affiché pour le sélecteur de message, à partir d'un item de lot déjà rendu. */
export function describeDraftOption(item) {
  return `${item.sender} — ${item.subject}`;
}

/* --------------------------------------------------------------------------
 * Cycle de vie d'une demande de brouillon — fonctions pures, sans DOM.
 *
 * Problème couvert : une réponse réseau peut arriver **après** qu'une
 * nouvelle demande (autre message, ou nouveau lot) a déjà pris le relais.
 * Sans protection, la réponse tardive de A s'afficherait sous B, ou sous un
 * tout nouveau lot. Chaque état de brouillon porte un `token` incrémenté à
 * chaque nouvelle demande ou réinitialisation ; une réponse n'est appliquée
 * que si son `token` est toujours celui en cours — sinon elle est purement
 * et simplement ignorée (jamais affichée, jamais fusionnée).
 * ------------------------------------------------------------------------ */

/** État initial, avant toute demande — utilisé au lancement d'un nouveau lot. */
export function initialDraftState() {
  return { token: 0, status: 'idle', messageId: null, view: null, editedBody: '' };
}

/**
 * Réinitialise l'état de brouillon (changement de message sélectionné, ou
 * nouveau lot lancé) : efface tout brouillon ou question affichés, et rend
 * périmée toute requête déjà en vol en incrémentant le jeton.
 */
export function resetDraftState(previous) {
  return { token: previous.token + 1, status: 'idle', messageId: null, view: null, editedBody: '' };
}

/**
 * Démarre une nouvelle demande pour `messageId` : incrémente le jeton (rend
 * périmée toute requête précédente, y compris pour un autre message) et
 * renvoie l'état « en cours ». L'appelant doit conserver `state.token` pour
 * l'associer à la réponse via {@link applyDraftResponse}.
 */
export function startDraftRequest(previous, messageId) {
  return { token: previous.token + 1, status: 'loading', messageId, view: null, editedBody: '' };
}

/**
 * Applique une réponse reçue pour `responseToken` à l'état courant. Renvoie
 * `null` si cette réponse est **périmée** (le jeton courant a déjà avancé,
 * parce qu'une nouvelle demande ou une réinitialisation a eu lieu entre
 * temps) — l'appelant ne doit alors rien afficher ni modifier.
 */
export function applyDraftResponse(current, responseToken, view) {
  if (current.token !== responseToken) {
    return null;
  }
  return {
    ...current,
    status: 'ready',
    view,
    editedBody: view.kind === 'draft' ? view.body : '',
  };
}
