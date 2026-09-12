import type { MemoryEntry } from './memory-entry.js';

/**
 * Reconstitue la **lignée de remplacements** à laquelle appartient l'entrée
 * `id` : la chaîne complète des `supersede`, de la plus ancienne à la plus
 * récente, **entrées invalidées incluses**. C'est une vue d'historique
 * explicite — pas une injection de contexte (une lignée n'est jamais transmise
 * au modèle par ce module).
 *
 * Fonction **pure**, même convention que `matchPreference`
 * (`@jarvis/classification`) et `MemorySelector.select` : elle opère sur le
 * tableau d'entrées fourni — typiquement `store.list({ includeInvalidated:
 * true })` — sans consulter de store, sans rien muter, sans réseau. La logique
 * de traversée reste ainsi séparée du stockage.
 *
 * - `id` absent de `entries` → lève `Error` ;
 * - entrée sans `supersedesId` ni `supersededById` → lignée d'un seul élément ;
 * - un maillon référencé mais absent de `entries` arrête la traversée de ce
 *   côté : le résultat est le sous-ensemble réellement disponible, de façon
 *   déterministe (jamais d'erreur pour un tableau partiel) ;
 * - protection anti-cycle : chaque id n'est visité qu'une fois ;
 * - `id` dupliqué dans `entries` → la première occurrence fait foi.
 *
 * Dans une lignée complète, toutes les entrées **sauf la dernière** sont
 * invalidées ; la dernière peut l'être aussi si elle a été invalidée après
 * coup via `invalidate`.
 */
export function resolveMemoryLineage(
  entries: readonly MemoryEntry[],
  id: string,
): readonly MemoryEntry[] {
  const byId = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }

  const start = byId.get(id);
  if (start === undefined) {
    throw new Error(
      `resolveMemoryLineage : aucune entrée d'id « ${id} » dans les entrées fournies.`,
    );
  }

  const seen = new Set<string>([start.id]);

  // Remonte vers l'origine par le lien amont `supersedesId`.
  const older: MemoryEntry[] = [];
  let backId = start.supersedesId;
  while (backId !== undefined && !seen.has(backId)) {
    const entry = byId.get(backId);
    if (entry === undefined) {
      break;
    }
    seen.add(entry.id);
    older.push(entry);
    backId = entry.supersedesId;
  }
  older.reverse();

  // Descend vers la version courante par le lien aval `supersededById`.
  const newer: MemoryEntry[] = [];
  let forwardId = start.supersededById;
  while (forwardId !== undefined && !seen.has(forwardId)) {
    const entry = byId.get(forwardId);
    if (entry === undefined) {
      break;
    }
    seen.add(entry.id);
    newer.push(entry);
    forwardId = entry.supersededById;
  }

  return [...older, start, ...newer];
}
