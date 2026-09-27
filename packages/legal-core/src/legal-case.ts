import type { LegalDocument } from './legal-document.js';
import type { LegalEvidence } from './legal-evidence.js';
import type { LegalFact } from './legal-fact.js';
import type { LegalFactConflict } from './legal-conflict.js';
import type { LegalFactValidation } from './legal-fact-validation.js';
import type { LegalRelation } from './legal-relation.js';
import type { LegalFactResolution, LegalResolutionProposal } from './legal-resolution.js';
import type { LegalRuleExecution } from './legal-rule.js';

/**
 * Modèle de données du moteur juridique JARVIS — jalon LEGAL-01, étendu par
 * LEGAL-02A (source versionnée/temporelle, `LegalCitation`, chaîne d'audit
 * Conclusion→Argument→Analysis→Citation→Source) et par **LegalCase v3**
 * (Fact / Provenance / Evidence / Temporal).
 *
 * Implémente la structure `LegalCase` définie par `LEGAL_SPECIFICATION.md`
 * (§2 workflow à 7 étapes, §3 gouvernance, §4 incertitude/sourçage). Ce
 * module ne contient que des types et constantes — aucune logique de
 * validation (voir `legal-case-validation.ts`) ni de persistance (voir
 * `legal-case-file-format.ts`), même discipline que `@jarvis/memory`
 * (`memory-entry.ts` séparé de `memory-file-format.ts`).
 *
 * Les types du modèle **Fact** vivent dans des modules dédiés (un module = une
 * responsabilité) : `legal-fact.ts`, `legal-provenance.ts`, `legal-temporal.ts`,
 * `legal-document.ts`, `legal-evidence.ts`, `legal-relation.ts`,
 * `legal-fact-validation.ts`, `legal-conflict.ts`, `legal-resolution.ts`,
 * `legal-rule.ts`. Le format **v2** est gelé dans `legal-case-v2.ts` (legacy).
 *
 * `@jarvis/legal-core` n'a aucune dépendance vers un autre package `@jarvis`,
 * à l'image de `@jarvis/memory` : la mémoire générale et la mémoire de dossier
 * juridique restent des espaces étanches (`LEGAL_SPECIFICATION.md` §5) — ce
 * n'est pas seulement une politique d'exécution, c'est déjà vrai au niveau des
 * graphes de dépendances.
 */

/** Juridictions supportées. Un seul membre en v1 — `LEGAL_SPECIFICATION.md` §1.1. */
export type LegalJurisdiction = 'FR';

/** Ensemble des juridictions connues — exposé pour la validation et les tests. */
export const LEGAL_JURISDICTIONS: readonly LegalJurisdiction[] = ['FR'];

/**
 * Étape courante du workflow à 7 étapes (`LEGAL_SPECIFICATION.md` §2).
 * Les étapes sont strictement séquentielles : ce type ne garantit pas à lui
 * seul l'ordre (voir `legal-case-validation.ts`), il énumère seulement les
 * valeurs possibles.
 */
export type LegalCaseStatus =
  'READ' | 'RESEARCH' | 'ANALYZE' | 'VERIFY' | 'PREPARE' | 'CONFIRMATION' | 'EXECUTE';

/** Ordre canonique des étapes — sert à la fois de documentation et de base de validation de séquence. */
export const LEGAL_CASE_STATUSES: readonly LegalCaseStatus[] = [
  'READ',
  'RESEARCH',
  'ANALYZE',
  'VERIFY',
  'PREPARE',
  'CONFIRMATION',
  'EXECUTE',
];

/** Une question ouverte identifiée pendant l'instruction de l'affaire. */
export interface LegalQuestion {
  readonly id: string;
  readonly question: string;
  readonly status: 'open' | 'answered';
}

/**
 * Type d'une source institutionnelle. Couvre les catégories minimales
 * requises pour une source de droit français (`LEGAL_SPECIFICATION.md`
 * §1.2) — volontairement sans aucune connaissance d'un fournisseur
 * particulier (Légifrance ou autre) : `sourceType` ne dit jamais *d'où* le
 * contenu a été récupéré, seulement *quelle nature* de texte il est (voir
 * {@link LegalSourceAuthority} pour la provenance institutionnelle).
 */
export type LegalSourceType =
  | 'legislative_text'
  | 'code_article'
  | 'regulatory_text'
  | 'case_law'
  | 'collective_agreement'
  | 'administrative_decision'
  | 'administrative_source';

