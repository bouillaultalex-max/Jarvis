/**
 * Implémentation réelle (réseau) de `OutboundTransport` — **non activée**
 * dans `main.ts` dans cette tranche (`SimulatedOutboundTransport` reste le
 * transport de production locale, voir `README.md`). Aucun appel réseau
 * n'a lieu tant que ce fichier n'est instancié et câblé explicitement
 * ailleurs — ce qui n'est fait nulle part dans cette mission.
 *
 * ## Contrat officiel retenu
 *
 * Vérifié par fetch direct, cette session :
 *
 * - **Endpoint** (`developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages`) :
 *   `POST https://graph.facebook.com/{apiVersion}/{phoneNumberId}/messages`.
 *   Version montrée dans l'exemple officiel au moment de la vérification :
 *   `v25.0` — **non codée en dur ici**, fournie par la configuration
 *   (`GraphApiTransportConfig.apiVersion`) : une version suppposée valide
 *   sans preuve n'est jamais choisie par ce fichier.
 * - **Authentification** : en-tête `Authorization: Bearer <token>` +
 *   `Content-Type: application/json`.
 * - **Corps de requête (message texte)** :
 *   `{ messaging_product: "whatsapp", recipient_type: "individual", to: "<destinataire>", type: "text", text: { body: "<texte>" } }`.
 * - **Réponse de succès** (exemple officiel vérifié) :
 *   `{ messaging_product: "whatsapp", contacts: [{ input, wa_id }], messages: [{ id }] }`.
 * - **Réponse d'erreur** (`developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes`,
 *   fetch direct) : `{ error: { message, type, code, error_data: { messaging_product, details }, error_subcode, fbtrace_id } }`.
 *
 * ## Points non vérifiés de façon fiable — exposés, pas devinés
 *
 * - **Limite de longueur du corps `text.body`** : sources secondaires
 *   contradictoires (1024 caractères côté templates vs 4096 souvent cité
 *   pour les messages texte libres) ; aucune confirmation directe obtenue
 *   sur la page de référence. **Aucune limite n'est donc imposée par
 *   défaut** (`maxBodyLength` reste `undefined` sauf configuration
 *   explicite par l'appelant, qui en assume alors la source).
 * - **Délai de requête recommandé pour l'envoi** (distinct du délai de
 *   réponse à un webhook entrant, déjà documenté ailleurs) : aucun chiffre
 *   officiel trouvé pour l'endpoint `/messages` lui-même. `timeoutMs` est
 *   donc un **choix applicatif local** (voir constante ci-dessous),
 *   explicitement non présenté comme une exigence Meta.
 * - **Format exact attendu du destinataire** (`to`) : l'exemple officiel
 *   utilise `"+16505551234"` (préfixe `+`), alors que le `from` d'un
 *   webhook entrant vérifié précédemment (et donc `recipientId` tel que
 *   reçu par ce transport) est composé de chiffres seuls, sans `+`. Ce
 *   fichier transmet `recipientId` **tel quel**, sans reformatage inventé
 *   — à confirmer avant un essai réel.
 */
import type { OutboundTransport, TransportResult } from './channel-ports.js';

export interface AccessTokenProvider {
  /** Résolu à chaque envoi — jamais mis en cache ici, jamais journalisé. */
  getAccessToken(): Promise<string>;
}

export interface GraphApiTransportConfig {
  /** Explicite, jamais une valeur par défaut supposée — voir l'en-tête de fichier. */
  readonly apiVersion: string;
  readonly phoneNumberId: string;
  /** Défaut : `https://graph.facebook.com` — overridable pour les tests (jamais pour un vrai déploiement). */
  readonly baseUrl?: string;
  /** Choix applicatif local, pas une exigence Meta vérifiée — voir l'en-tête de fichier. */
  readonly timeoutMs?: number;
  /** Absente par défaut : aucune limite de longueur n'est imposée sans preuve officielle — voir l'en-tête de fichier. */
  readonly maxBodyLength?: number;
}

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_TIMEOUT_MS = 10_000;
/** Format de l'exemple officiel vérifié (`v25.0`) — voir l'en-tête de fichier. */
const API_VERSION_PATTERN = /^v[0-9]+(?:\.[0-9]+)?$/;
/** Les identifiants de numéro observés dans la documentation officielle sont purement numériques. */
const PHONE_NUMBER_ID_PATTERN = /^[0-9]+$/;

