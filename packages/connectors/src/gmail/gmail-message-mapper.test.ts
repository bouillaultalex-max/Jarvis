import { describe, expect, it } from 'vitest';

import { mapGmailMessageToEmailMessage } from './gmail-message-mapper.js';
import type { GmailRawMessage } from './gmail-api-client.js';

function encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

function rawMessage(overrides: Partial<GmailRawMessage> = {}): GmailRawMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    internalDate: '1757000000000',
    payload: {
      headers: [
        { name: 'From', value: 'Boss <boss@example.com>' },
        { name: 'To', value: 'Alice <alice@example.com>, bob@example.com' },
        { name: 'Subject', value: 'Point hebdo' },
      ],
      mimeType: 'text/plain',
      body: { data: encode('Contenu du message.') },
    },
    ...overrides,
  };
}

describe('mapGmailMessageToEmailMessage', () => {
  it('transforme un message Gmail simple en EmailMessage complet', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage());

    expect(email).toEqual({
      id: 'msg-1',
      threadId: 'thread-1',
      sender: 'boss@example.com',
      recipients: ['alice@example.com', 'bob@example.com'],
      subject: 'Point hebdo',
      body: 'Contenu du message.',
      receivedAt: new Date(1757000000000).toISOString(),
    });
  });

  it('extrait correctement l’expéditeur (adresse entre chevrons)', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({
        payload: {
          headers: [{ name: 'From', value: 'Jane Doe <jane.doe@example.com>' }],
        },
      }),
    );

    expect(email.sender).toBe('jane.doe@example.com');
  });

  it('extrait correctement l’expéditeur quand l’en-tête ne contient qu’une adresse nue', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({ payload: { headers: [{ name: 'From', value: 'boss@example.com' }] } }),
    );

    expect(email.sender).toBe('boss@example.com');
  });

  it('extrait plusieurs destinataires', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({
        payload: {
          headers: [
            { name: 'To', value: 'Alice <alice@example.com>, Bob <bob@example.com>, carol@example.com' },
          ],
        },
      }),
    );

    expect(email.recipients).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com']);
  });

  it('renvoie une liste vide de destinataires si l’en-tête « To » est absent', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage({ payload: { headers: [] } }));

    expect(email.recipients).toEqual([]);
  });

  it('extrait le sujet', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({ payload: { headers: [{ name: 'Subject', value: 'Votre facture de septembre' }] } }),
    );

    expect(email.subject).toBe('Votre facture de septembre');
  });

  it('renvoie un sujet vide si l’en-tête « Subject » est absent (jamais undefined)', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage({ payload: { headers: [] } }));

    expect(email.subject).toBe('');
  });

  it('décode le corps text/plain encodé en base64url', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({
        payload: {
          headers: [],
          mimeType: 'text/plain',
          body: { data: encode('Corps en clair, accents éàü inclus.') },
        },
      }),
    );

    expect(email.body).toBe('Corps en clair, accents éàü inclus.');
  });

  it('trouve la partie text/plain dans un message multipart', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({
        payload: {
          headers: [],
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/html', body: { data: encode('<p>HTML</p>') } },
            { mimeType: 'text/plain', body: { data: encode('Version texte.') } },
          ],
        },
      }),
    );

    expect(email.body).toBe('Version texte.');
  });

  it('extrait correctement la date (internalDate → ISO 8601)', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage({ internalDate: '1700000000000' }));

    expect(email.receivedAt).toBe(new Date(1700000000000).toISOString());
  });

  it('message sans corps texte exploitable (HTML seul) : body vide, jamais de HTML brut', () => {
    const email = mapGmailMessageToEmailMessage(
      rawMessage({
        payload: {
          headers: [],
          mimeType: 'text/html',
          body: { data: encode('<p>Uniquement du HTML</p>') },
        },
      }),
    );

    expect(email.body).toBe('');
  });

  it('message sans corps du tout : body vide, aucune exception', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage({ payload: { headers: [] } }));

    expect(email.body).toBe('');
  });

  it('aucun champ « payload » brut Gmail ne fuit dans l’EmailMessage résultant', () => {
    const email = mapGmailMessageToEmailMessage(rawMessage());

    expect(Object.keys(email).sort()).toEqual(
      ['body', 'id', 'receivedAt', 'recipients', 'sender', 'subject', 'threadId'].sort(),
    );
  });
});
