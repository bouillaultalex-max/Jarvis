import { pickNextQuestion } from './next-question.js';
import type { Decision, ProjectBrief, Question, SourcedItem, TextItem } from './project-brief.js';

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

/**
 * Identifiants rendus échappés comme tout texte : le format JSON n'exige
 * qu'une chaîne non vide, un fichier accepté peut donc en porter un contenant
 * du Markdown/HTML/wikilien. Seul le rendu change, jamais la valeur stockée.
 */
const esc = escapeMarkdownText;

function renderTextItemList(items: readonly TextItem[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [emptyLabel];
  }
  return items.map((item) => `- [${esc(item.id)}] ${escapeMarkdownText(item.text)}`);
}

/** Absence de source affichée explicitement — jamais déduite ni inventée. */
function renderSourcedItemList(items: readonly SourcedItem[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [emptyLabel];
  }
  return items.map((item) => {
    const sources =
      item.sourceIds === undefined
        ? 'source non renseignée'
        : `sources : ${item.sourceIds.map(esc).join(', ')}`;
    return `- [${esc(item.id)}] ${escapeMarkdownText(item.text)} — ${sources}`;
  });
}

/**
 * Une décision validée sans justification est signalée, jamais masquée.
 * `formatId` : identité par défaut (sortie terminal) ; l'export Markdown
 * passe {@link escapeMarkdownText}.
 */
export function describeDecisionBasis(
  decision: Decision,
  formatId: (id: string) => string = (id) => id,
): string {
  if (decision.basis !== undefined) {
    return `justifiée par : ${decision.basis.map((r) => formatId(r.id)).join(', ')}`;
  }
  return decision.status === 'validated'
    ? 'validée sans justification enregistrée'
    : 'aucune justification enregistrée';
}

function renderDecisions(decisions: readonly Decision[]): string[] {
  if (decisions.length === 0) {
    return ['(aucune)'];
  }
  return decisions.map(
    (d) =>
      `- [${esc(d.id)}:${d.status}] ${escapeMarkdownText(d.text)} — ${describeDecisionBasis(d, esc)}`,
  );
}

function renderQuestions(questions: readonly Question[], status: Question['status']): string[] {
  const filtered = questions.filter((q) => q.status === status);
  if (filtered.length === 0) {
    return ['(aucune)'];
  }
  return filtered.map((q) =>
    q.answer === undefined
      ? `- [${esc(q.id)}] ${escapeMarkdownText(q.text)}`
      : `- [${esc(q.id)}] ${escapeMarkdownText(q.text)} — Réponse : ${escapeMarkdownText(q.answer)}`,
  );
}

function renderNextQuestion(brief: ProjectBrief): string {
  const result = pickNextQuestion(brief);
  return result.status === 'none'
    ? 'Aucune question ouverte restante (règle fixe) — rien à sélectionner.'
    : `[${esc(result.question.id)}] ${escapeMarkdownText(result.question.text)} ` +
        "(sélection par règle fixe — première question ouverte, ordre d'ajout ; pas un raisonnement)";
}

export function renderProjectBriefMarkdown(brief: ProjectBrief): string {
  const lines: string[] = [
    `# Export — ${escapeMarkdownText(brief.id)}`,
    '',
    `> ${EXPORT_WARNING}`,
    '',
    `- Identifiant : ${esc(brief.id)}`,
    `- Nom : ${escapeMarkdownText(brief.name)}`,
    `- Révision : ${brief.revision}`,
    `- Dernière modification : ${brief.updatedAt}`,
    '',
    '## Sources déclarées',
    '',
    "(déclarées par l'utilisateur — jamais vérifiées par Jarvis ni par cet export)",
    '',
    ...renderTextItemList(brief.sources, '(aucune)'),
    '',
    '## Faits déclarés',
    '',
    "(rapportés par l'utilisateur — jamais vérifiés de l'extérieur par cet export)",
    '',
    ...renderSourcedItemList(brief.facts, '(aucun)'),
    '',
    '## Hypothèses',
    '',
    ...renderSourcedItemList(brief.hypotheses, '(aucune)'),
    '',
    '## Décisions',
    '',
    '(une justification relie une décision à des éléments déclarés — elle ne prouve pas sa validité)',
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
