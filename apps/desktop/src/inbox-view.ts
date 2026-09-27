import type { ClassificationLabel, ClassificationSource } from '@jarvis/classification';
import type { AttentionSummary, ClassifiedEmail } from '@jarvis/inbox';

/**
 * Formatage terminal d'un lot d'emails classifiés — jamais l'objet brut.
 *
 * Pour chaque email, **exactement** cinq champs : expéditeur, objet, libellé,
 * raison et provenance, plus un sixième champ optionnel (« Résumé ») quand
 * `attentionSummaries` fournit un résumé exploitable pour cet email — jamais
 * un résumé fabriqué si absent. Aucun autre champ n'est lu ici : ni le corps,
 * ni un extrait, ni les destinataires, ni le `threadId`, ni un token, ni un
 * message d'erreur LLM brut (une erreur LLM ne remonte jamais jusqu'ici —
 * elle est absorbée en amont par un repli contrôlé vers `uncertain`).
 *
 * Boîte vide ⇒ une seule ligne informative, jamais de ligne fictive (même
 * discipline que `describeReadResult` dans `main.ts`).
 */

const LABEL_LABELS: Readonly<Record<ClassificationLabel, string>> = {
  important: 'important',
  not_important: 'non important',
  uncertain: 'incertain',
};

const SOURCE_LABELS: Readonly<Record<ClassificationSource, string>> = {
  explicit_rule: 'règle explicite',
  user_correction: 'correction utilisateur',
  llm: 'LLM',
  default: 'repli par défaut',
};

export function describeInboxResult(
  classified: readonly ClassifiedEmail[],
  attentionSummaries?: readonly AttentionSummary[],
): readonly string[] {
  if (classified.length === 0) {
    return ['Aucun email trouvé.'];
  }

  const lines: string[] = [];
  for (const entry of classified) {
    const { email, classification } = entry;
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`Expéditeur : ${email.sender}`);
    lines.push(`Objet : ${email.subject}`);
    lines.push(`Libellé : ${LABEL_LABELS[classification.label]}`);
    lines.push(`Raison : ${classification.reason}`);
    lines.push(`Provenance : ${SOURCE_LABELS[classification.source]}`);
    const summary = attentionSummaries?.find((s) => s.classified === entry)?.summary;
    if (summary !== undefined) {
      lines.push(`Résumé : ${summary}`);
    }
  }
  return lines;
}
