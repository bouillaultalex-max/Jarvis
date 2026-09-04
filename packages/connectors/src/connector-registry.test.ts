import { describe, expect, it } from 'vitest';

import type { Connector } from './connector.js';
import { ConnectorRegistry } from './connector-registry.js';
import { UnknownConnectorError } from './errors.js';

function fakeConnector(id: string, capabilities: readonly string[] = []): Connector {
  return {
    id,
    name: `Connector ${id}`,
    capabilities,
    createTools: () => [],
  };
}

describe('ConnectorRegistry', () => {
  it('enregistre puis retrouve un connector par id', () => {
    const registry = new ConnectorRegistry();
    const connector = fakeConnector('gmail');

    registry.register(connector);

    expect(registry.has('gmail')).toBe(true);
    expect(registry.get('gmail')).toBe(connector);
  });

  it('refuse un double enregistrement du même id', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('gmail'));

    expect(() => registry.register(fakeConnector('gmail'))).toThrowError(
      /déjà enregistré/,
    );
  });

  it('get() sur un connector inconnu lève UnknownConnectorError', () => {
    const registry = new ConnectorRegistry();

    expect(() => registry.get('discord')).toThrowError(UnknownConnectorError);
    try {
      registry.get('discord');
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownConnectorError);
      expect((err as UnknownConnectorError).connectorId).toBe('discord');
    }
  });

  it('has() sur un connector inconnu renvoie false sans lever', () => {
    const registry = new ConnectorRegistry();
    expect(registry.has('discord')).toBe(false);
  });

  it('list() énumère tous les connectors enregistrés, dans l’ordre d’enregistrement', () => {
    const registry = new ConnectorRegistry();
    const gmail = fakeConnector('gmail');
    const calendar = fakeConnector('calendar');

    registry.register(gmail);
    registry.register(calendar);

    expect(registry.list()).toEqual([gmail, calendar]);
  });

  it('list() sur un registre vide renvoie un tableau vide', () => {
    expect(new ConnectorRegistry().list()).toEqual([]);
  });

  it('listCapabilities() délègue à Connector.capabilities', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('gmail', ['gmail.read', 'gmail.prepare_reply']));

    expect(registry.listCapabilities('gmail')).toEqual(['gmail.read', 'gmail.prepare_reply']);
  });

  it('listCapabilities() sur un connector inconnu lève UnknownConnectorError', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.listCapabilities('discord')).toThrowError(UnknownConnectorError);
  });

  it('ne contient aucune logique métier spécifique à un provider : un connector arbitraire fonctionne à l’identique de gmail/calendar', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('totally-made-up-provider', ['made_up.action']));

    expect(registry.has('totally-made-up-provider')).toBe(true);
    expect(registry.listCapabilities('totally-made-up-provider')).toEqual(['made_up.action']);
  });
});
