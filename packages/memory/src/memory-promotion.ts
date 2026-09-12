import { type MemoryCandidate, validateMemoryCandidate } from './memory-candidate.js';
import type { MemoryEntryInput } from './memory-entry.js';

/**
 * Décision de promotion pour un {@link MemoryCandidate}.
 *
 * - `accept`  : le candidat peut devenir un `MemoryEntry` durable ;
 * - `reject`  : il ne doit **pas** être écrit ;
 * - `confirm` : il ne doit **pas** être écrit **tant qu'une confirmation
 *   utilisateur explicite n'a pas été fournie** (mécanisme de confirmation
 *   lui-même reporté à un chantier ultérieur) — c'est le résultat conservateur
 *   attendu pour une proposition `llm_proposed` valide.
 *
 * `reason` (sur `reject` / `confirm`) est lisible, destinée à un humain / un
 * journal d'audit — **jamais** renvoyée au LLM.
 */
export type MemoryPromotionDecision =
  | { readonly action: 'accept' }
  | { readonly action: 'reject'; readonly reason: string }
  | { readonly action: 'confirm'; readonly reason: string };

/**
 * Politique **explicite** décidant si un `MemoryCandidate` peut être promu en
 * `MemoryEntry`.
 *
 * C'est la **frontière de responsabilité** : sans politique fournie, aucune
 * proposition issue d'un LLM n'atteint jamais un `MemoryStore`. La politique ne
 * décide **que** de la promotion — elle n'écrit rien, ne consulte aucun store,
 * ne mute pas le candidat.
 *
 * `decide` doit être **déterministe**, locale, synchrone, sans réseau.
 */
export interface MemoryPromotionPolicy {
  decide(candidate: MemoryCandidate): MemoryPromotionDecision;
}

/**
 * Motifs rejetant un `statement`/`subject` qui **ressemble à une instruction**
 * (tentative de prompt-injection stockée en mémoire). Liste courte et
 * explicite — un premier filet, pas une garantie exhaustive.
 */
export const DEFAULT_INSTRUCTION_LIKE_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+|the\s+|any\s+|previous\s+|prior\s+)*instructions?\b/i,
  /\bignore\s+(toutes?\s+)?(les\s+)?(instructions?|consignes?)\b/i,
  /\bdisregard\s+(all\s+|the\s+|any\s+|previous\s+|prior\s+)/i,
  /\b(oublie|ignore)\s+(tout\s+ce\s+qui\s+précède|ce\s+qui\s+précède)\b/i,
  /\byou\s+are\s+now\b/i,
  /\btu\s+es\s+(désormais|maintenant)\b/i,
  /\b(system|développeur|developer)\s+(prompt|message)\b/i,
  /\b(prompt|message|consigne)s?\s+syst[eè]me\b/i,
  /\bact\s+as\s+(an?|the)\b/i,
  /\bcomporte[- ]toi\s+comme\b/i,
];

/**
 * Motifs rejetant un contenu **potentiellement sensible** (secret, jeton,
 * clé…). Conservateur : mieux vaut refuser un souvenir légitime que persister
 * un credential.
 */
export const DEFAULT_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\bapi[_-]?key\b/i,
  /\btokens?\b/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
  /\bmot\s+de\s+passe\b/i,
  /\bidentifiants?\s+de\s+connexion\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /-----BEGIN [A-Z ]+-----/,
  /\b[A-Za-z0-9_-]{40,}\b/,
];

export interface DefaultMemoryPromotionPolicyOptions {
  /** Remplace {@link DEFAULT_INSTRUCTION_LIKE_PATTERNS}. */
  readonly instructionLikePatterns?: readonly RegExp[];
  /** Remplace {@link DEFAULT_SENSITIVE_PATTERNS}. */
  readonly sensitivePatterns?: readonly RegExp[];
}

/**
 * Politique par défaut, **sûre par construction** : elle rejette
 *
 *   1. tout candidat structurellement invalide (`validateMemoryCandidate`) ;
 *   2. tout `statement`/`subject` ressemblant à une instruction ;
 *   3. tout `statement`/`subject` ressemblant à une donnée sensible.
 *
 * Elle **n'élève jamais** la provenance et ne juge pas la « qualité » d'un
 * souvenir (pas de score, pas de seuil de confiance) : uniquement une
 * frontière de sécurité. Tout le reste est `accept`.
 *
 * Déterministe et sans effet de bord.
 */
