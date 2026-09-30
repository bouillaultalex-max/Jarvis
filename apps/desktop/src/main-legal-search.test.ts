import { Writable } from 'node:stream';

import { InMemoryAccountStore, InMemorySecretStore } from '@jarvis/connectors';
import { describe, expect, it } from 'vitest';

import { dispatch, type DesktopDeps } from './main.js';
import {
  EMPTY_SEARCH_OUTPUT,
  FAKE_CLIENT_SECRET,
  buildFetchFn,
  buildLegifranceSecretStore,
} from './legal-search-test-fixtures.js';
import type { LegalSearchDeps } from './run-legal-search-flow.js';

/**
 * Tests de câblage de `legal-search` au niveau `dispatch()` — la commande
 * CLI réelle (`apps/desktop legal-search --asOf ... "texte"`), au-dessus de
 * `runLegalSearchFlow` (déjà couvert en détail par
 * `run-legal-search-flow.test.ts`, non dupliqué ici). `fetchFn` mocké :
 * aucun appel réseau réel.
 */

function collectingOutput(): { output: Writable; readText: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      text += chunk.toString();
      cb();
    },
  });
  return { output, readText: () => text };
}

/** `DesktopDeps` Gmail inertes — jamais lues par la branche `legal-search` de `dispatch()`. */
const INERT_DESKTOP_DEPS: DesktopDeps = {
  accountStore: new InMemoryAccountStore(),
  secretStore: new InMemorySecretStore(),
  appCredentials: { clientId: '', clientSecret: '' },
};

describe('dispatch — legal-search (câblage CLI)', () => {
  it('succès : argv complet → texte présenté, en traversant parseLegalSearchArgs → runLegalSearchFlow → describeLegalSearchResult', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn();
    const legalSearchDeps: LegalSearchDeps = { secretStore, environment: 'sandbox', fetchFn };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['legal-search', '--asOf', '2026-01-01', 'préavis licenciement économique'],
      INERT_DESKTOP_DEPS,
      { output },
      undefined,
      legalSearchDeps,
    );

    expect(readText()).toContain('1 résultat(s)');
    expect(readText()).toContain('LEGIARTI000006901174');
    expect(readText()).not.toContain(FAKE_CLIENT_SECRET);
  });

  it('aucun résultat : présenté distinctement, sans erreur', async () => {
    const secretStore = await buildLegifranceSecretStore();
    const fetchFn = buildFetchFn({ searchOutput: EMPTY_SEARCH_OUTPUT });
    const legalSearchDeps: LegalSearchDeps = { secretStore, environment: 'sandbox', fetchFn };
    const { output, readText } = collectingOutput();

    await dispatch(
      ['legal-search', '--asOf', '2026-01-01', 'texte introuvable'],
      INERT_DESKTOP_DEPS,
      { output },
      undefined,
      legalSearchDeps,
    );

    expect(readText()).toContain('Aucun résultat Légifrance');
  });

  it('argument invalide (date impossible) → rejeté avant toute résolution de credentials/appel fournisseur (exception propagée, jamais un résultat)', async () => {
    const fetchFn = buildFetchFn();
    // SecretStore volontairement vide et fetchFn volontairement non
    // pré-peuplé pour cette assertion précise : si parseLegalSearchArgs()
    // n'échouait pas *avant* toute résolution, ce test échouerait
    // différemment (configuration_error plutôt qu'une exception synchrone).
    const legalSearchDeps: LegalSearchDeps = {
      secretStore: new InMemorySecretStore(),
      environment: 'sandbox',
      fetchFn,
    };
    const { output } = collectingOutput();

    await expect(
      dispatch(
        ['legal-search', '--asOf', '2026-02-30', 'texte'],
        INERT_DESKTOP_DEPS,
        { output },
        undefined,
        legalSearchDeps,
      ),
    ).rejects.toThrow(/date calendaire réelle/);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('commande inconnue reste rejetée, et la liste des commandes mentionne « legal-search »', async () => {
    const { output } = collectingOutput();
    await expect(dispatch(['n-importe-quoi'], INERT_DESKTOP_DEPS, { output })).rejects.toThrow(
      /legal-search/,
    );
  });
});

describe('dispatch — legal-search, sans configuration Gmail ni clé LLM', () => {
  it("n'exige ni GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET ni ANTHROPIC_API_KEY (DesktopDeps Gmail inertes, jamais lues)", async () => {
    const originalGmailId = process.env.GMAIL_CLIENT_ID;
    const originalGmailSecret = process.env.GMAIL_CLIENT_SECRET;
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const secretStore = await buildLegifranceSecretStore();
      const fetchFn = buildFetchFn();
      const legalSearchDeps: LegalSearchDeps = { secretStore, environment: 'sandbox', fetchFn };
      const { output, readText } = collectingOutput();

      await dispatch(
        ['legal-search', '--asOf', '2026-01-01', 'texte'],
        INERT_DESKTOP_DEPS,
        { output },
        undefined,
        legalSearchDeps,
      );

      expect(readText()).toContain('1 résultat(s)');
    } finally {
      if (originalGmailId !== undefined) process.env.GMAIL_CLIENT_ID = originalGmailId;
      if (originalGmailSecret !== undefined) process.env.GMAIL_CLIENT_SECRET = originalGmailSecret;
      if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });
});
