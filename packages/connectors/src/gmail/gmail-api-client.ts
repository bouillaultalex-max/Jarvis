import type { AccessTokenProvider } from './gmail-auth.js';

/**
 * Formes brutes minimales de l'API Gmail (resource `Message`, `format=full`).
 * Ces types ne sortent **jamais** de ce module : `gmail-message-mapper.ts`
 * les convertit en `EmailMessage` avant qu'ils n'atteignent un `Tool`.
 */
export interface GmailRawHeader {
  readonly name: string;
  readonly value: string;
}

export interface GmailRawMessagePart {
  readonly mimeType?: string;
  readonly body?: { readonly data?: string };
  readonly parts?: readonly GmailRawMessagePart[];
  readonly headers?: readonly GmailRawHeader[];
}

export interface GmailRawMessage {
  readonly id: string;
  readonly threadId?: string;
  /** Millisecondes depuis epoch, sous forme de chaîne (format Gmail API). */
  readonly internalDate?: string;
  readonly payload?: GmailRawMessagePart;
}

const DEFAULT_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_MAX_RESULTS = 10;

export interface GmailApiClientOptions {
  readonly accessTokenProvider: AccessTokenProvider;
  readonly apiBaseUrl?: string;
  /** Injectable pour les tests : jamais d'appel réseau réel dans la suite de tests. */
  readonly fetchFn?: typeof fetch;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Entrée nécessaire à l'envoi d'un message — voir {@link GmailApiClient.sendMessage}. */
export interface GmailSendMessageInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly threadId?: string;
}

/**
 * Résultat minimal exposé après un envoi — dérivé de la réponse brute
 * Gmail (`id`, `threadId`, `labelIds`…), dont seuls `id`/`threadId` sont
 * retenus. Le reste de la réponse brute ne sort jamais de cette méthode.
 */
export interface GmailSendMessageResult {
  readonly id: string;
  readonly threadId?: string;
}

function encodeBase64Url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

/**
 * Construit un message MIME minimal (`text/plain`, UTF-8). Les en-têtes et
 * le corps portent l'UTF-8 tel quel : c'est l'encodage base64url de
 * l'ensemble (fait par l'appelant, voir `sendMessage`) qui transporte ces
 * octets sans perte jusqu'à l'API Gmail — aucun encodage RFC 2047
 * supplémentaire n'est nécessaire pour ce message minimal.
 */
function buildMimeMessage(input: GmailSendMessageInput): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${input.body}`;
}

/**
 * Client Gmail **authentifié** — c'est le `TClient` que `gmailConnector`
 * reçoit par injection dans `createTools(client)`. `listMessageIds` et
 * `getMessage` (lecture) et `sendMessage` (écriture) sont les seules
 * méthodes de cette classe. Aucune méthode de modification ou de
 * suppression n'existe ici — ce n'est pas une question de permission, la
 * capacité n'existe tout simplement pas sur cet objet.
 */
export class GmailApiClient {
  /**
   * Champ JS réellement privé (pas seulement `private` TypeScript, qui n'est
   * qu'une vérification à la compilation) — M8-A10 : un `GmailApiClient` peut
   * désormais être le résultat public d'une résolution (`resolveGmailApiClient`),
   * donc `JSON.stringify`/`Object.keys`/`String` sur l'instance ne doivent
   * jamais exposer l'`AccessTokenProvider` qu'il capture (et, par transitivité,
   * le refresh token qu'il porte).
   */
  readonly #accessTokenProvider: AccessTokenProvider;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GmailApiClientOptions) {
    this.#accessTokenProvider = options.accessTokenProvider;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async authorizedGet(path: string): Promise<unknown> {
    // Une authentification absente/invalide échoue ici et se propage telle
    // quelle : aucun résultat partiel, aucun repli silencieux.
    const accessToken = await this.#accessTokenProvider.getAccessToken();

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new Error(`Gmail API : échec réseau (${describeError(err)}).`);
    }

    if (!response.ok) {
      throw new Error(`Gmail API : requête refusée (statut HTTP ${response.status}).`);
    }

    return response.json();
  }

  /** Ids des messages les plus récents de la boîte de réception (lecture seule). */
  async listMessageIds(options: { readonly maxResults?: number } = {}): Promise<readonly string[]> {
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const payload = (await this.authorizedGet(`/users/me/messages?maxResults=${maxResults}`)) as {
      messages?: ReadonlyArray<{ id?: unknown }>;
    };
    return (payload.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
  }

  /** Message complet (`format=full`), sous forme brute Gmail. */
  async getMessage(id: string): Promise<GmailRawMessage> {
    return (await this.authorizedGet(`/users/me/messages/${encodeURIComponent(id)}?format=full`)) as GmailRawMessage;
  }

  /**
   * Envoie réellement un message via `POST /users/me/messages/send`
   * (`raw` = le message MIME, encodé en base64url). Réutilise le même
   * {@link AccessTokenProvider} que les méthodes de lecture — aucun
   * second mécanisme d'authentification. Ne journalise et ne renvoie
   * jamais l'access token, y compris en cas d'échec.
   */
  async sendMessage(input: GmailSendMessageInput): Promise<GmailSendMessageResult> {
    const accessToken = await this.#accessTokenProvider.getAccessToken();

    const body: Record<string, unknown> = { raw: encodeBase64Url(buildMimeMessage(input)) };
    if (input.threadId !== undefined) {
      body.threadId = input.threadId;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiBaseUrl}/users/me/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Gmail API : échec réseau (${describeError(err)}).`);
    }

    if (!response.ok) {
      throw new Error(`Gmail API : requête refusée (statut HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as { id?: unknown; threadId?: unknown };
    if (typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new Error('Gmail API : réponse d’envoi sans « id » exploitable.');
    }

    return {
      id: payload.id,
      ...(typeof payload.threadId === 'string' ? { threadId: payload.threadId } : {}),
    };
  }
}
