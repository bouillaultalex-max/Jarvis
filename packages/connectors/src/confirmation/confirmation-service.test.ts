import { describe, expect, it } from 'vitest';

import {
  ConfirmationService,
  UnsupportedConfirmationInputError,
  type ConfirmationPayload,
} from './confirmation-service.js';

const FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK = 'FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK';

function payload(overrides: Partial<ConfirmationPayload> = {}): ConfirmationPayload {
  return {
    toolName: 'gmail.send',
    action: 'execute',
    accountId: 'acc-1',
    input: { to: 'a@example.test', subject: 's', body: 'b' },
    ...overrides,
  };
}

describe('ConfirmationService — création et vérification', () => {
  it('create() renvoie un confirmationId opaque et une date d’expiration', async () => {
    const service = new ConfirmationService();
    const ticket = await service.create(payload());

    expect(typeof ticket.confirmationId).toBe('string');
    expect(ticket.confirmationId.length).toBeGreaterThan(0);
    expect(new Date(ticket.expiresAt).toISOString()).toBe(ticket.expiresAt);
  });

  it('verify() avec exactement le même payload → succès', async () => {
    const service = new ConfirmationService();
    const p = payload();
    const ticket = await service.create(p);

    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({ ok: true });
  });
});

describe('ConfirmationService — expiration (horloge injectable)', () => {
  it('maintenant < expiration → valide', async () => {
    let now = 1_000_000;
    const service = new ConfirmationService({ ttlMs: 60_000, now: () => now });
    const p = payload();
    const ticket = await service.create(p);

    now += 59_999; // juste avant expiration
    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({ ok: true });
  });

  it('maintenant = expiration → invalide', async () => {
    let now = 1_000_000;
    const service = new ConfirmationService({ ttlMs: 60_000, now: () => now });
    const p = payload();
    const ticket = await service.create(p);

    now += 60_000; // exactement à l'expiration
    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('maintenant > expiration → invalide', async () => {
    let now = 1_000_000;
    const service = new ConfirmationService({ ttlMs: 60_000, now: () => now });
    const p = payload();
    const ticket = await service.create(p);

    now += 60_001;
    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('ConfirmationService — deny()', () => {
  it('après deny(), verify() échoue systématiquement, même avec le bon payload', async () => {
    const service = new ConfirmationService();
    const p = payload();
    const ticket = await service.create(p);

    await service.deny(ticket.confirmationId);

    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
  });

  it('deny() sur un id inconnu est un no-op silencieux (idempotent)', async () => {
    const service = new ConfirmationService();
    await expect(service.deny('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('ConfirmationService — revokeForAccount()', () => {
  it('révoque toutes les confirmations pending du compte visé, jamais celles d’un autre compte', async () => {
    const service = new ConfirmationService();
    const payloadA = payload({ accountId: 'acc-A' });
    const payloadB = payload({ accountId: 'acc-B' });
    const ticketA = await service.create(payloadA);
    const ticketB = await service.create(payloadB);

    await service.revokeForAccount('acc-A');

    await expect(service.verify(ticketA.confirmationId, payloadA)).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    });
    await expect(service.verify(ticketB.confirmationId, payloadB)).resolves.toEqual({ ok: true });
  });
});

describe('ConfirmationService — binding strict (Tool / action / compte / payload)', () => {
  it('mauvais Tool → échec', async () => {
    const service = new ConfirmationService();
    const p = payload({ toolName: 'gmail.send' });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, { ...p, toolName: 'gmail.other_tool' }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('mauvaise action → échec', async () => {
    const service = new ConfirmationService();
    const p = payload({ action: 'execute' });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, { ...p, action: 'prepare' }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });

  it('mauvais compte → échec', async () => {
    const service = new ConfirmationService();
    const p = payload({ accountId: 'acc-A' });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, { ...p, accountId: 'acc-B' }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });

  it('payload (input) modifié → échec, y compris un champ ajouté/changé', async () => {
    const service = new ConfirmationService();
    const p = payload({ input: { to: 'a@example.test', subject: 's', body: 'texte original' } });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, {
        ...p,
        input: { ...(p.input as object), body: 'texte modifié' },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'payload_mismatch' });
  });

  it('input identique mais ordre de propriétés différent → succès (canonicalisation)', async () => {
    const service = new ConfirmationService();
    const p = payload({ input: { to: 'a@example.test', subject: 's' } });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, {
        ...p,
        input: { subject: 's', to: 'a@example.test' },
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('tableau réordonné dans input → échec', async () => {
    const service = new ConfirmationService();
    const p = payload({ input: { to: ['a@example.test', 'b@example.test'] } });
    const ticket = await service.create(p);

    await expect(
      service.verify(ticket.confirmationId, {
        ...p,
        input: { to: ['b@example.test', 'a@example.test'] },
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('ConfirmationService — token', () => {
  it('token absent/inconnu → échec (« not_found »)', async () => {
    const service = new ConfirmationService();
    await expect(service.verify('this-token-was-never-created', payload())).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('tokens opaques et imprévisibles : jamais deux identiques, longueur cohérente avec 256 bits aléatoires', async () => {
    const service = new ConfirmationService();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const ticket = await service.create(payload());
      ids.add(ticket.confirmationId);
    }
    expect(ids.size).toBe(50);
    for (const id of ids) {
      // base64url de 32 octets = 43 caractères, sans padding.
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('ConfirmationService — single-use', () => {
  it('un verify() réussi consomme la confirmation : un second verify() identique échoue', async () => {
    const service = new ConfirmationService();
    const p = payload();
    const ticket = await service.create(p);

    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({ ok: true });
    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({
      ok: false,
      reason: 'already_consumed',
    });
  });
});

describe('ConfirmationService — concurrence', () => {
  it('N vérifications concurrentes du même token : exactement une réussit', async () => {
    const service = new ConfirmationService();
    const p = payload();
    const ticket = await service.create(p);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.verify(ticket.confirmationId, p)),
    );

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);
    expect(failures.every((r) => !r.ok && r.reason === 'already_consumed')).toBe(true);
  });
});

describe('ConfirmationService — indépendance de Gmail/UI', () => {
  it('fonctionne pour un Tool et un provider entièrement génériques, sans rien de spécifique à Gmail', async () => {
    const service = new ConfirmationService();
    const p: ConfirmationPayload = {
      toolName: 'calendar.create_event',
      action: 'execute',
      accountId: 'acc-generic-provider',
      input: { title: 'Réunion', attendees: ['x@example.test'] },
    };
    const ticket = await service.create(p);

    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({ ok: true });
  });
});

describe('ConfirmationService — redémarrage simulé', () => {
  it('une nouvelle instance ne connaît rien des confirmations d’une instance précédente', async () => {
    const serviceA = new ConfirmationService();
    const ticket = await serviceA.create(payload());

    const serviceB = new ConfirmationService();
    await expect(serviceB.verify(ticket.confirmationId, payload())).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('ConfirmationService — sécurité : aucune fuite de donnée sensible', () => {
  it('le marqueur de secret présent dans le payload ne fuit jamais dans le ticket, ni dans un résultat d’échec', async () => {
    const service = new ConfirmationService();
    const p = payload({
      input: { to: 'a@example.test', body: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK },
    });
    const ticket = await service.create(p);

    expect(JSON.stringify(ticket)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);

    const mismatch = await service.verify(ticket.confirmationId, { ...p, accountId: 'other' });
    expect(JSON.stringify(mismatch)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);

    const notFound = await service.verify('unknown-token', p);
    expect(JSON.stringify(notFound)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });

  it('JSON.stringify(service) et String(service) ne révèlent aucun état interne (champs #privés)', async () => {
    const service = new ConfirmationService();
    await service.create(payload({ input: { body: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK } }));

    expect(JSON.stringify(service)).toBe('{}');
    expect(Object.keys(service)).toEqual([]);
    expect(String(service)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });

  it('le message d’échec est générique, identique pour toutes les causes, jamais dérivé du contenu', async () => {
    const service = new ConfirmationService();
    const p = payload({ input: { body: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK } });
    const ticket = await service.create(p);

    const { describeConfirmationFailure } = await import('./confirmation-service.js');
    const mismatch = await service.verify(ticket.confirmationId, { ...p, accountId: 'other' });
    if (!mismatch.ok) {
      expect(describeConfirmationFailure(mismatch.reason)).toBe('Invalid or expired confirmation');
    } else {
      throw new Error('unreachable: attendu un échec');
    }
  });
});

describe('ConfirmationService — contrat strict de `input` (confirmation-input-contract.ts)', () => {
  it('create() avec un input non pris en charge (accesseur) rejette sans créer de ticket, sans jamais invoquer l’accesseur', async () => {
    const service = new ConfirmationService();
    let getterCalls = 0;
    const badInput: Record<string, unknown> = {};
    Object.defineProperty(badInput, 'x', {
      get() {
        getterCalls += 1;
        return 'leaked';
      },
      enumerable: true,
    });

    await expect(service.create(payload({ input: badInput }))).rejects.toThrow(
      UnsupportedConfirmationInputError,
    );
    expect(getterCalls).toBe(0);

    // Le service reste utilisable normalement ensuite : aucun état corrompu.
    const goodTicket = await service.create(payload());
    await expect(service.verify(goodTicket.confirmationId, payload())).resolves.toEqual({
      ok: true,
    });
  });

  it('create() avec un BigInt imbriqué rejette sans créer de ticket', async () => {
    const service = new ConfirmationService();
    await expect(
      service.create(payload({ input: { amount: 10n } as unknown as Record<string, unknown> })),
    ).rejects.toThrow(UnsupportedConfirmationInputError);
  });

  it('verify() avec un input non pris en charge au moment de la confirmation → payload_mismatch, ticket non consommé, accesseur jamais invoqué', async () => {
    const service = new ConfirmationService();
    const p = payload();
    const ticket = await service.create(p);

    let getterCalls = 0;
    const badInput: Record<string, unknown> = {};
    Object.defineProperty(badInput, 'x', {
      get() {
        getterCalls += 1;
        return 'leaked';
      },
      enumerable: true,
    });

    const result = await service.verify(ticket.confirmationId, { ...p, input: badInput });

    expect(result).toEqual({ ok: false, reason: 'payload_mismatch' });
    expect(getterCalls).toBe(0);

    // Le ticket original n'a pas été consommé par cette tentative invalide —
    // il reste utilisable avec le payload réellement approuvé.
    await expect(service.verify(ticket.confirmationId, p)).resolves.toEqual({ ok: true });
  });
});
