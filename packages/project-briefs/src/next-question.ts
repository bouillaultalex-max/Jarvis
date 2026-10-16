import type { ProjectBrief, Question } from './project-brief.js';

export type NextQuestionResult =
  { readonly status: 'selected'; readonly question: Question } | { readonly status: 'none' };

/**
 * Fonction **pure** : sélectionne la première question `open`, dans l'ordre
 * d'ajout (ordre du tableau — jamais réordonné ailleurs dans ce package).
 * Règle fixe et unique, volontairement sans lecture des faits, hypothèses
 * ou décisions : ne fabrique ni raisonnement, ni obligation de décider.
 * Une question déjà `resolved` n'est plus jamais sélectionnée.
 */
export function pickNextQuestion(brief: ProjectBrief): NextQuestionResult {
  const question = brief.questions.find((q) => q.status === 'open');
  return question === undefined ? { status: 'none' } : { status: 'selected', question };
}
