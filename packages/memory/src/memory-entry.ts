import type { Provenance } from './provenance.js';

/**
 * Nature d'une entrée de mémoire.
 *
 * **Un seul champ discriminant** — délibérément pas quatre types distincts.
 * Fait, préférence, décision et apprentissage partagent exactement la même
 * forme de stockage ; seule leur *interprétation* par une couche supérieure
 * diffère. Introduire quatre classes maintenant serait de la sur-architecture
 * (cf. principes du chantier fondateur).
 */
export type MemoryKind =
  /** Une information tenue pour factuelle. */
  | 'fact'
  /** Une chose que l'utilisateur aime ou demande de façon récurrente. */
  | 'preference'
  /** Une décision prise par l'utilisateur. */
  | 'decision'
  /** Une information déduite de corrections ou de comportements observés. */
  | 'learning';

/** Ensemble des natures connues — exposé pour la validation et les tests. */
export const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'decision', 'learning'];

/**
 * Une entrée de la mémoire contrôlée de JARVIS.
 *
 * Immuable une fois créée, à une exception près : l'invalidation
 * (`invalidatedAt` / `invalidationReason`), qui **n'efface jamais** l'entrée —
 * elle reste traçable pour qu'une contradiction ne disparaisse pas en silence.
 */
export interface MemoryEntry {
  readonly id: string;
  readonly kind: MemoryKind;
  /** Énoncé lisible, en langage naturel. Jamais vide. */
  readonly statement: string;
  /**
   * Sujet/entité optionnel auquel se rattache l'entrée (adresse e-mail, nom de
   * projet, personne…). Sert de clé de regroupement **grossière** : la
   * détection fine des doublons et des contradictions n'est pas faite ici
   * (elle relèvera d'une couche supérieure, à l'image de `preference-matcher`).
   */
  readonly subject?: string;
  readonly provenance: Provenance;
  /** Date de création, ISO 8601. */
  readonly createdAt: string;
  /** Renseigné lorsque l'entrée a été invalidée (`invalidate` ou `supersede`). */
  readonly invalidatedAt?: string;
  /** Raison de l'invalidation, si connue. */
  readonly invalidationReason?: string;
  /**
   * Lien « amont » : id de l'entrée que celle-ci remplace (`supersede`).
   * Présent sur la **remplaçante**.
   */
  readonly supersedesId?: string;
  /**
   * Lien « aval » : id de l'entrée qui a remplacé celle-ci (`supersede`).
   * Présent sur l'**ancienne**, posé au moment où elle est invalidée par un
   * `supersede`. Absent d'une entrée invalidée via `invalidate` seul. Permet de
   * reconstituer la lignée complète des remplacements sans partir du plus
   * ancien (voir `resolveMemoryLineage`).
   */
  readonly supersededById?: string;
}

/** Entrée fournie à {@link MemoryStore.add} / {@link MemoryStore.supersede}. */
export interface MemoryEntryInput {
  readonly kind: MemoryKind;
  readonly statement: string;
  readonly subject?: string;
  readonly provenance: Provenance;
  /** Optionnel : surtout utile pour des tests déterministes. Défaut : maintenant. */
  readonly createdAt?: string;
}