/** Ensemble des types de source connus — exposé pour la validation et les tests. */
export const LEGAL_SOURCE_TYPES: readonly LegalSourceType[] = [
  'legislative_text',
  'code_article',
  'regulatory_text',
  'case_law',
  'collective_agreement',
  'administrative_decision',
  'administrative_source',
];

/**
 * Autorité institutionnelle dépositaire ou éditrice de la source.
 * `'other'` couvre une autorité légitime non encore nommée explicitement —
 * ce n'est jamais une échappatoire pour une source non institutionnelle :
 * l'exigence de source institutionnelle primaire (`LEGAL_SPECIFICATION.md`
 * §1.2) reste entière, seule son *identification précise* est ouverte.
 */
export type LegalSourceAuthority =
  | 'legifrance'
  | 'cour_de_cassation'
  | 'conseil_d_etat'
  | 'conseil_constitutionnel'
  | 'bofip'
  | 'service_public'
  | 'other';

/** Ensemble des autorités connues — exposé pour la validation et les tests. */
export const LEGAL_SOURCE_AUTHORITIES: readonly LegalSourceAuthority[] = [
  'legifrance',
  'cour_de_cassation',
  'conseil_d_etat',
  'conseil_constitutionnel',
  'bofip',
  'service_public',
  'other',
];

/**
 * Fiabilité perçue de la source — axe **distinct** de `authority` : une
 * autorité institutionnelle connue peut malgré tout n'avoir été consultée
 * que via une copie non vérifiée (capture, citation tierce), et
 * inversement une autorité `'other'` peut être une consultation directe et
 * fiable. Les deux champs ne se déduisent jamais l'un de l'autre.
 */
export type LegalSourceReliability = 'primary_institutional' | 'secondary_verified' | 'unverified';

/** Ensemble des niveaux de fiabilité connus — exposé pour la validation et les tests. */
export const LEGAL_SOURCE_RELIABILITIES: readonly LegalSourceReliability[] = [
  'primary_institutional',
  'secondary_verified',
  'unverified',
];

/**
 * Une source institutionnelle citée à l'appui d'une recherche, d'un
 * argument ou d'une conclusion — versionnée et temporelle (jalon
 * LEGAL-02A, suite à la revue d'architecture LEGAL-01 §5/§7).
 *
 * **Identité = une version précise, pas le texte dans l'absolu.** Un même
 * article modifié plusieurs fois dans le temps est représenté par
 * plusieurs valeurs `LegalSource` distinctes (des `id` différents),
 * partageant le même `identifier` (référence stable côté autorité) mais
 * portant chacune leur propre `version` et leur propre intervalle de
 * validité. `LegalSource` ne résout **jamais** lui-même « quelle version
 * s'appliquait à telle date » — cette résolution temporelle est une
 * capacité d'une couche dédiée, explicitement hors périmètre de LEGAL-02A.
 *
 * Trois dates à ne **jamais** confondre :
 *   - `publicationDate` : quand le texte a été publié ;
 *   - `effectiveFrom`/`effectiveTo` : quand son contenu a **force de
 *     droit** — seule paire de dates pertinente pour « quel était le droit
 *     applicable à telle date » ;
 *   - `consultedAt` : quand *JARVIS* a regardé cette source — un fait sur
 *     l'acte de consultation, jamais sur la validité juridique du contenu.
 *     `consultedAt` ne doit **jamais** se substituer à
 *     `effectiveFrom`/`effectiveTo` dans un raisonnement temporel.
 *
 * `publicationDate` est **optionnelle** (LEGAL-02B.3) : la vérification
 * réelle du contrat Légifrance (`/consult/getArticle`, sandbox PISTE) a
 * montré qu'aucun champ de la réponse ne porte une sémantique de
 * « date de publication » suffisamment confirmée (`dateDebut` n'est pas
 * documenté comme tel, et ne doit jamais être réinterprété comme
 * `publicationDate` sans preuve — voir `@jarvis/legal-research`). Rendre le
 * champ obligatoire aurait forcé soit une valeur inventée, soit un mapping
 * non prouvé — les deux interdits explicitement. L'absence de
 * `publicationDate` reste un fait honnête : « la date de publication n'est
 * pas connue/fournie par le fournisseur », jamais une omission silencieuse.
 */
