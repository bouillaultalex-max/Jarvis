import type { LlmMessage, LlmProvider } from '@jarvis/llm';
import type { EmailMessage } from '@jarvis/types';

import type { ClassificationLabel } from './classification.js';

/**
 * Nombre maximal de caractères du corps transmis au LLM. Un extrait borné —
 * jamais le corps entier — limite la quantité de contenu potentiellement
 * sensible envoyée hors du moteur de classification.
 */
export const MAX_BODY_EXCERPT_CHARS = 500;

export interface LlmClassificationOutput {
  readonly label: ClassificationLabel;
  readonly reason: string;
  readonly confidence?: number;
}

/**
 * Abstraction de classification par LLM. Le moteur de classification ne
 * connaît que cette interface — jamais un `LlmProvider` concret ni la façon
 * dont le prompt est construit.
 */
export interface EmailLlmClassifier {
  /** `undefined` = réponse inexploitable ou erreur technique : le moteur retombe sur `uncertain`. */
  classify(email: EmailMessage): Promise<LlmClassificationOutput | undefined>;
}

function boundedExcerpt(body: string): string {
  return body.length > MAX_BODY_EXCERPT_CHARS
    ? `${body.slice(0, MAX_BODY_EXCERPT_CHARS)}…`
    : body;
}

/**
 * Construit les messages envoyés au LLM.
 *
 * Exclut délibérément `recipients` et `threadId` : ni l'un ni l'autre n'est
 * nécessaire pour juger l'importance d'un message, et `recipients` peut
 * exposer des adresses tierces sans rapport avec la décision. Le corps est
 * borné à {@link MAX_BODY_EXCERPT_CHARS} caractères.
 */
export function buildClassificationPrompt(email: EmailMessage): LlmMessage[] {
  const system = [
    "Tu évalues l'importance d'un email pour son destinataire.",
    'Réponds strictement en JSON, sans texte autour : ' +
      '{"label": "important" | "not_important" | "uncertain", "reason": string, "confidence"?: number}.',
  ].join('\n');

  const user = [
    `Expéditeur : ${email.sender}`,
    `Objet : ${email.subject}`,
    `Extrait du corps : ${boundedExcerpt(email.body)}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const VALID_LABELS: readonly ClassificationLabel[] = ['important', 'not_important', 'uncertain'];

function parseLlmOutput(content: string): LlmClassificationOutput | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const { label, reason, confidence } = parsed as Record<string, unknown>;

  if (typeof label !== 'string' || !VALID_LABELS.includes(label as ClassificationLabel)) {
    return undefined;
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    return undefined;
  }
  if (confidence !== undefined && typeof confidence !== 'number') {
    return undefined;
  }

  return {
    label: label as ClassificationLabel,
    reason,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * Implémentation de {@link EmailLlmClassifier} basée sur un {@link LlmProvider}
 * abstrait. Ne fait elle-même aucun appel réseau : c'est le provider injecté
 * qui en est responsable (les tests injectent un `MockLlmProvider`).
 */
export class LlmProviderEmailClassifier implements EmailLlmClassifier {
  constructor(private readonly provider: LlmProvider) {}

  async classify(email: EmailMessage): Promise<LlmClassificationOutput | undefined> {
    const messages = buildClassificationPrompt(email);

    let response;
    try {
      response = await this.provider.chat(messages);
    } catch {
      // Une erreur technique du provider ne doit jamais faire échouer la
      // classification : elle se traduit par un fallback `uncertain` côté
      // ClassificationEngine.
      return undefined;
    }

    return parseLlmOutput(response.content);
  }
}
