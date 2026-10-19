/**
 * `@jarvis/project-briefs` — fiches projet persistantes pour le rôle
 * product builder de Jarvis.
 *
 * Package **feuille** : aucune dépendance `@jarvis/*`, aucun import du
 * prototype `prototypes/situation-poc` (voir `ADR-0010` : ce chantier n'est
 * pas une généralisation de la Situation, c'est un domaine séparé et
 * indépendant, au même titre que `@jarvis/legal-case-store`).
 */
export {
  CURRENT_PROJECT_BRIEF_FILE_VERSION,
  LEGACY_PROJECT_BRIEF_FILE_VERSION,
  MAX_ANSWER_CHARS,
  MAX_ID_CHARS,
  MAX_ITEM_CHARS,
  MAX_LINKS_PER_ITEM,
  MAX_LIST_ITEMS,
  MAX_NAME_CHARS,
  PROJECT_ID_PATTERN,
  isBoundedNonEmptyText,
  isValidProjectId,
  nextStableId,
} from './project-brief.js';
export type {
  Decision,
  DecisionStatus,
  ItemRef,
  ProjectBrief,
  ProjectBriefFileVersion,
  Question,
  QuestionStatus,
  Source,
  SourcedItem,
  TextItem,
} from './project-brief.js';

export { ProjectBriefFileError, ProjectBriefStoreError } from './project-brief-errors.js';
export type {
  ProjectBriefFileErrorReason,
  ProjectBriefStoreErrorReason,
} from './project-brief-errors.js';

export { parseProjectBriefFile, serializeProjectBriefFile } from './project-brief-file-format.js';

export { ProjectBriefLockError, acquireProjectBriefLock } from './project-brief-lock.js';

export { FileProjectBriefStore } from './project-brief-file-store.js';
export type { FileProjectBriefStoreOptions } from './project-brief-file-store.js';

export { pickNextQuestion } from './next-question.js';
export type { NextQuestionResult } from './next-question.js';

export {
  describeDecisionBasis,
  escapeMarkdownText,
  renderProjectBriefMarkdown,
} from './project-brief-markdown.js';
