import { describe, expect, it, vi } from 'vitest';

import { SecretNotFoundError } from '../errors.js';
import { InMemorySecretStore } from '../in-memory/in-memory-secret-store.js';
import { resolveLegifranceCredentials } from './legifrance-credentials.js';

// Réutilise les constructeurs de clé purs, restés dans @jarvis/legifrance-client.
import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from '@jarvis/legifrance-client';

// Valeurs manifestement factices — jamais des credentials réels, même en test.
const FAKE_CLIENT_ID = 'test-fake-client-id-0000';
const FAKE_CLIENT_SECRET = 'test-fake-client-secret-0000';

describe('resolveLegifranceCredentials', () => {
  it('résout clientId/clientSecret depuis le SecretStore existant, sans store parallèle', async () => {
    const store = new InMemorySecretStore();
    await store.set(legifranceClientIdSecretKey('sandbox'), FAKE_CLIENT_ID);
    await store.set(legifranceClientSecretSecretKey('sandbox'), FAKE_CLIENT_SECRET);

    const credentials = await resolveLegifranceCredentials(store, 'sandbox');

    expect(credentials).toEqual({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET });
  });

  it('scinde les clés par environnement — un credential sandbox n’est jamais lu pour production', async () => {
    const store = new InMemorySecretStore();
    await store.set(legifranceClientIdSecretKey('sandbox'), 'sandbox-id');
    await store.set(legifranceClientSecretSecretKey('sandbox'), 'sandbox-secret');

    expect(legifranceClientIdSecretKey('sandbox')).not.toBe(
      legifranceClientIdSecretKey('production'),
    );
    expect(legifranceClientSecretSecretKey('sandbox')).not.toBe(
      legifranceClientSecretSecretKey('production'),
    );
    await expect(resolveLegifranceCredentials(store, 'production')).rejects.toThrowError(
      SecretNotFoundError,
    );
  });

  it('credentials absents : lève SecretNotFoundError (réutilisé, aucune nouvelle classe d’erreur)', async () => {
    const store = new InMemorySecretStore();
    await expect(resolveLegifranceCredentials(store, 'sandbox')).rejects.toThrowError(
      SecretNotFoundError,
    );
  });

  it('client_id manquant seul : lève SecretNotFoundError', async () => {
    const store = new InMemorySecretStore();
    await store.set(legifranceClientSecretSecretKey('sandbox'), FAKE_CLIENT_SECRET);

    await expect(resolveLegifranceCredentials(store, 'sandbox')).rejects.toThrowError(
      SecretNotFoundError,
    );
  });

  it('ne journalise jamais les credentials pendant la résolution', async () => {
    const store = new InMemorySecretStore();
    await store.set(legifranceClientIdSecretKey('sandbox'), FAKE_CLIENT_ID);
    await store.set(legifranceClientSecretSecretKey('sandbox'), FAKE_CLIENT_SECRET);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await resolveLegifranceCredentials(store, 'sandbox');
    } finally {
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
