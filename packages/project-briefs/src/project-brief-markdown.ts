import { pickNextQuestion } from './next-question.js';
import type { Decision, ProjectBrief, Question, TextItem } from './project-brief.js';

/**
 * Rendu Markdown **pur et déterministe** d'une fiche projet — aucune I/O
 * (l'écriture du fichier vit dans la couche desktop, jamais ici). Même
 * `ProjectBrief` en entrée → même chaîne en sortie, toujours.
 *
 * Tout texte saisi par l'utilisateur passe par {@link escapeMarkdownText} :
 * un fait/une question contenant du Markdown, du HTML, un `[[wikilien]]`,
 * un bloc de code ou une apparence de propriété YAML doit rester du texte
 * littéral dans le rendu, jamais une structure active. Cette note n'écrit
 * jamais de bloc de propriétés YAML (`---`) en tête de fichier : le risque
 * qu'un texte utilisateur soit confondu avec de vraies propriétés Obsidian
 * disparaît par construction, pas seulement par échappement.
 */

const EXPORT_WARNING = 'Instantané exporté — modifier cette note ne met pas à jour Jarvis.';

/**
 * Aplati les retours à la ligne (un champ reste une seule ligne logique —
 * jamais de nouveau bloc Markdown caché dans un fait) puis échappe tout
 * caractère de ponctuation ASCII qui a un sens spécial en Markdown ou en
 * HTML. Le backslash est échappé par le même passage (une seule lecture du
 * texte source, jamais un second passage sur le résultat déjà échappé).
 */
export function escapeMarkdownText(text: string): string {
  const flattened = text.replace(/\r\n|\r|\n/g, ' ');
  return flattened.replace(/[\\`*_{}[\]()#+\-.!|>~<]/g, (ch) => `\\${ch}`);
}

function renderTextItemList(items: readonly TextItem[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [emptyLabel];
  }
  return items.map((item) => `- [${item.id}] ${escapeMarkdownText(item.text)}`);
}

function renderDecisions(decisions: readonly Decision[]): string[] {
  if (decisions.length === 0) {
    return ['(aucune)'];
  }
  return decisions.map((d) => `- [${d.id}:${d.status}] ${escapeMarkdownText(d.text)}`);
}

function renderQuestions(questions: readonly Question[], status: Question['status']): string[] {
  const filtered = questions.filter((q) => q.status === status);
  if (filtered.length === 0) {
    return ['(aucune)'];
  }
  return filtered.map((q) =>
    q.answer === undefined
      ? `- [${q.id}] ${escapeMarkdownText(q.text)}`
      : `- [${q.id}] ${escapeMarkdownText(q.text)} — Réponse : ${escapeMarkdownText(q.answer)}`,
  );
}

function renderNextQuestion(brief: ProjectBrief): string {
  const result = pickNextQuestion(brief);
  return result.status === 'none'
    ? 'Aucune question ouverte restante (règle fixe) — rien à sélectionner.'
    : `[${result.question.id}] ${escapeMarkdownText(result.question.text)} ` +
        "(sélection par règle fixe — première question ouverte, ordre d'ajout ; pas un raisonnement)";
}

export function renderProjectBriefMarkdown(brief: ProjectBrief): string {
  const lines: string[] = [
    `# Export — ${escapeMarkdownText(brief.id)}`,
    '',
    `> ${EXPORT_WARNING}`,
    '',
    `- Identifiant : \`${brief.id}\``,
    `- Nom : ${escapeMarkdownText(brief.name)}`,
    `- Révision : ${brief.revision}`,
    `- Dernière modification : ${brief.updatedAt}`,
    '',
    '## Faits déclarés',
    '',
    "(rapportés par l'utilisateur — jamais vérifiés de l'extérieur par cet export)",
    '',
    ...renderTextItemList(brief.facts, '(aucun)'),
    '',
    '## Hypothèses',
    '',
    ...renderTextItemList(brief.hypotheses, '(aucune)'),
    '',
    '## Décisions',
    '',
    ...renderDecisions(brief.decisions),
    '',
    '## Questions ouvertes',
    '',
    ...renderQuestions(brief.questions, 'open'),
    '',
    '## Questions résolues',
    '',
    ...renderQuestions(brief.questions, 'resolved'),
    '',
    '## Prochaine question',
    '',
    renderNextQuestion(brief),
    '',
  ];
  return lines.join('\n');
}
