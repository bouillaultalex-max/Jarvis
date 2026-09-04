import type { ClassificationLabel } from '@jarvis/classification';

import type { ClassifiedEmail } from './classified-email.js';

/**
 * Politique déterminant quels labels de classification méritent l'attention
 * de l'utilisateur. Fonctions pures — aucune E/S, aucun réseau, aucun appel
 * LLM, aucun credential : ne fait que filtrer des `ClassifiedEmail` déjà
 * obtenus.
 */
export interface AttentionPolicy {
  readonly labels: readonly ClassificationLabel[];
}

/** Politique par défaut : seul `important` nécessite l'attention. */
const DEFAULT_ATTENTION_POLICY: AttentionPolicy = { labels: ['important'] };

/** Un email nécessite l'attention si son label figure dans la politique. */
export function needsAttention(email: ClassifiedEmail, policy: AttentionPolicy = DEFAULT_ATTENTION_POLICY): boolean {
  return policy.labels.includes(email.classification.label);
}

/**
 * Filtre un lot déjà classifié pour ne garder que les emails nécessitant
 * l'attention de l'utilisateur, selon `policy` (par défaut : `important`
 * uniquement). Ne mute jamais `batch` ; préserve l'ordre d'origine.
 */
export function filterEmailsNeedingAttention(
  batch: readonly ClassifiedEmail[],
  policy: AttentionPolicy = DEFAULT_ATTENTION_POLICY,
): readonly ClassifiedEmail[] {
  return batch.filter((email) => needsAttention(email, policy));
}
