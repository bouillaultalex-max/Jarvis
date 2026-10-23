import {
  MAX_LINKS_PER_ITEM,
  MAX_LIST_ITEMS,
  NEEDS_PROJECT_BRIEF_FILE_VERSION,
  type ProjectBrief,
  type SourcedItem,
  nextStableId,
  withMinimumVersion,
} from './project-brief.js';
import { ProjectBriefStoreError } from './project-brief-errors.js';

/**
 * Opérations **pures** sur les besoins déclarés (`needs`) : aucune I/O, aucune
 * révision ni date touchée (le store appelle `touch` et écrit sous verrou).
 * Toute erreur est levée AVANT de retourner une fiche : l'appelant n'écrit
 * donc jamais rien sur un refus. Un besoin est une déclaration de
 * l'utilisateur, jamais vérifiée ; ses sources non plus.
 */

function requireKnownSources(brief: ProjectBrief, sourceIds: readonly string[]): void {
  for (const sourceId of sourceIds) {
    if (!brief.sources.some((s) => s.id === sourceId)) {
      throw new ProjectBriefStoreError('unknown_source', `Source « ${sourceId} » introuvable.`);
    }
  }
}

function assertLinkRoom(links: readonly unknown[], itemId: string): void {
  if (links.length >= MAX_LINKS_PER_ITEM) {
    throw new ProjectBriefStoreError(
      'invalid_input',
      `Limite de liens atteinte pour « ${itemId} » (${MAX_LINKS_PER_ITEM} maximum).`,
    );
  }
}

/**
 * Ajoute un besoin (avec 0..n sources existantes). Première notion v3 : la
 * fiche passe en `formatVersion: 3` (jamais l'inverse). Sans source,
 * `sourceIds` est omis (« source non renseignée »).
 *
 * @throws {ProjectBriefStoreError} `invalid_input` (limite de 50 besoins ou
 *   de 20 sources), `unknown_source`, `already_linked` (source répétée).
 */
export function withNeedAdded(
  brief: ProjectBrief,
  text: string,
  sourceIds: readonly string[] = [],
): ProjectBrief {
  if (brief.needs.length >= MAX_LIST_ITEMS) {
    throw new ProjectBriefStoreError(
      'invalid_input',
      `Limite atteinte pour « needs » (${MAX_LIST_ITEMS} éléments maximum).`,
    );
  }
  const seen = new Set<string>();
  for (const sourceId of sourceIds) {
    if (seen.has(sourceId)) {
      throw new ProjectBriefStoreError(
        'already_linked',
        `Source « ${sourceId} » répétée pour le même besoin.`,
      );
    }
    seen.add(sourceId);
  }
  if (sourceIds.length > MAX_LINKS_PER_ITEM) {
    throw new ProjectBriefStoreError(
      'invalid_input',
      `Limite de liens dépassée pour un besoin (${MAX_LINKS_PER_ITEM} maximum).`,
    );
  }
  requireKnownSources(brief, sourceIds);
  const item: SourcedItem = {
    id: nextStableId(brief.needs, 'need'),
    text,
    ...(sourceIds.length > 0 ? { sourceIds: [...sourceIds] } : {}),
  };
  return withMinimumVersion(
    { ...brief, needs: [...brief.needs, item] },
    NEEDS_PROJECT_BRIEF_FILE_VERSION,
  );
}

/**
 * Relie un besoin existant à une source existante. Jamais de retrait de lien.
 *
 * @throws {ProjectBriefStoreError} `unknown_item`, `unknown_source`,
 *   `already_linked`, `invalid_input` (20 sources déjà atteintes).
 */
export function withNeedSourceLinked(
  brief: ProjectBrief,
  needId: string,
  sourceId: string,
): ProjectBrief {
  const need = brief.needs.find((n) => n.id === needId);
  if (need === undefined) {
    throw new ProjectBriefStoreError('unknown_item', `Besoin « ${needId} » introuvable.`);
  }
  requireKnownSources(brief, [sourceId]);
  const sourceIds = need.sourceIds ?? [];
  if (sourceIds.includes(sourceId)) {
    throw new ProjectBriefStoreError(
      'already_linked',
      `« ${needId} » est déjà relié à la source « ${sourceId} ».`,
    );
  }
  assertLinkRoom(sourceIds, needId);
  const updated: SourcedItem = { ...need, sourceIds: [...sourceIds, sourceId] };
  return withMinimumVersion(
    { ...brief, needs: brief.needs.map((n) => (n.id === needId ? updated : n)) },
    NEEDS_PROJECT_BRIEF_FILE_VERSION,
  );
}