export function createDefaultMemoryPromotionPolicy(
  options: DefaultMemoryPromotionPolicyOptions = {},
): MemoryPromotionPolicy {
  const instructionLike = options.instructionLikePatterns ?? DEFAULT_INSTRUCTION_LIKE_PATTERNS;
  const sensitive = options.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;

  return {
    decide(candidate: MemoryCandidate): MemoryPromotionDecision {
      const check = validateMemoryCandidate(candidate);
      if (!check.ok) {
        return { action: 'reject', reason: `candidat invalide — ${check.error}` };
      }
      const haystacks = [check.value.statement, check.value.subject];

      if (matchesAny(instructionLike, haystacks)) {
        return {
          action: 'reject',
          reason: 'contenu ressemblant à une instruction — jamais promu.',
        };
      }
      if (matchesAny(sensitive, haystacks)) {
        return {
          action: 'reject',
          reason: 'contenu potentiellement sensible — jamais promu.',
        };
      }
      return { action: 'accept' };
    },
  };
}

function matchesAny(patterns: readonly RegExp[], haystacks: readonly string[]): boolean {
  return patterns.some((pattern) => haystacks.some((h) => pattern.test(h)));
}

/**
 * Politique **conservatrice** : identique à {@link createDefaultMemoryPromotionPolicy}
 * pour les rejets (candidat invalide / instruction-like / sensible), mais un
 * candidat **propre** n'est **jamais** `accept` — il devient `confirm`.
 *
 * Autrement dit : **aucune promotion automatique** d'une proposition. Une
 * proposition valide du LLM (`llm_proposed`) attend une confirmation
 * utilisateur explicite avant de devenir une mémoire durable.
 *
 * Réutilise entièrement la logique de sécurité de la politique par défaut —
 * aucune duplication de motifs ni de validation.
 */
export function createConservativeMemoryPromotionPolicy(
  options: DefaultMemoryPromotionPolicyOptions = {},
): MemoryPromotionPolicy {
  const base = createDefaultMemoryPromotionPolicy(options);
  return {
    decide(candidate: MemoryCandidate): MemoryPromotionDecision {
      const decision = base.decide(candidate);
      if (decision.action === 'accept') {
        return {
          action: 'confirm',
          reason:
            'Proposition valide : une confirmation utilisateur explicite est requise avant de la mémoriser durablement.',
        };
      }
      return decision;
    },
  };
}

/**
 * Résultat de la transformation d'un {@link MemoryCandidate} en entrée prête
 * pour `MemoryStore.add()`.
 *
 * - `promoted: true`  → `input` peut être passé **tel quel** à `add()` ;
 * - `promoted: false` → le candidat n'est pas promouvable ; `reason` est
 *   lisible (audit humain — jamais renvoyée au LLM).
 *
 * Cette valeur **ne déclenche aucune écriture** : c'est à la couche appelante
 * (revue humaine, orchestrateur…) d'appeler `store.add(outcome.input)`.
 */
export type MemoryPromotionOutcome =
  | { readonly promoted: true; readonly input: MemoryEntryInput }
  | { readonly promoted: false; readonly reason: string };

export interface PromoteMemoryCandidateOptions {
  /**
   * Refuser toute provenance ≠ `llm_proposed`. Défaut : `true` — la promotion
   * **automatique** n'écrit que des propositions clairement marquées. Une
   * couche de validation **explicite** (humaine) peut passer `false` lorsque
   * d'autres origines (`inferred`, `email_extracted`…) sont légitimes ; la
   * provenance reste alors **recopiée telle quelle**, jamais élevée.
   */
  readonly requireLlmProposed?: boolean;
}

/**
 * Transforme un `MemoryCandidate` **accepté** en `MemoryEntryInput`, sans rien
 * écrire. C'est le mécanisme unique de promotion : la barre à franchir avant
 * toute persistance d'une proposition.
 *
 * - candidat structurellement invalide (`validateMemoryCandidate`) →
 *   `{ promoted: false }` ;
 * - `requireLlmProposed` (défaut `true`) et `provenance.origin !== 'llm_proposed'`
 *   → `{ promoted: false }` ;
 * - sinon → `{ promoted: true, input: { kind, subject, statement, provenance } }`,
 *   champs repris de la **valeur validée** (donc nettoyée). `provenance` est
 *   recopiée intégralement (`origin` **et** `confidence`) — aucune élévation,
 *   aucune suppression. `id` / `createdAt` restent générés par le `MemoryStore`.
 *
 * Pure, déterministe, sans effet de bord (ne consulte aucun store, ne mute pas
 * le candidat).
 */
export function promoteMemoryCandidate(
  candidate: MemoryCandidate,
  options: PromoteMemoryCandidateOptions = {},
): MemoryPromotionOutcome {
  const check = validateMemoryCandidate(candidate);
  if (!check.ok) {
    return { promoted: false, reason: check.error };
  }

  const requireLlmProposed = options.requireLlmProposed ?? true;
  if (requireLlmProposed && check.value.provenance.origin !== 'llm_proposed') {
    return {
      promoted: false,
      reason: `provenance « ${check.value.provenance.origin} » : promotion automatique réservée à « llm_proposed ».`,
    };
  }

  return {
    promoted: true,
    input: {
      kind: check.value.kind,
      subject: check.value.subject,
      statement: check.value.statement,
      provenance: check.value.provenance,
    },
  };
}
