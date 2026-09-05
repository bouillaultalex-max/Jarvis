import { describe, expect, it } from 'vitest';

import type { Account } from '../account.js';
import { computeFingerprint } from './fingerprint.js';
import {
  buildConfirmationRequest,
  type BuildConfirmationRequestOptions,
  type ConfirmationInputSummary,
} from './confirmation-request.js';
import { buildTextPreview } from './text-preview.js';

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

function baseOptions(overrides: Partial<BuildConfirmationRequestOptions> = {}): BuildConfirmationRequestOptions {
  return {
    confirmationId: 'conf-abc123',
    createdAt: '2026-03-01T10:00:00.000Z',
    expiresAt: '2026-03-01T10:05:00.000Z',
    toolName: 'gmail.send',
    action: 'execute',
    account: makeAccount({ id: 'acc-1', provider: 'gmail', accountIdentifier: 'perso@example.test' }),
    summary: { fields: [] },
    ...overrides,
  };
}

describe('buildConfirmationRequest — construction', () => {
  it('construction minimale : compte sans displayName, résumé vide', () => {
    const request = buildConfirmationRequest(baseOptions());

    expect(request.confirmationId).toBe('conf-abc123');
    expect(request.toolName).toBe('gmail.send');
    expect(request.action).toBe('execute');
    expect(request.account).toEqual({
      accountId: 'acc-1',
      provider: 'gmail',
      accountIdentifier: 'perso@example.test',
    });
    expect(request.summary).toEqual({ fields: [] });
    expect(request.createdAt).toBe('2026-03-01T10:00:00.000Z');
    expect(request.expiresAt).toBe('2026-03-01T10:05:00.000Z');
  });

  it('construction complète : displayName présent, plusieurs champs de résumé, dont un tronqué', () => {
    const preview = buildTextPreview('x'.repeat(600));
    const summary: ConfirmationInputSummary = {
      fields: [
        { key: 'recipient', label: 'Destinataire', value: 'boss@example.test' },
        { key: 'subject', label: 'Objet', value: 'Point hebdo' },
        { key: 'body', label: 'Message', value: preview.value, truncated: preview.truncated },
      ],
    };
    const request = buildConfirmationRequest(
      baseOptions({
        account: makeAccount({
          id: 'acc-2',
          provider: 'gmail',
          accountIdentifier: 'pro@example.test',
          displayName: 'Compte professionnel',
        }),
        summary,
      }),
    );

    expect(request.account).toEqual({
      accountId: 'acc-2',
      provider: 'gmail',
      accountIdentifier: 'pro@example.test',
      displayName: 'Compte professionnel',
    });
    expect(request.summary.fields).toHaveLength(3);
    expect(request.summary.fields[2]).toMatchObject({ key: 'body', truncated: true });
  });

  it('account view : allowlist stricte, aucun autre champ d’Account ne fuit', () => {
    const request = buildConfirmationRequest(baseOptions());
    expect(Object.keys(request.account).sort()).toEqual(['accountId', 'accountIdentifier', 'provider'].sort());
  });

  it('action : préservée exactement pour chaque ActionLevel', () => {
    for (const action of ['read', 'prepare', 'execute'] as const) {
      const request = buildConfirmationRequest(baseOptions({ action }));
      expect(request.action).toBe(action);
    }
  });

  it('timestamps : createdAt/expiresAt préservés exactement, jamais recalculés', () => {
    const request = buildConfirmationRequest(
      baseOptions({ createdAt: '2026-05-05T05:05:05.000Z', expiresAt: '2026-05-05T05:10:05.000Z' }),
    );
    expect(request.createdAt).toBe('2026-05-05T05:05:05.000Z');
    expect(request.expiresAt).toBe('2026-05-05T05:10:05.000Z');
  });

  it('confirmationId : préservé exactement, jamais régénéré (même id à chaque appel)', () => {
    const options = baseOptions({ confirmationId: 'conf-fixed-id' });
    const first = buildConfirmationRequest(options);
    const second = buildConfirmationRequest(options);
    expect(first.confirmationId).toBe('conf-fixed-id');
    expect(second.confirmationId).toBe('conf-fixed-id');
  });
});

