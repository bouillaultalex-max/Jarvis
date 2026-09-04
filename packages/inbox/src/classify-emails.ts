import type { ClassificationEngine } from '@jarvis/classification';
import type { EmailMessage } from '@jarvis/types';

import type { ClassifiedEmail } from './classified-email.js';

/**
 * Classe chaque email indépendamment via `ClassificationEngine.classify`.
 * Ne modifie ni n'étend `ClassificationEngine` — se contente de l'appeler et
 * de recomposer le résultat avec l'email d'origine pour restitution future.
 */
export async function classifyEmails(
  engine: ClassificationEngine,
  emails: readonly EmailMessage[],
): Promise<readonly ClassifiedEmail[]> {
  const results: ClassifiedEmail[] = [];
  for (const email of emails) {
    const classification = await engine.classify(email);
    results.push({ email, classification });
  }
  return results;
}
