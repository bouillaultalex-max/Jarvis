import { describe, expect, it } from 'vitest';

import {
  LegifranceConfigError,
  LegifranceHttpError,
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
  LegifranceOAuthError,
} from './legifrance-errors.js';

describe('erreurs typées Légifrance', () => {
  it('LegifranceConfigError porte un code stable et le détail fourni', () => {
    const error = new LegifranceConfigError('LEGIFRANCE_ENVIRONMENT manquante');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('legifrance_config_invalid');
    expect(error.name).toBe('LegifranceConfigError');
    expect(error.message).toContain('LEGIFRANCE_ENVIRONMENT manquante');
  });

  it('LegifranceOAuthError porte le statut HTTP exact, jamais un corps de réponse', () => {
    const error = new LegifranceOAuthError(401);
    expect(error.code).toBe('legifrance_oauth_error');
    expect(error.status).toBe(401);
    expect(error.message).toContain('401');
  });

  it('LegifranceHttpError dérive kind à partir du statut', () => {
    expect(new LegifranceHttpError(404).kind).toBe('client_error');
    expect(new LegifranceHttpError(499).kind).toBe('client_error');
    expect(new LegifranceHttpError(500).kind).toBe('server_error');
    expect(new LegifranceHttpError(503).kind).toBe('server_error');
  });

  it('LegifranceNetworkError et LegifranceMalformedResponseError portent un détail fixe, jamais un secret', () => {
    const network = new LegifranceNetworkError('ECONNREFUSED');
    const malformed = new LegifranceMalformedResponseError('sans « access_token » exploitable.');

    expect(network.code).toBe('legifrance_network_error');
    expect(malformed.code).toBe('legifrance_malformed_response');
    expect(network.message).not.toMatch(/client_secret|access_token|Bearer/i);
    expect(malformed.message).not.toMatch(/client_secret|Bearer [A-Za-z0-9._-]+/);
  });
});
