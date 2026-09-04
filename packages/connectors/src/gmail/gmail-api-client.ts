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

/**
 * Client Gmail **authentifié** — c'est le `TClient` que `gmailConnector`
 * reçoit par injection dans `createTools(client)`. Ne fait strictement que
 * lire : `listMessageIds` et `getMessage` sont les deux seules méthodes de
 * cette classe. Aucune méthode d'envoi, de modification ou de suppression
 * n'existe ici — ce n'est pas une question de permission, la capacité
 * n'existe tout simplement pas sur cet objet.
 */
export class GmailApiClient {
  private readonly accessTokenProvider: AccessTokenProvider;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GmailApiClientOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async authorizedGet(path: string): Promise<unknown> {
    // Une authentification absente/invalide échoue ici et se propage telle
    // quelle : aucun résultat partiel, aucun repli silencieux.
    const accessToken = await this.accessTokenProvider.getAccessToken();

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
}
