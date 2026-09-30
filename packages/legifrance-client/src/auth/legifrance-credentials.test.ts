import { describe, expect, it } from 'vitest';

import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from './legifrance-credentials.js';

/**
 * Ne teste que les constructeurs de clé purs, restés dans ce package après
 * le déplacement de `resolveLegifranceCredentials` vers `@jarvis/connectors`
 * (cycle de packages corrigé — voir
 * `packages/connectors/src/legifrance/legifrance-credentials.test.ts` pour
 * la résolution effective via `SecretStore`).
 */
describe('constructeurs de clé Légifrance', () => {
  it('scinde les clés par environnement — un credential sandbox n’est jamais confondu avec production', () => {
    expect(legifranceClientIdSecretKey('sandbox')).not.toBe(
      legifranceClientIdSecretKey('production'),
    );
    expect(legifranceClientSecretSecretKey('sandbox')).not.toBe(
      legifranceClientSecretSecretKey('production'),
    );
  });

  it('clientId et clientSecret ne partagent jamais la même clé', () => {
    expect(legifranceClientIdSecretKey('sandbox')).not.toBe(
      legifranceClientSecretSecretKey('sandbox'),
    );
  });

  it('est déterministe (même environnement → même clé)', () => {
    expect(legifranceClientIdSecretKey('production')).toBe(
      legifranceClientIdSecretKey('production'),
    );
  });
});
