import { describe, expect, it, vi } from 'vitest';

import { GraphApiOutboundTransport, type AccessTokenProvider } from './graph-api-transport.js';

const FAKE_TOKEN = 'EAA-fake-access-token-never-real-1234567890';

class FakeAccessTokenProvider implements AccessTokenProvider {
  public callCount = 0;
  constructor(private readonly token = FAKE_TOKEN) {}
  async getAccessToken(): Promise<string> {
    this.callCount += 1;
    return this.token;
  }
}

class ThrowingAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    throw new Error('trousseau indisponible');
  }
}

function jsonResponse(status: number, ok: boolean, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function unreadableJsonResponse(status: number, ok: boolean): Response {
  return {
    ok,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  } as unknown as Response;
}

/** Simule un `fetch` dont la promesse ne se résout/rejette qu'au déclenchement du signal fourni — utile pour simuler un abandon pendant l'attente des en-têtes. */
function hangingUntilAbortedFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
}

/** `fetch` qui résout vite (en-têtes reçus) mais dont `.json()` reste bloqué jusqu'au même signal — simule un corps de réponse qui ne vient jamais. */
function respondingThenHangingOnJsonFetch(status = 200, ok = true): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    const response = {
      ok,
      status,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    };
    return Promise.resolve(response as unknown as Response);
  });
}

const SUCCESS_BODY = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '+16505551234', wa_id: '16505551234' }],
  messages: [{ id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI4MjZGRDA0OUE2OTQ3RkEyMzcA' }],
};

const ERROR_BODY = {
  error: {
    message: 'Invalid parameter',
    type: 'OAuthException',
    code: 100,
    error_data: { messaging_product: 'whatsapp', details: 'to is not a valid phone number' },
    error_subcode: 2018001,
    fbtrace_id: 'AbCdEfGhIjKlMnOp',
  },
};

function buildTransport(
  fetchImpl: ReturnType<typeof vi.fn>,
  configOverrides: Partial<ConstructorParameters<typeof GraphApiOutboundTransport>[0]> = {},
  tokenProvider: AccessTokenProvider = new FakeAccessTokenProvider(),
) {
  const transport = new GraphApiOutboundTransport(
    { apiVersion: 'v25.0', phoneNumberId: '106540352242922', ...configOverrides },
    tokenProvider,
    fetchImpl as unknown as typeof fetch,
  );
  return { transport, tokenProvider };
}

describe('GraphApiOutboundTransport — configuration validée à la construction', () => {
  it('apiVersion de forme invalide → lève à la construction, jamais de send() possible', () => {
    expect(
      () =>
        new GraphApiOutboundTransport(
          { apiVersion: 'pas-une-version', phoneNumberId: '106540352242922' },
          new FakeAccessTokenProvider(),
          vi.fn() as unknown as typeof fetch,
        ),
    ).toThrow(/apiVersion/);
  });

  it("apiVersion contenant un chemin/hôte injecté → lève (aucune déviation d'URL possible)", () => {
    expect(
      () =>
        new GraphApiOutboundTransport(
          { apiVersion: 'v25.0/../evil.test', phoneNumberId: '106540352242922' },
          new FakeAccessTokenProvider(),
          vi.fn() as unknown as typeof fetch,
        ),
    ).toThrow();
  });

  it('phoneNumberId non numérique → lève à la construction', () => {
    expect(
      () =>
        new GraphApiOutboundTransport(
          { apiVersion: 'v25.0', phoneNumberId: 'abc' },
          new FakeAccessTokenProvider(),
          vi.fn() as unknown as typeof fetch,
        ),
    ).toThrow(/phoneNumberId/);
  });

  it('phoneNumberId tentant une injection de chemin ("/") → lève', () => {
    expect(
      () =>
        new GraphApiOutboundTransport(
          { apiVersion: 'v25.0', phoneNumberId: '123/../../evil' },
          new FakeAccessTokenProvider(),
          vi.fn() as unknown as typeof fetch,
        ),
    ).toThrow();
  });
});

describe('GraphApiOutboundTransport — payload et endpoint exacts', () => {
  it("construit l'URL, la méthode, les en-têtes et le corps conformes au contrat vérifié", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY));
    const { transport } = buildTransport(fetchImpl);

    const result = await transport.send({ recipientId: '16505551234', text: 'Bonjour' });

    expect(result).toEqual({ status: 'sent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v25.0/106540352242922/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${FAKE_TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '16505551234',
      type: 'text',
      text: { body: 'Bonjour' },
    });
  });

  it('respecte baseUrl surchargée (tests uniquement)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY));
    const { transport } = buildTransport(fetchImpl, { baseUrl: 'https://example.test' });
    await transport.send({ recipientId: '16505551234', text: 'x' });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://example.test/v25.0/106540352242922/messages');
  });
});

