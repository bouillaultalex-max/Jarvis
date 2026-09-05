import { describe, expect, it, vi } from 'vitest';

import type { Account } from '../account.js';
import { SecretNotFoundError } from '../errors.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import { gmailRefreshTokenSecretKey, type GmailAppCredentials } from './gmail-auth.js';
import { resolveGmailApiClient } from './gmail-client-resolver.js';

/**
 * Tests M8-A10 — ferme la boucle `Account → GmailApiClient`. Aucun appel
 * réseau réel : un unique `fetchFn` mocké sert à la fois l'échange OAuth
 * (`oauth2.googleapis.com/token`) et l'API Gmail
 * (`gmail.googleapis.com/gmail/v1/...`), comme en production.
 */

const APP_CREDENTIALS: GmailAppCredentials = { clientId: 'app-client-id', clientSecret: 'FAKE-APP-CLIENT-SECRET' };

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    provider: 'gmail',
    accountIdentifier: `${overrides.id}@example.test`,
    status: 'connected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Fausse API combinée : route l'échange OAuth et les appels Gmail sur un
 * seul `fetchFn`, exactement comme `resolveGmailApiClient` le fait en
 * partageant un unique `fetch` réel en production.
 */
function buildCombinedFetch(refreshTokenToAccessToken: ReadonlyMap<string, string>) {
  const tokenExchangeRefreshTokens: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      const refreshToken = body.get('refresh_token') ?? '';
      tokenExchangeRefreshTokens.push(refreshToken);
      const accessToken = refreshTokenToAccessToken.get(refreshToken);
      if (accessToken === undefined) {
        return jsonResponse(400, { error: 'invalid_grant' });
      }
      return jsonResponse(200, { access_token: accessToken, expires_in: 3600 });
    }

    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      const accessToken = String(init?.headers && (init.headers as Record<string, string>).Authorization).replace(
        'Bearer ',
        '',
      );
      const expectedTokens = new Set(refreshTokenToAccessToken.values());
      if (!expectedTokens.has(accessToken)) {
        return jsonResponse(401, { error: 'invalid access token' });
      }
      return jsonResponse(200, { messages: [{ id: 'm1' }] });
    }

    return jsonResponse(500, { error: `unexpected url in test: ${url}` });
  });

  return { fetchFn, tokenExchangeRefreshTokens };
}

describe('resolveGmailApiClient — M8-A10', () => {
  it('A. résolution nominale : le client construit est pleinement fonctionnel', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    const { fetchFn } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    const client = await resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn });
    const ids = await client.listMessageIds();

    expect(ids).toEqual(['m1']);
  });

  it('G. absence de réseau lors de la simple résolution (avant tout appel de méthode)', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    const { fetchFn } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    await resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('B. le bon refresh token est utilisé, dérivé exclusivement de l’accountId', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    const { fetchFn, tokenExchangeRefreshTokens } = buildCombinedFetch(
      new Map([['refresh-token-acc-1', 'access-token-acc-1']]),
    );

    const client = await resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn });
    await client.listMessageIds();

    expect(tokenExchangeRefreshTokens).toEqual(['refresh-token-acc-1']);
  });

  it('C. isolation entre deux comptes Gmail : chaque client n’utilise que le secret de son propre compte', async () => {
    const accountA = makeAccount({ id: 'acc-A' });
    const accountB = makeAccount({ id: 'acc-B' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');
    const { fetchFn, tokenExchangeRefreshTokens } = buildCombinedFetch(
      new Map([
        ['refresh-token-A', 'access-token-A'],
        ['refresh-token-B', 'access-token-B'],
      ]),
    );

    const clientA = await resolveGmailApiClient({
      account: accountA,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });
    const clientB = await resolveGmailApiClient({
      account: accountB,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      fetchFn,
    });

    await clientA.listMessageIds();
    await clientB.listMessageIds();

    expect(tokenExchangeRefreshTokens).toEqual(['refresh-token-A', 'refresh-token-B']);
  });

  it('D. propagation des erreurs : secret absent → SecretNotFoundError, sans appel réseau', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    const { fetchFn } = buildCombinedFetch(new Map());

    await expect(
      resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('D. propagation des erreurs : mauvais provider → refus, sans appel réseau', async () => {
    const account = makeAccount({ id: 'acc-1', provider: 'discord' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    const { fetchFn } = buildCombinedFetch(new Map([['refresh-token-acc-1', 'access-token-acc-1']]));

    await expect(
      resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn }),
    ).rejects.toThrow(/n'est pas un compte Gmail/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('E. sécurité : FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK absent des erreurs et de tout résultat public', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), marker);
    // Le token endpoint refuse ce refresh token : force une erreur à observer.
    const { fetchFn } = buildCombinedFetch(new Map());

    const client = await resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn });

    try {
      await client.listMessageIds();
      expect.unreachable();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(marker);
    }

    // Le client lui-même (objet public retourné) ne porte aucune propriété énumérable
    // exposant le refresh token — seules les méthodes du contrat GmailApiClient existent.
    // Vérifié par les trois voies usuelles de sérialisation/introspection :
    // JSON.stringify, Object.keys, String() — le champ #accessTokenProvider (M8-A10,
    // vrai champ JS privé) est structurellement invisible aux trois.
    expect(JSON.stringify(client)).not.toContain(marker);
    expect(Object.keys(client)).not.toContain('accessTokenProvider');
    expect(String(client)).not.toContain(marker);
  });

  it('F. réutilise réellement GoogleOAuthAccessTokenProvider : l’access token est mis en cache entre deux appels', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    const { fetchFn, tokenExchangeRefreshTokens } = buildCombinedFetch(
      new Map([['refresh-token-acc-1', 'access-token-acc-1']]),
    );

    const client = await resolveGmailApiClient({ account, secretStore, appCredentials: APP_CREDENTIALS, fetchFn });
    await client.listMessageIds();
    await client.listMessageIds();

    // Deux appels au client, mais un seul échange OAuth : preuve que
    // GoogleOAuthAccessTokenProvider (avec son cache) est réellement utilisé,
    // pas un mécanisme ad hoc qui ré-échangerait à chaque appel.
    expect(tokenExchangeRefreshTokens).toHaveLength(1);
  });
});