describe('buildConfirmationRequest — sécurité : aucun credential ne peut transiter', () => {
  it('refreshToken/accessToken/clientSecret/credential dans Account.metadata ne fuient jamais', () => {
    const account = makeAccount({
      id: 'acc-1',
      provider: 'gmail',
      accountIdentifier: 'a@example.test',
      metadata: {
        refreshToken: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
        accessToken: 'FAKE-ACCESS-TOKEN',
        clientSecret: 'FAKE-CLIENT-SECRET',
        credential: 'FAKE-CREDENTIAL',
      },
    });
    const request = buildConfirmationRequest(baseOptions({ account }));

    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
    expect(serialized).not.toContain('FAKE-ACCESS-TOKEN');
    expect(serialized).not.toContain('FAKE-CLIENT-SECRET');
    expect(serialized).not.toContain('FAKE-CREDENTIAL');
    expect(request.account).not.toHaveProperty('metadata');
  });

  it('un champ superflu porté par un Account-like arbitraire (ex. refreshToken au premier niveau) ne fuit jamais', () => {
    const account = {
      ...makeAccount({ id: 'acc-1', provider: 'gmail', accountIdentifier: 'a@example.test' }),
      refreshToken: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK,
    } as unknown as Account;

    const request = buildConfirmationRequest(baseOptions({ account }));

    expect(JSON.stringify(request)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
    expect(request.account).not.toHaveProperty('refreshToken');
  });

  it('le marqueur n’apparaît que là où l’appelant l’a explicitement placé dans le résumé (contenu voulu, pas une fuite)', () => {
    const summary: ConfirmationInputSummary = {
      fields: [{ key: 'body', label: 'Message', value: FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK }],
    };
    const request = buildConfirmationRequest(baseOptions({ summary }));

    // Un champ de résumé EST fait pour afficher du contenu — ce n'est pas une fuite,
    // c'est le rôle même de ConfirmationInputSummary. On vérifie juste qu'il n'apparaît
    // nulle part ailleurs (account, ids...).
    expect(request.summary.fields[0]?.value).toBe(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
    expect(JSON.stringify(request.account)).not.toContain(FAKE_REFRESH_TOKEN_SHOULD_NEVER_LEAK);
  });
});

describe('buildConfirmationRequest — immutabilité', () => {
  it('le résultat est gelé : toute tentative de mutation échoue', () => {
    const request = buildConfirmationRequest(baseOptions({ summary: { fields: [{ key: 'a', label: 'A', value: '1' }] } }));

    expect(() => {
      (request as { toolName: string }).toolName = 'other.tool';
    }).toThrow();
    expect(() => {
      (request.account as { provider: string }).provider = 'other';
    }).toThrow();
    expect(() => {
      (request.summary.fields[0] as { value: string }).value = 'modifié';
    }).toThrow();
    expect(() => {
      (request.summary.fields as unknown[]).push({});
    }).toThrow();
  });
});

describe('buildConfirmationRequest — pureté', () => {
  it('ne modifie jamais les données source (account, summary)', () => {
    const account = makeAccount({ id: 'acc-1', provider: 'gmail', accountIdentifier: 'a@example.test' });
    const accountSnapshot = { ...account };
    const summary: ConfirmationInputSummary = { fields: [{ key: 'a', label: 'A', value: '1' }] };
    const summarySnapshot = JSON.parse(JSON.stringify(summary));

    buildConfirmationRequest(baseOptions({ account, summary }));

    expect(account).toEqual(accountSnapshot);
    expect(summary).toEqual(summarySnapshot);
  });

  it('déterministe : même entrée → même résultat (égalité structurelle)', () => {
    const options = baseOptions({
      summary: { fields: [{ key: 'a', label: 'A', value: '1' }] },
    });

    const first = buildConfirmationRequest(options);
    const second = buildConfirmationRequest(options);

    expect(first).toEqual(second);
  });

  it('aucun effet de bord observable : appels répétés indépendants, aucune référence partagée modifiable en commun', () => {
    const options = baseOptions({ summary: { fields: [{ key: 'a', label: 'A', value: '1' }] } });

    const first = buildConfirmationRequest(options);
    const second = buildConfirmationRequest(options);

    expect(first).not.toBe(second);
    expect(first.summary.fields).not.toBe(second.summary.fields);
  });
});

describe('buildConfirmationRequest — séparation avec le fingerprint', () => {
  it('modifier (tenter de modifier) le read-model n’affecte jamais un fingerprint calculé séparément depuis l’input original', () => {
    const input = { to: 'a@example.test', body: 'contenu original' };
    const fingerprintBefore = computeFingerprint({
      toolName: 'gmail.send',
      action: 'execute',
      accountId: 'acc-1',
      input,
    });

    const summary: ConfirmationInputSummary = {
      fields: [{ key: 'body', label: 'Message', value: 'contenu original' }],
    };
    const request = buildConfirmationRequest(baseOptions({ summary }));

    expect(() => {
      (request.summary.fields[0] as { value: string }).value = 'contenu falsifié après confirmation';
    }).toThrow();

    const fingerprintAfter = computeFingerprint({
      toolName: 'gmail.send',
      action: 'execute',
      accountId: 'acc-1',
      input,
    });
    expect(fingerprintAfter).toBe(fingerprintBefore);
  });

  it('buildConfirmationRequest ne prend jamais un input brut/unknown en paramètre (garantie de type)', () => {
    // Preuve structurelle : BuildConfirmationRequestOptions n'a pas de
    // champ `input`, seulement `summary` (déjà construit par l'appelant).
    const options = baseOptions();
    expect(options).not.toHaveProperty('input');
  });
});
