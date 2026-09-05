import type { Account } from '../account.js';
import type { SecretStore } from '../secret-store.js';
import { GmailApiClient } from './gmail-api-client.js';
import { GoogleOAuthAccessTokenProvider, resolveGmailCredentials, type GmailAppCredentials } from './gmail-auth.js';

/**
 * Ferme la boucle `Account → GmailApiClient` — M8-A10.
 *
 * Compose trois éléments déjà existants, sans en introduire un nouveau :
 * `resolveGmailCredentials` (M8-A8 : `Account` + `SecretStore` →
 * `GmailCredentials`), `GoogleOAuthAccessTokenProvider` (`gmail-auth.ts`,
 * inchangé — échange/cache/renouvelle l'access token), `GmailApiClient`
 * (`gmail-api-client.ts`, inchangé). Reste transport-agnostique : ne sait
 * rien de l'origine du refresh token (voir `gmail-connection.ts`, M8-A9),
 * ne décide d'aucune permission, n'appelle jamais
 * `PermissionManager`/`ToolExecutor`/`ConfirmationFlow`.
 *
 * `gmail-auth.ts` reste volontairement « entièrement séparée du client
 * Gmail » (voir son en-tête de fichier) : cette composition vit donc dans
 * son propre module plutôt que d'introduire une dépendance de
 * `gmail-auth.ts` vers `gmail-api-client.ts`.
 */

export interface ResolveGmailApiClientOptions {
  /** Compte Gmail déjà résolu (ex. via `resolveAccount`) — jamais choisi implicitement ici. */
  readonly account: Account;
  readonly secretStore: SecretStore;
  readonly appCredentials: GmailAppCredentials;
  /**
   * Un seul `fetchFn`, partagé par l'échange OAuth et les appels Gmail API
   * — comme en production (un unique `fetch` global). Injectable pour les
   * tests : jamais d'appel réseau réel dans la suite de tests.
   */
  readonly fetchFn?: typeof fetch;
  /** Injectable pour les tests (contrôle déterministe de l'expiration du token). */
  readonly now?: () => number;
  readonly tokenEndpoint?: string;
  readonly revokeEndpoint?: string;
  readonly apiBaseUrl?: string;
}

/**
 * Résout un `GmailApiClient` pleinement fonctionnel pour le compte donné.
 *
 * Ne fait strictement **aucun appel réseau elle-même** : `SecretStore.get()`
 * (lecture locale, via `resolveGmailCredentials`) et les deux constructeurs
 * réutilisés (`GoogleOAuthAccessTokenProvider`, `GmailApiClient`) ne
 * contactent jamais Google à la construction — seul un appel ultérieur
 * d'une méthode du client retourné (ex. `listMessageIds`, `sendMessage`)
 * déclenche le premier échange OAuth réel.
 *
 * @throws la même erreur que {@link resolveGmailCredentials} si le compte
 *   n'est pas Gmail ou si aucun refresh token n'est stocké pour lui — ces
 *   erreurs se propagent telles quelles, jamais interceptées ni ré-écrites
 *   ici (jamais de secret dans leur message, voir `resolveGmailCredentials`).
 */
export async function resolveGmailApiClient(options: ResolveGmailApiClientOptions): Promise<GmailApiClient> {
  const credentials = await resolveGmailCredentials({
    account: options.account,
    secretStore: options.secretStore,
    appCredentials: options.appCredentials,
  });

  const accessTokenProvider = new GoogleOAuthAccessTokenProvider({
    credentials,
    ...(options.tokenEndpoint !== undefined ? { tokenEndpoint: options.tokenEndpoint } : {}),
    ...(options.revokeEndpoint !== undefined ? { revokeEndpoint: options.revokeEndpoint } : {}),
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  return new GmailApiClient({
    accessTokenProvider,
    ...(options.apiBaseUrl !== undefined ? { apiBaseUrl: options.apiBaseUrl } : {}),
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
}