export interface LegalSource {
  readonly id: string;
  readonly sourceType: LegalSourceType;
  readonly authority: LegalSourceAuthority;
  readonly title: string;
  /** Identifiant stable côté autorité (ex. `LEGIARTI000006901247`, un NOR, un numéro de pourvoi) — machine-stable, jamais un simple libellé. */
  readonly identifier: string;
  /** Libellé humain de citation (ex. « Code civil, art. 1103 »), distinct de `identifier`. Optionnel : pas toujours pertinent (ex. décision administrative sans référence d'article). */
  readonly reference?: string;
  readonly url?: string;
  /** Date de publication du texte — ISO 8601, si connue avec une sémantique confirmée (voir la note de classe). */
  readonly publicationDate?: string;
  /** Début de la force de droit du contenu exact décrit par cette version — ISO 8601. */
  readonly effectiveFrom: string;
  /** Fin de la force de droit, si connue. Absent = toujours en vigueur à ce jour. */
  readonly effectiveTo?: string;
  /** Date ISO 8601 à laquelle *JARVIS* a consulté cette source. Jamais utilisé pour raisonner sur la validité juridique — voir la note de classe. */
  readonly consultedAt: string;
  /** Identifiant de version de ce contenu précis (ex. « 2021-03-01 », « v2 »). Distingue deux `LegalSource` partageant le même `identifier`. */
  readonly version: string;
  /**
   * Empreinte SHA-256 (hexadécimal, 64 caractères) du contenu exact sur
   * lequel JARVIS s'est appuyé, si disponible. Permet de détecter une
   * modification silencieuse en amont. Jamais calculée ici — LEGAL-02A ne
   * fait aucun appel réseau ; ce champ ne fait que décrire la **forme**
   * attendue d'une empreinte future.
   */
  readonly contentHash?: string;
  readonly reliability: LegalSourceReliability;
}

/**
 * Utilisation précise d'une {@link LegalSource} dans le raisonnement d'une
 * affaire — distincte de la source elle-même : `LegalSource` décrit *le
 * texte*, `LegalCitation` décrit *comment et où il a été mobilisé*
 * (passage précis, extrait exact, version réellement lue). Plusieurs
 * `LegalCitation` peuvent viser la même `LegalSource` (des passages
 * différents, ou le même passage réutilisé dans plusieurs arguments) —
 * `LegalCitation` ne duplique donc jamais `LegalSource`, elle le référence.
 *
 * `sourceVersion` ressemble à `LegalSource.version` du `sourceId` visé,
 * mais porte une garantie différente : elle **épingle** la version
 * réellement lue au moment de la citation, indépendamment de toute
 * évolution ultérieure de l'enregistrement `LegalSource`. La validation
 * (voir `legal-citation-validation.ts`) vérifie leur cohérence mutuelle ;
 * les deux champs ne sont pas fusionnés pour que cette vérification reste
 * possible et pour qu'une incohérence soit détectable plutôt que masquée.
 */
export interface LegalCitation {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  /** Passage précis (ex. « art. 3, alinéa 2 »). Optionnel : une citation peut porter sur un texte entier. */
  readonly pinpoint?: string;
  /** Extrait exact invoqué. Optionnel : une citation peut n'être qu'une référence, sans citation littérale. */
  readonly quotedText?: string;
  readonly consultedAt: string;
  /**
   * Empreinte SHA-256 (hexadécimale, 64 caractères) du contenu de la version
   * citée, **épinglée** au moment de la citation — même rôle que `sourceVersion` :
   * elle survit à une évolution ultérieure de l'enregistrement `LegalSource`.
   * Optionnelle (la source n'en a pas toujours). Si la source en porte une aussi,
   * les deux doivent être identiques (voir `legal-citation-validation.ts`).
   */
  readonly contentHash?: string;
  /**
   * Fondement d'éligibilité d'une citation **de niveau source** produite depuis
   * une recherche (ADR-0020). Optionnel : une citation de passage ou de
   * raisonnement (futur ANALYZE) n'en porte pas nécessairement.
   */
  readonly eligibility?: LegalCitationEligibility;
}

/**
 * Exhaustivité **déclarée** de l'historique de versions sur lequel une
 * résolution temporelle s'appuie. `unknown` = rien n'est garanti : la version
 * résolue l'est « au mieux », d'après les seules versions connues. Ne se
 * déduit jamais d'une autre donnée.
 */
