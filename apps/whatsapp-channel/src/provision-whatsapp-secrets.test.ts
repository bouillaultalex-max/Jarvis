import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { InMemorySecretStore, type SecretStore } from '@jarvis/connectors';
import { describe, expect, it, vi } from 'vitest';

import {
  WHATSAPP_ACCESS_TOKEN_KEY,
  WHATSAPP_APP_SECRET_KEY,
  WHATSAPP_VERIFY_TOKEN_KEY,
} from './real-whatsapp-config.js';
import {
  ProvisionCancelledError,
  ProvisionStdinClosedError,
  describeProvisionOutcome,
  readMaskedLine,
  runProvisionWhatsAppSecrets,
  type ProvisionStdin,
} from './provision-whatsapp-secrets.js';

/**
 * Tests du provisionnement des secrets du mode réel WhatsApp — exclusivement
 * avec un `SecretStore` en mémoire (`InMemorySecretStore` ou un double local)
 * et un `stdin` simulé (`PassThrough`, jamais `process.stdin`). Aucun test
 * ici ne construit ni n'utilise `OsCredentialSecretStore` (le vrai
 * trousseau) — voir `provision-legifrance-secrets.test.ts`, dont ce fichier
 * reprend la structure déjà éprouvée, étendue aux trois champs WhatsApp et
 * aux deux défauts corrigés en revue (fin de stdin, redaction défensive).
 */

type FakeTty = PassThrough & { isTTY: boolean; setRawMode: ReturnType<typeof vi.fn> };

function fakeTty(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.isTTY = true;
  stream.setRawMode = vi.fn();
  return stream;
}

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

describe('readMaskedLine — saisie masquée', () => {
  it('caractère par caractère puis Entrée → valeur exacte, jamais affichée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const promise = readMaskedLine({ stdin, output }, 'prompt: ');

    stdin.write('a');
    stdin.write('b');
    stdin.write('c');
    stdin.write('\r');

    await expect(promise).resolves.toBe('abc');
    expect(readText()).not.toContain('abc');
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('collé (plusieurs caractères dans un seul chunk `data`) → traité correctement', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const promise = readMaskedLine({ stdin, output }, 'prompt: ');

    stdin.write('pasted-secret-value\r'); // un seul évènement `data`, plusieurs caractères

    await expect(promise).resolves.toBe('pasted-secret-value');
  });

  it('retour arrière retire le dernier caractère', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const promise = readMaskedLine({ stdin, output }, 'prompt: ');

    stdin.write('abc\u007f\u007fd\r'); // 'abc' puis deux retours arrière ('a') puis 'd' → 'ad'

    await expect(promise).resolves.toBe('ad');
  });

  it('Ctrl+C → ProvisionCancelledError, écouteur retiré, mode brut restauré', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const promise = readMaskedLine({ stdin, output }, 'prompt: ');

    stdin.write('ab\u0003');

    await expect(promise).rejects.toBeInstanceOf(ProvisionCancelledError);
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.listenerCount('end')).toBe(0);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("fin de stdin ('end') avant Entrée/Ctrl+C → ProvisionStdinClosedError, jamais un blocage indéfini", async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const promise = readMaskedLine({ stdin, output }, 'prompt: ');

    stdin.write('partial-no-terminator');
    stdin.end();

    await expect(promise).rejects.toBeInstanceOf(ProvisionStdinClosedError);
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.listenerCount('end')).toBe(0);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('deux lectures successives (appSecret puis verifyToken) → un seul écouteur actif à la fois, jamais accumulé', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();

    const first = readMaskedLine({ stdin, output }, 'a: ');
    stdin.write('first\r');
    await expect(first).resolves.toBe('first');
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.listenerCount('end')).toBe(0);

    const second = readMaskedLine({ stdin, output }, 'b: ');
    stdin.write('second\r');
    await expect(second).resolves.toBe('second');
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.listenerCount('end')).toBe(0);
  });
});