/**
 * `OutboundTransport` réel, avec `fetch` **injecté** (jamais le `fetch`
 * global utilisé directement) — permet des tests entièrement locaux, sans
 * aucun appel réseau, et un remplacement explicite en production.
 *
 * ## Classification des issues (`TransportResult`)
 *
 * **Échec certain (`'error'`)** — seulement quand rien n'a pu avoir été
 * transmis au fournisseur, ou quand le fournisseur l'a rejeté explicitement :
 *   - rejet de la validation locale (avant tout appel réseau) ;
 *   - jeton d'accès indisponible (`AccessTokenProvider` en échec — avant
 *     tout appel réseau) ;
 *   - réponse HTTP **4xx** avec corps conforme au contrat d'erreur Meta
 *     (rejet explicite : paramètre invalide, limite de débit…) ;
 *   - réponse HTTP 4xx avec corps illisible (le code HTTP lui-même reste un
 *     signal explicite de rejet, même sans détail exploitable).
 *
 * **Issue incertaine (`'uncertain'`)** — dès qu'il existe un doute réel sur
 * ce que le fournisseur a fait de la requête :
 *   - **toute exception levée par `fetch` lui-même** (y compris un abandon
 *     par délai) — une exception de `fetch` ne prouve jamais que la requête
 *     n'a pas atteint le fournisseur (ex. connexion interrompue après que
 *     le serveur a déjà reçu et traité la requête) ;
 *   - délai dépassé pendant la **lecture du corps** de réponse (après
 *     réception des en-têtes) — mêmes raisons ;
 *   - réponse HTTP **5xx** : le fournisseur a bien reçu et traité la
 *     requête jusqu'à produire une réponse, mais une erreur serveur ne
 *     prouve ni l'envoi ni son absence — le message a pu être accepté
 *     avant l'échec côté serveur ;
 *   - réponse 200 avec JSON illisible, ou de forme inattendue (hors
 *     contrat de succès vérifié).
 *
 * Garanties tenues, dans l'ordre :
 *   1. `apiVersion`/`phoneNumberId` validés **à la construction** (format
 *      strict) — aucune valeur ne peut faire dévier l'URL construite vers
 *      un autre hôte ou chemin.
 *   2. Validation locale (corps non vide, longueur si configurée,
 *      destinataire syntaxiquement plausible — espaces explicitement
 *      rejetés) — **avant** tout appel réseau.
 *   3. Délai borné via `AbortController`/`AbortSignal`, couvrant à la fois
 *      l'attente des en-têtes **et** la lecture du corps de réponse — un
 *      seul minuteur, jamais réarmé, nettoyé une seule fois.
 *   4. **Aucun retry automatique** — un seul appel `fetch` par `send()`.
 *   5. Jamais de secret (jeton) dans un `reason` renvoyé ou journalisé —
 *      aucun `console.*` dans cette classe, et les motifs d'erreur ne
 *      réutilisent que des champs du corps de réponse Meta (jamais la
 *      configuration locale).
 *   6. Succès renvoyé **uniquement** si la réponse est conforme au contrat
 *      vérifié ci-dessus (jamais sur un simple `response.ok`).
 */
export class GraphApiOutboundTransport implements OutboundTransport {
  constructor(
    private readonly config: GraphApiTransportConfig,
    private readonly tokenProvider: AccessTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    // Validées une fois, à la construction : aucune valeur ne peut jamais
    // atteindre l'interpolation de l'URL sans être conforme à ces formats —
    // aucune possibilité d'injecter un autre hôte ou chemin via la
    // configuration (voir README, § Configuration et destination).
    if (!API_VERSION_PATTERN.test(config.apiVersion)) {
      throw new Error(
        `GraphApiOutboundTransport : « apiVersion » invalide (« ${config.apiVersion} ») — ` +
          'format attendu : « vNN[.N] » (ex. « v25.0 »).',
      );
    }
    if (!PHONE_NUMBER_ID_PATTERN.test(config.phoneNumberId)) {
      throw new Error(
        'GraphApiOutboundTransport : « phoneNumberId » invalide — doit être purement numérique.',
      );
    }
  }

