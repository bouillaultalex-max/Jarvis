import type { LegalCase, LegalResearchItem } from './legal-case.js';
import { canonicalizeLegal } from './legal-canonical.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';

/**
 * Rattachement de {@link LegalResearchItem} à un dossier — LEGAL-RESEARCH-ITEM-01.
 * Fonction **pure** : aucune I/O, aucune horloge, aucune mutation. Symétrique à
 * `attachSourcesAndCitations` (ADR-0020) pour `sources`/`citations`, mais
 * indépendante : elle ne touche jamais `sources`/`citations` elle-même — un
 * item est rattaché à un dossier où les citations qu'il référence sont déjà
 * présentes (typiquement via `attachSourcesAndCitations`, appelé avant).
 *
 * Contrairement à une `LegalSource` (identité technique `id` distincte de son
 * identité logique `authority`+`identifier`+`version`), un `LegalResearchItem`
 * produit par un projecteur déterministe (`research-item-projection.ts`,
 * `@jarvis/legal-research`) a un `id` **déjà** dérivé de son contenu complet
 * (question, requête, citations) : deux items de même `id` sont donc censés
 * être identiques. Ce rattachement le vérifie plutôt que de le supposer.
 */

export interface AttachResearchItemsOptions {
  /** Nouvel `updatedAt` du dossier, **uniquement** si le rattachement ajoute quelque chose. Absent : `updatedAt` inchangé. */
  readonly updatedAt?: string;
}

/**
 * Ajoute au dossier les items fournis, **s'ils n'y sont pas déjà** (même `id`
 * et même contenu) :
 *
 *   - un item de même `id` et de contenu strictement identique est ignoré
 *     (rattachement idempotent) ;
 *   - un item de même `id` mais de contenu différent est une erreur — un `id`
 *     déterministe désigne une seule affirmation, jamais deux versions
 *     silencieusement choisies l'une pour l'autre ;
 *   - chaque `citationIds[i]` doit désigner une {@link LegalCitation} déjà
 *     présente dans `legalCase.citations` ;
 *   - chaque `questionId`, s'il est présent, doit désigner une
 *     {@link LegalQuestion} déjà présente dans `legalCase.questions` ;
 *   - le dossier résultant est **revalidé** par {@link validateLegalCaseV3} —
 *     jamais contourné.
 *
 * Ne modifie ni `status`, ni aucune autre collection du dossier.
 *
 * @throws {Error} si un item référence une citation ou une question absente du
 *   dossier ; si un `id` d'item entre en collision avec un contenu différent ;
 *   ou si le dossier résultant est invalide.
 */
export function attachResearchItems(
  legalCase: LegalCase,
  items: readonly LegalResearchItem[],
  options: AttachResearchItemsOptions = {},
): LegalCase {
  const knownCitationIds = new Set(legalCase.citations.map((citation) => citation.id));
  const knownQuestionIds = new Set(legalCase.questions.map((question) => question.id));
  const existingById = new Map(legalCase.research.map((item) => [item.id, item] as const));

  const added: LegalResearchItem[] = [];

  for (const item of items) {
    for (const citationId of item.citationIds) {
      if (!knownCitationIds.has(citationId)) {
        throw new Error(
          `attachResearchItems : l'item « ${item.id} » référence la citation « ${citationId} », absente du dossier.`,
        );
      }
    }
    if (item.questionId !== undefined && !knownQuestionIds.has(item.questionId)) {
      throw new Error(
        `attachResearchItems : l'item « ${item.id} » référence la question « ${item.questionId} », absente du dossier.`,
      );
    }

    const existing = existingById.get(item.id);
    if (existing === undefined) {
      existingById.set(item.id, item);
      added.push(item);
    } else if (canonicalizeLegal(existing) !== canonicalizeLegal(item)) {
      throw new Error(
        `attachResearchItems : l'item « ${item.id} » existe déjà avec un contenu différent.`,
      );
    }
  }

  if (added.length === 0) return legalCase;

  const next: LegalCase = {
    ...legalCase,
    ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
    research: [...legalCase.research, ...added],
  };
  const validation = validateLegalCaseV3(next);
  if (!validation.ok) {
    throw new Error(
      `attachResearchItems : dossier invalide après rattachement — ${validation.error}`,
    );
  }
  return next;
}
