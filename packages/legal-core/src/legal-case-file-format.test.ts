import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_CASE_FILE_VERSION,
  LegalCaseFileError,
  parseLegalCaseFile,
  serializeLegalCaseFile,
} from './legal-case-file-format.js';
import { createLegalCase } from './legal-case-factory.js';
import type { LegalCase } from './legal-case.js';

function buildSampleLegalCase(): LegalCase {
  const base = createLegalCase({
    title: 'Dossier de test',
    id: 'case-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  return {
    ...base,
    sources: [
      {
        id: 'src-1',
        sourceType: 'legislative_text',
        authority: 'legifrance',
        title: 'Code civil — art. 1103',
        identifier: 'LEGIARTI000006436298',
        publicationDate: '2016-02-11T00:00:00.000Z',
        effectiveFrom: '2016-10-01T00:00:00.000Z',
        consultedAt: '2026-01-01T00:00:00.000Z',
        version: '2016-10-01',
        reliability: 'primary_institutional',
      },
    ],
    citations: [
      {
        id: 'cit-1',
        sourceId: 'src-1',
        sourceVersion: '2016-10-01',
        consultedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    conclusions: [
      {
        id: 'con-1',
        statement: 'Le contrat est valablement formé.',
        confidence: 'certain',
        argumentIds: [],
        analysisIds: [],
        citationIds: ['cit-1'],
      },
    ],
  };
}

describe('serializeLegalCaseFile / parseLegalCaseFile', () => {
  it('round-trip : une affaire sérialisée puis relue est strictement égale', () => {
    const legalCase = buildSampleLegalCase();

    const serialized = serializeLegalCaseFile(legalCase);
    const parsed = JSON.parse(serialized) as unknown;
    const roundTripped = parseLegalCaseFile(parsed);

    expect(roundTripped).toEqual(legalCase);
  });

  it('sérialise sous une enveloppe versionnée { version, case }', () => {
    const legalCase = buildSampleLegalCase();
    const parsed = JSON.parse(serializeLegalCaseFile(legalCase)) as {
      version: number;
      case: unknown;
    };

    expect(parsed.version).toBe(CURRENT_LEGAL_CASE_FILE_VERSION);
    expect(parsed.case).toMatchObject({ id: legalCase.id, title: legalCase.title });
  });

  it('rejette une racine qui n’est pas un objet', () => {
    expect(() => parseLegalCaseFile('not-an-object')).toThrowError(LegalCaseFileError);
    try {
      parseLegalCaseFile(null);
    } catch (error) {
      expect(error).toBeInstanceOf(LegalCaseFileError);
      expect((error as LegalCaseFileError).reason).toBe('invalid_structure');
    }
  });

  it('rejette une clé inconnue à la racine de l’enveloppe', () => {
    const legalCase = buildSampleLegalCase();
    const tampered = {
      version: CURRENT_LEGAL_CASE_FILE_VERSION,
      case: legalCase,
      extra: 'unexpected',
    };

    try {
      parseLegalCaseFile(tampered);
      expect.unreachable('parseLegalCaseFile aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegalCaseFileError);
      expect((error as LegalCaseFileError).reason).toBe('invalid_structure');
    }
  });

  it('rejette une version inconnue (aucune migration silencieuse)', () => {
    const legalCase = buildSampleLegalCase();
    const futureVersion = { version: 999, case: legalCase };

    try {
      parseLegalCaseFile(futureVersion);
      expect.unreachable('parseLegalCaseFile aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegalCaseFileError);
      expect((error as LegalCaseFileError).reason).toBe('unknown_version');
    }
  });

  it('rejette une « case » structurellement invalide', () => {
    const invalidEnvelope = { version: CURRENT_LEGAL_CASE_FILE_VERSION, case: { id: 'case-1' } };

    try {
      parseLegalCaseFile(invalidEnvelope);
      expect.unreachable('parseLegalCaseFile aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(LegalCaseFileError);
      expect((error as LegalCaseFileError).reason).toBe('invalid_case');
    }
  });
});

describe('compatibilité LEGAL-01 (format v1) — LEGAL-02A', () => {
  it('v1 file is rejected, not silently migrated : un fichier v1 (sourceIds, LegalSource minimal) échoue avec unknown_version', () => {
    // Forme exacte d'une affaire LEGAL-01 persistée avant LEGAL-02A : `version: 1`,
    // `LegalSource` minimal (pas de sourceType/authority/identifier/…), et
    // `sourceIds` au lieu de `citationIds`. Ne doit jamais être interprétée
    // silencieusement par le parseur v2 — voir le commentaire de
    // `CURRENT_LEGAL_CASE_FILE_VERSION` dans `legal-case-file-format.ts`.
    const legacyV1Envelope = {
      version: 1,
      case: {
        id: 'case-legacy',
        title: 'Dossier LEGAL-01',
        jurisdiction: 'FR',
        status: 'ANALYZE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        facts: { established: [], alleged: [], contradictory: [], unknown: [] },
        documents: [],
        evidence: [],
        questions: [],
        research: [],
        sources: [
          { id: 'src-1', title: 'Ancienne source', consultedAt: '2026-01-01T00:00:00.000Z' },
        ],
        arguments: [{ id: 'arg-1', statement: 'Ancien argument.', sourceIds: ['src-1'] }],
        counterArguments: [],
        analysis: [],
        conclusions: [
          {
            id: 'con-1',
            statement: 'Ancienne conclusion.',
            confidence: 'certain',
            sourceIds: ['src-1'],
          },
        ],
        deadlines: [],
        actions: [],
      },
    };

    expect(CURRENT_LEGAL_CASE_FILE_VERSION).toBeGreaterThan(1);
    try {
      parseLegalCaseFile(legacyV1Envelope);
      expect.unreachable('parseLegalCaseFile aurait dû lever pour un fichier v1');
    } catch (error) {
      expect(error).toBeInstanceOf(LegalCaseFileError);
      expect((error as LegalCaseFileError).reason).toBe('unknown_version');
    }

    // Le contenu original n'est ni muté ni supprimé par la tentative de lecture.
    expect(legacyV1Envelope.version).toBe(1);
    expect(legacyV1Envelope.case.sources).toEqual([
      { id: 'src-1', title: 'Ancienne source', consultedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

describe('format de fichier v3 — champs additifs de citation (ADR-0020, inchangés)', () => {
  it('round-trip : eligibility et contentHash sont conservés en v3', () => {
    const base = buildSampleLegalCase();
    const legalCase: LegalCase = {
      ...base,
      questions: [{ id: 'q-1', question: 'Quel préavis ?', status: 'open' }],
      citations: [
        {
          ...base.citations[0]!,
          contentHash: 'c'.repeat(64),
          eligibility: {
            questionId: 'q-1',
            asOf: '2020-01-01',
            resolution: 'resolved',
            historyCompleteness: 'unknown',
          },
        },
      ],
    };

    const serialized = JSON.parse(serializeLegalCaseFile(legalCase)) as { version: number };
    expect(serialized.version).toBe(3);
    expect(CURRENT_LEGAL_CASE_FILE_VERSION).toBe(3);
    expect(parseLegalCaseFile(serialized)).toEqual(legalCase);
  });

  it('un fichier v3 dont les citations n’ont pas de champ additif reste lisible', () => {
    const legalCase = buildSampleLegalCase();
    const reloaded = parseLegalCaseFile(JSON.parse(serializeLegalCaseFile(legalCase)) as unknown);
    expect(reloaded.citations[0]).not.toHaveProperty('eligibility');
  });

  it('un fichier dont une citation vise une question absente est refusé au chargement', () => {
    const base = buildSampleLegalCase();
    const broken: LegalCase = {
      ...base,
      citations: [
        {
          ...base.citations[0]!,
          eligibility: {
            questionId: 'q-absente',
            asOf: '2020-01-01',
            resolution: 'resolved',
            historyCompleteness: 'unknown',
          },
        },
      ],
    };
    // L'écrivain refuserait ce dossier : on construit l'enveloppe à la main pour tester le chargement.
    const file = JSON.parse(JSON.stringify({ version: 3, case: broken })) as unknown;
    expect(() => parseLegalCaseFile(file)).toThrow(LegalCaseFileError);
  });
});
