/**
 * Identifiant Légifrance d'un article — `LEGIARTI` + 12 chiffres, seul format
 * récupérable par `legifrance.get_article` (même motif que sa validation
 * d'entrée côté connecteur, dupliqué ici car `legal-research` ne peut pas
 * importer `@jarvis/connectors`). Partagé par le parseur de recherche et
 * l'adaptateur de récupération (LEGAL-03B).
 */
const ARTICLE_ID_PATTERN = /^LEGIARTI\d{12}$/;

export function isLegifranceArticleId(value: unknown): value is string {
  return typeof value === 'string' && ARTICLE_ID_PATTERN.test(value);
}
