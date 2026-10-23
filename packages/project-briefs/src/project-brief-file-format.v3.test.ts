import { describe, expect, it } from 'vitest';

import type { ProjectBrief } from './project-brief.js';
import { ProjectBriefFileError } from './project-brief-errors.js';
import { parseProjectBriefFile, serializeProjectBriefFile } from './project-brief-file-format.js';
import { parseProjectBriefFile as oldParseProjectBriefFile } from './testing/legacy-parser-b13ec43.js';

const NEED_TEXT = 'Je veux suivre mon stock sans ressaisir mes commandes.';

function v1Raw(): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'Projet fictif',
    formatVersion: 1,
    revision: 4,
    facts: [{ id: 'fact-1', text: 'Un fait' }],
    hypotheses: [],
    decisions: [],
    questions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function v2Raw(): Record<string, unknown> {
  const { id, name, revision, ...rest } = v1Raw();
  delete rest.formatVersion;
  // Ordre de clés canonique du sérialiseur (sources juste après revision).
  return {
    id,
    name,
    formatVersion: 2,
    revision,
    sources: [{ id: 'src-1', text: 'Échange oral fictif' }],
    ...rest,
  };
}

function v3Raw(): Record<string, unknown> {
  return {
    ...v2Raw(),
    formatVersion: 3,
    needs: [
      { id: 'need-1', text: NEED_TEXT, sourceIds: ['src-1'] },
      { id: 'need-2', text: 'Un besoin sans source' },
    ],
  };
}

function oldReasonOf(raw: unknown): string | undefined {
  try {
    oldParseProjectBriefFile(raw, 'f.json');
  } catch (err) {
    if (err instanceof ProjectBriefFileError) return err.reason;
    throw err;
  }
  return undefined;
}

function reasonOf(raw: unknown): string | undefined {
  try {
    parseProjectBriefFile(raw, 'f.json');
  } catch (err) {
    if (err instanceof ProjectBriefFileError) return err.reason;
    throw err;
  }
  return undefined;
}

describe('NOUVEAU lecteur accepte v1/v2/v3 et lit needs', () => {
  it('lit v1 (needs vide), v2 (needs vide) et v3 (needs lus avec leurs sources)', () => {
    const v1 = parseProjectBriefFile(v1Raw(), 'f.json');
    const v2 = parseProjectBriefFile(v2Raw(), 'f.json');
    const v3 = parseProjectBriefFile(v3Raw(), 'f.json');
    expect([v1.formatVersion, v2.formatVersion, v3.formatVersion]).toEqual([1, 2, 3]);
    expect(v1.needs).toEqual([]);
    expect(v2.needs).toEqual([]);
    expect(v3.needs).toEqual([
      { id: 'need-1', text: NEED_TEXT, sourceIds: ['src-1'] },
      { id: 'need-2', text: 'Un besoin sans source' },
    ]);
  });

  it('version inconnue (4, 0, absente) → unknown_version', () => {
    expect(reasonOf({ ...v3Raw(), formatVersion: 4 })).toBe('unknown_version');
    expect(reasonOf({ ...v3Raw(), formatVersion: 0 })).toBe('unknown_version');
    const withoutVersion = v3Raw();
    delete withoutVersion.formatVersion;
    expect(reasonOf(withoutVersion)).toBe('unknown_version');
  });

  it('v3 : aller-retour fidèle ; needs omis quand vide ; sources/liens préservés', () => {
    const raw = v3Raw();
    expect(JSON.parse(serializeProjectBriefFile(parseProjectBriefFile(raw, 'f.json')))).toEqual(
      raw,
    );
    const empty = parseProjectBriefFile({ ...raw, needs: [] }, 'f.json');
    expect(JSON.parse(serializeProjectBriefFile(empty))).not.toHaveProperty('needs');
  });
});

describe('clé needs et intégrité', () => {
  it('clé `needs` interdite dans un fichier v1 et v2 → invalid_structure', () => {
    expect(reasonOf({ ...v1Raw(), needs: [] })).toBe('invalid_structure');
    expect(reasonOf({ ...v2Raw(), needs: [] })).toBe('invalid_structure');
    expect(reasonOf({ ...v2Raw(), needs: v3Raw().needs })).toBe('invalid_structure');
  });

  it('besoin mal formé ou clé inconnue → invalid_structure', () => {
    expect(reasonOf({ ...v3Raw(), needs: 'x' })).toBe('invalid_structure');
    expect(reasonOf({ ...v3Raw(), needs: [{ id: 'need-1', text: 'a', status: 'x' }] })).toBe(
      'invalid_structure',
    );
    expect(reasonOf({ ...v3Raw(), needs: [{ id: 'need-1', text: 'a', sourceIds: [] }] })).toBe(
      'invalid_structure',
    );
  });

  it('id de besoin dupliqué → duplicate_id ; source répétée → duplicate_reference', () => {
    expect(
      reasonOf({
        ...v3Raw(),
        needs: [
          { id: 'need-1', text: 'a' },
          { id: 'need-1', text: 'b' },
        ],
      }),
    ).toBe('duplicate_id');
    expect(
      reasonOf({ ...v3Raw(), needs: [{ id: 'need-1', text: 'a', sourceIds: ['src-1', 'src-1'] }] }),
    ).toBe('duplicate_reference');
  });

  it('source de besoin orpheline → dangling_reference', () => {
    expect(
      reasonOf({ ...v3Raw(), needs: [{ id: 'need-1', text: 'a', sourceIds: ['src-9'] }] }),
    ).toBe('dangling_reference');
  });

  it('plus de 20 sources sur un besoin → invalid_structure', () => {
    const sourceIds = Array.from({ length: 21 }, (_, i) => `src-${i + 1}`);
    const sources = sourceIds.map((id) => ({ id, text: 't' }));
    expect(reasonOf({ ...v3Raw(), sources, needs: [{ id: 'need-1', text: 'a', sourceIds }] })).toBe(
      'invalid_structure',
    );
  });

  it('serialize refuse une fiche v1/v2 qui porte des besoins (jamais de perte silencieuse)', () => {
    const brief: ProjectBrief = { ...parseProjectBriefFile(v3Raw(), 'f.json'), formatVersion: 2 };
    expect(() => serializeProjectBriefFile(brief)).toThrow(/besoins/);
  });
});

describe('ANCIEN comportement : le parseur strict antérieur à la tranche refuse formatVersion: 3 avec unknown_version', () => {
  it('un ancien binaire échoue proprement sur un fichier v3 (attendu, pas une régression)', () => {
    expect(oldReasonOf(v3Raw())).toBe('unknown_version');
  });

  it('le vrai parseur figé (commit b13ec43) accepte toujours v1 et v2 et refuse needs en v2', () => {
    expect(oldReasonOf(v1Raw())).toBeUndefined();
    expect(oldReasonOf(v2Raw())).toBeUndefined();
    expect(oldReasonOf({ ...v2Raw(), needs: [] })).toBe('invalid_structure');
  });
});

describe('garantie : lire v1/v2 puis réécrire est identique octet pour octet', () => {
  it.each([
    ['v1', v1Raw],
    ['v2', v2Raw],
  ])('%s : parse → serialize reproduit exactement le texte source', (_name, make) => {
    const text = JSON.stringify(make(), null, 2);
    const brief = parseProjectBriefFile(JSON.parse(text), 'f.json');
    expect(serializeProjectBriefFile(brief)).toBe(text);
  });
});
