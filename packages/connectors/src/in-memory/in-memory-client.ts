/**
 * "Client déjà authentifié" fictif, entièrement local.
 *
 * Sert uniquement à valider l'architecture des connecteurs (injection d'un
 * client, séparation credential/Tool) sans réseau ni OAuth réel. Les données
 * sont en mémoire, réinitialisées à chaque instanciation.
 */

export interface InMemoryMessage {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

export interface InMemorySentMessage {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

const DEFAULT_MESSAGES: readonly InMemoryMessage[] = [
  { id: 'msg-1', from: 'alice@example.test', subject: 'Bonjour', body: 'Comment ça va ?' },
  { id: 'msg-2', from: 'bob@example.test', subject: 'Réunion', body: 'On se voit demain ?' },
];

export class InMemoryMailClient {
  readonly #inbox: InMemoryMessage[];
  readonly #sent: InMemorySentMessage[] = [];
  /**
   * Marqueur fictif représentant "un secret" côté client authentifié
   * (jamais un vrai token). N'existe que pour prouver, dans les tests, qu'un
   * `Tool` ne renvoie ni ne transmet jamais ce que porte le client.
   */
  readonly #fakeAuthMarker = 'FAKE-LOCAL-CREDENTIAL-MARKER-NOT-A-REAL-SECRET';

  constructor(seedMessages: readonly InMemoryMessage[] = DEFAULT_MESSAGES) {
    this.#inbox = [...seedMessages];
  }

  listInbox(): readonly InMemoryMessage[] {
    return [...this.#inbox];
  }

  findById(id: string): InMemoryMessage | undefined {
    return this.#inbox.find((m) => m.id === id);
  }

  /** Mutation réelle (mais 100% locale) : simule l'envoi d'un message. */
  send(message: { to: string; subject: string; body: string }): InMemorySentMessage {
    const sent: InMemorySentMessage = {
      id: `sent-${this.#sent.length + 1}`,
      ...message,
    };
    this.#sent.push(sent);
    return sent;
  }

  listSent(): readonly InMemorySentMessage[] {
    return [...this.#sent];
  }

  /** Réservé aux tests : jamais utilisé par un `Tool`. */
  debugAuthMarkerForTests(): string {
    return this.#fakeAuthMarker;
  }
}
