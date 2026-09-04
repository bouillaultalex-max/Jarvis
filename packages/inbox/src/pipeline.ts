import type { ClassificationEngine } from '@jarvis/classification';
import type { ToolExecutor } from '@jarvis/core';

import { classifyEmails } from './classify-emails.js';
import type { ClassifiedEmail } from './classified-email.js';
import { fetchEmailsViaTool, type FetchEmailsOptions } from './fetch-emails.js';

/**
 * Le premier flux réel de bout en bout :
 *
 *   Tool de lecture (via ToolExecutor) → EmailMessage[]
 *     → ClassificationEngine.classify → ClassifiedEmail[]
 *
 * Générique : fonctionne avec n'importe quel Tool de lecture d'emails déjà
 * enregistré (`gmail.read` aujourd'hui, un futur `outlook.read` demain) sans
 * aucune modification de cette fonction.
 */
export async function fetchAndClassifyEmails(
  executor: ToolExecutor,
  engine: ClassificationEngine,
  options: FetchEmailsOptions,
): Promise<readonly ClassifiedEmail[]> {
  const emails = await fetchEmailsViaTool(executor, options);
  return classifyEmails(engine, emails);
}
