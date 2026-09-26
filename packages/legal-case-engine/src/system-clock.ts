import type { LegalInstant } from '@jarvis/legal-core';

/**
 * Horloge système **explicite** : la seule lecture de l'heure réelle du package (garde-fou
 * `architecture-boundaries.test.ts`). Le moteur n'en utilise **aucune** par défaut : c'est à
 * l'appelant de la passer (`now: systemClock`), tandis que les tests injectent une horloge
 * déterministe. Renvoie un instant ISO 8601 avec décalage `Z`.
 */
export function systemClock(): LegalInstant {
  return new Date().toISOString();
}
