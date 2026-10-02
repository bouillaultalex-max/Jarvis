import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { InMemorySecretStore, type SecretStore } from '@jarvis/connectors';
import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from '@jarvis/legifrance-client';
import { describe, expect, it, vi } from 'vitest';

import {
  ProvisionCancelledError,
  describeProvisionOutcome,
  readMaskedLine,
  runProvisionLegifranceSecrets,
  type ProvisionStdin,
} from './provision-legifrance-secrets.js';

/**
 * Tests du provisionnement des secrets sandbox Légifrance — exclusivement
 * avec un `SecretStore` en mémoire et un `stdin` simulé (`PassThrough`,
 * jamais `process.stdin`). Aucun test ici n'accède au trousseau OS réel.
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
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('deux lectures successives (clientId puis clientSecret) → un seul écouteur actif à la fois, jamais accumulé', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();

    const first = readMaskedLine({ stdin, output }, 'a: ');
    stdin.write('first\r');
    await expect(first).resolves.toBe('first');
    expect(stdin.listenerCount('data')).toBe(0);

    const second = readMaskedLine({ stdin, output }, 'b: ');
    stdin.write('second\r');
    await expect(second).resolves.toBe('second');
    expect(stdin.listenerCount('data')).toBe(0);
  });
});

describe('runProvisionLegifranceSecrets — orchestration', () => {
  it('stdin non TTY → refusé avant toute saisie, aucun appel SecretStore', async () => {
    const stdin = new PassThrough() as unknown as ProvisionStdin; // isTTY undefined (pipe)
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    const hasSpy = vi.spyOn(secretStore, 'has');

    const outcome = await runProvisionLegifranceSecrets({ stdin, output, secretStore });

    expect(outcome).toEqual({ status: 'not_a_tty' });
    expect(hasSpy).not.toHaveBeenCalled();
  });

  it('valeur vide (Entrée immédiate) pour clientId → refusée, rien écrit', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    stdin.write('\r');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'empty_value', label: 'clientId' });
    await expect(secretStore.has(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(false);
  });

  it('valeur vide pour clientSecret (clientId valide, clientSecret vide) → refusée, rien écrit', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    stdin.write('some-id\r');
    await vi.waitFor(() => expect(readText()).toContain('client_secret'));
    stdin.write('\r');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'empty_value', label: 'clientSecret' });
    await expect(secretStore.has(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(false);
  });

  it('annulation (Ctrl+C) pendant la saisie de clientId → rien écrit', async () => {
    const stdin = fakeTty();
    const { output } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    stdin.write('partial\u0003');

    const outcome = await promise;

    expect(outcome).toEqual({ status: 'cancelled' });
    await expect(secretStore.has(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(false);
  });

  it('secret déjà présent, écrasement refusé (n) → rien écrit, valeur existante conservée', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    await secretStore.set(legifranceClientIdSecretKey('sandbox'), 'existing-id');

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    await vi.waitFor(() => expect(readText()).toContain('Écraser'));
    stdin.write('n\n');

    const outcome = await promise;

    expect(outcome.status).toBe('declined_overwrite');
    await expect(secretStore.get(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(
      'existing-id',
    );
    expect(readText()).not.toContain('existing-id');
  });

  it('secret déjà présent, écrasement confirmé (y) → nouvelle valeur écrite', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();
    await secretStore.set(legifranceClientIdSecretKey('sandbox'), 'old-id');

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    await vi.waitFor(() => expect(readText()).toContain('Écraser'));
    stdin.write('y\n');
    await vi.waitFor(() => expect(readText()).toContain('client_id'));
    stdin.write('new-id\r');
    await vi.waitFor(() => expect(readText()).toContain('client_secret'));
    stdin.write('new-secret\r');

    const outcome = await promise;

    expect(outcome.status).toBe('written');
    await expect(secretStore.get(legifranceClientIdSecretKey('sandbox'))).resolves.toBe('new-id');
    await expect(secretStore.get(legifranceClientSecretSecretKey('sandbox'))).resolves.toBe(
      'new-secret',
    );
    expect(readText()).not.toContain('new-secret');
  });

  it('saisie collée pour clientId et clientSecret → écrits tels quels', async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const secretStore = new InMemorySecretStore();

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    stdin.write('pasted-client-id\r');
    await vi.waitFor(() => expect(readText()).toContain('client_secret'));
    stdin.write('pasted-client-secret\r');

    const outcome = await promise;

    expect(outcome.status).toBe('written');
    await expect(secretStore.get(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(
      'pasted-client-id',
    );
    await expect(secretStore.get(legifranceClientSecretSecretKey('sandbox'))).resolves.toBe(
      'pasted-client-secret',
    );
  });

  it("échec partiel d'écriture (clientSecret refusé par le SecretStore) → message clair sans valeur, clientId non supprimé", async () => {
    const stdin = fakeTty();
    const { output, readText } = collectingOutput();
    const inner = new InMemorySecretStore();
    const secretStore: SecretStore = {
      set: async (key, value) => {
        if (key === legifranceClientSecretSecretKey('sandbox')) {
          throw new Error('Ambiguous credential entry');
        }
        await inner.set(key, value);
      },
      get: (key) => inner.get(key),
      has: (key) => inner.has(key),
      delete: (key) => inner.delete(key),
    };

    const promise = runProvisionLegifranceSecrets({ stdin, output, secretStore });
    stdin.write('my-id\r');
    await vi.waitFor(() => expect(readText()).toContain('client_secret'));
    stdin.write('my-secret\r');

    const outcome = await promise;

    expect(outcome.status).toBe('partial_failure');
    if (outcome.status !== 'partial_failure') throw new Error('unreachable');
    expect(outcome.clientId).toBe('written');
    expect(outcome.clientSecret).toBe('failed');
    expect(outcome.detail).not.toContain('my-secret');
    await expect(inner.get(legifranceClientIdSecretKey('sandbox'))).resolves.toBe('my-id');
    // Pas de suppression automatique de la clé déjà écrite.
    await expect(inner.has(legifranceClientIdSecretKey('sandbox'))).resolves.toBe(true);
  });
});

describe('describeProvisionOutcome — jamais une valeur de secret', () => {
  it.each([
    { status: 'not_a_tty' } as const,
    { status: 'cancelled' } as const,
    { status: 'declined_overwrite', keys: ['legifrance.sandbox.clientId'] } as const,
    { status: 'empty_value', label: 'clientId' } as const,
    {
      status: 'written',
      clientIdKey: 'legifrance.sandbox.clientId',
      clientSecretKey: 'legifrance.sandbox.clientSecret',
    } as const,
    {
      status: 'partial_failure',
      clientId: 'written',
      clientSecret: 'failed',
      detail: 'Ambiguous credential entry',
    } as const,
  ])('produit au moins une ligne pour le statut %s', (outcome) => {
    const lines = describeProvisionOutcome(outcome);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('my-secret');
  });
});

describe('point d’entrée réel (process tsx) — sans lancer le provisionnement réel', () => {
  it('stdin non TTY (pipe) → refuse avant toute saisie, jamais un accès trousseau', () => {
    const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const SCRIPT = join(__dirname, 'provision-legifrance-secrets.ts');

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
