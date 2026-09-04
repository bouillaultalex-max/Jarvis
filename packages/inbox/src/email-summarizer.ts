import type { LlmMessage, LlmProvider } from '@jarvis/llm';
import type { EmailMessage } from '@jarvis/types';

/**
 * Nombre maximal de caractères du corps transmis au LLM pour un résumé.
 * Même logique et même valeur que le classifieur LLM d'emails
 * (`@jarvis/classification`, `MAX_BODY_EXCERPT_CHARS`), définie ici de
 * façon indépendante pour ne pas coupler ce module aux détails internes de
 * `@jarvis/classification`.
 */
export const MAX_BODY_EXCERPT_CHARS = 500;

export interface EmailSummary {
  readonly summary: string;
}

/**
 * Abstraction de résumé par LLM. Aucun appelant ne connaît un `LlmProvider`
 * concret ni la façon dont le prompt est construit.
 */
export interface EmailSummarizer {
  /** `undefined` = réponse inexploitable ou erreur technique du provider. */
  summarize(email: EmailMessage): Promise<EmailSummary | undefined>;
}

function boundedExcerpt(body: string): string {
  return body.length > MAX_BODY_EXCERPT_CHARS ? `${body.slice(0, MAX_BODY_EXCERPT_CHARS)}…` : body;
}

/**
 * Construit les messages envoyés au LLM pour produire un résumé.
 *
 * Exclut délibérément `recipients` (adresses tierces sans rapport avec le
 * contenu à résumer) et `threadId` (identifiant technique du fournisseur,
 * sans valeur pour un résumé). Le corps est borné à
 * {@link MAX_BODY_EXCERPT_CHARS} caractères. Aucun credential ni metadata
 * fournisseur ne transite jamais : seuls `sender`, `subject` et un extrait
 * de `body` sont transmis.
 */
export function buildSummaryPrompt(email: EmailMessage): LlmMessage[] {
  const system = [
    'Tu résumes un email en une ou deux phrases claires, pour son destinataire.',
    'Réponds uniquement avec le texte du résumé, sans JSON, sans préambule.',
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

/**
 * Implémentation de {@link EmailSummarizer} basée sur un {@link LlmProvider}
 * abstrait. Ne fait elle-même aucun appel réseau : c'est le provider injecté
 * qui en est responsable (les tests injectent un `MockLlmProvider`).
 */
export class LlmProviderEmailSummarizer implements EmailSummarizer {
  constructor(private readonly provider: LlmProvider) {}

  async summarize(email: EmailMessage): Promise<EmailSummary | undefined> {
    const messages = buildSummaryPrompt(email);

    let response;
    try {
      response = await this.provider.chat(messages);
    } catch {
      // Une erreur technique du provider ne doit jamais devenir un résumé
      // valide : elle se traduit par `undefined`.
      return undefined;
    }

    const summary = response.content.trim();
    return summary.length === 0 ? undefined : { summary };
  }
}
