import type { LegalCaseV2 } from './legal-case-v2.js';
import { LegalCaseFileError } from './legal-case-file-format.js';
import { validateLegalCaseV2 } from './legal-case-v2-validation.js';

/**
 * Lecteur **legacy** du format fichier v2 — gel de la v2, LegalCase v3.
 *
 * ```json
 * { "version": 2, "case": { …champs de LegalCaseV2… } }
 * ```
 *
 * - Lecture **seule** : il n'existe aucun écrivain v2 et aucune conversion vers
 *   la v3. Un dossier legacy est consultable, jamais ré-enregistré tel quel.
 * - **Aucune migration implicite** : la valeur renvoyée est un {@link LegalCaseV2}
 *   (faits répartis par état stocké, sans provenance ni temporalité). Rien n'est
 *   inventé pour la rendre conforme à la v3.
 * - Un fichier de version 3 est refusé (`unknown_version`) : il se lit avec
 *   `parseLegalCaseFile`.
 */
export const LEGACY_LEGAL_CASE_FILE_VERSION = 2;

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['version', 'case']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Interprète une valeur **déjà `JSON.parse`'d** comme un dossier v2 persisté.
 * Fonction pure, sans I/O.
 *
 * @throws {LegalCaseFileError}
 *   - `invalid_structure` : racine non objet ou clé d'enveloppe inconnue ;
 *   - `unknown_version` : `version` ≠ 2 (dont la 3 : lecteur strict) ;
 *   - `invalid_case` : `case` ne satisfait pas {@link validateLegalCaseV2}.
 */
export function parseLegacyLegalCaseFile(parsed: unknown): LegalCaseV2 {
  if (!isPlainObject(parsed)) {
    throw new LegalCaseFileError('invalid_structure', 'racine : objet attendu.');
  }
  for (const key of Object.keys(parsed)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new LegalCaseFileError('invalid_structure', `clé inconnue « ${key} ».`);
    }
  }
  if (parsed.version !== LEGACY_LEGAL_CASE_FILE_VERSION) {
    throw new LegalCaseFileError(
      'unknown_version',
      `version reçue : ${String(parsed.version)} (le lecteur legacy ne lit que la version ${LEGACY_LEGAL_CASE_FILE_VERSION}).`,
    );
  }

  const validation = validateLegalCaseV2(parsed.case);
  if (!validation.ok) {
    throw new LegalCaseFileError('invalid_case', validation.error);
  }
  return parsed.case as LegalCaseV2;
}
