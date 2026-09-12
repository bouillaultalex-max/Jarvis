import type { MemoryEntry, MemoryListFilter, MemorySelector, MemoryStore } from '@jarvis/core';
import { LexicalMemorySelector } from '@jarvis/core';
import type { EmailMessage } from '@jarvis/types';

import type { EmailAnalysis, EmailAnalysisResult, EmailAnalyzer } from './email-analysis.js';
import type {
  EmailReplyConstraints,
  EmailReplyDraft,
  EmailReplyDraftResult,
  EmailReplyPlanner,
} from './email-reply-planner.js';

/**
 * Orchestration « Email Intelligence » de bout en bout, **couche inbox** (jamais
 * `@jarvis/core` : le graphe de dépendances l'interdit). Compose, dans un ordre
 * strict et sans fusionner les responsabilités :
 *
 *   compréhension (EmailAnalyzer)
 *     → sélection de contexte mémoire (MemorySelector, ici — jamais dans
 *       l'analyseur ni le planificateur)
 *     → style → contraintes (EmailStyleConstraintsProvider, point d'injection
 *       futur)
 *     → génération (EmailReplyPlanner)
 *     → validation (parseurs runtime des étapes précédentes)
 *
 * La **préparation Gmail** reste **hors** de ce workflow : l'appelant passe
 * `result.draft` à `prepareReplyFromDraft(executor, …)` — `gmail.prepare_reply`
 * seul, `{ messageId, body }` seuls, `gmail.send` jamais.
 *
 * Garanties :
 *   - `MemoryStore` **lecture seule** — `list()` uniquement, jamais `add` /
 *     `invalidate` / `supersede` ; aucune promotion de candidat ;
 *   - `includeInvalidated` **toujours** forcé à `false` ;
 *   - dégradation gracieuse : `list()` ou `select()` qui lève ⇒ « aucun contexte
 *     mémoire », le workflow continue ;
 *   - le contenu de l'email et la mémoire restent des **données non fiables**
 *     (garanti par les prompts/parseurs de `EmailAnalyzer` / `EmailReplyPlanner`,
 *     inchangés) ;
 *   - déterministe à composants injectés déterministes ;
 *   - `process` **ne rejette jamais** — toute défaillance devient un `status`.
 */

/** Variantes d'échec d'une analyse (tout sauf `ok`). */
export type EmailAnalysisFailure = Extract<EmailAnalysisResult, { status: 'invalid' | 'error' }>;
/** Variantes d'échec d'une génération (tout sauf `ok`). */
export type EmailReplyDraftFailure = Extract<
  EmailReplyDraftResult,
  { status: 'invalid' | 'error' }
>;

/**
 * Point d'injection d'un futur composant de style (« comment Alexandre
 * communique »). **Non implémenté ici** : ce chantier ne fournit que
 * l'interface, aucun `UserCommunicationProfile`, aucun style fabriqué.
 *
 * Une implémentation future dérivera des {@link EmailReplyConstraints} à partir
 * de réponses réellement approuvées, sans que {@link EmailReplyPlanner} ni ce
 * workflow changent.
 */
export interface EmailStyleConstraintsProvider {
  /**
   * Contraintes de rédaction pour cet email/analyse — `undefined` si aucune.
   * Doit être **pure et déterministe** (aucun réseau, aucune horloge).
   */
  constraintsFor(context: {
    readonly email: EmailMessage;
    readonly analysis: EmailAnalysis;
  }): EmailReplyConstraints | undefined;
}

export interface EmailReplyWorkflowOptions {
  /** Compréhension de l'email. */
  readonly analyzer: EmailAnalyzer;
  /** Génération de la proposition de réponse. */
  readonly planner: EmailReplyPlanner;
  /**
   * Mémoire consultée **en lecture seule**. Absente ⇒ aucun contexte mémoire
   * (`selectedMemory` vaut `[]`), comportement identique à « sans mémoire ».
   */
  readonly memory?: MemoryStore;
  /**
   * Stratégie de sélection des entrées pertinentes. Défaut :
   * {@link LexicalMemorySelector}. Remplaçable (un sélecteur sémantique se
   * branche ici sans toucher le workflow).
   */
  readonly memorySelector?: MemorySelector;
  /**
   * Filtre transmis à {@link MemoryStore.list}. `includeInvalidated` est
   * **toujours** forcé à `false`.
   */
  readonly memoryContextFilter?: MemoryListFilter;
  /** Contraintes de rédaction fixes fournies par l'appelant. */
  readonly constraints?: EmailReplyConstraints;
  /** Futur composant de style — voir {@link EmailStyleConstraintsProvider}. */
  readonly styleConstraintsProvider?: EmailStyleConstraintsProvider;
}

export interface EmailReplyWorkflowInput {
  readonly email: EmailMessage;
  /** `EmailMessage` du même fil **déjà fournis** par l'appelant. Aucune reconstruction. */
  readonly conversationContext?: readonly EmailMessage[];
}

/**
 * Résultat du workflow.
 *
 * - `analysis_failed` : l'analyse a échoué (`invalid` / `error`) → **aucune**
 *   sélection mémoire, **aucune** génération ;
 * - `draft_failed`    : l'analyse a réussi mais la génération a échoué →
 *   **aucune** préparation Gmail possible ;
 * - `ok`              : `draft` exploitable ; l'appelant décide (ou non) d'appeler
 *   `prepareReplyFromDraft`.
 */
