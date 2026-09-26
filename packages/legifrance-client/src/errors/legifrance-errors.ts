/**
 * Erreurs typées de `@jarvis/legifrance-client` — même discipline que
 * `packages/connectors/src/errors.ts` : une classe dédiée par catégorie,
 * un `code` littéral, jamais de secret dans un message.
 *
 * **Aucune de ces erreurs ne contient jamais** `client_secret`,
 * `access_token`, un header `Authorization` complet, ni le corps d'une
 * réponse distante (qui peut contenir un contenu sensible non maîtrisé) —
 * uniquement des métadonnées sûres à journaliser (statut HTTP, catégorie,
 * message fixe écrit dans ce fichier).
 *
 * Taxonomie retenue (voir LEGAL-02B.1, rapport d'implémentation §14) :
 *   - `LegifranceConfigError`            — configuration invalide (ex. `LEGIFRANCE_ENVIRONMENT` absent/inconnu).
 *   - *(credentials absents)*            — délibérément **pas** de classe dédiée : `resolveLegifranceCredentials`
 *                                          réutilise `SecretNotFoundError` de `@jarvis/connectors`, déjà exact pour ce cas.
 *   - `LegifranceOAuthError`             — le point de terminaison OAuth PISTE a refusé la demande de jeton (statut HTTP non 2xx).
 *   - `LegifranceMalformedResponseError` — réponse 2xx mais non exploitable (JSON invalide, `access_token`/`expires_in` absents ou mal typés).
 *   - `LegifranceNetworkError`           — l'appel réseau lui-même a échoué (DNS, timeout, connexion refusée…), avant toute réponse HTTP.
 *   - `LegifranceHttpError`              — un appel à l'API Légifrance (pas le point de terminaison OAuth) a reçu un statut HTTP non 2xx ;
 *                                          `kind` distingue `client_error` (4xx) de `server_error` (5xx). C'est aussi la forme que prend
 *                                          un « token invalide » une fois présenté à l'API (401) — aucune classe séparée pour ce cas.
 */

export class LegifranceConfigError extends Error {
  readonly code = 'legifrance_config_invalid' as const;

  constructor(detail: string) {
    super(`Légifrance : configuration invalide (${detail}).`);
    this.name = 'LegifranceConfigError';
  }
}

/** Le point de terminaison OAuth PISTE a refusé la demande de jeton. Ne porte que le statut HTTP — jamais le corps de la réponse. */
export class LegifranceOAuthError extends Error {
  readonly code = 'legifrance_oauth_error' as const;

  constructor(readonly status: number) {
    super(`Légifrance OAuth : demande de jeton refusée (HTTP ${status}).`);
    this.name = 'LegifranceOAuthError';
  }
}

/** Réponse 2xx mais dont la forme ne peut pas être exploitée en confiance. `detail` est toujours un texte fixe écrit dans ce package, jamais dérivé du corps de la réponse. */
export class LegifranceMalformedResponseError extends Error {
  readonly code = 'legifrance_malformed_response' as const;

  constructor(detail: string) {
    super(`Légifrance : réponse malformée (${detail}).`);
    this.name = 'LegifranceMalformedResponseError';
  }
}

/** L'appel réseau a échoué avant toute réponse HTTP (DNS, timeout, connexion refusée…). */
export class LegifranceNetworkError extends Error {
  readonly code = 'legifrance_network_error' as const;

  constructor(detail: string) {
    super(`Légifrance : échec réseau (${detail}).`);
    this.name = 'LegifranceNetworkError';
  }
}

export type LegifranceHttpErrorKind = 'client_error' | 'server_error';

/** Un appel à l'API Légifrance (hors point de terminaison OAuth) a reçu un statut HTTP non 2xx. Ne porte que le statut — jamais le corps de la réponse. */
export class LegifranceHttpError extends Error {
  readonly code = 'legifrance_http_error' as const;
  readonly kind: LegifranceHttpErrorKind;

  constructor(readonly status: number) {
    const kind: LegifranceHttpErrorKind = status >= 500 ? 'server_error' : 'client_error';
    super(`Légifrance : requête API refusée (HTTP ${status}, ${kind}).`);
    this.name = 'LegifranceHttpError';
    this.kind = kind;
  }
}