describe('runProvisionWhatsAppSecrets — orchestration', () => {
  it('stdin non TTY → refusé avant toute saisie, aucun appel SecretStore', async () => {
    const stdin = new PassThrough() as unknown as ProvisionStdin; // isTTY undefined (pipe)
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    const hasSpy = vi.spyOn(secretStore, 'has');

    const outcome = await runProvisionWhatsAppSecrets({ stdin, output, secretStore });

    expect(outcome).toEqual({ status: 'not_a_tty' });
    expect(hasSpy).not.toHaveBeenCalled();
  });

  it('succès → les trois clés exactes sont écrites avec les valeurs saisies, jamais confondues entre elles', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('my-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('my-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('my-access-token\r');

    const outcome = await promise;

    expect(outcome.status).toBe('written');
    if (outcome.status !== 'written') throw new Error('unreachable');
    expect(outcome.keys).toEqual([
      WHATSAPP_APP_SECRET_KEY,
      WHATSAPP_VERIFY_TOKEN_KEY,
      WHATSAPP_ACCESS_TOKEN_KEY,
    ]);
    await expect(secretStore.get(WHATSAPP_APP_SECRET_KEY)).resolves.toBe('my-app-secret');
    await expect(secretStore.get(WHATSAPP_VERIFY_TOKEN_KEY)).resolves.toBe('my-verify-token');
    await expect(secretStore.get(WHATSAPP_ACCESS_TOKEN_KEY)).resolves.toBe('my-access-token');
    // phoneNumberId n'est jamais un secret — aucune clé de ce type n'existe dans le trousseau.
    await expect(secretStore.has('whatsapp.phoneNumberId')).resolves.toBe(false);
    expect(readText()).not.toContain('my-app-secret');
    expect(readText()).not.toContain('my-verify-token');
    expect(readText()).not.toContain('my-access-token');
  });

  it('valeur vide (Entrée immédiate) pour le premier champ (appSecret) → refusée, rien écrit', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('\r');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'empty_value', label: 'appSecret' });
    await expect(secretStore.has(WHATSAPP_APP_SECRET_KEY)).resolves.toBe(false);
  });

  it('valeur vide pour le dernier champ (accessToken), les précédents valides → refusée, rien écrit du tout', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('valid-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('valid-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('\r');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'empty_value', label: 'accessToken' });
    // Aucune écriture partielle : les champs valides saisis avant le champ
    // vide ne sont jamais écrits isolément.
    await expect(secretStore.has(WHATSAPP_APP_SECRET_KEY)).resolves.toBe(false);
    await expect(secretStore.has(WHATSAPP_VERIFY_TOKEN_KEY)).resolves.toBe(false);
  });

  it('annulation (Ctrl+C) pendant la saisie du premier champ → rien écrit', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('partial\u0003');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'cancelled' });
    await expect(secretStore.has(WHATSAPP_APP_SECRET_KEY)).resolves.toBe(false);
  });

  it('fin de stdin pendant la saisie du deuxième champ → statut explicite dédié, rien écrit', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('valid-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.end();

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'stdin_closed' });
    await expect(secretStore.has(WHATSAPP_APP_SECRET_KEY)).resolves.toBe(false);
  });

  it('secret déjà présent, écrasement refusé (n) → rien écrit, valeur existante conservée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    await secretStore.set(WHATSAPP_APP_SECRET_KEY, 'existing-app-secret');

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    await vi.waitFor(() => expect(readText()).toContain('Écraser'));
    stdin.write('n\n');

    const outcome = await promise;

    expect(outcome.status).toBe('declined_overwrite');
    if (outcome.status !== 'declined_overwrite') throw new Error('unreachable');
    expect(outcome.keys).toEqual([WHATSAPP_APP_SECRET_KEY]);
    await expect(secretStore.get(WHATSAPP_APP_SECRET_KEY)).resolves.toBe('existing-app-secret');
    expect(readText()).not.toContain('existing-app-secret');
  });

  it('secret déjà présent, écrasement confirmé (y) → nouvelle valeur écrite pour les trois champs', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    await secretStore.set(WHATSAPP_APP_SECRET_KEY, 'old-app-secret');

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    await vi.waitFor(() => expect(readText()).toContain('Écraser'));
    stdin.write('y\n');
    await vi.waitFor(() => expect(readText()).toContain('App Secret'));
    stdin.write('new-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('new-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('new-access-token\r');

    const outcome = await promise;

    expect(outcome.status).toBe('written');
    await expect(secretStore.get(WHATSAPP_APP_SECRET_KEY)).resolves.toBe('new-app-secret');
    await expect(secretStore.get(WHATSAPP_VERIFY_TOKEN_KEY)).resolves.toBe('new-verify-token');
    await expect(secretStore.get(WHATSAPP_ACCESS_TOKEN_KEY)).resolves.toBe('new-access-token');
    expect(readText()).not.toContain('new-app-secret');
    expect(readText()).not.toContain('old-app-secret');
  });

  it('erreur de lecture du store (has() lève) → statut explicite dédié, JAMAIS interprétée comme « absente », arrêt avant toute saisie/écriture', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const setSpy = vi.fn(() => Promise.reject(new Error('jamais appelé')));
    const secretStore: SecretStore = {
      set: setSpy,
      get: () => Promise.reject(new Error('jamais appelé')),
      has: () => Promise.reject(new Error('trousseau indisponible')),
      delete: () => Promise.reject(new Error('jamais appelé')),
    };

    const outcome = await runProvisionWhatsAppSecrets({ stdin, output, secretStore });

    expect(outcome).toEqual({ status: 'existence_check_failed', key: WHATSAPP_APP_SECRET_KEY });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("erreur de has() contenant plusieurs valeurs sensibles → aucune ne fuit dans le résultat, l'affichage ou la sortie terminal", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const leakedSecretA = 'leaked-os-keychain-master-token';
    const leakedSecretB = 'leaked-other-account-password';
    const secretStore: SecretStore = {
      set: () => Promise.reject(new Error('jamais appelé')),
      get: () => Promise.reject(new Error('jamais appelé')),
      has: () =>
        Promise.reject(
          new Error(
            `keychain backend failure, context: token=${leakedSecretA} session=${leakedSecretB}`,
          ),
        ),
      delete: () => Promise.reject(new Error('jamais appelé')),
    };

    const outcome = await runProvisionWhatsAppSecrets({ stdin, output, secretStore });

    expect(outcome).toEqual({ status: 'existence_check_failed', key: WHATSAPP_APP_SECRET_KEY });
    for (const line of describeProvisionOutcome(outcome)) {
      expect(line).not.toContain(leakedSecretA);
      expect(line).not.toContain(leakedSecretB);
      expect(line).not.toContain('keychain backend failure');
    }
    expect(readText()).not.toContain(leakedSecretA);
    expect(readText()).not.toContain(leakedSecretB);
  });

  it("échec d'écriture (accessToken refusé par le store) → motif fixe nommant la clé, jamais le message d'origine, appSecret/verifyToken non supprimés", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const inner = new InMemorySecretStore();
    const secretStore: SecretStore = {
      set: async (key, value) => {
        if (key === WHATSAPP_ACCESS_TOKEN_KEY) {
          throw new Error('Ambiguous credential entry');
        }
        await inner.set(key, value);
      },
      get: (key) => inner.get(key),
      has: (key) => inner.has(key),
      delete: (key) => inner.delete(key),
    };

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('my-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('my-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('my-access-token\r');

    const outcome = await promise;

    expect(outcome.status).toBe('partial_failure');
    if (outcome.status !== 'partial_failure') throw new Error('unreachable');
    expect(outcome.results).toEqual([
      { key: WHATSAPP_APP_SECRET_KEY, ok: true },
      { key: WHATSAPP_VERIFY_TOKEN_KEY, ok: true },
      { key: WHATSAPP_ACCESS_TOKEN_KEY, ok: false },
    ]);
    expect(outcome.detail).not.toContain('my-access-token');
    // Motif fixe et contrôlé : jamais le message d'origine du store, même
    // inoffensif en apparence — seul le nom de la clé (non secret) apparaît.
    expect(outcome.detail).not.toContain('Ambiguous credential entry');
    expect(outcome.detail).toContain(WHATSAPP_ACCESS_TOKEN_KEY);
    await expect(inner.get(WHATSAPP_APP_SECRET_KEY)).resolves.toBe('my-app-secret');
    await expect(inner.get(WHATSAPP_VERIFY_TOKEN_KEY)).resolves.toBe('my-verify-token');
    // Pas de suppression automatique des clés déjà écrites.
    await expect(inner.has(WHATSAPP_APP_SECRET_KEY)).resolves.toBe(true);
    await expect(inner.has(WHATSAPP_VERIFY_TOKEN_KEY)).resolves.toBe(true);
  });

  it("l'exception du store contient la valeur soumise ET un autre secret sans rapport → motif fixe, aucune des deux valeurs ne fuit (retirer seulement la valeur soumise ne suffirait pas)", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const inner = new InMemorySecretStore();
    const unrelatedLeakedSecret = 'sk-unrelated-internal-token-should-never-appear';
    const secretStore: SecretStore = {
      set: async (key, value) => {
        if (key === WHATSAPP_ACCESS_TOKEN_KEY) {
          // Simule une implémentation de SecretStore buguée/adverse dont le
          // message d'erreur embarque à la fois la valeur soumise ET un
          // tout autre secret interne (ex. un jeton de session du
          // trousseau) — jamais censé arriver, mais vérifié plutôt que
          // supposé. Retirer uniquement `value` (tentative précédente,
          // revue finale) laisserait fuiter `unrelatedLeakedSecret`.
          throw new Error(
            `write failed for value "${value}" using internal credential ${unrelatedLeakedSecret}`,
          );
        }
        await inner.set(key, value);
      },
      get: (key) => inner.get(key),
      has: (key) => inner.has(key),
      delete: (key) => inner.delete(key),
    };

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('my-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('my-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('super-sensitive-token-value\r');

    const outcome = await promise;

    expect(outcome.status).toBe('partial_failure');
    if (outcome.status !== 'partial_failure') throw new Error('unreachable');
    expect(outcome.detail).not.toContain('super-sensitive-token-value');
    expect(outcome.detail).not.toContain(unrelatedLeakedSecret);
    expect(outcome.detail).not.toContain('write failed for value');
    expect(outcome.detail).toContain(WHATSAPP_ACCESS_TOKEN_KEY);

    for (const line of describeProvisionOutcome(outcome)) {
      expect(line).not.toContain('super-sensitive-token-value');
      expect(line).not.toContain(unrelatedLeakedSecret);
    }
    expect(readText()).not.toContain('super-sensitive-token-value');
    expect(readText()).not.toContain(unrelatedLeakedSecret);
  });

  it('saisie collée pour les trois champs → écrits tels quels', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionWhatsAppSecrets({ stdin, output, secretStore });
    stdin.write('pasted-app-secret\r');
    await vi.waitFor(() => expect(readText()).toContain('Verify Token'));
    stdin.write('pasted-verify-token\r');
    await vi.waitFor(() => expect(readText()).toContain('Access Token'));
    stdin.write('pasted-access-token\r');

    const outcome = await promise;

    expect(outcome.status).toBe('written');
    await expect(secretStore.get(WHATSAPP_APP_SECRET_KEY)).resolves.toBe('pasted-app-secret');
    await expect(secretStore.get(WHATSAPP_ACCESS_TOKEN_KEY)).resolves.toBe('pasted-access-token');
  });
});

