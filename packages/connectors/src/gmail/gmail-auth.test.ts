import { describe, expect, it, vi } from 'vitest';
import { PermissionManager } from '@jarvis/core';

import type { Account } from '../account.js';
import { SecretNotFoundError } from '../errors.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import type { SecretStore } from '../secret-store.js';
import {
  GoogleOAuthAccessTokenProvider,
  loadGmailCredentialsFromEnv,
  gmailRefreshTokenSecretKey,
  resolveGmailCredentials,
} from './gmail-auth.js';
import type { GmailAppCredentials, GmailCredentials } from './gmail-auth.js';

const CREDENTIALS: GmailCredentials = {
  clientId: 'fake-client-id',
  clientSecret: 'FAKE-CLIENT-SECRET-NOT-REAL',
  refreshToken: 'FAKE-REFRESH-TOKEN-NOT-REAL',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleOAuthAccessTokenProvider — aucun appel réseau réel (fetchFn mocké)', () => {
  it('échange le refresh token contre un access token', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }),
    );
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    const token = await provider.getAccessToken();

    expect(token).toBe('access-token-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init?.body)).toContain('grant_type=refresh_token');
  });

  it('met en cache l’access token et ne re-sollicite pas l’endpoint avant expiration', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }));
    let now = 0;
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn, now: () => now });

    await provider.getAccessToken();
    now += 1000; // bien avant expiration
    await provider.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('renouvelle automatiquement l’access token une fois expiré', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return jsonResponse(200, { access_token: `access-token-${call}`, expires_in: 3600 });
    });
    let now = 0;
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn, now: () => now });

    const first = await provider.getAccessToken();
    now += 3600_000 + 1; // au-delà de l'expiration + marge de sécurité
    const second = await provider.getAccessToken();

    expect(first).toBe('access-token-1');
    expect(second).toBe('access-token-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('authentification invalide (refresh token refusé) : erreur claire, sans fuite de secret', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant' }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/renouvellement.*refusé/);
    try {
      await provider.getAccessToken();
      expect.unreachable();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(CREDENTIALS.clientSecret);
      expect(message).not.toContain(CREDENTIALS.refreshToken);
    }
  });

  it('réponse sans access_token exploitable : erreur explicite', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { expires_in: 3600 }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/access_token/);
  });

  it('échec réseau (fetchFn qui lève) : erreur explicite, jamais un access token', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('DNS lookup failed');
    });
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await expect(provider.getAccessToken()).rejects.toThrow(/échec réseau/);
  });

  it('revoke() appelle l’endpoint de révocation et efface le cache local', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-token-2', expires_in: 3600 }));
    const provider = new GoogleOAuthAccessTokenProvider({ credentials: CREDENTIALS, fetchFn });

    await provider.getAccessToken();
    await provider.revoke();
    const tokenAfterRevoke = await provider.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe('https://oauth2.googleapis.com/revoke');
    expect(tokenAfterRevoke).toBe('access-token-2');
  });

  it('sécurité (M8-A10) : JSON.stringify/Object.keys/String() n’exposent jamais clientSecret ni refreshToken', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const credentials: GmailCredentials = {
      clientId: 'app-client-id',
      clientSecret: 'FAKE_CLIENT_SECRET_SHOULD_NEVER_LEAK',
      refreshToken: marker,
    };
    const provider = new GoogleOAuthAccessTokenProvider({ credentials });

    // #credentials est un vrai champ JS privé (M8-A10) : invisible aux trois
    // voies usuelles de sérialisation/introspection, avant même tout appel réseau.
    expect(JSON.stringify(provider)).not.toContain(marker);
    expect(JSON.stringify(provider)).not.toContain(credentials.clientSecret);
    // tokenEndpoint/revokeEndpoint/fetchFn/now/cached restent des champs
    // TypeScript-private ordinaires (non sensibles) : seul #credentials doit
    // être absent de l'énumération.
    expect(Object.keys(provider)).not.toContain('credentials');
    expect(String(provider)).not.toContain(marker);
  });
});

describe('loadGmailCredentialsFromEnv', () => {
  it('charge les credentials depuis un objet env fourni explicitement', () => {
    const credentials = loadGmailCredentialsFromEnv({
      GMAIL_CLIENT_ID: ' client-id ',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
    });

    expect(credentials).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    });
  });

  it('rejette si une variable requise est absente, sans jamais faire de réseau', () => {
    expect(() => loadGmailCredentialsFromEnv({})).toThrow(/GMAIL_CLIENT_ID/);
    expect(() =>
      loadGmailCredentialsFromEnv({ GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y' }),
    ).toThrow(/GMAIL_REFRESH_TOKEN/);
  });
});

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

const APP_CREDENTIALS: GmailAppCredentials = { clientId: 'app-client-id', clientSecret: 'FAKE-APP-CLIENT-SECRET' };

