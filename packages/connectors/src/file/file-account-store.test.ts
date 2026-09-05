import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAccount, type Account } from '../account.js';
import { AccountStoreCorruptedError, AmbiguousAccountError, UnknownAccountError } from '../errors.js';
import { FileAccountStore } from './file-account-store.js';

const FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'provider' | 'accountIdentifier'>): Account {
  return {
    displayName: undefined,
    status: 'connected',
    metadata: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-file-account-store-'));
  filePath = join(dir, 'accounts.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileAccountStore — fonctionnement', () => {
  it('register() puis get()', async () => {
    const store = new FileAccountStore({ filePath });
    const account = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });

    await store.register(account);

    await expect(store.get('acc-1')).resolves.toEqual(account);
    await expect(store.has('acc-1')).resolves.toBe(true);
  });

  it('list()', async () => {
    const store = new FileAccountStore({ filePath });
    const a = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' });
    const b = makeAccount({ id: 'acc-2', provider: 'slack', accountIdentifier: 'team-x' });
    await store.register(a);
    await store.register(b);

    await expect(store.list()).resolves.toEqual(expect.arrayContaining([a, b]));
    await expect(store.list()).resolves.toHaveLength(2);
  });

  it('listByProvider()', async () => {
    const store = new FileAccountStore({ filePath });
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
    const slack = makeAccount({ id: 'acc-3', provider: 'slack', accountIdentifier: 'team-x' });
    await store.register(personal);
    await store.register(work);
    await store.register(slack);

    await expect(store.listByProvider('google')).resolves.toEqual(expect.arrayContaining([personal, work]));
    await expect(store.listByProvider('google')).resolves.toHaveLength(2);
  });

  it('register() met à jour (upsert) un compte existant plutôt que de dupliquer', async () => {
    const store = new FileAccountStore({ filePath });
    const original = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' });
    const updated = makeAccount({
      id: 'acc-1',
      provider: 'google',
      accountIdentifier: 'a@example.test',
      status: 'error',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    await store.register(original);
    await store.register(updated);

    await expect(store.list()).resolves.toHaveLength(1);
    await expect(store.get('acc-1')).resolves.toEqual(updated);
  });

  it('persistance après register() : le contenu survit sur disque', async () => {
    const store = new FileAccountStore({ filePath });
    await store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' }));

    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].id).toBe('acc-1');
  });

  it('un nouveau FileAccountStore relit ce qu’un précédent a écrit (redémarrage simulé)', async () => {
    const first = new FileAccountStore({ filePath });
    await first.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' }));

    const second = new FileAccountStore({ filePath });
    await expect(second.get('acc-1')).resolves.toMatchObject({ id: 'acc-1', provider: 'google' });
    await expect(second.list()).resolves.toHaveLength(1);
  });

  it('resolveAccount() fonctionne sur FileAccountStore comme sur n’importe quel AccountStore', async () => {
    const store = new FileAccountStore({ filePath });
    const personal = makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'perso@example.test' });
    const work = makeAccount({ id: 'acc-2', provider: 'google', accountIdentifier: 'pro@example.test' });
    await store.register(personal);
    await store.register(work);

    await expect(resolveAccount(store, { provider: 'google', accountId: 'acc-2' })).resolves.toEqual(work);
    await expect(resolveAccount(store, { provider: 'google' })).rejects.toThrowError(AmbiguousAccountError);
    await expect(resolveAccount(store, { provider: 'discord' })).rejects.toThrowError(UnknownAccountError);
  });
});

