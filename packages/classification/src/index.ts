export type {
  PreferenceAttribute,
  PreferenceOrigin,
  PreferenceDecision,
  Preference,
  PreferenceInput,
  PreferenceStore,
} from './preference.js';
export { InMemoryPreferenceStore } from './preference.js';

export { matchPreference } from './preference-matcher.js';

export type { ClassificationLabel, ClassificationSource, ClassificationResult } from './classification.js';

export type { LlmClassificationOutput, EmailLlmClassifier } from './llm-classifier.js';
export { MAX_BODY_EXCERPT_CHARS, buildClassificationPrompt, LlmProviderEmailClassifier } from './llm-classifier.js';

export type { ClassificationEngineOptions } from './classification-engine.js';
export { ClassificationEngine } from './classification-engine.js';