describe('gmailRefreshTokenSecretKey — convention centralisée (M8-A8)', () => {
  it('produit la clé « gmail.{accountId}.refreshToken »', () => {
    expect(gmailRefreshTokenSecretKey('acc-1')).toBe('gmail.acc-1.refreshToken');
  });
});

describe('resolveGmailCredentials — M8-A8', () => {
  it('résolution nominale : credentials correctement assemblés depuis Account + SecretStore', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');

    const credentials = await resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS });

    expect(credentials).toEqual({
      clientId: 'app-client-id',
      clientSecret: 'FAKE-APP-CLIENT-SECRET',
      refreshToken: 'refresh-token-acc-1',
    });
  });

  it('secret absent : SecretNotFoundError, message sans aucun secret', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();

    await expect(
      resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);

    try {
      await resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SecretNotFoundError);
      expect((err as Error).message).toContain(gmailRefreshTokenSecretKey('acc-1'));
    }
  });

  it('mauvais provider : un Account non-Gmail est refusé, aucun secret lu', async () => {
    const account = makeAccount({ id: 'acc-1', provider: 'discord' });
    const secretStore = new InMemorySecretStore();
    const getSpy = vi.spyOn(secretStore, 'get');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');

    await expect(
      resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS }),
    ).rejects.toThrow(/n'est pas un compte Gmail/);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('accountId vide : refus explicite, aucun secret lu', async () => {
    const account = makeAccount({ id: '' });
    const secretStore = new InMemorySecretStore();
    const getSpy = vi.spyOn(secretStore, 'get');

    await expect(
      resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS }),
    ).rejects.toThrow(/account\.id/);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('cross-account isolation : chaque compte ne récupère que son propre refresh token, jamais mélangés', async () => {
    const accountA = makeAccount({ id: 'acc-A' });
    const accountB = makeAccount({ id: 'acc-B' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');

    const credentialsA = await resolveGmailCredentials({
      account: accountA,
      secretStore,
      appCredentials: APP_CREDENTIALS,
    });
    const credentialsB = await resolveGmailCredentials({
      account: accountB,
      secretStore,
      appCredentials: APP_CREDENTIALS,
    });

    expect(credentialsA.refreshToken).toBe('refresh-token-A');
    expect(credentialsB.refreshToken).toBe('refresh-token-B');
    expect(credentialsA.refreshToken).not.toBe(credentialsB.refreshToken);
  });

  it('sécurité : le marqueur FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK n’apparaît jamais dans Account ni dans une erreur', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), marker);

    const credentials = await resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS });

    // Présence légitime : c'est la donnée que le mécanisme OAuth existant doit consommer.
    expect(credentials.refreshToken).toBe(marker);
    // Jamais dans l'objet métier public Account, ni dans son sérialisé (metadata inclus).
    expect(JSON.stringify(account)).not.toContain(marker);

    const otherAccount = makeAccount({ id: 'acc-2' });
    try {
      await resolveGmailCredentials({ account: otherAccount, secretStore, appCredentials: APP_CREDENTIALS });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(marker);
    }
  });

  it('Account reste immuable : la résolution ne le modifie jamais', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const snapshotBefore = { ...account };
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');

    await resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS });

    expect(account).toEqual(snapshotBefore);
  });

  it('invariant permission : totalement indépendant de PermissionManager, aucun Tool exécuté', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1');
    // Une politique qui refuse tout : resolveGmailCredentials n'appelle jamais
    // PermissionManager/ToolExecutor, donc une politique "deny" n'a aucun effet ici.
    const permissions = new PermissionManager({ default: 'deny' });

    const credentials = await resolveGmailCredentials({ account, secretStore, appCredentials: APP_CREDENTIALS });

    expect(credentials.refreshToken).toBe('refresh-token-acc-1');
    expect(permissions.decide('gmail.send', 'execute')).toBe('deny');
  });

  it('n’utilise que le contrat SecretStore (aucune dépendance à RefreshTokenStore)', async () => {
    const account = makeAccount({ id: 'acc-1' });
    const secrets = new Map<string, string>([[gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-acc-1']]);
    // Implémentation minimale du seul contrat SecretStore — ne porte aucune des
    // méthodes de RefreshTokenStore (load/save/clear) : prouve que
    // resolveGmailCredentials ne dépend que de SecretStore.
    const minimalSecretStore: SecretStore = {
      async set(key, value) {
        secrets.set(key, value);
      },
      async get(key) {
        return secrets.get(key);
      },
      async delete(key) {
        secrets.delete(key);
      },
      async has(key) {
        return secrets.has(key);
      },
    };

    const credentials = await resolveGmailCredentials({
      account,
      secretStore: minimalSecretStore,
      appCredentials: APP_CREDENTIALS,
    });

    expect(credentials.refreshToken).toBe('refresh-token-acc-1');
  });
});
