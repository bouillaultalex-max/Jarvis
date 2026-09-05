import { AsyncEntry } from '@napi-rs/keyring';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { OsCredentialSecretStore } from './os-credential-secret-store.js';

/**
 * M8-B3 — Tests contre le VRAI backend d'identification du système
 * d'exploitation, via `@napi-rs/keyring` (`AsyncEntry`). Aucun mock
 * d'`AsyncEntry` nulle part dans ce fichier : un mock ne prouverait rien
 * sur une persistance OS réelle (voir M8-B3 SECRET STORE ARCHITECTURE
 * STUDY) — ce serait pire que ne pas tester du tout.
 *
 * Disponibilité du backend selon l'environnement d'exécution : sondée
 * réellement ci-dessous (`beforeAll`, un vrai `set`/`delete`), jamais
 * supposée. Constaté empiriquement sur le sandbox Linux/WSL2 utilisé pour
 * développer M8-B3 : aucun fournisseur Secret Service D-Bus
 * (`org.freedesktop.secrets`) n'y est enregistré, mais `keyring-rs` y
 * utilise malgré tout un vrai mécanisme natif du noyau Linux (trousseau de
 * clés `keyutils`, confirmé via `/proc/keys` et via une persistance
 * vérifiée à travers deux process Node **séparés**, pas seulement deux
 * instances en mémoire) — un backend OS réel, pas un mock, mais **distinct**
 * du Windows Credential Manager qui sera réellement utilisé en production.
 * Les scénarios ci-dessous s'exécutent donc réellement ici, mais la
 * validation du backend Windows reste à faire sur une machine Windows :
 *
 *   npm test -w @jarvis/connectors -- os-credential-secret-store
 *
 * Si cette suite tourne un jour dans un environnement sans aucun backend OS
 * exploitable (ni Secret Service, ni trousseau noyau, ni Keychain), le
 * sondage ci-dessous le détecte et les scénarios qui en dépendent
 * s'auto-ignorent (`ctx.skip()`, évalué à l'exécution — jamais
 * `it.skipIf()`, dont la condition est figée à la collection, donc *avant*
 * que `beforeAll` n'ait sondé quoi que ce soit) plutôt que d'être faussement
 * validés.
 */

const TEST_SERVICE = `jarvis-test-${process.pid}-${Date.now()}`;
const createdKeys = new Set<string>();

function testKey(name: string): string {
  const key = `${name}-${Math.random().toString(36).slice(2)}`;
  createdKeys.add(key);
  return key;
}

let backendAvailable = false;
let backendUnavailableReason = '';

beforeAll(async () => {
  const probeKey = testKey('backend-probe');
  try {
    const probe = new AsyncEntry(TEST_SERVICE, probeKey);
    await probe.setPassword('probe-value');
    await probe.deletePassword();
    backendAvailable = true;
  } catch (err) {
    backendAvailable = false;
    backendUnavailableReason = err instanceof Error ? err.message : String(err);
    // Diagnostic explicite dans la sortie de test : ce n'est pas un test en
    // échec, c'est l'absence documentée d'un backend OS exploitable ici.
    console.warn(
      `OsCredentialSecretStore : aucun backend OS exploitable dans cet environnement ` +
        `(${backendUnavailableReason}). Scénarios ignorés — à valider sur une machine avec un vrai ` +
        `Credential Manager/Keychain/Secret Service.`,
    );
  }
});

afterEach(async () => {
  // Nettoyage systématique, y compris après un test en échec — jamais de
  // credential de test laissé dans le magasin OS réel.
  if (!backendAvailable) return;
  await Promise.all(
    [...createdKeys].map((key) => new AsyncEntry(TEST_SERVICE, key).deletePassword().catch(() => undefined)),
  );
  createdKeys.clear();
});

describe('OsCredentialSecretStore — structurel (ne dépend d’aucun backend)', () => {
  it('ne conserve et n’expose aucun état sensible via sérialisation', () => {
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    expect(JSON.stringify(store)).not.toContain('refreshToken');
    expect(Object.keys(store)).not.toContain('secret');
    expect(Object.keys(store)).not.toContain('value');
  });
});

describe('OsCredentialSecretStore — backend OS réel', () => {
  it('set → get retrouve exactement la valeur écrite', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('set-get');

    await store.set(key, 'refresh-token-value-1');

    await expect(store.get(key)).resolves.toBe('refresh-token-value-1');
  });

  it('set → has renvoie true', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('set-has');

    await store.set(key, 'value');

    await expect(store.has(key)).resolves.toBe(true);
  });

  it('delete → get renvoie undefined ensuite', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('delete-then-get');
    await store.set(key, 'value');

    await store.delete(key);

    await expect(store.get(key)).resolves.toBeUndefined();
  });

  it('delete sur une clé absente ne lève aucune exception', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('delete-absent');

    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it('has sur une clé absente renvoie false', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('has-absent');

    await expect(store.has(key)).resolves.toBe(false);
  });

  it('deux clés distinctes du même service sont isolées l’une de l’autre', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const keyA = testKey('isolation-a');
    const keyB = testKey('isolation-b');

    await store.set(keyA, 'value-a');
    await store.set(keyB, 'value-b');

    await expect(store.get(keyA)).resolves.toBe('value-a');
    await expect(store.get(keyB)).resolves.toBe('value-b');
  });

  it('deux instances utilisant le même service retrouvent le même credential (aucun état partagé côté JS)', async ({
    skip,
  }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const key = testKey('cross-instance');
    const storeA = new OsCredentialSecretStore({ service: TEST_SERVICE });
    await storeA.set(key, 'value-cross-instance');

    // Nouvelle instance logique du wrapper (pas un nouveau process OS — voir
    // le rapport pour la distinction précise). Aucun état n'est partagé
    // entre les deux instances JS : la valeur ne peut venir que du magasin
    // OS lui-même.
    const storeB = new OsCredentialSecretStore({ service: TEST_SERVICE });

    await expect(storeB.get(key)).resolves.toBe('value-cross-instance');
  });

  it('un échec d’écriture éventuel ne fait jamais fuiter le secret dans le message d’erreur', async ({ skip }) => {
    skip(!backendAvailable, backendUnavailableReason);
    const store = new OsCredentialSecretStore({ service: TEST_SERVICE });
    const key = testKey('oversized');
    const marker = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';
    // Valeur très supérieure à la limite connue de certains magasins OS (ex.
    // 2560 octets pour Windows Credential Manager) : tentative de provoquer
    // un vrai échec natif plutôt que d'en simuler un.
    const oversizedValue = marker + 'x'.repeat(10_000);

    try {
      await store.set(key, oversizedValue);
      // Cette plateforme/ce backend accepte la valeur : rien à vérifier côté
      // erreur pour ce cas précis (couvert par ailleurs par les tests
      // set/get/delete standards).
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(marker);
    }
  });
});
