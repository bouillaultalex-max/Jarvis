import type { LegalCase } from './legal-case.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';

/**
 * Sérialisation persistée d'une {@link LegalCase} **v3** — même discipline
 * qu'`@jarvis/memory` (`memory-file-format.ts`) : enveloppe versionnée explicite,
 * aucune migration silencieuse.
 *
 * **Format v3** :
 * ```json
 * { "version": 3, "case": { …champs de LegalCase v3… } }
 * ```
 *
 * ## Deux lecteurs, un seul écrivain
 *   - {@link parseLegalCaseFile} : lecteur **strict v3**. Un fichier de version 2 est
 *     refusé avec le motif distinct `legacy_version` (jamais lu « comme » v3) ; toute
 *     autre version est `unknown_version` ;
 *   - `parseLegacyLegalCaseFile` (`legal-case-file-format-v2.ts`) : lecteur **legacy**
 *     v2, lecture seule, sans migration ;
 *   - {@link serializeLegalCaseFile} : écrivain **v3 uniquement**. Il n'existe aucun
 *     écrivain v2 : un dossier legacy n'est pas ré-enregistrable tel quel.
 *
 * Toute migration v2 → v3 future doit être explicite et traçable : une conversion
 * inventerait la provenance, la temporalité et l'état des faits, ce que le modèle
 * interdit.
 *
 * ## Écriture sûre
 * L'écrivain **valide avant d'écrire** (`validateLegalCaseV3`) : les entités du
 * modèle Fact étant à clés fermées, aucune clé superflue ne peut fuiter sur disque
 * par référence. (Les entités conservées de la v2 — sources, citations, arguments… —
 * restent à clés ouvertes, comme avant.) Les champs racine sont recopiés un par un.
 */
export const CURRENT_LEGAL_CASE_FILE_VERSION = 3;

export type LegalCaseFileErrorReason =
  'invalid_structure' | 'unknown_version' | 'legacy_version' | 'invalid_case';

/**
 * Levée lorsqu'une valeur **existe mais ne peut pas être interprétée en
 * confiance** comme une affaire juridique persistée. Ne masque jamais une
 * anomalie par une valeur par défaut silencieuse.
 */
export class LegalCaseFileError extends Error {
  constructor(
    readonly reason: LegalCaseFileErrorReason,
    readonly detail?: string,
  ) {
    super(
      `LegalCaseFileError[${reason}]${detail ? ` : ${detail}` : ''} — enveloppe de dossier juridique illisible.`,
    );
    this.name = 'LegalCaseFileError';
  }
}

interface PersistedLegalCaseFileV3 {
  readonly version: 3;
  readonly case: LegalCase;
}

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['version', 'case']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Interprète une valeur **déjà `JSON.parse`'d** comme une {@link LegalCase} v3
 * persistée. Fonction **pure**, sans I/O.
 *
 * @throws {LegalCaseFileError}
 *   - `invalid_structure` : racine non objet, ou clé d'enveloppe inconnue ;
 *   - `legacy_version` : `version` = 2 (dossier legacy : `parseLegacyLegalCaseFile`) ;
 *   - `unknown_version` : toute autre `version` ≠ {@link CURRENT_LEGAL_CASE_FILE_VERSION} ;
 *   - `invalid_case` : `case` ne satisfait pas {@link validateLegalCaseV3}.
 */
export function parseLegalCaseFile(parsed: unknown): LegalCase {
  if (!isPlainObject(parsed)) {
    throw new LegalCaseFileError('invalid_structure', 'racine : objet attendu.');
  }
  for (const key of Object.keys(parsed)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new LegalCaseFileError('invalid_structure', `clé inconnue « ${key} ».`);
    }
  }
  if (parsed.version === 2) {
    throw new LegalCaseFileError(
      'legacy_version',
      'dossier au format v2 (legacy) : lire avec parseLegacyLegalCaseFile — aucune migration implicite.',
    );
  }
  if (parsed.version !== CURRENT_LEGAL_CASE_FILE_VERSION) {
    throw new LegalCaseFileError('unknown_version', `version reçue : ${String(parsed.version)}.`);
  }

  const validation = validateLegalCaseV3(parsed.case);
  if (!validation.ok) {
    throw new LegalCaseFileError('invalid_case', validation.error);
  }

  return parsed.case as LegalCase;
}

/**
 * Sérialise une {@link LegalCase} vers le **format v3** (JSON indenté de 2).
 *
 * Valide d'abord ; recopie ensuite les champs racine un à un (jamais
 * `{ ...legalCase }`) : aucun champ superflu ajouté en mémoire ne peut fuiter.
 *
 * @throws {LegalCaseFileError} `invalid_case` si le dossier est invalide.
 */
export function serializeLegalCaseFile(legalCase: LegalCase): string {
  const validation = validateLegalCaseV3(legalCase);
  if (!validation.ok) {
    throw new LegalCaseFileError('invalid_case', validation.error);
  }
  const payload: PersistedLegalCaseFileV3 = {
    version: CURRENT_LEGAL_CASE_FILE_VERSION,
    case: {
      id: legalCase.id,
      title: legalCase.title,
      jurisdiction: legalCase.jurisdiction,
      status: legalCase.status,
      createdAt: legalCase.createdAt,
      updatedAt: legalCase.updatedAt,
      facts: legalCase.facts,
      documents: legalCase.documents,
      evidence: legalCase.evidence,
      questions: legalCase.questions,
      relations: legalCase.relations,
      factValidations: legalCase.factValidations,
      conflicts: legalCase.conflicts,
      resolutionProposals: legalCase.resolutionProposals,
      ruleExecutions: legalCase.ruleExecutions,
      resolutions: legalCase.resolutions,
      research: legalCase.research,
      sources: legalCase.sources,
      citations: legalCase.citations,
      arguments: legalCase.arguments,
      counterArguments: legalCase.counterArguments,
      analysis: legalCase.analysis,
      conclusions: legalCase.conclusions,
      deadlines: legalCase.deadlines,
      actions: legalCase.actions,
    },
  };
  return JSON.stringify(payload, null, 2);
}
