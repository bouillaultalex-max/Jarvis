import type { AccessTokenProvider } from './graph-api-transport.js';

/**
 * `AccessTokenProvider` **minimal** — renvoie un jeton déjà résolu (lu une
 * fois depuis `SecretStore`, voir `real-whatsapp-config.ts`), sans flux de
 * rafraîchissement OAuth. Suffisant pour un jeton système permanent (Meta
 * Business System User) ou un jeton temporaire de test, dont le
 * renouvellement reste une opération manuelle hors périmètre de cette
 * tranche — contrairement à `GoogleOAuthAccessTokenProvider` (Gmail), qui
 * rafraîchit un jeton qui expire en quelques minutes.
 */
export class StaticAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly accessToken: string) {}

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }
}
