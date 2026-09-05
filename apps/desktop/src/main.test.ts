import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AmbiguousAccountError,
  ConfirmationService,
  FileAccountStore,
  InMemoryAccountStore,
  InMemorySecretStore,
  OsCredentialSecretStore,
  connectGmailAccount,
  disconnectGmailAccount,
  gmailRefreshTokenSecretKey,
  type Account,
  type GmailAppCredentials,
  type GmailOAuthResult,
} from '@jarvis/connectors';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resolveExistingGmailConnection } from './main.js';

/**
 * M8-B3 — Cycle de vie de la persistance desktop.
 *
 * Deux groupes de tests, délibérément distincts (voir le rapport
 * d'implémentation pour la justification précise) :
 *
 *   - « décision, sans dépendance au backend OS réel » : valide la logique
 *     de `resolveExistingGmailConnection` (déjà connecté / pas encore
 *     exploitable / sélection de compte) avec `InMemorySecretStore` — cette
 *     partie ne teste PAS la persistance OS, seulement la composition
 *     `resolveAccount()`/`resolveGmailApiClient()`, exactement comme le font
 *     déjà `gmail-account-integration.test.ts`/`gmail-connection-lifecycle.test.ts`.
 *   - « persistance réelle » : `FileAccountStore` (toujours réel, aucune
 *     dépendance OS) et `OsCredentialSecretStore` (backend OS réel, sondé —
 *     voir `os-credential-secret-store.test.ts` pour le détail de ce que ce
 *     backend est réellement dans cet environnement).
 */

const APP_CREDENTIALS: GmailAppCredentials = { clientId: 'app-client-id', clientSecret: 'FAKE-APP-CLIENT-SECRET' };

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'status'>): Account {
  return {
    provider: 'gmail',
    accountIdentifier: `${overrides.id}@example.test`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function successResult(accountIdentifier: string, refreshToken: string): GmailOAuthResult {
  return { status: 'success', identity: { accountIdentifier }, refreshToken };
}

describe('resolveExistingGmailConnection — décision, sans dépendance au backend OS réel', () => {
  it('premier lancement (aucun compte) → undefined, OAuth nécessaire', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(result).toBeUndefined();
  });

  it('compte connected + secret présent → retourné, aucun nouveau OAuth', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1', status: 'connected' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-1');

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(result).toEqual(account);
  });

  it('compte disconnected → non considéré comme connecté, undefined', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1', status: 'disconnected' });
    await accountStore.register(account);
    // Un éventuel secret orphelin (scénario documenté dans gmail-connection.ts)
    // ne doit pas non plus rendre le compte exploitable.
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-1');

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(result).toBeUndefined();
  });

  it('compte error → non considéré comme connecté, undefined', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1', status: 'error' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), 'refresh-token-1');

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(result).toBeUndefined();
  });

  it('compte connected mais secret absent → non exploitable, undefined', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1', status: 'connected' });
    await accountStore.register(account);

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(result).toBeUndefined();
  });

  it('plusieurs comptes Gmail sans accountId explicite → AmbiguousAccountError propagée, aucune sélection arbitraire', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    await accountStore.register(makeAccount({ id: 'acc-A', status: 'connected' }));
    await accountStore.register(makeAccount({ id: 'acc-B', status: 'connected' }));
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');

    await expect(
      resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS }),
    ).rejects.toBeInstanceOf(AmbiguousAccountError);
  });

  it('plusieurs comptes Gmail avec accountId explicite → celui-ci est utilisé, jamais un autre', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const accountA = makeAccount({ id: 'acc-A', status: 'connected' });
    const accountB = makeAccount({ id: 'acc-B', status: 'connected' });
    await accountStore.register(accountA);
    await accountStore.register(accountB);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-A'), 'refresh-token-A');
    await secretStore.set(gmailRefreshTokenSecretKey('acc-B'), 'refresh-token-B');

    const result = await resolveExistingGmailConnection({
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      accountId: 'acc-B',
    });

    expect(result).toEqual(accountB);
  });

  it('déconnexion (disconnectGmailAccount, inchangée) puis relance → non considéré comme connecté, OAuth peut être relancé', async () => {
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const confirmationService = new ConfirmationService();
    const connected = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-1'),
      accountStore,
      secretStore,
    });
    if (connected.status !== 'connected') throw new Error('unreachable');

    await disconnectGmailAccount({ accountId: connected.accountId, accountStore, secretStore, confirmationService });

    const result = await resolveExistingGmailConnection({
      accountStore,
      secretStore,
      appCredentials: APP_CREDENTIALS,
      accountId: connected.accountId,
    });

    expect(result).toBeUndefined();
  });

  it('sécurité : le marqueur de secret n’apparaît jamais dans le résultat de résolution (compte connecté)', async () => {
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    const accountStore = new InMemoryAccountStore();
    const secretStore = new InMemorySecretStore();
    const account = makeAccount({ id: 'acc-1', status: 'connected' });
    await accountStore.register(account);
    await secretStore.set(gmailRefreshTokenSecretKey('acc-1'), marker);

    const result = await resolveExistingGmailConnection({ accountStore, secretStore, appCredentials: APP_CREDENTIALS });

    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

describe('Persistance réelle — FileAccountStore (aucune dépendance OS)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jarvis-desktop-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), 'jarvis-desktop-test-'));
  });

  it('un compte enregistré via une instance survit à une nouvelle instance pointant sur le même fichier', async () => {
    const filePath = join(dir, 'accounts.json');
    const storeA = new FileAccountStore({ filePath });
    const account = makeAccount({ id: 'acc-1', status: 'connected' });
    await storeA.register(account);

    // Nouvelle instance — simule une nouvelle exécution du process qui
    // recrée son `FileAccountStore` au démarrage, pas un redémarrage réel du
    // process (voir le rapport pour la distinction).
    const storeB = new FileAccountStore({ filePath });

    await expect(storeB.get('acc-1')).resolves.toEqual(account);
  });
});

