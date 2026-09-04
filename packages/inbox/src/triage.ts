import type { AttentionPolicy } from './attention.js';
import { filterEmailsNeedingAttention } from './attention.js';
import type { ClassifiedEmail } from './classified-email.js';
import type { EmailSummarizer } from './email-summarizer.js';

/**
 * Un email retenu pour l'attention de l'utilisateur, avec son résumé
 * (`undefined` si le LLM n'a pas produit de résumé exploitable — jamais un
 * faux résumé).
 */
export interface AttentionSummary {
  readonly classified: ClassifiedEmail;
  readonly summary: string | undefined;
}

/**
 * Compose le flux complet :
 *
 *   ClassifiedEmail[] → filterEmailsNeedingAttention (M7.1) → EmailSummarizer (M7.2)
 *
 * Ne modifie ni `ClassificationEngine`, ni `ToolExecutor`, ni
 * `PermissionManager` — se contente de composer deux fonctions déjà
 * existantes. **Seuls** les emails retenus par `policy` (par défaut :
 * `important` uniquement) sont transmis au `summarizer` : un email
 * `not_important` ou `uncertain` n'atteint jamais le LLM. Préserve l'ordre
 * du lot filtré ; ne mute ni `batch`, ni les `ClassifiedEmail` qu'il
 * contient.
 */
export async function summarizeEmailsNeedingAttention(
  batch: readonly ClassifiedEmail[],
  summarizer: EmailSummarizer,
  policy?: AttentionPolicy,
): Promise<readonly AttentionSummary[]> {
  const attended = filterEmailsNeedingAttention(batch, policy);

  const results: AttentionSummary[] = [];
  for (const classified of attended) {
    const summary = await summarizer.summarize(classified.email);
    results.push({ classified, summary: summary?.summary });
  }
  return results;
}
