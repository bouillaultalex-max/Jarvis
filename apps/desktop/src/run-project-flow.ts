import {
  ProjectBriefStoreError,
  describeDecisionBasis,
  type FileProjectBriefStore,
  type ProjectBrief,
  type SourcedItem,
  pickNextQuestion,
  type NextQuestionResult,
} from '@jarvis/project-briefs';

import type { ProjectInput } from './project-args.js';

/**
 * `export-markdown` est géré séparément par `runExportMarkdownFlow` (lecture
 * seule, écriture de fichier) ; `interview` est géré séparément par
 * `runProjectInterview` (boucle interactive, pas une opération unique).
 */
export type MutableProjectInput = Exclude<
  ProjectInput,
  { readonly op: 'export-markdown' } | { readonly op: 'interview' }
>;

export interface ProjectFlowDeps {
  readonly store: FileProjectBriefStore;
}

export type ProjectFlowResult =
  | { readonly status: 'ok'; readonly op: MutableProjectInput['op']; readonly brief: ProjectBrief }
  | { readonly status: 'not-found'; readonly id: string }
  | { readonly status: 'next-question'; readonly result: NextQuestionResult }
  | { readonly status: 'error'; readonly reason: string; readonly message: string };

/**
 * Fonction pure côté E/S injectée (`deps.store`) — aucun réseau, aucune
 * dépendance Gmail/Légifrance/LLM. Les erreurs opérationnelles du store
 * (`ProjectBriefStoreError`) sont converties ici en résultat contrôlé,
 * jamais laissées remonter comme une exception non gérée — à la différence
 * d'un argument mal formé (rejeté plus tôt par `parseProjectArgs`, avant
 * même d'atteindre cette fonction).
 */
export function runProjectFlow(
  input: MutableProjectInput,
  deps: ProjectFlowDeps,
): ProjectFlowResult {
  try {
    switch (input.op) {
      case 'create':
        return { status: 'ok', op: input.op, brief: deps.store.create(input.id, input.name) };
      case 'show': {
        const brief = deps.store.get(input.id);
        return brief === undefined
          ? { status: 'not-found', id: input.id }
          : { status: 'ok', op: input.op, brief };
      }
      case 'add-fact':
        return { status: 'ok', op: input.op, brief: deps.store.addFact(input.id, input.text) };
      case 'add-hypothesis':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.addHypothesis(input.id, input.text),
        };
      case 'add-question':
        return { status: 'ok', op: input.op, brief: deps.store.addQuestion(input.id, input.text) };
      case 'answer-question':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.answerQuestion(input.id, input.questionId, input.answer),
        };
      case 'add-decision':
        return { status: 'ok', op: input.op, brief: deps.store.addDecision(input.id, input.text) };
      case 'validate-decision':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.validateDecision(input.id, input.decisionId),
        };
      case 'obsolete-decision':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.obsoleteDecision(input.id, input.decisionId),
        };
      case 'add-source':
        return { status: 'ok', op: input.op, brief: deps.store.addSource(input.id, input.text) };
      case 'add-need':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.addNeed(input.id, input.text, input.sourceIds),
        };
      case 'link-source':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.linkSource(input.id, input.item, input.sourceId),
        };
      case 'justify-decision':
        return {
          status: 'ok',
          op: input.op,
          brief: deps.store.justifyDecision(input.id, input.decisionId, input.item),
        };
      case 'next-question': {
        const brief = deps.store.get(input.id);
        if (brief === undefined) {
          return { status: 'not-found', id: input.id };
        }
        return { status: 'next-question', result: pickNextQuestion(brief) };
      }
    }
  } catch (err) {
    if (err instanceof ProjectBriefStoreError) {
      return { status: 'error', reason: err.reason, message: err.message };
    }
    throw err;
  }
}

function sourcedItemLabel(item: SourcedItem): string {
  const sources =
    item.sourceIds === undefined
      ? 'source non renseignée'
      : `sources : ${item.sourceIds.join(', ')}`;
  return `[${item.id}] ${item.text} {${sources}}`;
}

function briefSummaryLines(brief: ProjectBrief): string[] {
  return [
    `Projet « ${brief.id} » — ${brief.name} (révision ${brief.revision}, mis à jour ${brief.updatedAt}).`,
    `Sources déclarées, non vérifiées (${brief.sources.length}) : ${
      brief.sources.map((s) => `[${s.id}] ${s.text}`).join(' | ') || '(aucune)'
    }`,
    `Faits (${brief.facts.length}) : ${brief.facts.map(sourcedItemLabel).join(' | ') || '(aucun)'}`,
    `Hypothèses (${brief.hypotheses.length}) : ${
      brief.hypotheses.map(sourcedItemLabel).join(' | ') || '(aucune)'
    }`,
    `Besoins déclarés, non vérifiés (${brief.needs.length}) : ${
      brief.needs.map(sourcedItemLabel).join(' | ') || '(aucun)'
    }`,
    `Décisions (${brief.decisions.length}) : ${
      brief.decisions
        .map((d) => `[${d.id}:${d.status}] ${d.text} {${describeDecisionBasis(d)}}`)
        .join(' | ') || '(aucune)'
    }`,
    `Questions (${brief.questions.length}) : ${
      brief.questions
        .map(
          (q) => `[${q.id}:${q.status}] ${q.text}${q.answer !== undefined ? ` → ${q.answer}` : ''}`,
        )
        .join(' | ') || '(aucune)'
    }`,
  ];
}

export function describeProjectResult(result: ProjectFlowResult): string[] {
  switch (result.status) {
    case 'ok':
      return briefSummaryLines(result.brief);
    case 'not-found':
      return [`Projet « ${result.id} » introuvable.`];
    case 'next-question':
      return result.result.status === 'selected'
        ? [
            `Question suivante (sélection par règle fixe — première question ouverte, ordre ` +
              `d'ajout ; ceci n'est pas un raisonnement, seulement un filtre déterministe) : ` +
              `[${result.result.question.id}] ${result.result.question.text}`,
          ]
        : [
            'Aucune question ouverte restante (règle fixe) — rien à sélectionner ; ceci ne ' +
              "signifie pas qu'une décision doit être prise.",
          ];
    case 'error':
      return [`Erreur [${result.reason}] : ${result.message}`];
  }
}

export function projectExitCode(result: ProjectFlowResult): number {
  return result.status === 'ok' || result.status === 'next-question' ? 0 : 1;
}
