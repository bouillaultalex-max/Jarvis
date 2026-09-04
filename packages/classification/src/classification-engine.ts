import type { EmailMessage } from '@jarvis/types';

import type { ClassificationResult } from './classification.js';
import type { EmailLlmClassifier } from './llm-classifier.js';
import { matchPreference } from './preference-matcher.js';
import type { Preference, PreferenceAttribute, PreferenceDecision, PreferenceStore } from './preference.js';

const DEFAULT_UNCERTAIN_REASON =
  'Aucune préférence connue et aucune classification exploitable : classement par défaut.';

export interface ClassificationEngineOptions {
  readonly preferenceStore: PreferenceStore;
  /** Absent → le moteur ne fait jamais appel à un LLM (repli direct sur `uncertain`). */
  readonly llmClassifier?: EmailLlmClassifier;
}

/**
 * Moteur de classification d'emails, indépendant de tout fournisseur.
 *
 * Résolution :
 *   1. une préférence utilisateur correspond (`explicit_rule` ou
 *      `user_correction`, même priorité) → décision de la préférence,
 *      jamais outrepassée par le LLM ;
 *   2. sinon, un `EmailLlmClassifier` est fourni et renvoie une décision
 *      exploitable → décision du LLM ;
 *   3. sinon → `uncertain`.
 */
export class ClassificationEngine {
  private readonly preferenceStore: PreferenceStore;
  private readonly llmClassifier: EmailLlmClassifier | undefined;

  constructor(options: ClassificationEngineOptions) {
    this.preferenceStore = options.preferenceStore;
    this.llmClassifier = options.llmClassifier;
  }

  async classify(email: EmailMessage): Promise<ClassificationResult> {
    const matched = matchPreference(email, this.preferenceStore.list());
    if (matched !== undefined) {
      return {
        label: matched.decision,
        source: matched.origin,
        reason: matched.reason,
        preferenceId: matched.id,
      };
    }

    if (this.llmClassifier !== undefined) {
      const llmResult = await this.llmClassifier.classify(email);
      if (llmResult !== undefined) {
        return {
          label: llmResult.label,
          source: 'llm',
          reason: llmResult.reason,
          ...(llmResult.confidence !== undefined ? { confidence: llmResult.confidence } : {}),
        };
      }
    }

    return { label: 'uncertain', source: 'default', reason: DEFAULT_UNCERTAIN_REASON };
  }

  /**
   * Règle générale déclarée explicitement par l'utilisateur, indépendamment
   * de tout email précis (ex. « les mails de mon patron sont importants »).
   */
  addExplicitRule(rule: {
    readonly attribute: PreferenceAttribute;
    readonly value: string;
    readonly decision: PreferenceDecision;
    readonly reason: string;
  }): Preference {
    return this.preferenceStore.add({
      attribute: rule.attribute,
      value: rule.value,
      decision: rule.decision,
      origin: 'explicit_rule',
      reason: rule.reason,
    });
  }

  /**
   * Correction ponctuelle de l'utilisateur sur un email précis (« non, ceux
   * de cet expéditeur sont importants »). Ne crée par défaut qu'une
   * préférence de portée `sender` — jamais `domain` ou `keyword` — pour
   * éviter qu'une correction ponctuelle ne se généralise sans contexte
   * explicite.
   */
  learnFromFeedback(
    email: EmailMessage,
    decision: PreferenceDecision,
    options?: { readonly reason?: string },
  ): Preference {
    const reason =
      options?.reason ??
      `Correction de l'utilisateur : les messages de « ${email.sender} » sont désormais classés « ${decision} ».`;

    return this.preferenceStore.add({
      attribute: 'sender',
      value: email.sender,
      decision,
      origin: 'user_correction',
      reason,
    });
  }
}
