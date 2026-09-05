import type { Account } from '../account.js';
import type { SecretStore } from '../secret-store.js';
import { requireSecret } from '../secret-store.js';

/**
 * Couche d'authentification Gmail — entièrement séparée du client Gmail et
 * des `Tool`. Ni `GmailApiClient`, ni `gmailConnector`, ni aucun `Tool` ne
 * manipulent directement `GmailCredentials` : ils ne connaissent que
 * {@link AccessTokenProvider}, qui fournit un access token sur demande sans
 * jamais exposer comment il est obtenu ou renouvelé.
 */

export interface GmailCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/**
 * Credentials au niveau **application** : `clientId`/`clientSecret`
 * identifient l'enregistrement OAuth de JARVIS auprès de Google — un seul
 * enregistrement sert tous les comptes Gmail connectés, ce n'est jamais une
 * donnée par compte (voir {@link resolveGmailCredentials}). Dérivé de
 * `GmailCredentials` (sans dupliquer les champs) plutôt que redéfini de
 * zéro.
 */
export type GmailAppCredentials = Omit<GmailCredentials, 'refreshToken'>;

/**
 * Abstraction dont dépend le client Gmail. Le renouvellement (refresh token
 * → access token) est un détail d'implémentation caché derrière cette
 * interface.
 */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

/**
 * Point d'extension future : stockage sécurisé du refresh token (fichier
 * chiffré, trousseau OS, coffre-fort…). **Non implémenté à ce stade** — le
 * refresh token est reçu directement via {@link GmailCredentials}, fourni
 * par l'appelant. La connexion initiale du compte (flux de consentement
 * OAuth, obtention du premier refresh token) est également hors scope de ce
 * jalon.
 */
export interface RefreshTokenStore {
  load(): Promise<string | undefined>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
/** Marge de sécurité avant l'expiration annoncée par Google. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export interface GoogleOAuthAccessTokenProviderOptions {
  readonly credentials: GmailCredentials;
  readonly tokenEndpoint?: string;
  readonly revokeEndpoint?: string;
  /** Injectable pour les tests : jamais d'appel réseau réel dans la suite de tests. */
  readonly fetchFn?: typeof fetch;
  /** Injectable pour les tests (contrôle déterministe de l'expiration). Défaut : `Date.now`. */
  readonly now?: () => number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Implémentation réelle de {@link AccessTokenProvider} : échange le refresh
 * token contre un access token via l'endpoint OAuth 2.0 de Google, met en
 * cache l'access token jusqu'à son expiration (avec marge de sécurité), et
 * le renouvelle automatiquement au prochain appel expiré. Ne journalise et
 * ne renvoie jamais `clientSecret` ni `refreshToken` — y compris dans les
 * messages d'erreur.
 */
export class GoogleOAuthAccessTokenProvider implements AccessTokenProvider {
  /**
   * Champ JS réellement privé (pas seulement `private` TypeScript, qui n'est
   * qu'une vérification à la compilation) — M8-A10 : cette instance est
   * capturée par un `GmailApiClient` qui peut désormais être un résultat
   * public (`resolveGmailApiClient`), donc `JSON.stringify`/`Object.keys`/
   * `String` sur le provider lui-même ne doivent jamais exposer
   * `clientSecret` ni `refreshToken`.
   */
  readonly #credentials: GmailCredentials;
  private readonly tokenEndpoint: string;
  private readonly revokeEndpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private cached: CachedToken | undefined;

  constructor(options: GoogleOAuthAccessTokenProviderOptions) {
    this.#credentials = options.credentials;
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.revokeEndpoint = options.revokeEndpoint ?? DEFAULT_REVOKE_ENDPOINT;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached !== undefined && this.cached.expiresAtMs - EXPIRY_SAFETY_MARGIN_MS > this.now()) {
      return this.cached.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
      refresh_token: this.#credentials.refreshToken,
      grant_type: 'refresh_token',
    });

