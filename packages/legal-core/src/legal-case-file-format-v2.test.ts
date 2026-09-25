import { describe, expect, it } from 'vitest';

import { LegalCaseFileError } from './legal-case-file-format.js';
import {
  LEGACY_LEGAL_CASE_FILE_VERSION,
  parseLegacyLegalCaseFile,
} from './legal-case-file-format-v2.js';
import { validateLegalCaseV2 } from './legal-case-v2-validation.js';
import { buildLegalCaseV2Fixture } from './testing/legal-case-v2-fixtures.js';

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof LegalCaseFileError ? error.reason : 'other';
  }
  return undefined;
}

describe('validateLegalCaseV2 — contrat legacy figé', () => {
  it('accepte un dossier v2 avec faits répartis par état', () => {
    expect(validateLegalCaseV2(buildLegalCaseV2Fixture())).toEqual({ ok: true });
  });

  it('rejette un fait v2 sans énoncé', () => {
    const legalCase = buildLegalCaseV2Fixture();
    const broken = {
      ...legalCase,
      facts: { ...legalCase.facts, alleged: [{ id: 'fact-x', statement: '' }] },
    };
    expect(validateLegalCaseV2(broken).ok).toBe(false);
  });

  it('rejette une forme v3 (facts plat) : aucun accueil implicite', () => {
    const v3Shaped = { ...buildLegalCaseV2Fixture(), facts: [] };
    expect(validateLegalCaseV2(v3Shaped).ok).toBe(false);
  });
});

describe('parseLegacyLegalCaseFile', () => {
  it('lit un fichier v2 et renvoie le dossier tel quel, sans migration', () => {
    const legalCase = buildLegalCaseV2Fixture();
    const parsed = JSON.parse(JSON.stringify({ version: 2, case: legalCase })) as unknown;

    const result = parseLegacyLegalCaseFile(parsed);

    expect(LEGACY_LEGAL_CASE_FILE_VERSION).toBe(2);
    expect(result).toEqual(legalCase);
    // Aucun champ v3 inventé.
    expect(result).not.toHaveProperty('relations');
    expect(result).not.toHaveProperty('factValidations');
    expect(result.facts).toEqual(legalCase.facts);
  });

  it('refuse un fichier de version 3 (lecteur strict) : unknown_version', () => {
    expect(reasonOf(() => parseLegacyLegalCaseFile({ version: 3, case: {} }))).toBe(
      'unknown_version',
    );
  });

  it('refuse une version inconnue ou absente', () => {
    expect(reasonOf(() => parseLegacyLegalCaseFile({ version: 1, case: {} }))).toBe(
      'unknown_version',
    );
    expect(reasonOf(() => parseLegacyLegalCaseFile({ version: 999, case: {} }))).toBe(
      'unknown_version',
    );
    expect(reasonOf(() => parseLegacyLegalCaseFile({ case: {} }))).toBe('unknown_version');
  });

  it('refuse une racine non objet et une clé d’enveloppe inconnue', () => {
    expect(reasonOf(() => parseLegacyLegalCaseFile('x'))).toBe('invalid_structure');
    expect(reasonOf(() => parseLegacyLegalCaseFile(null))).toBe('invalid_structure');
    expect(
      reasonOf(() =>
        parseLegacyLegalCaseFile({ version: 2, case: buildLegalCaseV2Fixture(), extra: 1 }),
      ),
    ).toBe('invalid_structure');
  });

  it('refuse un dossier v2 invalide : invalid_case', () => {
    expect(reasonOf(() => parseLegacyLegalCaseFile({ version: 2, case: { id: 'x' } }))).toBe(
      'invalid_case',
    );
  });
});