export type EmailReplyWorkflowResult =
  | { readonly status: 'analysis_failed'; readonly analysis: EmailAnalysisFailure }
  | {
      readonly status: 'draft_failed';
      readonly analysis: EmailAnalysis;
      readonly selectedMemory: readonly MemoryEntry[];
      readonly appliedConstraints: EmailReplyConstraints | undefined;
      readonly draft: EmailReplyDraftFailure;
    }
  | {
      readonly status: 'ok';
      readonly analysis: EmailAnalysis;
      readonly selectedMemory: readonly MemoryEntry[];
      readonly appliedConstraints: EmailReplyConstraints | undefined;
      readonly draft: EmailReplyDraft;
    };

/** Longueur maximale d'extrait du corps de l'email utilisée pour la requête mémoire. */
export const MAX_MEMORY_QUERY_BODY_CHARS = 2000;

/**
 * Construit — de façon **pure et déterministe**, sans LLM — le texte de requête
 * soumis au {@link MemorySelector}. Concatène les signaux les plus
 * discriminants : objet de l'email, extrait borné du corps, et l'analyse déjà
 * distillée (résumé, intention, demandes, informations clés).
 */
export function buildMemoryQuery(email: EmailMessage, analysis: EmailAnalysis): string {
  return [
    email.subject,
    email.body.slice(0, MAX_MEMORY_QUERY_BODY_CHARS),
    analysis.summary,
    analysis.senderIntent,
    ...analysis.requests.map((item) => item.text),
    ...analysis.keyInformation.map((item) => item.text),
  ].join('\n');
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Fusionne des contraintes fixes et des contraintes dérivées du style. Les
 * scalaires **fixes l'emportent** (l'appelant est explicite) ; les listes sont
 * **concaténées et dédupliquées**. `undefined` si rien à appliquer.
 */
export function mergeConstraints(
  fixed: EmailReplyConstraints | undefined,
  derived: EmailReplyConstraints | undefined,
): EmailReplyConstraints | undefined {
  if (fixed === undefined && derived === undefined) {
    return undefined;
  }
  const f = fixed ?? {};
  const d = derived ?? {};
  const merged: { -readonly [K in keyof EmailReplyConstraints]: EmailReplyConstraints[K] } = {};

  const language = f.language ?? d.language;
  if (language !== undefined) merged.language = language;
  const maxLength = f.maxLength ?? d.maxLength;
  if (maxLength !== undefined) merged.maxLength = maxLength;
  const tone = f.tone ?? d.tone;
  if (tone !== undefined) merged.tone = tone;

  const required = dedupe([...(f.requiredPhrases ?? []), ...(d.requiredPhrases ?? [])]);
  if (required.length > 0) merged.requiredPhrases = required;
  const forbidden = dedupe([...(f.forbiddenPhrases ?? []), ...(d.forbiddenPhrases ?? [])]);
  if (forbidden.length > 0) merged.forbiddenPhrases = forbidden;

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export class EmailReplyWorkflow {
  private readonly analyzer: EmailAnalyzer;
  private readonly planner: EmailReplyPlanner;
  private readonly memory: MemoryStore | undefined;
  private readonly memorySelector: MemorySelector;
  private readonly memoryContextFilter: MemoryListFilter | undefined;
  private readonly constraints: EmailReplyConstraints | undefined;
  private readonly styleConstraintsProvider: EmailStyleConstraintsProvider | undefined;

  constructor(options: EmailReplyWorkflowOptions) {
    this.analyzer = options.analyzer;
    this.planner = options.planner;
    this.memory = options.memory;
    this.memorySelector = options.memorySelector ?? new LexicalMemorySelector();
    this.memoryContextFilter = options.memoryContextFilter;
    this.constraints = options.constraints;
    this.styleConstraintsProvider = options.styleConstraintsProvider;
  }

  /**
   * Exécute le flux complet. Ordre garanti : `analyze` **avant** toute sélection
   * mémoire, sélection mémoire **avant** `plan`. Ne rejette jamais.
   */
  async process(input: EmailReplyWorkflowInput): Promise<EmailReplyWorkflowResult> {
    const analysisResult = await this.analyzer.analyze({
      email: input.email,
      conversationContext: input.conversationContext,
    });
    if (analysisResult.status !== 'ok') {
      return { status: 'analysis_failed', analysis: analysisResult };
    }
    const analysis = analysisResult.analysis;

    const selectedMemory = this.selectMemory(input.email, analysis);

    const derived = this.styleConstraintsProvider?.constraintsFor({ email: input.email, analysis });
    const appliedConstraints = mergeConstraints(this.constraints, derived);

    const draftResult = await this.planner.plan({
      email: input.email,
      analysis,
      conversationContext: input.conversationContext,
      ...(selectedMemory.length > 0 ? { memory: selectedMemory } : {}),
      ...(appliedConstraints !== undefined ? { constraints: appliedConstraints } : {}),
    });
    if (draftResult.status !== 'ok') {
      return {
        status: 'draft_failed',
        analysis,
        selectedMemory,
        appliedConstraints,
        draft: draftResult,
      };
    }

    return {
      status: 'ok',
      analysis,
      selectedMemory,
      appliedConstraints,
      draft: draftResult.draft,
    };
  }

  /**
   * Sélection mémoire **lecture seule**, calquée sur `AgentLoop.readMemoryContext` :
   * `list()` puis `select()`, chacun sous `try/catch` renvoyant `[]`.
   * `includeInvalidated` est forcé à `false`.
   */
  private selectMemory(email: EmailMessage, analysis: EmailAnalysis): readonly MemoryEntry[] {
    if (this.memory === undefined) {
      return [];
    }
    let candidates: readonly MemoryEntry[];
    try {
      candidates = this.memory.list({ ...this.memoryContextFilter, includeInvalidated: false });
    } catch {
      return [];
    }
    if (candidates.length === 0) {
      return [];
    }
    try {
      return this.memorySelector.select({ text: buildMemoryQuery(email, analysis) }, candidates);
    } catch {
      return [];
    }
  }
}
