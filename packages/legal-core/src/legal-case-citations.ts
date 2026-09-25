import type { LegalCase, LegalCitation, LegalSource } from './legal-case.js';
import { canonicalizeLegal } from './legal-canonical.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';

/**
 * Rattachement de sources et de citations **de niveau source** à un dossier —
 * ADR-0020. Fonction **pure** : aucune I/O, aucune horloge, aucune mutation.
 *
 * Elle ne décide rien de juridique (ni pertinence, ni usage dans un
 * raisonnement) : elle ajoute au dossier ce qu'une projection lui fournit,
 * en respectant les invariants du modèle. Le statut du dossier n'est pas
 * modifié (les transitions du workflow ne sont pas appliquées, voir
 * `LEGAL_SPECIFICATION.md` §7.3).
 */

export interface AttachSourcesAndCitationsInput {
  readonly sources: readonly LegalSource[];
  readonly citations: readonly LegalCitation[];
}

export interface AttachSourcesAndCitationsOptions {
  /** Nouvel `updatedAt` du dossier, **uniquement** si le rattachement ajoute quelque chose. Absent : `updatedAt` inchangé. */
  readonly updatedAt?: string;
}

/** Identité logique d'une source : autorité + identifiant stable + version — jamais `id` seul (ADR-0013). */
function logicalKey(source: Pick<LegalSource, 'authority' | 'identifier' | 'version'>): string {
  return JSON.stringify([source.authority, source.identifier, source.version]);
}

/**
 * Deux citations de même `id` désignent la même affirmation si tout est identique
 * **hors `consultedAt`** : rejouer une recherche plus tard ne crée pas une autre
 * citation (la première consultation est conservée, comme pour les sources).
 */
function sameClaim(a: LegalCitation, b: LegalCitation): boolean {
  return (
    canonicalizeLegal({ ...a, consultedAt: '' }) === canonicalizeLegal({ ...b, consultedAt: '' })
  );
}

/**
 * Ajoute au dossier les sources et citations fournies, **si elles n'y sont pas
 * déjà** :
 *
 *   - une source déjà présente sous la même identité logique (`authority` +
 *     `identifier` + `version`) est **réutilisée**, quel que soit son `id` ni son
 *     `consultedAt` ; les citations entrantes sont redirigées vers elle ;
 *   - une citation déjà présente (même `id`) et identique **hors `consultedAt`**
 *     est ignorée (la première consultation est conservée) : le rattachement est
 *     **idempotent** (le même dossier est rendu, à l'identique d'objet si rien
 *     n'est ajouté) ;
 *   - le dossier résultant est **revalidé** par {@link validateLegalCaseV3} : une
 *     citation dont la question n'existe pas dans `questions`, un `contentHash`
 *     incohérent, etc. sont refusés, jamais contournés.
 *
 * @throws {Error} si une citation référence une source absente de l'entrée ; si
 *   deux sources de même identité logique portent des empreintes de contenu
 *   différentes ; si une citation de même `id` existe déjà avec un contenu
 *   différent hors `consultedAt` (un `id` déterministe désigne une seule affirmation) ; ou si le
 *   dossier résultant est invalide.
 */
export function attachSourcesAndCitations(
  legalCase: LegalCase,
  input: AttachSourcesAndCitationsInput,
  options: AttachSourcesAndCitationsOptions = {},
): LegalCase {
  const byKey = new Map<string, LegalSource>(
    legalCase.sources.map((source) => [logicalKey(source), source] as const),
  );
  const idMap = new Map<string, string>();
  const addedSources: LegalSource[] = [];

  for (const source of input.sources) {
    const key = logicalKey(source);
    const known = byKey.get(key);
    if (known === undefined) {
      byKey.set(key, source);
      addedSources.push(source);
      idMap.set(source.id, source.id);
      continue;
    }
    if (
      known.contentHash !== undefined &&
      source.contentHash !== undefined &&
      known.contentHash !== source.contentHash
    ) {
      throw new Error(
        `attachSourcesAndCitations : la source « ${source.identifier} » version « ${source.version} » existe avec un contenu différent (empreintes distinctes).`,
      );
    }
    idMap.set(source.id, known.id);
  }

  const citationsById = new Map<string, LegalCitation>(
    legalCase.citations.map((citation) => [citation.id, citation] as const),
  );
  const addedCitations: LegalCitation[] = [];

  for (const citation of input.citations) {
    const sourceId = idMap.get(citation.sourceId);
    if (sourceId === undefined) {
      throw new Error(
        `attachSourcesAndCitations : la citation « ${citation.id} » référence la source « ${citation.sourceId} », absente de l'entrée.`,
      );
    }
    const rewritten: LegalCitation =
      sourceId === citation.sourceId ? citation : { ...citation, sourceId };

    const existing = citationsById.get(rewritten.id);
    if (existing === undefined) {
      citationsById.set(rewritten.id, rewritten);
      addedCitations.push(rewritten);
    } else if (!sameClaim(existing, rewritten)) {
      throw new Error(
        `attachSourcesAndCitations : la citation « ${rewritten.id} » existe déjà avec un contenu différent.`,
      );
    }
  }

  if (addedSources.length === 0 && addedCitations.length === 0) return legalCase;

  const next: LegalCase = {
    ...legalCase,
    ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
    sources: [...legalCase.sources, ...addedSources],
    citations: [...legalCase.citations, ...addedCitations],
  };
  const validation = validateLegalCaseV3(next);
  if (!validation.ok) {
    throw new Error(
      `attachSourcesAndCitations : dossier invalide après rattachement — ${validation.error}`,
    );
  }
  return next;
}