export type LegalHistoryCompleteness = 'complete' | 'unknown';

/** Ensemble des exhaustivités connues — exposé pour la validation et les tests. */
export const LEGAL_HISTORY_COMPLETENESSES: readonly LegalHistoryCompleteness[] = [
  'complete',
  'unknown',
];

/**
 * Pourquoi cette source/version est **éligible** à être citée : elle a été
 * *retrouvée* (récupérée) **et** une résolution temporelle l'a désignée comme
 * version *applicable* à `asOf`. Rien de plus.
 *
 * **Ne dit pas** que la source est *pertinente* pour la question, qu'elle
 * *soutient* une affirmation, ni ce que dit son texte : ces jugements
 * appartiennent à ANALYZE et ne sont pas représentés ici. Aucun score.
 *
 * Distingue « résolu sur un historique établi » (`complete`) de « résolu au
 * mieux » (`unknown`) : `resolution: 'resolved'` **n'implique pas** une version
 * juridiquement certaine quand `historyCompleteness` vaut `unknown`.
 */
export interface LegalCitationEligibility {
  /** Question à l'origine de la recherche. Doit désigner une `LegalQuestion` du dossier. */
  readonly questionId: string;
  /**
   * Date **juridique** de référence de la résolution (ISO 8601) : « le droit
   * applicable à cette date ». Explicite : jamais une date de consultation ni
   * un « aujourd'hui » implicite.
   */
  readonly asOf: string;
  /** Issue de la résolution temporelle. Seule `resolved` rend éligible. */
  readonly resolution: 'resolved';
  readonly historyCompleteness: LegalHistoryCompleteness;
}

/**
 * Un élément de recherche (étape `RESEARCH`), rattaché à une ou plusieurs
 * {@link LegalCitation} — jamais directement à une {@link LegalSource}
 * brute, pour porter le passage précis mobilisé (revue d'architecture
 * LEGAL-01 §5/§6).
 *
 * `questionId` (LEGAL-RESEARCH-ITEM-01) : optionnel pour la rétrocompatibilité
 * des dossiers et fixtures antérieurs à ce champ ; **tout item produit par un
 * producteur de ce jalon en fournit un** valide (voir
 * `research-item-projection.ts`, `@jarvis/legal-research`). Quand il est
 * présent, il doit désigner une {@link LegalQuestion} réellement présente dans
 * le dossier (voir `legal-case-common-validation.ts`) — même discipline que
 * `LegalCitationEligibility.questionId`.
 */
export interface LegalResearchItem {
  readonly id: string;
  readonly topic: string;
  readonly summary: string;
  readonly citationIds: readonly string[];
  readonly questionId?: string;
}

/** Un argument ou contre-argument (étape `ANALYZE`), rattaché à ses citations précises. */
export interface LegalArgument {
  readonly id: string;
  readonly statement: string;
  readonly citationIds: readonly string[];
}

/**
 * Une note d'analyse produite pendant l'étape `VERIFY`. Rattachée aux
 * arguments qu'elle synthétise et aux citations qu'elle mobilise
 * directement — ferme le maillon `Argument → Analysis` de la chaîne
 * d'audit `Conclusion → Argument → Analysis → Citation → Source`
 * identifiée par la revue d'architecture LEGAL-01 §5 (auparavant une note
 * d'analyse n'était reliée à rien).
 */
export interface LegalAnalysisNote {
  readonly id: string;
  readonly note: string;
  readonly createdAt: string;
  readonly argumentIds: readonly string[];
  readonly citationIds: readonly string[];
}

/** Niveau de confiance d'une conclusion — jamais implicite. */
export type LegalConfidenceLevel = 'certain' | 'likely' | 'uncertain';

/**
 * Une conclusion de l'affaire. Rattachée aux arguments et notes d'analyse
 * qui y mènent (`argumentIds`/`analysisIds`, revue LEGAL-01 §5) et à ses
 * citations directes. `citationIds` **ne peut pas être vide** : « toute
 * conclusion doit être accompagnée de sa ou ses sources »
 * (`LEGAL_SPECIFICATION.md` §4) — appliqué par
 * {@link import('./legal-case-validation.js').validateLegalCase}, pas
 * seulement documenté. Remplace l'ancien `sourceIds` de LEGAL-01 : une
 * citation précise offre une traçabilité supérieure à un simple pointeur
 * de source (revue d'architecture LEGAL-01 §6).
 */
