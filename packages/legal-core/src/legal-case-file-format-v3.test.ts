import { describe, expect, it } from 'vitest';

import { createLegalCase } from './legal-case-factory.js';
import {
  CURRENT_LEGAL_CASE_FILE_VERSION,
  LegalCaseFileError,
  parseLegalCaseFile,
  serializeLegalCaseFile,
} from './legal-case-file-format.js';
import { parseLegacyLegalCaseFile } from './legal-case-file-format-v2.js';
import { LEGAL_CASE_V3_KEYS } from './legal-case-validation.js';
import { buildLegalCaseV2Fixture } from './testing/legal-case-v2-fixtures.js';
import { buildFullLegalCaseV3 } from './testing/legal-case-v3-fixtures.js';

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof LegalCaseFileError ? error.reason : 'other';
  }
  return undefined;
}

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

describe('écrivain et lecteur strict v3', () => {
  it('round-trip : un dossier v3 complet sérialisé puis relu est strictement égal', () => {
    const legalCase = buildFullLegalCaseV3();
    const parsed = roundTrip(JSON.parse(serializeLegalCaseFile(legalCase)));
    expect(parseLegalCaseFile(parsed)).toEqual(legalCase);
  });

  it('round-trip d’un dossier vide', () => {
    const legalCase = createLegalCase({
      title: 'Vide',
      id: 'c-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(legalCase)))).toEqual(legalCase);
  });

  it('écrit la version 3 dans l’enveloppe', () => {
    const file = JSON.parse(serializeLegalCaseFile(buildFullLegalCaseV3())) as { version: number };
    expect(CURRENT_LEGAL_CASE_FILE_VERSION).toBe(3);
    expect(file.version).toBe(3);
  });

  it('tout champ racine d’un dossier est sérialisé (aucune perte silencieuse d’une liste)', () => {
    const legalCase = buildFullLegalCaseV3();
    const file = JSON.parse(serializeLegalCaseFile(legalCase)) as { case: Record<string, unknown> };
    expect(Object.keys(file.case).sort()).toEqual([...LEGAL_CASE_V3_KEYS].sort());
    for (const key of Object.keys(legalCase)) {
      expect(file.case[key]).toEqual((legalCase as unknown as Record<string, unknown>)[key]);
    }
  });

  it('la sérialisation ne contient aucun état épistémique', () => {
    const text = serializeLegalCaseFile(buildFullLegalCaseV3());
    for (const forbidden of [
      '"epistemicState"',
      '"certainty"',
      '"established"',
      '"contradictory"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('l’écrivain valide avant d’écrire : un dossier invalide n’est jamais écrit', () => {
    const legalCase = buildFullLegalCaseV3();
    const broken = {
      ...legalCase,
      facts: [...legalCase.facts, { id: 'fact-v2', statement: 'v2' }],
    };
    expect(reasonOf(() => serializeLegalCaseFile(broken as never))).toBe('invalid_case');
  });

  it('aucune fuite par référence : une clé superflue sur une provenance en mémoire empêche l’écriture', () => {
    const legalCase = buildFullLegalCaseV3();
    const leaky = {
      ...legalCase,
      facts: [
        {
          ...legalCase.facts[0]!,
          provenance: { ...legalCase.facts[0]!.provenance, token: 'sk-secret' },
        },
        ...legalCase.facts.slice(1),
      ],
    };
    expect(reasonOf(() => serializeLegalCaseFile(leaky as never))).toBe('invalid_case');
    // Le secret n'apparaît dans aucune sortie.
    let output = '';
    try {
      output = serializeLegalCaseFile(leaky as never);
    } catch {
      output = '';
    }
    expect(output).not.toContain('sk-secret');
  });

  it('un champ racine superflu n’est pas écrit et invalide le dossier', () => {
    const legalCase = { ...buildFullLegalCaseV3(), stateCache: { a: 'established' } };
    expect(reasonOf(() => serializeLegalCaseFile(legalCase as never))).toBe('invalid_case');
  });

  it('le lecteur ne modifie pas l’entrée', () => {
    const parsed = roundTrip(JSON.parse(serializeLegalCaseFile(buildFullLegalCaseV3())));
    const before = JSON.stringify(parsed);
    parseLegalCaseFile(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
  });
});

describe('séparation des lecteurs v2 / v3', () => {
  const v2File = () => roundTrip({ version: 2, case: buildLegalCaseV2Fixture() });
  const v3File = () => roundTrip(JSON.parse(serializeLegalCaseFile(buildFullLegalCaseV3())));

  it('un fichier v2 est rejeté par le lecteur strict avec le motif legacy_version (jamais lu comme v3)', () => {
    expect(reasonOf(() => parseLegalCaseFile(v2File()))).toBe('legacy_version');
  });

  it('un fichier v2 est lu par le lecteur legacy, sans migration', () => {
    const result = parseLegacyLegalCaseFile(v2File());
    expect(result).toEqual(buildLegalCaseV2Fixture());
    expect(Array.isArray(result.facts)).toBe(false);
    expect(result.facts).toHaveProperty('established');
  });

  it('un fichier v3 est lu par le lecteur strict et refusé par le lecteur legacy', () => {
    expect(parseLegalCaseFile(v3File())).toEqual(buildFullLegalCaseV3());
    expect(reasonOf(() => parseLegacyLegalCaseFile(v3File()))).toBe('unknown_version');
  });

  it.each([1, 4, 999, '3', null, undefined])(
    'une version inconnue (%j) est rejetée par les deux lecteurs',
    (version) => {
      const file = { version, case: {} };
      expect(reasonOf(() => parseLegalCaseFile(file))).toBe('unknown_version');
      expect(reasonOf(() => parseLegacyLegalCaseFile(file))).toBe('unknown_version');
    },
  );

  it('un v2 invalide échoue au lecteur legacy (invalid_case) et reste refusé par le strict', () => {
    const broken = { version: 2, case: { id: 'x' } };
    expect(reasonOf(() => parseLegacyLegalCaseFile(broken))).toBe('invalid_case');
    expect(reasonOf(() => parseLegalCaseFile(broken))).toBe('legacy_version');
  });

  it('un v3 invalide échoue au lecteur strict (invalid_case)', () => {
    expect(reasonOf(() => parseLegalCaseFile({ version: 3, case: { id: 'x' } }))).toBe(
      'invalid_case',
    );
    const legalCase = buildFullLegalCaseV3();
    const mixed = {
      version: 3,
      case: {
        ...legalCase,
        facts: { established: [], alleged: [], contradictory: [], unknown: [] },
      },
    };
    expect(reasonOf(() => parseLegalCaseFile(roundTrip(mixed)))).toBe('invalid_case');
  });

  it('un dossier v2 enveloppé en version 3 est rejeté : aucun enrichissement silencieux', () => {
    const disguised = { version: 3, case: buildLegalCaseV2Fixture() };
    expect(reasonOf(() => parseLegalCaseFile(roundTrip(disguised)))).toBe('invalid_case');
  });

  it('racine non objet et clé d’enveloppe inconnue : invalid_structure pour les deux lecteurs', () => {
    for (const parse of [parseLegalCaseFile, parseLegacyLegalCaseFile]) {
      expect(reasonOf(() => parse('x'))).toBe('invalid_structure');
      expect(reasonOf(() => parse(null))).toBe('invalid_structure');
      expect(reasonOf(() => parse({ version: 3, case: {}, extra: 1 }))).toBe('invalid_structure');
    }
  });
});
