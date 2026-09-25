import { randomUUID } from 'node:crypto';

import type { LegalCase, LegalCaseStatus, LegalJurisdiction } from './legal-case.js';

/**
 * Entrée de création d'une {@link LegalCase}. Seul `title` est obligatoire :
 * une affaire naît toujours à l'étape `READ`, sans fait, document, source ou
 * action — le contenu se construit ensuite au fil du workflow
 * (`LEGAL_SPECIFICATION.md` §2).
 */
export interface CreateLegalCaseInput {
  readonly title: string;
  /** Par défaut `'FR'` — seule juridiction supportée en v1. */
  readonly jurisdiction?: LegalJurisdiction;
  /** Par défaut généré via `randomUUID()`. */
  readonly id?: string;
  /** Par défaut l'horodatage courant — surchargeable pour des tests déterministes. */
  readonly createdAt?: string;
}

/**
 * Crée une nouvelle {@link LegalCase} **v3** vide, à l'étape initiale `READ` :
 * toutes les listes (dont celles du modèle Fact) sont vides. Aucune valeur de
 * provenance, de temporalité ou d'état n'est jamais inventée.
 *
 * @throws {Error} si `title` est vide — un dossier sans titre n'est pas une
 *   simplification acceptable (même discipline que `MemoryStore.add`, qui
 *   refuse un `statement` vide).
 */
export function createLegalCase(input: CreateLegalCaseInput): LegalCase {
  if (input.title.trim().length === 0) {
    throw new Error('createLegalCase : « title » ne peut pas être vide.');
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const status: LegalCaseStatus = 'READ';

  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    jurisdiction: input.jurisdiction ?? 'FR',
    status,
    createdAt,
    updatedAt: createdAt,
    facts: [],
    documents: [],
    evidence: [],
    questions: [],
    relations: [],
    factValidations: [],
    conflicts: [],
    resolutionProposals: [],
    ruleExecutions: [],
    resolutions: [],
    research: [],
    sources: [],
    citations: [],
    arguments: [],
    counterArguments: [],
    analysis: [],
    conclusions: [],
    deadlines: [],
    actions: [],
  };
}
