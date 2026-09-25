import { canonicalizeLegal } from './legal-canonical.js';
import type { LegalCase } from './legal-case.js';
import { validateLegalCaseV3 } from './legal-case-validation.js';
import type { LegalRuleRegistry } from './legal-rule.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';

/**
 * Append-only **ciblé** du modèle Fact — LegalCase v3 (Q10).
 *
 * Pas d'event-sourcing complet du dossier : seules les listes suivantes sont
 * append-only. Chacune n'est jamais réécrite, seulement **complétée** :
 *
 * `facts`, `documents`, `evidence`, `relations`, `factValidations`, `conflicts`,
 * `resolutionProposals`, `ruleExecutions`, `resolutions`.
 *
 * Un validateur ne voit qu'un instantané ; la garantie est donc portée par :
 *   - {@link checkAppendOnly} / {@link assertAppendOnly} : comparaison de deux
 *     instantanés — aucun objet retiré, modifié, remplacé ni réordonné, seules des
 *     additions en fin de liste ;
 *   - {@link appendToLegalCase} : ajout **pur** (nouveau dossier), sans
 *     remplacement silencieux, qui revalide le résultat.
 *
 * Portée : ces contrôles ne remplacent pas un stockage à intégrité garantie ; une
 * réécriture complète et cohérente du fichier reste hors de leur portée (voir
 * `legal-fingerprint.ts`).
 */
export const LEGAL_CASE_APPEND_ONLY_LISTS = [
  'facts',
  'documents',
  'evidence',
  'relations',
  'factValidations',
  'conflicts',
  'resolutionProposals',
  'ruleExecutions',
  'resolutions',
] as const;

export type LegalCaseAppendOnlyList = (typeof LEGAL_CASE_APPEND_ONLY_LISTS)[number];

/** Éléments à ajouter, par liste. */
export type LegalCaseAdditions = {
  readonly [K in LegalCaseAppendOnlyList]?: readonly LegalCase[K][number][];
};

/**
 * Vérifie que `after` n'est qu'une **extension** de `before` : pour chaque liste
 * append-only, les objets de `before` sont présents, dans le même ordre, identiques
 * (canonicalisation), et aucun n'est retiré. Ne lève pas.
 */
export function checkAppendOnly(before: LegalCase, after: LegalCase): LegalCaseValidation {
  for (const name of LEGAL_CASE_APPEND_ONLY_LISTS) {
    const previous = before[name] as readonly unknown[];
    const next = after[name] as readonly unknown[];
    if (next.length < previous.length) {
      return invalid(
        `${name} : ${previous.length - next.length} objet(s) supprimé(s) (append-only).`,
      );
    }
    for (let i = 0; i < previous.length; i += 1) {
      let same: boolean;
      try {
        same = canonicalizeLegal(previous[i]) === canonicalizeLegal(next[i]);
      } catch {
        same = false;
      }
      if (!same) {
        return invalid(`${name}[${i}] : objet modifié, remplacé ou réordonné (append-only).`);
      }
    }
  }
  return OK;
}

/** Comme {@link checkAppendOnly}, mais lève. @throws {Error} */
export function assertAppendOnly(before: LegalCase, after: LegalCase): void {
  const result = checkAppendOnly(before, after);
  if (!result.ok) throw new Error(`assertAppendOnly : ${result.error}`);
}

export interface AppendToLegalCaseOptions {
  /** Nouvel `updatedAt`, **uniquement** si l'ajout ajoute quelque chose. Ce module n'a pas d'horloge. */
  readonly updatedAt?: string;
  /**
   * Whitelist des règles. **Requise** pour ajouter des `ruleExecutions` : une
   * exécution n'est acceptée que si sa règle (`operationId`, `operationVersion`)
   * est whitelistée. Vérifiée à l'ajout, jamais à la lecture.
   */
  readonly ruleRegistry?: LegalRuleRegistry;
}

/**
 * Ajoute des objets aux listes append-only et renvoie un **nouveau** dossier (le
 * dossier d'entrée n'est jamais modifié). Le dossier est revalidé et comparé à
 * l'original ({@link assertAppendOnly}).
 *
 * @throws {Error} liste inconnue ; identifiant déjà présent (aucun remplacement
 *   silencieux, même pour un objet identique) ; identifiant dupliqué dans l'ajout ;
 *   exécution de règle sans registre ou non whitelistée ; dossier résultant invalide.
 */
export function appendToLegalCase(
  legalCase: LegalCase,
  additions: LegalCaseAdditions,
  options: AppendToLegalCaseOptions = {},
): LegalCase {
  const added: Partial<Record<LegalCaseAppendOnlyList, readonly unknown[]>> = {};
  let total = 0;

  for (const key of Object.keys(additions)) {
    if (!(LEGAL_CASE_APPEND_ONLY_LISTS as readonly string[]).includes(key)) {
      throw new Error(`appendToLegalCase : « ${key} » n'est pas une liste append-only.`);
    }
    const name = key as LegalCaseAppendOnlyList;
    const items = (additions[name] ?? []) as readonly { readonly id: string }[];
    const existing = new Set(
      (legalCase[name] as readonly { readonly id: string }[]).map((item) => item.id),
    );
    for (const item of items) {
      if (existing.has(item.id)) {
        throw new Error(
          `appendToLegalCase : ${name} contient déjà l'id « ${item.id} » (aucun remplacement).`,
        );
      }
      existing.add(item.id);
    }
    if (items.length > 0) {
      added[name] = items;
      total += items.length;
    }
  }
  if (total === 0) return legalCase;

  for (const execution of (added.ruleExecutions ?? []) as LegalCase['ruleExecutions']) {
    if (options.ruleRegistry === undefined) {
      throw new Error(
        'appendToLegalCase : un registre de règles (whitelist) est requis pour ajouter des ruleExecutions.',
      );
    }
    const version = Number(execution.provenance.operationVersion);
    if (!options.ruleRegistry.has(execution.provenance.operationId, version)) {
      throw new RangeError(
        `appendToLegalCase : règle « ${execution.provenance.operationId} » version ${execution.provenance.operationVersion} non whitelistée.`,
      );
    }
  }

  const next = {
    ...legalCase,
    ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
  } as { -readonly [K in keyof LegalCase]: LegalCase[K] };
  for (const name of LEGAL_CASE_APPEND_ONLY_LISTS) {
    const items = added[name];
    if (items !== undefined) {
      (next as Record<string, unknown>)[name] = [
        ...(legalCase[name] as readonly unknown[]),
        ...items,
      ];
    }
  }

  const validation = validateLegalCaseV3(next);
  if (!validation.ok) {
    throw new Error(`appendToLegalCase : dossier invalide après ajout — ${validation.error}`);
  }
  assertAppendOnly(legalCase, next);
  return next;
}