describe('FileAccountStore — gestion du fichier', () => {
  it('fichier absent : traité comme un store vide, aucun fichier créé par une simple lecture', async () => {
    const store = new FileAccountStore({ filePath });

    await expect(store.list()).resolves.toEqual([]);
    await expect(store.has('anything')).resolves.toBe(false);
    await expect(store.get('anything')).rejects.toThrowError(UnknownAccountError);

    await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
  });

  it('fichier vide : traité comme une corruption (AccountStoreCorruptedError « empty_file »), jamais comme un store vide', async () => {
    await writeFile(filePath, '', 'utf-8');
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('empty_file');
  });

  it('JSON invalide : AccountStoreCorruptedError « invalid_json »', async () => {
    await writeFile(filePath, '{ not valid json', 'utf-8');
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('invalid_json');
  });

  it('version inconnue : AccountStoreCorruptedError « unknown_version », aucune tentative de migration', async () => {
    await writeFile(filePath, JSON.stringify({ version: 2, accounts: [] }), 'utf-8');
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('unknown_version');
  });

  it('version absente : traitée comme une version inconnue', async () => {
    await writeFile(filePath, JSON.stringify({ accounts: [] }), 'utf-8');
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('unknown_version');
  });

  it('structure invalide : racine non objet, ou « accounts » absent/non-tableau', async () => {
    const store = new FileAccountStore({ filePath });

    await writeFile(filePath, JSON.stringify(['not', 'an', 'object']), 'utf-8');
    let err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('invalid_structure');

    await writeFile(filePath, JSON.stringify({ version: 1, accounts: 'not-an-array' }), 'utf-8');
    err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('invalid_structure');
  });

  it('account invalide : champ requis manquant → AccountStoreCorruptedError « invalid_structure », rien n’est chargé silencieusement', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, accounts: [{ id: 'acc-1' /* provider, accountIdentifier… manquants */ }] }),
      'utf-8',
    );
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('invalid_structure');
  });

  it('account invalide : status hors énumération → AccountStoreCorruptedError « invalid_structure »', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            id: 'acc-1',
            provider: 'google',
            accountIdentifier: 'a@example.test',
            status: 'bogus-status',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      'utf-8',
    );
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as AccountStoreCorruptedError).reason).toBe('invalid_structure');
  });
});

describe('FileAccountStore — écriture atomique', () => {
  it('après register(), aucun fichier temporaire résiduel ne reste dans le dossier', async () => {
    const store = new FileAccountStore({ filePath });
    await store.register(makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' }));

    const entries = await readdir(dir);
    expect(entries).toEqual(['accounts.json']);
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});

describe('FileAccountStore — concurrence', () => {
  it('des register() concurrents sur la même instance ne s’écrasent jamais entre eux', async () => {
    const store = new FileAccountStore({ filePath });
    const accounts = Array.from({ length: 10 }, (_, i) =>
      makeAccount({ id: `acc-${i}`, provider: 'google', accountIdentifier: `user${i}@example.test` }),
    );

    await Promise.all(accounts.map((account) => store.register(account)));

    const list = await store.list();
    expect(list).toHaveLength(10);
    expect(new Set(list.map((a) => a.id))).toEqual(new Set(accounts.map((a) => a.id)));

    // Le fichier final doit rester un JSON valide (pas d'écritures entrelacées).
    const raw = await readFile(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('FileAccountStore — sécurité : aucun credential ne peut transiter par ce format', () => {
  it('un champ superflu porté par un objet "Account"-like n’est jamais écrit sur disque', async () => {
    const store = new FileAccountStore({ filePath });
    const accountWithBogusField = {
      ...makeAccount({ id: 'acc-1', provider: 'google', accountIdentifier: 'a@example.test' }),
      refreshToken: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
    } as unknown as Account;

    await store.register(accountWithBogusField);

    const raw = await readFile(filePath, 'utf-8');
    expect(raw).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });

  it('un champ superflu déjà présent dans le fichier JSON n’est jamais recopié dans l’Account lu (list/get)', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            id: 'acc-1',
            provider: 'google',
            accountIdentifier: 'a@example.test',
            status: 'connected',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            refreshToken: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
          },
        ],
      }),
      'utf-8',
    );
    const store = new FileAccountStore({ filePath });

    const list = await store.list();
    expect(JSON.stringify(list)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
    expect(list[0]).not.toHaveProperty('refreshToken');

    const account = await store.get('acc-1');
    expect(JSON.stringify(account)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
    expect(account).not.toHaveProperty('refreshToken');
  });

  it('aucune erreur levée par ce module ne cite jamais le marqueur de secret', async () => {
    await writeFile(filePath, `not json at all ${FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK}`, 'utf-8');
    const store = new FileAccountStore({ filePath });

    const err = await store.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountStoreCorruptedError);
    expect((err as Error).message).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });
});
