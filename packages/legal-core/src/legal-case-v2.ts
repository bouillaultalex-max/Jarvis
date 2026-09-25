import type {
  LegalAction,
  LegalAnalysisNote,
  LegalArgument,
  LegalCaseStatus,
  LegalCitation,
  LegalConclusion,
  LegalDeadline,
  LegalJurisdiction,
  LegalQuestion,
  LegalResearchItem,
  LegalSource,
} from './legal-case.js';

/**
 * Modèle **legacy** LegalCase v2 — gelé (LegalCase v3).
 *
 * La v2 reste lisible par `parseLegacyLegalCaseFile` et validable par
 * `validateLegalCaseV2`. Elle n'est **jamais** convertie en v3 : ni provenance,
 * ni temporalité, ni état épistémique ne peuvent être inventés pour un fait
 * v2 (aucune migration implicite). Ces types ne sont plus étendus.
 *
 * Les entités inchangées (`LegalQuestion`, `LegalSource`, `LegalCitation`,
 * `LegalArgument`, …) sont celles de `legal-case.ts`, partagées avec la v3.
 */

/** Un fait v2 — sans provenance, sans temporalité (`sourceRef` libre). */
export interface LegalFactV2 {
  readonly id: string;
  /** Énoncé lisible, en langage naturel. Jamais vide. */
  readonly statement: string;
  /** Référence libre vers la pièce/le document dont ce fait est extrait, si connue. */
  readonly sourceRef?: string;
}

/**
 * Faits v2 répartis par **état stocké** (établi / allégué / contradictoire /
 * inconnu). En v3 l'état n'est plus stocké : il est dérivé.
 */
export interface LegalCaseFactsV2 {
  readonly established: readonly LegalFactV2[];
  readonly alleged: readonly LegalFactV2[];
  readonly contradictory: readonly LegalFactV2[];
  readonly unknown: readonly LegalFactV2[];
}

/** Un document v2 (fourni par l'utilisateur ou rédigé par le moteur en `PREPARE`). */
export interface LegalDocumentV2 {
  readonly id: string;
  readonly title: string;
  readonly addedAt: string;
}

/** Une pièce v2, sans lien vers un document. */
export interface LegalEvidenceV2 {
  readonly id: string;
  readonly description: string;
  readonly addedAt: string;
}

/** Une affaire au format v2 (legacy). */
export interface LegalCaseV2 {
  readonly id: string;
  readonly title: string;
  readonly jurisdiction: LegalJurisdiction;
  readonly status: LegalCaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly facts: LegalCaseFactsV2;
  readonly documents: readonly LegalDocumentV2[];
  readonly evidence: readonly LegalEvidenceV2[];
  readonly questions: readonly LegalQuestion[];
  readonly research: readonly LegalResearchItem[];
  readonly sources: readonly LegalSource[];
  readonly citations: readonly LegalCitation[];
  readonly arguments: readonly LegalArgument[];
  readonly counterArguments: readonly LegalArgument[];
  readonly analysis: readonly LegalAnalysisNote[];
  readonly conclusions: readonly LegalConclusion[];
  readonly deadlines: readonly LegalDeadline[];
  readonly actions: readonly LegalAction[];
}
