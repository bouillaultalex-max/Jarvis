import { describe, expect, it } from 'vitest';

import { LegifranceConfigError } from '../errors/legifrance-errors.js';
import { createLegifranceConfig, resolveLegifranceEnvironment } from './legifrance-config.js';

describe('createLegifranceConfig', () => {
  it('configuration sandbox : URLs sandbox attendues', () => {
    const config = createLegifranceConfig('sandbox');

    expect(config).toEqual({
      environment: 'sandbox',
      oauthTokenUrl: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app',
    });
  });

  it('configuration production : URLs production attendues', () => {
    const config = createLegifranceConfig('production');

    expect(config).toEqual({
      environment: 'production',
      oauthTokenUrl: 'https://oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app',
    });
  });

  it('séparation stricte sandbox / production : aucune URL en commun', () => {
    const sandbox = createLegifranceConfig('sandbox');
    const production = createLegifranceConfig('production');

    expect(sandbox.oauthTokenUrl).not.toBe(production.oauthTokenUrl);
    expect(sandbox.apiBaseUrl).not.toBe(production.apiBaseUrl);
    expect(production.oauthTokenUrl).not.toContain('sandbox');
    expect(production.apiBaseUrl).not.toContain('sandbox');
  });
});

describe('resolveLegifranceEnvironment', () => {
  it('lit "sandbox" depuis LEGIFRANCE_ENVIRONMENT', () => {
    expect(resolveLegifranceEnvironment({ LEGIFRANCE_ENVIRONMENT: 'sandbox' })).toBe('sandbox');
  });

  it('lit "production" depuis LEGIFRANCE_ENVIRONMENT', () => {
    expect(resolveLegifranceEnvironment({ LEGIFRANCE_ENVIRONMENT: 'production' })).toBe(
      'production',
    );
  });

  it('rejette une variable absente — jamais de défaut implicite vers un environnement', () => {
    // N'appelle jamais silencieusement createLegifranceConfig('production') (ou 'sandbox') :
    // l'absence de la variable est une erreur, pas un choix par défaut.
    expect(() => resolveLegifranceEnvironment({})).toThrowError(LegifranceConfigError);
  });

  it('rejette une valeur vide ou inconnue', () => {
    expect(() => resolveLegifranceEnvironment({ LEGIFRANCE_ENVIRONMENT: '' })).toThrowError(
      LegifranceConfigError,
    );
    expect(() => resolveLegifranceEnvironment({ LEGIFRANCE_ENVIRONMENT: 'staging' })).toThrowError(
      LegifranceConfigError,
    );
  });
});
