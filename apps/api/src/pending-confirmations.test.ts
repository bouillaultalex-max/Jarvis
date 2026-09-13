import { describe, expect, it } from 'vitest';

import type { ConfirmationPayload } from '@jarvis/connectors';

import { PendingConfirmations } from './pending-confirmations.js';

function payload(input: unknown = { mode: 'confirm' }): ConfirmationPayload {
  return {
    toolName: 'internal.fake_execute',
    action: 'execute',
    accountId: 'internal-fake-tool',
    input,
  };
}

describe('PendingConfirmations', () => {
  it('renvoie l’entrée déposée par set()', () => {
    const table = new PendingConfirmations();
    table.set('id-1', {
      payload: payload(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(table.get('id-1')).toEqual({
      payload: payload(),
      expiresAt: expect.any(String),
    });
  });

  it('renvoie undefined pour un id jamais déposé', () => {
    const table = new PendingConfirmations();
    expect(table.get('inconnu')).toBeUndefined();
  });

  it('ne court-circuite jamais vers une décision d’expiration : une entrée présente reste renvoyée même si son expiresAt local est déjà dépassé (tant que la marge de purge n’est pas écoulée)', () => {
    const now = 1_000_000;
    const table = new PendingConfirmations({ now: () => now, purgeGraceMs: 5 * 60_000 });
    const expiresAt = new Date(now - 1_000).toISOString(); // déjà "expiré" au sens ConfirmationService

    table.set('id-2', { payload: payload(), expiresAt });

    // Toujours dans la marge de purge (5 min) : l'entrée reste présente,
    // à charge pour l'appelant de la soumettre à ConfirmationService.
    expect(table.get('id-2')).toBeDefined();
  });

  it('purge une entrée seulement après expiration + marge', () => {
    let now = 1_000_000;
    const table = new PendingConfirmations({ now: () => now, purgeGraceMs: 1_000 });
    const expiresAt = new Date(now).toISOString();

    table.set('id-3', { payload: payload(), expiresAt });
    expect(table.get('id-3')).toBeDefined();

    now += 2_000; // au-delà d'expiresAt + marge
    expect(table.get('id-3')).toBeUndefined();
  });

  it('évince l’entrée la plus ancienne (FIFO) quand la limite de taille est atteinte', () => {
    const table = new PendingConfirmations({ maxSize: 2 });
    const future = new Date(Date.now() + 60_000).toISOString();

    table.set('a', { payload: payload(), expiresAt: future });
    table.set('b', { payload: payload(), expiresAt: future });
    table.set('c', { payload: payload(), expiresAt: future });

    expect(table.size()).toBe(2);
    expect(table.get('a')).toBeUndefined();
    expect(table.get('b')).toBeDefined();
    expect(table.get('c')).toBeDefined();
  });
});
