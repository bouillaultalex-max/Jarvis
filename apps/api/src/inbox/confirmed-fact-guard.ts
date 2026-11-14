/**
 * Garde-fou de SORTIE pour un brouillon généré par {@link EmailReplyWorkflow}
 * (`@jarvis/inbox`), borné à un petit nombre de **sujets sensibles explicites**
 * — aujourd'hui, un seul : la validation d'un paiement. Ne vérifie PAS la
 * véracité générale d'un texte libre : hors de portée pour cette tranche (voir
 * la note Obsidian « Inbox temps A - boîte fictive », section « Portée exacte
 * de la protection »).
 *
 * Principe : si le brouillon affirme positivement qu'un sujet sensible est
 * résolu (ex. « le paiement a été validé »), au moins un des faits confirmés
 * **réellement transmis au workflow** (`EmailReplyWorkflowResult.selectedMemory`,
 * eux-mêmes soumis à ADR-0007 — jamais une proposition LLM non validée) doit
 * corroborer la même affirmation sur le même sujet. Sinon : violation.
 *
 * Couverture exacte, testée dans `confirmed-fact-guard.test.ts` (ne pas
 * supposer au-delà) :
 * - **Détecté** : le mot « paiement » suivi, dans les ~4 mots qui suivent,
 *   d'une forme de « validé / confirmé / reçu / effectué » (avec ou sans
 *   « a (bien) été » entre les deux) — y compris une négation mal protégée
 *   (« le paiement n'a PAS été validé » est tout de même détecté : faux
 *   positif assumé, plus sûr qu'un faux négatif).
 * - **Non détecté** (faux négatif, le brouillon passe sans contrôle) :
 *   - un synonyme sans le mot « paiement » (« le règlement a été effectué »,
 *     « la facture est payée », « nous avons été payés ») ;
 *   - une autre langue (« payment has been validated ») ;
 *   - un ordre des mots où le verbe précède « paiement » (« validé, le
 *     paiement ») ;
 *   - tout sujet sensible qui n'est pas la validation d'un paiement
 *     (remboursement, annulation, expédition…) — un seul sujet est couvert
 *     aujourd'hui, étendre {@link SENSITIVE_TOPICS} à la main pour en
 *     couvrir d'autres, avec un test par sujet ajouté.
 * - Correspondance par motif textuel sur un sujet nommé dans les deux cas
 *   (brouillon et faits confirmés) — jamais une compréhension sémantique.
 */

interface SensitiveTopic {
  readonly name: string;
  readonly pattern: RegExp;
}

const SENSITIVE_TOPICS: readonly SensitiveTopic[] = [
  {
    name: 'paiement validé',
    pattern:
      /paiement(?:\s+\S+){0,4}?\s+(?:a\s+(?:bien\s+)?été\s+)?(validé|confirmé|reçu|effectué)/i,
  },
];

function matchedSensitiveTopic(text: string): SensitiveTopic | undefined {
  return SENSITIVE_TOPICS.find((topic) => topic.pattern.test(text));
}

export interface ConfirmedFactGuardResult {
  readonly ok: boolean;
  /** Présent uniquement si `ok` vaut `false` : description lisible de l'écart. */
  readonly violation?: string;
}

/**
 * Vérifie qu'une affirmation sensible du brouillon est corroborée par au
 * moins un fait confirmé transmis au workflow. Fonction pure, déterministe,
 * aucun accès réseau.
 */
export function checkDraftAgainstConfirmedFacts(
  draftBody: string,
  confirmedFacts: readonly string[],
): ConfirmedFactGuardResult {
  const claim = matchedSensitiveTopic(draftBody);
  if (claim === undefined) {
    return { ok: true };
  }
  const corroborated = confirmedFacts.some(
    (fact) => matchedSensitiveTopic(fact)?.name === claim.name,
  );
  if (corroborated) {
    return { ok: true };
  }
  return {
    ok: false,
    violation:
      `Le brouillon affirme « ${claim.name} » sans qu'aucun fait confirmé transmis au workflow ` +
      'ne corrobore cette affirmation.',
  };
}