export interface LegalConclusion {
  readonly id: string;
  readonly statement: string;
  readonly confidence: LegalConfidenceLevel;
  readonly argumentIds: readonly string[];
  readonly analysisIds: readonly string[];
  readonly citationIds: readonly string[];
}

/** Une échéance associée à l'affaire (délai de forclusion, préavis, etc.). */
export interface LegalDeadline {
  readonly id: string;
  readonly label: string;
  readonly dueAt: string;
  /** `true` si un dépassement a des conséquences juridiques directes (ex. forclusion). */
  readonly critical?: boolean;
}

/** Discriminant d'action, aligné sur les trois catégories citées par le brief LEGAL-01. */
export type LegalActionType = 'READ' | 'PREPARE' | 'EXECUTE';

interface LegalActionBase {
  readonly id: string;
  readonly description: string;
  readonly createdAt: string;
}

/** Action de lecture/consultation — jamais soumise à confirmation. */
export interface LegalReadAction extends LegalActionBase {
  readonly type: 'READ';
}

/**
 * Action de préparation (analyse, rédaction) — étape terminale par défaut
 * du workflow (`LEGAL_SPECIFICATION.md` §3). Ne modifie rien en dehors du
 * dossier lui-même.
 */
export interface LegalPrepareAction extends LegalActionBase {
  readonly type: 'PREPARE';
}

/**
 * Action d'exécution. Porte **structurellement** la preuve de confirmation
 * (`confirmationId`/`confirmedAt`) : il est impossible de construire une
 * valeur `LegalExecuteAction` sans ces champs, ce qui fait respecter la
 * règle « jamais d'`EXECUTE` sans confirmation explicite »
 * (`LEGAL_SPECIFICATION.md` §3) dès le typage, avant même toute validation
 * runtime.
 */
export interface LegalExecuteAction extends LegalActionBase {
  readonly type: 'EXECUTE';
  /** Empreinte de la confirmation ayant autorisé cette exécution précise. */
  readonly confirmationId: string;
  readonly confirmedAt: string;
}

export type LegalAction = LegalReadAction | LegalPrepareAction | LegalExecuteAction;

/**
 * Une affaire juridique suivie par le moteur — entité racine du domaine, **format v3**.
 *
 * Immuable par convention (comme `MemoryEntry`, `Account` dans
 * `@jarvis/connectors`) : toute évolution passe par la construction d'une
 * nouvelle valeur (spread), jamais par une mutation en place.
 *
 * ## Listes append-only (jamais réécrites, seulement complétées)
 * `facts`, `documents`, `evidence`, `relations`, `factValidations`, `conflicts`,
 * `resolutionProposals`, `ruleExecutions`, `resolutions` : identifiants uniques par
 * liste, ordre conservé, aucun remplacement ni suppression (voir
 * `legal-case-append-only.ts`). `facts` est une liste **plate** : l'état
 * épistémique n'est pas stocké, il est dérivé (`deriveFactEpistemicState`).
 *
 * Les autres listes (`questions`, `research`, `sources`, `citations`, `arguments`,
 * `counterArguments`, `analysis`, `conclusions`, `deadlines`, `actions`) sont
 * **inchangées** par rapport à la v2.
 */
export interface LegalCase {
  readonly id: string;
  readonly title: string;
  readonly jurisdiction: LegalJurisdiction;
  readonly status: LegalCaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly facts: readonly LegalFact[];
  readonly documents: readonly LegalDocument[];
  readonly evidence: readonly LegalEvidence[];
  readonly questions: readonly LegalQuestion[];
  readonly relations: readonly LegalRelation[];
  readonly factValidations: readonly LegalFactValidation[];
  readonly conflicts: readonly LegalFactConflict[];
  readonly resolutionProposals: readonly LegalResolutionProposal[];
  readonly ruleExecutions: readonly LegalRuleExecution[];
  readonly resolutions: readonly LegalFactResolution[];
  readonly research: readonly LegalResearchItem[];
  readonly sources: readonly LegalSource[];
  readonly citations: readonly LegalCitation[];
  readonly arguments: readonly LegalArgument[];
  readonly counterArguments: readonly LegalArgument[];
  readonly analysis: readonly LegalAnalysisNote[];
  readonly conclusions: readonly LegalConclusion[];
  readonly deadlines: readonly LegalDeadline[];
  readonly actions: readonly LegalAction[];
}