describe('describeProvisionOutcome — jamais une valeur de secret', () => {
  it.each([
    { status: 'not_a_tty' } as const,
    { status: 'cancelled' } as const,
    { status: 'stdin_closed' } as const,
    { status: 'existence_check_failed', key: WHATSAPP_APP_SECRET_KEY } as const,
    { status: 'declined_overwrite', keys: [WHATSAPP_APP_SECRET_KEY] } as const,
    { status: 'empty_value', label: 'appSecret' } as const,
    {
      status: 'written',
      keys: [WHATSAPP_APP_SECRET_KEY, WHATSAPP_VERIFY_TOKEN_KEY, WHATSAPP_ACCESS_TOKEN_KEY],
    } as const,
    {
      status: 'partial_failure',
      results: [
        { key: WHATSAPP_APP_SECRET_KEY, ok: true },
        { key: WHATSAPP_ACCESS_TOKEN_KEY, ok: false },
      ],
      detail: 'Ambiguous credential entry',
    } as const,
  ])('produit au moins une ligne pour le statut %s', (outcome) => {
    const lines = describeProvisionOutcome(outcome);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('my-secret-value');
  });
});

describe('point d’entrée réel (process tsx) — sans lancer le provisionnement réel', () => {
  it('stdin non TTY (pipe) → refuse avant toute saisie, jamais un accès trousseau', () => {
    const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const SCRIPT = join(__dirname, 'provision-whatsapp-secrets.ts');

    const result = spawnSync(TSX_BIN, [SCRIPT], {
      cwd: join(__dirname, '..'),
      input: '', // pipe, pas un TTY
      encoding: 'utf8',
      timeout: 15_000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('non interactive');
  });
});