    let response: Response;
    try {
      response = await this.fetchFn(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new Error(
        `Gmail OAuth : échec réseau lors du renouvellement de l'access token (${describeError(err)}).`,
      );
    }

    if (!response.ok) {
      throw new Error(`Gmail OAuth : renouvellement de l'access token refusé (statut HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new Error('Gmail OAuth : réponse de renouvellement sans « access_token » exploitable.');
    }
    const expiresInSeconds =
      typeof payload.expires_in === 'number' ? payload.expires_in : DEFAULT_EXPIRES_IN_SECONDS;

    this.cached = {
      accessToken: payload.access_token,
      expiresAtMs: this.now() + expiresInSeconds * 1000,
    };
    return this.cached.accessToken;
  }

  /** Révoque l'accès côté Google (déconnexion) et efface le cache local, y compris en cas d'échec. */
  async revoke(): Promise<void> {
    this.cached = undefined;

    const body = new URLSearchParams({ token: this.#credentials.refreshToken });
    let response: Response;
    try {
      response = await this.fetchFn(this.revokeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new Error(`Gmail OAuth : échec réseau lors de la révocation (${describeError(err)}).`);
    }

    if (!response.ok) {
      throw new Error(`Gmail OAuth : révocation refusée (statut HTTP ${response.status}).`);
    }
  }
}

/**
 * Charge les credentials Gmail depuis des variables d'environnement
 * (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`). Ne
 * journalise jamais les valeurs lues. Voir `.env.example` pour les
 * placeholders attendus.
 *
 * @throws {Error} si une variable requise est absente ou vide (le message
 *   ne cite que les *noms* de variable, jamais une valeur).
 */
export function loadGmailCredentialsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GmailCredentials {
  const clientId = env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = env.GMAIL_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail OAuth : variables d’environnement manquantes ' +
        '(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN requises).',
    );
  }

  return { clientId, clientSecret, refreshToken };
}

/**
 * Clé `SecretStore` du refresh token d'un compte Gmail — **seul** endroit du
 * dépôt qui construit cette chaîne (M8-A8) : tout code qui a besoin de lire
 * ou d'écrire ce secret doit appeler cette fonction plutôt que de recopier
 * le format littéralement, pour qu'une éventuelle évolution de convention
 * n'ait qu'un seul endroit à changer.
 */
export function gmailRefreshTokenSecretKey(accountId: string): string {
  return `gmail.${accountId}.refreshToken`;
}

export interface ResolveGmailCredentialsOptions {
  /** Compte Gmail déjà résolu (ex. via `resolveAccount`) — jamais choisi implicitement ici. */
  readonly account: Account;
  readonly secretStore: SecretStore;
  /** Config d'application (voir {@link GmailAppCredentials}) — pas une donnée du compte. */
  readonly appCredentials: GmailAppCredentials;
}

/**
 * Assemble les {@link GmailCredentials} nécessaires à
 * {@link GoogleOAuthAccessTokenProvider} à partir d'un `Account` déjà résolu
 * et d'un `SecretStore` — sans jamais faire transiter le refresh token par
 * `Account` (qui ne le porte structurellement pas) ni par un second
 * mécanisme de stockage (`SecretStore` reste la seule autorité).
 *
 * Ne modifie jamais `account` (aucune mutation, aucune écriture dans
 * `AccountStore`) et ne persiste le refresh token nulle part ailleurs — il
 * est uniquement lu depuis `secretStore` puis renvoyé dans la structure déjà
 * consommée par le mécanisme OAuth existant, exactement comme
 * `loadGmailCredentialsFromEnv` le fait pour le cas mono-compte. Ne
 * journalise jamais sa valeur.
 *
 * `account.status` n'est délibérément pas vérifié ici : il est purement
 * informatif (voir sa documentation dans `account.ts`) et ne conditionne
 * aucune décision — la seule autorité qui décide si une action Gmail peut
 * s'exécuter reste `PermissionManager`, en aval.
 *
 * @throws {Error} si `account.provider` n'est pas `'gmail'`, ou si
 *   `account.id` est vide — dans les deux cas, message sans aucune valeur
 *   sensible.
 * @throws {SecretNotFoundError} si aucun refresh token n'est stocké pour ce
 *   compte précis — jamais de repli sur un autre compte, jamais de secret
 *   créé automatiquement (voir {@link requireSecret}).
 */
export async function resolveGmailCredentials(options: ResolveGmailCredentialsOptions): Promise<GmailCredentials> {
  const { account, secretStore, appCredentials } = options;

  if (account.provider !== 'gmail') {
    throw new Error(
      `resolveGmailCredentials : le compte « ${account.id} » n'est pas un compte Gmail (provider « ${account.provider} »).`,
    );
  }
  if (account.id.length === 0) {
    throw new Error('resolveGmailCredentials : « account.id » est requis.');
  }

  const refreshToken = await requireSecret(secretStore, gmailRefreshTokenSecretKey(account.id));

  return {
    clientId: appCredentials.clientId,
    clientSecret: appCredentials.clientSecret,
    refreshToken,
  };
}
