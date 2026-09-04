import type { EmailMessage } from '@jarvis/types';

import type { GmailRawHeader, GmailRawMessage, GmailRawMessagePart } from './gmail-api-client.js';

/**
 * Frontière stricte entre l'API Gmail et le domaine JARVIS : cette fonction
 * pure est le **seul** endroit où une forme brute Gmail est convertie en
 * `EmailMessage`. Au-delà, aucun objet brut Gmail ne doit remonter.
 */

function headerValue(headers: readonly GmailRawHeader[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

/**
 * Extrait l'adresse d'un en-tête `"Nom Affiché <adresse@example.com>"` (ou
 * l'entrée telle quelle si aucun chevron n'est présent).
 */
function extractAddress(entry: string): string {
  const match = entry.match(/<([^>]+)>/);
  return (match ? match[1] : entry).trim();
}

function parseRecipients(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => extractAddress(entry.trim()))
    .filter((address) => address.length > 0);
}

/**
 * Cherche la première partie `text/plain` exploitable, en profondeur
 * (message simple ou multipart). Renvoie `''` si aucune n'existe (ex.
 * message HTML seul) — jamais de contenu HTML brut en guise de corps.
 */
function findPlainTextBody(part: GmailRawMessagePart | undefined): string {
  if (part === undefined) {
    return '';
  }
  if (part.parts !== undefined && part.parts.length > 0) {
    for (const child of part.parts) {
      const found = findPlainTextBody(child);
      if (found.length > 0) {
        return found;
      }
    }
    return '';
  }
  if (part.mimeType === 'text/plain' && part.body?.data !== undefined) {
    return decodeBase64Url(part.body.data);
  }
  return '';
}

export function mapGmailMessageToEmailMessage(raw: GmailRawMessage): EmailMessage {
  const headers = raw.payload?.headers;
  const sender = extractAddress(headerValue(headers, 'From') ?? '');
  const recipients = parseRecipients(headerValue(headers, 'To'));
  const subject = headerValue(headers, 'Subject') ?? '';
  const body = findPlainTextBody(raw.payload);
  const receivedAt = raw.internalDate
    ? new Date(Number(raw.internalDate)).toISOString()
    : new Date(0).toISOString();

  return {
    id: raw.id,
    threadId: raw.threadId,
    sender,
    recipients,
    subject,
    body,
    receivedAt,
  };
}
