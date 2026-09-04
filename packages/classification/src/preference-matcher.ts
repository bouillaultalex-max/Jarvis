import type { EmailMessage } from '@jarvis/types';

import { domainOfAddress, normalizeEmailAddress, normalizeText } from './normalize.js';
import type { Preference, PreferenceAttribute } from './preference.js';

/**
 * Ordre de spécificité, du plus précis au plus large. Sert à départager deux
 * préférences contradictoires qui matchent le même email.
 */
const SPECIFICITY: Readonly<Record<PreferenceAttribute, number>> = {
  sender: 4,
  subject_contains: 3,
  domain: 2,
  keyword: 1,
};

function preferenceMatches(preference: Preference, email: EmailMessage): boolean {
  switch (preference.attribute) {
    case 'sender':
      return normalizeEmailAddress(email.sender) === preference.value;
    case 'domain':
      return domainOfAddress(email.sender) === preference.value;
    case 'subject_contains':
      return normalizeText(email.subject).includes(preference.value);
    case 'keyword':
      return (
        normalizeText(email.subject).includes(preference.value) ||
        normalizeText(email.body).includes(preference.value)
      );
  }
}

/**
 * Sélectionne, parmi les préférences qui correspondent à cet email, la
 * décision applicable — de façon **déterministe** :
 *
 *   1. la préférence la plus spécifique l'emporte (`sender` > `subject_contains`
 *      > `domain` > `keyword`) ;
 *   2. à spécificité égale, la plus récente (`createdAt`) l'emporte.
 *
 * `explicit_rule` et `user_correction` ont le même poids : seule la
 * spécificité de l'attribut et la récence départagent deux préférences
 * contradictoires, jamais leur origine.
 *
 * Renvoie `undefined` si aucune préférence ne correspond.
 */
export function matchPreference(
  email: EmailMessage,
  preferences: readonly Preference[],
): Preference | undefined {
  const matching = preferences.filter((preference) => preferenceMatches(preference, email));
  if (matching.length === 0) {
    return undefined;
  }

  return matching.reduce((best, current) => {
    const bestSpecificity = SPECIFICITY[best.attribute];
    const currentSpecificity = SPECIFICITY[current.attribute];
    if (currentSpecificity !== bestSpecificity) {
      return currentSpecificity > bestSpecificity ? current : best;
    }
    return current.createdAt >= best.createdAt ? current : best;
  });
}
