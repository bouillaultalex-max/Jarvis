import { describe, expect, it } from 'vitest';

import { ProjectBriefFileError } from './project-brief-errors.js';
import type { ProjectBrief } from './project-brief.js';
import { parseProjectBriefFile, serializeProjectBriefFile } from './project-brief-file-format.js';

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    id: 'p1',
    name: 'Projet',
    formatVersion: 1,
    revision: 1,
    facts: [{ id: 'fact-1', text: 'un fait' }],
    hypotheses: [],
    decisions: [{ id: 'dec-1', text: 'une décision', status: 'proposed' }],
    questions: [{ id: 'q-1', text: 'une question', status: 'resolved', answer: 'une réponse' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseProjectBriefFile / serializeProjectBriefFile', () => {
  it('aller-retour fidèle', () => {
    const original = brief();
    const parsed = parseProjectBriefFile(JSON.parse(serializeProjectBriefFile(original)), 'f.json');
    expect(parsed).toEqual(original);
  });

  it('formatVersion inconnu → unknown_version', () => {
    const raw = JSON.parse(serializeProjectBriefFile(brief()));
    raw.formatVersion = 2;
    expect(() => parseProjectBriefFile(raw, 'f.json')).toThrow(ProjectBriefFileError);
    try {
      parseProjectBriefFile(raw, 'f.json');
    } catch (err) {
      expect((err as ProjectBriefFileError).reason).toBe('unknown_version');
    }
  });

  it('clé inconnue à la racine → invalid_structure', () => {
    const raw = JSON.parse(serializeProjectBriefFile(brief()));
    raw.extra = 'intrus';
    expect(() => parseProjectBriefFile(raw, 'f.json')).toThrow(ProjectBriefFileError);
  });

  it('clé inconnue dans un élément → invalid_structure', () => {
    const raw = JSON.parse(serializeProjectBriefFile(brief()));
    raw.facts[0].extra = 'intrus';
    expect(() => parseProjectBriefFile(raw, 'f.json')).toThrow(ProjectBriefFileError);
  });

  it('statut de décision invalide → invalid_structure', () => {
    const raw = JSON.parse(serializeProjectBriefFile(brief()));
    raw.decisions[0].status = 'inconnu';
    expect(() => parseProjectBriefFile(raw, 'f.json')).toThrow(ProjectBriefFileError);
  });

  it('id dupliqué dans une même catégorie → duplicate_id', () => {
    const raw = JSON.parse(serializeProjectBriefFile(brief()));
    raw.facts.push({ id: 'fact-1', text: 'doublon' });
    expect(() => parseProjectBriefFile(raw, 'f.json')).toThrow(ProjectBriefFileError);
    try {
      parseProjectBriefFile(raw, 'f.json');
    } catch (err) {
      expect((err as ProjectBriefFileError).reason).toBe('duplicate_id');
    }
  });

  it('racine non-objet → invalid_structure', () => {
    expect(() => parseProjectBriefFile([], 'f.json')).toThrow(ProjectBriefFileError);
    expect(() => parseProjectBriefFile('texte', 'f.json')).toThrow(ProjectBriefFileError);
  });
});
