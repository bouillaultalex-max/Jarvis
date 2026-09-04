import { describe, expect, it } from 'vitest';

import { SecretNotFoundError } from '../errors.js';
import { requireSecret } from '../secret-store.js';
import { InMemorySecretStore } from './in-memory-secret-store.js';

const FAKE_SECRET_VALUE = 'FAKE-SECRET-VALUE-NOT-REAL-abc123';

describe('InMemorySecretStore', () => {
  it('set() puis get() renvoie la valeur stockée', async () => {
    const store = new InMemorySecretStore();

    await store.set('gmail.acc-1.refreshToken', FAKE_SECRET_VALUE);

    await expect(store.get('gmail.acc-1.refreshToken')).resolves.toBe(FAKE_SECRET_VALUE);
  });

  it('has() reflète la présence d’un secret', async () => {
    const store = new InMemorySecretStore();
    expect(await store.has('k')).toBe(false);

    await store.set('k', FAKE_SECRET_VALUE);
    expect(await store.has('k')).toBe(true);
  });

  it('delete() retire un secret existant', async () => {
    const store = new InMemorySecretStore();
    await store.set('k', FAKE_SECRET_VALUE);

    await store.delete('k');

    expect(await store.has('k')).toBe(false);
    await expect(store.get('k')).resolves.toBeUndefined();
  });

  it('delete() sur une clé absente ne lève pas', async () => {
    const store = new InMemorySecretStore();
    await expect(store.delete('never-set')).resolves.toBeUndefined();
  });

  it('get() sur une clé absente renvoie undefined (ne lève pas)', async () => {
    const store = new InMemorySecretStore();
    await expect(store.get('absent')).resolves.toBeUndefined();
  });

  it('requireSecret() lève SecretNotFoundError pour une clé absente, sans citer de valeur', async () => {
    const store = new InMemorySecretStore();

    await expect(requireSecret(store, 'absent-key')).rejects.toThrowError(SecretNotFoundError);
    try {
      await requireSecret(store, 'absent-key');
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretNotFoundError);
      expect((err as SecretNotFoundError).secretKey).toBe('absent-key');
      expect((err as Error).message).not.toContain(FAKE_SECRET_VALUE);
    }
  });

  it('requireSecret() renvoie la valeur quand le secret existe', async () => {
    const store = new InMemorySecretStore();
    await store.set('k', FAKE_SECRET_VALUE);

    await expect(requireSecret(store, 'k')).resolves.toBe(FAKE_SECRET_VALUE);
  });
});