describe('GraphApiOutboundTransport — validation locale (avant tout appel réseau)', () => {
  it('corps vide → error, fetch jamais appelé', async () => {
    const fetchImpl = vi.fn();
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: '' });
    expect(result.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('corps trop long (maxBodyLength configuré) → error, motif distingue explicitement une limite LOCALE, pas Meta', async () => {
    const fetchImpl = vi.fn();
    const { transport } = buildTransport(fetchImpl, { maxBodyLength: 5 });
    const result = await transport.send({
      recipientId: '16505551234',
      text: 'texte bien trop long',
    });
    expect(result.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
    if (result.status === 'error') {
      expect(result.reason).toMatch(/LOCALE/);
      expect(result.reason).toMatch(/PAS une limite officielle Meta/);
    }
  });

  it('sans maxBodyLength configuré, aucune limite de longueur imposée (non vérifiée officiellement)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x'.repeat(5000) });
    expect(result.status).toBe('sent');
  });

  it('destinataire syntaxiquement invalide → error, fetch jamais appelé', async () => {
    const fetchImpl = vi.fn();
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: 'pas-un-numero', text: 'x' });
    expect(result.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['espace en tête', ' 16505551234'],
    ['espace en fin', '16505551234 '],
    ['espace au milieu', '1650 5551234'],
  ])(
    'destinataire avec %s → error, jamais nettoyé silencieusement, fetch jamais appelé',
    async (_label, recipientId) => {
      const fetchImpl = vi.fn();
      const { transport } = buildTransport(fetchImpl);
      const result = await transport.send({ recipientId, text: 'x' });
      expect(result.status).toBe('error');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("jeton d'accès indisponible → error, fetch jamais appelé (aucun envoi tenté)", async () => {
    const fetchImpl = vi.fn();
    const { transport } = buildTransport(fetchImpl, {}, new ThrowingAccessTokenProvider());
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
    if (result.status === 'error') {
      expect(result.reason).not.toContain(FAKE_TOKEN);
    }
  });
});

describe('GraphApiOutboundTransport — succès conforme au contrat', () => {
  it('réponse 200 conforme → sent', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result).toEqual({ status: 'sent' });
  });
});

describe('GraphApiOutboundTransport — refus fournisseur explicite (échec certain)', () => {
  it("400 avec corps d'erreur Graph API conforme → error, motif issu de Meta uniquement", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, false, ERROR_BODY));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('100');
      expect(result.reason).toContain('Invalid parameter');
    }
  });

  it('429 (limite de débit) → error, échec certain (rejet explicite avant tout traitement)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, false, {
        error: { message: 'Cloud API message throughput has been reached', code: 130429 },
      }),
    );
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('error');
  });

  it('400 avec JSON illisible → error (le code HTTP explicite reste un signal de rejet, même sans détail exploitable)', async () => {
    const fetchImpl = vi.fn(async () => unreadableJsonResponse(400, false));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('error');
  });
});

describe('GraphApiOutboundTransport — ruptures après invocation de fetch (issue incertaine, jamais un échec certain)', () => {
  it("fetch rejette pour une raison réseau quelconque (pas un abandon) → uncertain, jamais 'error'", async () => {
    // Une exception de fetch (ECONNRESET, DNS, etc.) ne prouve jamais que
    // la requête n'a pas atteint le fournisseur — voir l'en-tête du fichier.
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNRESET');
    });
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
  });

  it("500 (erreur serveur fournisseur) → uncertain : le fournisseur a répondu, mais rien ne prouve l'envoi ni son absence", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, false, { error: { message: 'Internal error', code: 1 } }),
    );
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
  });

  it('503 → uncertain, même raisonnement que 500', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, false, { error: { message: 'Down' } }));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
  });
});

