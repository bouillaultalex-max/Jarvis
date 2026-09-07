import { describe, expect, it } from 'vitest';

import { parseGmailSendArgs } from './gmail-send-args.js';

/**
 * M8-B5 — parsing des arguments de la sous-commande `send`.
 * Valeurs strictement artificielles.
 */

describe('parseGmailSendArgs — M8-B5', () => {
  it('construit un GmailSendInput exact depuis --to/--subject/--body (sans threadId)', () => {
    const input = parseGmailSendArgs(['--to', 'dest@example.test', '--subject', 'Sujet', '--body', 'Corps']);
    expect(input).toEqual({ to: 'dest@example.test', subject: 'Sujet', body: 'Corps' });
  });

  it('inclut threadId uniquement lorsqu’il est fourni', () => {
    const input = parseGmailSendArgs([
      '--to',
      'dest@example.test',
      '--subject',
      'Sujet',
      '--body',
      'Corps',
      '--threadId',
      'thread-1',
    ]);
    expect(input).toEqual({ to: 'dest@example.test', subject: 'Sujet', body: 'Corps', threadId: 'thread-1' });
  });

  it('accepte la forme --flag=valeur', () => {
    const input = parseGmailSendArgs(['--to=dest@example.test', '--subject=Sujet précis', '--body=Corps du message']);
    expect(input).toEqual({ to: 'dest@example.test', subject: 'Sujet précis', body: 'Corps du message' });
  });

  it('ne retourne jamais de clé au-delà de to/subject/body/threadId', () => {
    const input = parseGmailSendArgs(['--to', 'a@x.test', '--subject', 's', '--body', 'b', '--threadId', 't']);
    expect(Object.keys(input).sort()).toEqual(['body', 'subject', 'threadId', 'to']);
  });

  it('option requise manquante → erreur citant les noms de flags, jamais une valeur', () => {
    expect(() => parseGmailSendArgs(['--to', 'secret-dest@example.test', '--subject', 'secret-sujet'])).toThrowError(
      /option\(s\) requise\(s\) manquante\(s\) : --body/,
    );
    try {
      parseGmailSendArgs(['--to', 'secret-dest@example.test', '--subject', 'secret-sujet']);
      throw new Error('unreachable');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('secret-dest@example.test');
      expect(message).not.toContain('secret-sujet');
    }
  });

  it('plusieurs options requises manquantes → toutes listées', () => {
    expect(() => parseGmailSendArgs(['--body', 'b'])).toThrowError(
      /manquante\(s\) : --to, --subject/,
    );
  });

  it('option inconnue → rejet explicite (jamais ignorée)', () => {
    expect(() =>
      parseGmailSendArgs(['--to', 'a@x.test', '--subject', 's', '--body', 'b', '--cc', 'c@x.test']),
    ).toThrowError(/option inconnue « --cc »/);
  });

  it('option inconnue de forme « valeur » (--dest@example.test) → message générique, jamais d’écho du token', () => {
    for (const argv of [['--dest@example.test'], ['--secret.token=leaked-value', '--to', 'a@x.test']]) {
      try {
        parseGmailSendArgs(argv);
        throw new Error('unreachable');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/option inconnue \(connues : --to, --subject, --body, --threadId\)\./);
        expect(message).not.toContain('dest@example.test');
        expect(message).not.toContain('secret.token');
        expect(message).not.toContain('leaked-value');
      }
    }
  });

  it('option fournie deux fois → rejet', () => {
    expect(() =>
      parseGmailSendArgs(['--to', 'a@x.test', '--to', 'b@x.test', '--subject', 's', '--body', 'b']),
    ).toThrowError(/« --to » fournie plusieurs fois/);
  });

  it('valeur manquante (flag en fin, ou suivi d’un autre flag) → erreur citant le nom du flag', () => {
    expect(() => parseGmailSendArgs(['--to', 'a@x.test', '--subject', 's', '--body'])).toThrowError(
      /valeur manquante pour l'option « --body »/,
    );
    expect(() => parseGmailSendArgs(['--to', '--subject', 's', '--body', 'b'])).toThrowError(
      /valeur manquante pour l'option « --to »/,
    );
  });

  it('argument positionnel → rejet sans écho de la valeur', () => {
    expect(() => parseGmailSendArgs(['dest@example.test', '--subject', 's', '--body', 'b'])).toThrowError(
      /argument positionnel inattendu/,
    );
    try {
      parseGmailSendArgs(['leak@example.test']);
      throw new Error('unreachable');
    } catch (err) {
      expect((err as Error).message).not.toContain('leak@example.test');
    }
  });

  it('--body="" (corps vide explicite) est accepté et transmis tel quel', () => {
    const input = parseGmailSendArgs(['--to=a@x.test', '--subject=s', '--body=']);
    expect(input).toEqual({ to: 'a@x.test', subject: 's', body: '' });
  });
});
