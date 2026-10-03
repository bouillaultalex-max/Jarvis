import type { OutboundTransport, TransportResult } from './channel-ports.js';

/**
 * Transport **simulé** — ne constitue PAS une implémentation de l'API Graph
 * WhatsApp et ne doit jamais être présenté ou déployé comme tel. N'effectue
 * strictement aucun appel réseau ; enregistre uniquement les envois pour
 * inspection par les tests/l'exploitation locale.
 *
 * Un transport réseau réel (authentifié par `accessToken`/`phoneNumberId`
 * contre l'API Graph WhatsApp) est une étape ultérieure explicitement hors
 * périmètre de cette tranche — voir le rapport d'intégration.
 */
export class SimulatedOutboundTransport implements OutboundTransport {
  public readonly sentMessages: Array<{ readonly recipientId: string; readonly text: string }> = [];

  constructor(private readonly result: TransportResult = { status: 'sent' }) {}

  async send(input: {
    readonly recipientId: string;
    readonly text: string;
  }): Promise<TransportResult> {
    this.sentMessages.push({ recipientId: input.recipientId, text: input.text });
    return this.result;
  }
}