describe('GraphApiOutboundTransport — réponses malformées (succès apparent)', () => {
  it('200 mais JSON illisible → uncertain (une réponse a bien été reçue)', async () => {
    const fetchImpl = vi.fn(async () => unreadableJsonResponse(200, true));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
  });

  it('200 mais forme de succès non conforme au contrat → uncertain, jamais sent par présomption', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, { messaging_product: 'whatsapp' }));
    const { transport } = buildTransport(fetchImpl);
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
  });
});

describe('GraphApiOutboundTransport — délai borné de bout en bout', () => {
  it("timeout pendant l'attente des en-têtes → uncertain, jamais présenté comme une preuve de non-envoi", async () => {
    const fetchImpl = hangingUntilAbortedFetch();
    const { transport } = buildTransport(fetchImpl, { timeoutMs: 15 });
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
    expect(result.status === 'uncertain' && result.reason).not.toMatch(
      /non envoyé|pas envoyé|échoué|annulé côté fournisseur/i,
    );
  });

  it('timeout pendant la LECTURE DU CORPS (en-têtes déjà reçus, .json() ne se résout jamais) → uncertain', async () => {
    // Preuve que le délai couvre aussi la lecture du corps, pas seulement
    // l'obtention des en-têtes : `fetch` résout vite, mais `.json()` reste
    // bloqué jusqu'au même signal d'abandon.
    const fetchImpl = respondingThenHangingOnJsonFetch();
    const { transport } = buildTransport(fetchImpl, { timeoutMs: 15 });
    const result = await transport.send({ recipientId: '16505551234', text: 'x' });
    expect(result.status).toBe('uncertain');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('GraphApiOutboundTransport — absence de retry automatique', () => {
  it('un seul appel fetch, quel que soit le résultat (succès, erreur, incertain)', async () => {
    for (const fetchImpl of [
      vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY)),
      vi.fn(async () => jsonResponse(400, false, ERROR_BODY)),
      vi.fn(async () => jsonResponse(500, false, { error: { message: 'x' } })),
      vi.fn(async () => unreadableJsonResponse(200, true)),
    ]) {
      const { transport } = buildTransport(fetchImpl);
      await transport.send({ recipientId: '16505551234', text: 'x' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe('GraphApiOutboundTransport — absence de fuite du jeton', () => {
  it("le jeton n'apparaît jamais dans un résultat, succès ou échec, certain ou incertain", async () => {
    const scenarios = [
      jsonResponse(200, true, SUCCESS_BODY),
      jsonResponse(400, false, ERROR_BODY),
      jsonResponse(500, false, { error: { message: 'x' } }),
      jsonResponse(200, true, { messaging_product: 'whatsapp' }),
      unreadableJsonResponse(200, true),
    ];
    for (const response of scenarios) {
      const fetchImpl = vi.fn(async () => response);
      const { transport } = buildTransport(fetchImpl);
      const result = await transport.send({ recipientId: '16505551234', text: 'x' });
      expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    }
  });

  it("le jeton n'apparaît pas dans le résultat d'un timeout (en-têtes ou corps)", async () => {
    for (const fetchImpl of [hangingUntilAbortedFetch(), respondingThenHangingOnJsonFetch()]) {
      const { transport } = buildTransport(fetchImpl, { timeoutMs: 10 });
      const result = await transport.send({ recipientId: '16505551234', text: 'x' });
      expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    }
  });

  it('getAccessToken() est résolu à chaque envoi, jamais mis en cache par le transport', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, true, SUCCESS_BODY));
    const { transport, tokenProvider } = buildTransport(fetchImpl);
    await transport.send({ recipientId: '16505551234', text: 'x' });
    await transport.send({ recipientId: '16505551234', text: 'y' });
    expect((tokenProvider as FakeAccessTokenProvider).callCount).toBe(2);
  });
});