  async send(input: {
    readonly recipientId: string;
    readonly text: string;
  }): Promise<TransportResult> {
    const validationError = this.#validateLocally(input);
    if (validationError !== undefined) {
      return { status: 'error', reason: validationError };
    }

    let token: string;
    try {
      token = await this.tokenProvider.getAccessToken();
    } catch (err) {
      // Aucun appel réseau n'a encore eu lieu : échec certain, aucun envoi tenté.
      return {
        status: 'error',
        reason: `Jeton d'accès indisponible — aucun envoi tenté (${describeError(err)}).`,
      };
    }

    const url = `${this.config.baseUrl ?? DEFAULT_BASE_URL}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.recipientId,
      type: 'text',
      text: { body: input.text },
    });

    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Un seul minuteur, non réarmé, couvrant explicitement l'attente des
    // en-têtes **et** la lecture du corps de réponse (voir plus bas) —
    // nettoyé une seule fois, dans le `finally` global.
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        // Toute exception de `fetch` — y compris un abandon par délai —
        // ne prouve **jamais** que la requête n'a pas atteint le
        // fournisseur : une rupture de connexion peut survenir après que
        // le serveur a déjà reçu et traité la requête. Jamais classée
        // `'error'` ici (voir README, § Classification des issues).
        if (isAbortError(err)) {
          return {
            status: 'uncertain',
            reason: `Délai dépassé (${timeoutMs}ms) avant réception de la réponse — statut d'envoi indéterminé.`,
          };
        }
        return {
          status: 'uncertain',
          reason: `Rupture réseau après invocation de l'envoi — statut d'envoi indéterminé (${describeError(err)}).`,
        };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (err) {
        if (isAbortError(err)) {
          // Les en-têtes avaient déjà été reçus (le `fetch` ci-dessus a
          // résolu) ; le délai a expiré pendant la lecture du corps —
          // toujours une issue incertaine, jamais une preuve de non-envoi.
          return {
            status: 'uncertain',
            reason: `Délai dépassé (${timeoutMs}ms) pendant la lecture de la réponse — statut d'envoi indéterminé.`,
          };
        }
        // Corps illisible (JSON invalide), pas un abandon par délai.
        return response.ok
          ? { status: 'uncertain', reason: 'Réponse HTTP reçue (ok) mais corps JSON illisible.' }
          : { status: 'error', reason: `HTTP ${response.status}, corps de réponse illisible.` };
      }

      if (response.status >= 500) {
        // Le fournisseur a bien reçu et traité la requête jusqu'à produire
        // une réponse, mais une erreur serveur ne prouve ni l'envoi ni son
        // absence — le message a pu être accepté avant l'échec. Jamais
        // classée `'error'` (voir README).
        return {
          status: 'uncertain',
          reason: `HTTP ${response.status} (erreur serveur fournisseur) — statut d'envoi indéterminé.`,
        };
      }
      if (!response.ok) {
        // 4xx : rejet explicite du fournisseur avant tout traitement
        // d'envoi (paramètre invalide, limite de débit…) — échec certain.
        return { status: 'error', reason: describeGraphErrorResponse(json, response.status) };
      }
      if (!isValidSuccessPayload(json)) {
        return {
          status: 'uncertain',
          reason: `Réponse HTTP ${response.status} de forme inattendue — contrat de succès non confirmé.`,
        };
      }
      return { status: 'sent' };
    } finally {
      clearTimeout(timer);
    }
  }

  #validateLocally(input: {
    readonly recipientId: string;
    readonly text: string;
  }): string | undefined {
    if (input.text.length === 0) {
      return 'Corps de message vide — aucun envoi tenté.';
    }
    const maxLength = this.config.maxBodyLength;
    if (maxLength !== undefined && input.text.length > maxLength) {
      return (
        `Corps de message trop long (${input.text.length} caractères) pour la limite ` +
        `LOCALE configurée (${maxLength}) — choix applicatif de ce transport, PAS une ` +
        'limite officielle Meta vérifiée (voir en-tête de fichier). Aucun envoi tenté.'
      );
    }
    // Rejette aussi tout espace (début, fin, milieu) — jamais de nettoyage
    // silencieux d'une entrée douteuse ; voir README § Configuration et
    // destination.
    if (!isPlausibleRecipient(input.recipientId)) {
      return 'Identifiant destinataire syntaxiquement invalide (vide, espace, ou hors chiffres/+) — aucun envoi tenté.';
    }
    return undefined;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Vérification défensive locale, pas une règle officielle Meta vérifiée — voir l'en-tête de fichier. Rejette explicitement tout espace. */
function isPlausibleRecipient(recipientId: string): boolean {
  return /^\+?[0-9]{5,20}$/.test(recipientId);
}

function isValidSuccessPayload(json: unknown): json is {
  readonly messaging_product: 'whatsapp';
  readonly messages: readonly { readonly id: string }[];
} {
  if (typeof json !== 'object' || json === null) return false;
  const obj = json as Record<string, unknown>;
  if (obj.messaging_product !== 'whatsapp') return false;
  const messages = obj.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const first: unknown = messages[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    typeof (first as Record<string, unknown>).id === 'string'
  );
}

/** Ne reprend que des champs du corps d'erreur **de Meta** — jamais la configuration locale (jeton, phoneNumberId). */
function describeGraphErrorResponse(json: unknown, httpStatus: number): string {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const error = (json as { error: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const e = error as Record<string, unknown>;
      const code = typeof e.code === 'number' ? e.code : undefined;
      const message = typeof e.message === 'string' ? e.message : undefined;
      if (code !== undefined || message !== undefined) {
        return `HTTP ${httpStatus}, erreur Graph API ${code ?? '?'} : ${message ?? 'sans message.'}`;
      }
    }
  }
  return `HTTP ${httpStatus}, corps d'erreur de forme inattendue.`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
