import { describe, expect, it } from 'vitest';

import { MAX_LINKS_PER_ITEM, type ProjectBrief } from './project-brief.js';
import { ProjectBriefFileError } from './project-brief-errors.js';
import { parseProjectBriefFile, serializeProjectBriefFile } from './project-brief-file-format.js';

/**
 * Fixture **synthétique** de forme représentative d'un fichier v1 réel
 * (révision 11, 5 faits, 5 questions ouvertes, aucune hypothèse ni décision)
 * — aucune donnée personnelle réelle lue ni copiée.
 */
function v1Raw(): Record<string, unknown> {
  return {
    id: 'boutique-fictive',
    name: 'Boutique fictive',
    formatVersion: 1,
    revision: 11,
    facts: [1, 2, 3, 4, 5].map((n) => ({ id: `fact-${n}`, text: `Fait fictif ${n}` })),
    hypotheses: [],
    decisions: [],
    questions: [1, 2, 3, 4, 5].map((n) => ({
      id: `q-${n}`,
      text: `Question fictive ${n} ?`,
      status: 'open',
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function v2Brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    id: 'p1',
    name: 'Projet',
    formatVersion: 2,
    revision: 3,
    sources: [{ id: 'src-1', text: 'Échange oral fictif' }],
    facts: [
      { id: 'fact-1', text: 'un fait', sourceIds: ['src-1'] },
      { id: 'fact-2', text: 'nu' },
    ],
    hypotheses: [{ id: 'hyp-1', text: 'une hypothèse' }],
    needs: [],
    decisions: [
      {
        id: 'dec-1',
        text: 'une décision',
        status: 'proposed',
        basis: [
          { kind: 'fact', id: 'fact-1' },
          { kind: 'hypothesis', id: 'hyp-1' },
        ],
      },
      { id: 'dec-2', text: 'sans justification', status: 'validated' },
    ],
    questions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

describe('format v1 (historique) — lecture stricte, aucune provenance inventée', () => {
  it('lu tel quel : formatVersion 1, sources vide, aucun lien déduit', () => {
    const brief = parseProjectBriefFile(v1Raw(), 'f.json');
    expect(brief.formatVersion).toBe(1);
    expect(brief.revision).toBe(11);
    expect(brief.sources).toEqual([]);
    expect(brief.facts.every((f) => f.sourceIds === undefined)).toBe(true);
  });

  it('réécrit à l’identique en v1 : aucune clé v2 ajoutée', () => {
    const raw = v1Raw();
    const reserialized = JSON.parse(
      serializeProjectBriefFile(parseProjectBriefFile(raw, 'f.json')),
    );
    expect(reserialized).toEqual(raw);
    expect(reserialized).not.toHaveProperty('sources');
  });

  it('clé v2 dans un fichier v1 → invalid_structure (jamais tolérée en silence)', () => {
    expect(reasonOf({ ...v1Raw(), sources: [] })).toBe('invalid_structure');
    const withSourceIds = v1Raw();
    (withSourceIds.facts as Record<string, unknown>[])[0]!.sourceIds = ['src-1'];
    expect(reasonOf(withSourceIds)).toBe('invalid_structure');
    const withBasis = {
      ...v1Raw(),
      decisions: [{ id: 'dec-1', text: 'd', status: 'proposed', basis: [] }],
    };
    expect(reasonOf(withBasis)).toBe('invalid_structure');
    const withValidatedAt = {
      ...v1Raw(),
      decisions: [
        { id: 'dec-1', text: 'd', status: 'validated', validatedAt: '2026-10-21T12:00:00.000Z' },
      ],
    };
    expect(reasonOf(withValidatedAt)).toBe('invalid_structure');
  });

  it('écrire une fiche v1 portant une notion v2 est refusé (jamais d’abaissement silencieux)', () => {
    const brief = { ...v2Brief(), formatVersion: 1 as const };
    expect(() => serializeProjectBriefFile(brief)).toThrow();
  });
});

describe('format v2 — sources, liens et justifications', () => {
  it('aller-retour fidèle ; listes de liens absentes omises (jamais vides sur disque)', () => {
    const original = v2Brief();
    const text = serializeProjectBriefFile(original);
    expect(parseProjectBriefFile(JSON.parse(text), 'f.json')).toEqual(original);
    const raw = JSON.parse(text);
    expect(raw.facts[1]).not.toHaveProperty('sourceIds');
    expect(raw.decisions[1]).not.toHaveProperty('basis');
  });

  it('validatedAt : aller-retour identique ; absent → omis sur disque', () => {
    const original = v2Brief({
      decisions: [
        {
          id: 'dec-1',
          text: 'validée',
          status: 'validated',
          validatedAt: '2026-10-21T12:00:00.000Z',
        },
        { id: 'dec-2', text: 'proposée', status: 'proposed' },
      ],
    });
    const text = serializeProjectBriefFile(original);
    const parsed = parseProjectBriefFile(JSON.parse(text), 'f.json');
    expect(parsed).toEqual(original);
    expect(parsed.decisions[0]!.validatedAt).toBe('2026-10-21T12:00:00.000Z');
    expect(JSON.parse(text).decisions[1]).not.toHaveProperty('validatedAt');
  });

  it('validatedAt non strictement ISO 8601 → invalid_structure (même si Date.parse l’accepte)', () => {
    const withDate = (validatedAt: unknown): unknown => {
      const raw = JSON.parse(serializeProjectBriefFile(v2Brief()));
      raw.decisions[1].validatedAt = validatedAt;
      return raw;
    };
    for (const bad of [
      'October 21, 2026',
      '2026-10-21',
      '2026-10-21T12:00:00Z',
      '2026-02-31T12:00:00.000Z',
      '',
      42,
    ]) {
      expect(reasonOf(withDate(bad))).toBe('invalid_structure');
    }
    expect(Number.isNaN(Date.parse('October 21, 2026'))).toBe(false);
    expect(reasonOf(withDate('2026-10-21T12:00:00.000Z'))).toBeUndefined();
  });

  it('v2 sans `sources` → invalid_structure ; version inconnue → unknown_version', () => {
    const raw = JSON.parse(serializeProjectBriefFile(v2Brief()));
    delete raw.sources;
    expect(reasonOf(raw)).toBe('invalid_structure');
    expect(
      reasonOf({ ...JSON.parse(serializeProjectBriefFile(v2Brief())), formatVersion: 4 }),
    ).toBe('unknown_version');
  });

  it('référence orpheline → dangling_reference (source, fait, ou type ne correspondant pas)', () => {
    const missingSource = JSON.parse(serializeProjectBriefFile(v2Brief()));
    missingSource.facts[0].sourceIds = ['src-9'];
    expect(reasonOf(missingSource)).toBe('dangling_reference');

    const missingFact = JSON.parse(serializeProjectBriefFile(v2Brief()));
    missingFact.decisions[0].basis = [{ kind: 'fact', id: 'fact-9' }];
    expect(reasonOf(missingFact)).toBe('dangling_reference');

    // `fact-1` existe, mais pas comme hypothèse : le type n'est jamais déduit de l'id.
    const wrongKind = JSON.parse(serializeProjectBriefFile(v2Brief()));
    wrongKind.decisions[0].basis = [{ kind: 'hypothesis', id: 'fact-1' }];
    expect(reasonOf(wrongKind)).toBe('dangling_reference');
  });

  it('référence répétée → duplicate_reference', () => {
    const dupSource = JSON.parse(serializeProjectBriefFile(v2Brief()));
    dupSource.facts[0].sourceIds = ['src-1', 'src-1'];
    expect(reasonOf(dupSource)).toBe('duplicate_reference');

    const dupBasis = JSON.parse(serializeProjectBriefFile(v2Brief()));
    dupBasis.decisions[0].basis = [
      { kind: 'fact', id: 'fact-1' },
      { kind: 'fact', id: 'fact-1' },
    ];
    expect(reasonOf(dupBasis)).toBe('duplicate_reference');
  });

  it('liste vide, trop longue, type inconnu ou clé inconnue → invalid_structure', () => {
    const empty = JSON.parse(serializeProjectBriefFile(v2Brief()));
    empty.facts[0].sourceIds = [];
    expect(reasonOf(empty)).toBe('invalid_structure');

    const tooMany = JSON.parse(serializeProjectBriefFile(v2Brief()));
    tooMany.facts[0].sourceIds = Array.from({ length: MAX_LINKS_PER_ITEM + 1 }, (_, i) => `s${i}`);
    expect(reasonOf(tooMany)).toBe('invalid_structure');

    const badKind = JSON.parse(serializeProjectBriefFile(v2Brief()));
    badKind.decisions[0].basis = [{ kind: 'question', id: 'q-1' }];
    expect(reasonOf(badKind)).toBe('invalid_structure');

    const extraKey = JSON.parse(serializeProjectBriefFile(v2Brief()));
    extraKey.decisions[0].basis[0].verified = true;
    expect(reasonOf(extraKey)).toBe('invalid_structure');
  });

  it('source dupliquée → duplicate_id', () => {
    const raw = JSON.parse(serializeProjectBriefFile(v2Brief()));
    raw.sources.push({ id: 'src-1', text: 'doublon' });
    expect(reasonOf(raw)).toBe('duplicate_id');
  });
});
