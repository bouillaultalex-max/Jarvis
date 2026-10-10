import { describe, expect, it } from 'vitest';

import { sendResponse } from './send-response.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';

describe('sendResponse', () => {
  it('transport ok → replied', async () => {
    const transport = new SimulatedOutboundTransport({ status: 'sent' });
    const result = await sendResponse({ recipientId: 'r1', text: 'bonjour' }, { transport });
    expect(result).toEqual({ status: 'replied' });
    expect(transport.sentMessages).toEqual([{ recipientId: 'r1', text: 'bonjour' }]);
  });

  it('transport error (échec démontré) → transport_error', async () => {
    const transport = new SimulatedOutboundTransport({ status: 'error', reason: 'rejet 4xx' });
    const result = await sendResponse({ recipientId: 'r1', text: 'x' }, { transport });
    expect(result).toEqual({ status: 'transport_error', reason: 'rejet 4xx' });
  });

  it('transport uncertain → transport_uncertain (jamais failed)', async () => {
    const transport = new SimulatedOutboundTransport({ status: 'uncertain', reason: 'timeout' });
    const result = await sendResponse({ recipientId: 'r1', text: 'x' }, { transport });
    expect(result).toEqual({ status: 'transport_uncertain', reason: 'timeout' });
  });

  it("exception inattendue du transport → processing_error, PAS failed : ne prouve aucune absence d'envoi", async () => {
    const throwingTransport = {
      async send(): Promise<never> {
        throw new Error('connexion interrompue après envoi possible');
      },
    };
    const result = await sendResponse(
      { recipientId: 'r1', text: 'x' },
      { transport: throwingTransport },
    );
    expect(result).toEqual({
      status: 'processing_error',
      reason: 'connexion interrompue après envoi possible',
    });
  });
});
