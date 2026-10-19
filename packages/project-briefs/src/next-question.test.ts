import { describe, expect, it } from 'vitest';

import { pickNextQuestion } from './next-question.js';
import type { ProjectBrief } from './project-brief.js';

function brief(questions: ProjectBrief['questions']): ProjectBrief {
  return {
    id: 'p1',
    name: 'Projet',
    formatVersion: 1,
    revision: 1,
    sources: [],
    facts: [],
    hypotheses: [],
    decisions: [],
    questions,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('pickNextQuestion', () => {
  it('aucune question → "none", annoncé clairement', () => {
    expect(pickNextQuestion(brief([]))).toEqual({ status: 'none' });
  });

  it('toutes résolues → "none"', () => {
    const result = pickNextQuestion(
      brief([{ id: 'q-1', text: 'Q1', status: 'resolved', answer: 'R1' }]),
    );
    expect(result).toEqual({ status: 'none' });
  });

  it("sélectionne la première question 'open', dans l'ordre d'ajout — jamais une déjà résolue", () => {
    const result = pickNextQuestion(
      brief([
        { id: 'q-1', text: 'Q1', status: 'resolved', answer: 'R1' },
        { id: 'q-2', text: 'Q2', status: 'open' },
        { id: 'q-3', text: 'Q3', status: 'open' },
      ]),
    );
    expect(result).toEqual({
      status: 'selected',
      question: { id: 'q-2', text: 'Q2', status: 'open' },
    });
  });
});