let osBackendAvailable = false;
const OS_TEST_SERVICE = `jarvis-desktop-test-${process.pid}-${Date.now()}`;
const osTestKeys = new Set<string>();

const osProbeStore = new OsCredentialSecretStore({ service: OS_TEST_SERVICE });

beforeAll(async () => {
  const probeKey = 'backend-probe';
  try {
    await osProbeStore.set(probeKey, 'probe');
    await osProbeStore.delete(probeKey);
    osBackendAvailable = true;
  } catch (err) {
    osBackendAvailable = false;
    console.warn(
      `Tests de persistance OS (apps/desktop) ignorés : aucun backend OS exploitable ici ` +
        `(${err instanceof Error ? err.message : String(err)}). À valider sur une machine avec un vrai ` +
        `Credential Manager/Keychain/Secret Service — voir os-credential-secret-store.test.ts.`,
    );
  }
});

afterEach(async () => {
  if (!osBackendAvailable) return;
  await Promise.all([...osTestKeys].map((key) => osProbeStore.delete(key).catch(() => undefined)));
  osTestKeys.clear();
});

function osTestAccountId(): string {
  const id = randomUUID();
  osTestKeys.add(gmailRefreshTokenSecretKey(id));
  return id;
}

describe('Persistance réelle — OsCredentialSecretStore (backend OS réel requis)', () => {
  it('un refresh token écrit via une instance reste lisible depuis une nouvelle instance du même service', async ({
    skip,
  }) => {
    skip(!osBackendAvailable, 'aucun backend OS exploitable dans cet environnement');
    const accountId = osTestAccountId();
    const storeA = new OsCredentialSecretStore({ service: OS_TEST_SERVICE });
    await storeA.set(gmailRefreshTokenSecretKey(accountId), 'refresh-token-persisted');

    const storeB = new OsCredentialSecretStore({ service: OS_TEST_SERVICE });

    await expect(storeB.get(gmailRefreshTokenSecretKey(accountId))).resolves.toBe('refresh-token-persisted');
  });
});

describe('Cycle complet desktop (FileAccountStore + OsCredentialSecretStore réels — backend OS réel requis)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jarvis-desktop-e2e-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), 'jarvis-desktop-e2e-'));
  });

  it('premier lancement (connexion) puis second lancement (nouvelles instances de stores) → compte déjà connecté, aucun nouvel OAuth', async ({
    skip,
  }) => {
    skip(!osBackendAvailable, 'aucun backend OS exploitable dans cet environnement');
    const filePath = join(dir, 'accounts.json');

    // --- Premier lancement : simule le flux M8-B2 déjà réalisé, on part
    // directement d'un GmailOAuthResult (comme gmail-connection-lifecycle.test.ts)
    // plutôt que de rejouer GmailOAuthFlow, hors périmètre de ce test.
    const accountStoreRun1 = new FileAccountStore({ filePath });
    const secretStoreRun1 = new OsCredentialSecretStore({ service: OS_TEST_SERVICE });

    const connected = await connectGmailAccount({
      result: successResult('alice@example.test', 'refresh-token-e2e'),
      accountStore: accountStoreRun1,
      secretStore: secretStoreRun1,
    });
    if (connected.status !== 'connected') throw new Error('unreachable');
    osTestKeys.add(gmailRefreshTokenSecretKey(connected.accountId));

    // Vérifie l'invariant Account/SecretStore avant de simuler le redémarrage.
    expect(JSON.stringify(connected)).not.toContain('refresh-token-e2e');
    const persistedAccount = await accountStoreRun1.get(connected.accountId);
    expect(JSON.stringify(persistedAccount)).not.toContain('refresh-token-e2e');

    // --- Second lancement : nouvelles instances de stores, pointant sur le
    // même fichier/service — simule un nouveau run du process, pas un vrai
    // redémarrage OS (le service OS reste néanmoins réel, voir le rapport).
    const accountStoreRun2 = new FileAccountStore({ filePath });
    const secretStoreRun2 = new OsCredentialSecretStore({ service: OS_TEST_SERVICE });

    const resolved = await resolveExistingGmailConnection({
      accountStore: accountStoreRun2,
      secretStore: secretStoreRun2,
      appCredentials: APP_CREDENTIALS,
    });

    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe(connected.accountId);
    expect(resolved?.status).toBe('connected');
  });
});
