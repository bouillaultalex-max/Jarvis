import { InMemorySecretStore, SecretNotFoundError } from '@jarvis/connectors';
import { describe, expect, it } from 'vitest';

import {
  IncompleteRealConfigError,
  resolveRealWhatsAppConfig,
  WHATSAPP_ACCESS_TOKEN_KEY,
  WHATSAPP_APP_SECRET_KEY,
  WHATSAPP_VERIFY_TOKEN_KEY,
} from './real-whatsapp-config.js';

const FAKE_APP_SECRET = 'fake-app-secret-never-real';
const FAKE_VERIFY_TOKEN = 'fake-verify-token-never-real';
const FAKE_ACCESS_TOKEN = 'fake-access-token-never-real';

async function buildCompleteSecretStore(): Promise<InMemorySecretStore> {
  const store = new InMemorySecretStore();
  await store.set(WHATSAPP_APP_SECRET_KEY, FAKE_APP_SECRET);
  await store.set(WHATSAPP_VERIFY_TOKEN_KEY, FAKE_VERIFY_TOKEN);
  await store.set(WHATSAPP_ACCESS_TOKEN_KEY, FAKE_ACCESS_TOKEN);
  return store;
}

const COMPLETE_ENV = {
  WHATSAPP_GRAPH_API_VERSION: 'v26.0',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ALLOWED_SENDER_ID: '33600000001',
};

describe('resolveRealWhatsAppConfig — configuration complète', () => {
  it('résout toutes les valeurs depuis le SecretStore et l’environnement injectés, jamais codées en dur', async () => {
    const store = await buildCompleteSecretStore();
    const config = await resolveRealWhatsAppConfig(store, COMPLETE_ENV);
    expect(config).toEqual({
      appSecret: FAKE_APP_SECRET,
      verifyToken: FAKE_VERIFY_TOKEN,
      accessToken: FAKE_ACCESS_TOKEN,
      phoneNumberId: COMPLETE_ENV.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: COMPLETE_ENV.WHATSAPP_GRAPH_API_VERSION,
      allowedSenderId: COMPLETE_ENV.WHATSAPP_ALLOWED_SENDER_ID,
    });
  });
});

describe('resolveRealWhatsAppConfig — configuration incomplète, aucun repli synthétique', () => {
  it('secret manquant (ex. accessToken) → SecretNotFoundError, jamais une valeur par défaut', async () => {
    const store = new InMemorySecretStore();
    await store.set(WHATSAPP_APP_SECRET_KEY, FAKE_APP_SECRET);
    await store.set(WHATSAPP_VERIFY_TOKEN_KEY, FAKE_VERIFY_TOKEN);
    // accessToken volontairement absent.
    await expect(resolveRealWhatsAppConfig(store, COMPLETE_ENV)).rejects.toThrow(
      SecretNotFoundError,
    );
  });

  it('variable d’environnement manquante (ex. WHATSAPP_PHONE_NUMBER_ID) → IncompleteRealConfigError', async () => {
    const store = await buildCompleteSecretStore();
    const incompleteEnv = { ...COMPLETE_ENV, WHATSAPP_PHONE_NUMBER_ID: undefined };
    await expect(resolveRealWhatsAppConfig(store, incompleteEnv)).rejects.toThrow(
      IncompleteRealConfigError,
    );
  });

  it('variable d’environnement vide (chaîne vide) est traitée comme absente', async () => {
    const store = await buildCompleteSecretStore();
    await expect(
      resolveRealWhatsAppConfig(store, { ...COMPLETE_ENV, WHATSAPP_ALLOWED_SENDER_ID: '' }),
    ).rejects.toThrow(IncompleteRealConfigError);
  });

  it('aucune des erreurs ne cite jamais une valeur de secret, seulement un nom de clé/variable', async () => {
    const store = new InMemorySecretStore();
    try {
      await resolveRealWhatsAppConfig(store, COMPLETE_ENV);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SecretNotFoundError);
      const message = (err as Error).message;
      expect(message).not.toContain(FAKE_APP_SECRET);
      expect(message).not.toContain(FAKE_ACCESS_TOKEN);
      expect(message).toContain(WHATSAPP_APP_SECRET_KEY);
    }

    try {
      await resolveRealWhatsAppConfig(await buildCompleteSecretStore(), {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteRealConfigError);
      expect((err as Error).message).not.toContain(FAKE_ACCESS_TOKEN);
    }
  });
});
