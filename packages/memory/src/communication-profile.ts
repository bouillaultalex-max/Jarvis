import { DEFAULT_SENSITIVE_PATTERNS } from './memory-promotion.js';
import { type Provenance, validateProvenance } from './provenance.js';

/**
 * Fondation du **profil de communication** de l'utilisateur : comment il
 * s'exprime, avec quelle provenance connue. Générique — **aucune** dépendance à
 * un canal (e-mail, Gmail, réseau social) : l'adaptation vers un contrat
 * concret (`EmailReplyConstraints`…) vit chez le consommateur.
 *
 * Trois couches **strictement séparées**, jamais promues automatiquement de
 * l'une à l'autre :
 *
 *   1. {@link CommunicationStyleObservation} — observation brute issue d'UN
 *      message réel. Pure **trace** : n'influence jamais la résolution.
 *   2. {@link CommunicationTrait} d'origine incertaine (`inferred` /
 *      `llm_proposed` / `email_extracted`) — caractéristique **déduite**,
 *      tentative : utilisée seulement si `includeInferred: true`.
 *   3. {@link CommunicationTrait} d'origine certaine (`user_stated` /
 *      `user_confirmed`) — préférence **autoritaire** : l'emporte toujours.
 *   4. Contraintes de rédaction — **dérivées** par un consommateur, hors d'ici.
 *
 * Tout est **pur, immuable, déterministe** : aucune I/O, aucune horloge, aucun
 * `Math.random`, aucun accès réseau, aucune écriture mémoire. Les chaînes
 * (`value` / `note`) sont des **données** — jamais interprétées comme des
 * instructions.
 */

/** Dimension de style. Union **fermée** — toute autre valeur est rejetée. */
export type CommunicationDimension =
  | 'formality'
  | 'address_form'
  | 'length'
  | 'structure'
  | 'greeting'
  | 'signature'
  | 'emoji'
  | 'punctuation'
  | 'vocabulary'
  | 'warmth'
  | 'register'
  | 'preferred_phrases'
  | 'phrases_to_avoid'
  | 'language';

/** Ensemble des dimensions connues — exposé pour la validation et les tests. */
export const COMMUNICATION_DIMENSIONS: readonly CommunicationDimension[] = [
  'formality',
  'address_form',
  'length',
  'structure',
  'greeting',
  'signature',
  'emoji',
  'punctuation',
  'vocabulary',
  'warmth',
  'register',
  'preferred_phrases',
  'phrases_to_avoid',
  'language',
];

const DIMENSION_SET: ReadonlySet<string> = new Set(COMMUNICATION_DIMENSIONS);

/**
 * Origines « certaines » d'un trait : la préférence est **affirmée** par
 * l'utilisateur, pas estimée. Un tel trait est autoritaire.
 */
const AUTHORITATIVE_ORIGINS: ReadonlySet<string> = new Set(['user_stated', 'user_confirmed']);

/** Longueur maximale d'une `value`. */
export const MAX_COMMUNICATION_VALUE_CHARS = 2000;
/** Longueur maximale d'une `note`. */
export const MAX_COMMUNICATION_NOTE_CHARS = 2000;

/**
 * COUCHE 1 — observation brute d'une dimension de style, issue d'**un** message
 * analysé. Conservée comme trace / matière première pour un futur chantier
 * d'agrégation ; **n'influence jamais** {@link UserCommunicationProfile.resolve}.
 */
export interface CommunicationStyleObservation {
  readonly dimension: CommunicationDimension;
  /** Valeur observée, en clair (ex. « vous », « court », « aucun emoji »). Donnée inerte. */
  readonly value: string;
  /** Provenance de l'observation — typiquement `email_extracted` ou `inferred` (avec `confidence`). */
  readonly provenance: Provenance;
  /** Détail lisible optionnel (ex. référence opaque au message source — jamais son contenu). */
  readonly note?: string;
}

/**
 * COUCHE 2 & 3 — trait retenu pour le profil. Sa **strate** dépend de
 * `provenance.origin` : `user_stated` / `user_confirmed` ⇒ autoritaire ; toute
 * autre origine ⇒ tentative.
 */
export interface CommunicationTrait {
  readonly dimension: CommunicationDimension;
  readonly value: string;
  readonly provenance: Provenance;
  readonly note?: string;
}

/** Valeur effective d'une dimension, avec la provenance d'où elle vient. */
export interface ResolvedCommunicationValue {
  readonly value: string;
  readonly provenance: Provenance;
}

/** Options de résolution. `includeInferred` est **opt-in** (défaut : `false`). */
export interface CommunicationResolveOptions {
  /** Autoriser les traits d'origine incertaine à fournir une valeur effective. */
  readonly includeInferred?: boolean;
}

/**
 * Contexte générique d'une interaction, pour {@link CommunicationStyleProvider}.
 * Volontairement neutre — aucun champ spécifique à un canal.
 */
export interface CommunicationContext {
  /** Canal logique (ex. « email », « social:x »). Opaque. */
  readonly channel?: string;
  /** Identifiant opaque de l'interlocuteur (adresse, handle…). Jamais un secret. */
  readonly counterparty?: string;
  /** Locale de l'échange (ex. « fr-FR »). */
  readonly locale?: string;
}

/**
 * Fournisseur générique de profil. Spécialisé par des adaptateurs de canal
 * (ex. `EmailStyleConstraintsProvider` dans `@jarvis/inbox`). Doit être **pur
 * et déterministe**.
 */
export interface CommunicationStyleProvider {
  profileFor(context: CommunicationContext): UserCommunicationProfile | undefined;
}

/**
 * Profil de communication **immuable**. Construit via
 * {@link createUserCommunicationProfile} ; `withObservation` / `withTrait`
 * renvoient un **nouveau** profil (l'original est inchangé).
 */
export interface UserCommunicationProfile {
  /** Observations enregistrées, dans l'ordre d'ajout. Trace uniquement. */
  readonly observations: readonly CommunicationStyleObservation[];
  /** Traits enregistrés, dans l'ordre d'ajout (le dernier l'emporte dans sa strate). */
  readonly traits: readonly CommunicationTrait[];

  /**
   * Valeur effective d'une dimension :
   *   - dernier trait **autoritaire** (`user_stated` / `user_confirmed`) ; sinon
   *   - si `includeInferred` : dernier trait **tentatif** ; sinon
   *   - `undefined` (valeur inconnue → reste inconnue).
   *
   * Les {@link CommunicationStyleObservation} ne sont **jamais** consultées.
   */
  resolve(
    dimension: CommunicationDimension,
    options?: CommunicationResolveOptions,
  ): ResolvedCommunicationValue | undefined;

  /**
   * Toutes les dimensions ayant une valeur effective (mêmes règles que
   * {@link resolve}), déterministe : itère `COMMUNICATION_DIMENSIONS` dans
   * l'ordre.
   */
  resolveAll(
    options?: CommunicationResolveOptions,
  ): ReadonlyMap<CommunicationDimension, ResolvedCommunicationValue>;

  /** Nouveau profil avec une observation de plus. Original inchangé. */
  withObservation(observation: CommunicationStyleObservation): UserCommunicationProfile;

  /**
   * Nouveau profil avec un trait de plus. Sert aussi à **corriger** une
   * préférence : le nouveau trait, ajouté en fin, l'emporte dans sa strate ;
   * l'ancien reste dans `traits` (traçabilité) mais devient inerte pour
   * `resolve`. Original inchangé.
   */
  withTrait(trait: CommunicationTrait): UserCommunicationProfile;
}

function matchesSensitivePattern(text: string): boolean {
  return DEFAULT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Valide une couche (observation ou trait) — ne renvoie rien, lève si invalide. */
function assertValidLayer(layer: CommunicationStyleObservation | CommunicationTrait): void {
  if (!DIMENSION_SET.has(layer.dimension)) {
    throw new Error(
      `communication-profile : « dimension » inconnue (attendu : ${COMMUNICATION_DIMENSIONS.join(', ')}).`,
    );
  }
  if (typeof layer.value !== 'string' || layer.value.trim().length === 0) {
    throw new Error('communication-profile : « value » ne peut pas être vide.');
  }
  if (layer.value.length > MAX_COMMUNICATION_VALUE_CHARS) {
    throw new Error(
      `communication-profile : « value » dépasse ${MAX_COMMUNICATION_VALUE_CHARS} caractères.`,
    );
  }
  if (layer.note !== undefined) {
    if (typeof layer.note !== 'string') {
      throw new Error('communication-profile : « note » doit être une chaîne.');
    }
    if (layer.note.length > MAX_COMMUNICATION_NOTE_CHARS) {
      throw new Error(
        `communication-profile : « note » dépasse ${MAX_COMMUNICATION_NOTE_CHARS} caractères.`,
      );
    }
  }
  const provenance = validateProvenance(layer.provenance);
  if (!provenance.ok) {
    throw new Error(`communication-profile : ${provenance.error}`);
  }
  // Anti-fuite : jamais de token / clé / credential dans un profil.
  if (
    matchesSensitivePattern(layer.value) ||
    (layer.note !== undefined && matchesSensitivePattern(layer.note))
  ) {
    throw new Error(
      'communication-profile : contenu potentiellement sensible (secret / jeton / identifiant) — refusé.',
    );
  }
}

/** Copie **propre** d'une provenance (champs connus uniquement). */
function cleanProvenance(provenance: Provenance): Provenance {
  return {
    origin: provenance.origin,
    ...(provenance.confidence !== undefined ? { confidence: provenance.confidence } : {}),
    ...(provenance.note !== undefined ? { note: provenance.note } : {}),
  };
}

function cleanObservation(o: CommunicationStyleObservation): CommunicationStyleObservation {
  return {
    dimension: o.dimension,
    value: o.value,
    provenance: cleanProvenance(o.provenance),
    ...(o.note !== undefined ? { note: o.note } : {}),
  };
}

function cleanTrait(t: CommunicationTrait): CommunicationTrait {
  return {
    dimension: t.dimension,
    value: t.value,
    provenance: cleanProvenance(t.provenance),
    ...(t.note !== undefined ? { note: t.note } : {}),
  };
}

function isAuthoritative(trait: CommunicationTrait): boolean {
  return AUTHORITATIVE_ORIGINS.has(trait.provenance.origin);
}

function buildProfile(
  observations: readonly CommunicationStyleObservation[],
  traits: readonly CommunicationTrait[],
): UserCommunicationProfile {
  const frozenObservations = Object.freeze([...observations]);
  const frozenTraits = Object.freeze([...traits]);

  const resolve = (
    dimension: CommunicationDimension,
    options?: CommunicationResolveOptions,
  ): ResolvedCommunicationValue | undefined => {
    const includeInferred = options?.includeInferred ?? false;
    const forDimension = frozenTraits.filter((trait) => trait.dimension === dimension);

    for (let i = forDimension.length - 1; i >= 0; i -= 1) {
      if (isAuthoritative(forDimension[i]!)) {
        const winner = forDimension[i]!;
        return { value: winner.value, provenance: cleanProvenance(winner.provenance) };
      }
    }
    if (includeInferred) {
      for (let i = forDimension.length - 1; i >= 0; i -= 1) {
        const winner = forDimension[i]!;
        return { value: winner.value, provenance: cleanProvenance(winner.provenance) };
      }
    }
    return undefined;
  };

  const profile: UserCommunicationProfile = {
    observations: frozenObservations,
    traits: frozenTraits,
    resolve,
    resolveAll(options?: CommunicationResolveOptions) {
      const out = new Map<CommunicationDimension, ResolvedCommunicationValue>();
      for (const dimension of COMMUNICATION_DIMENSIONS) {
        const resolved = resolve(dimension, options);
        if (resolved !== undefined) {
          out.set(dimension, resolved);
        }
      }
      return out;
    },
    withObservation(observation: CommunicationStyleObservation) {
      assertValidLayer(observation);
      return buildProfile([...frozenObservations, cleanObservation(observation)], frozenTraits);
    },
    withTrait(trait: CommunicationTrait) {
      assertValidLayer(trait);
      return buildProfile(frozenObservations, [...frozenTraits, cleanTrait(trait)]);
    },
  };
  return Object.freeze(profile);
}

/**
 * Construit un profil à partir d'observations / traits **non fiables** (entrée
 * externe). Valide chaque couche (dimension connue, `value` non vide et bornée,
 * `provenance` valide, `note` bornée, **aucun contenu sensible**) — lève à la
 * première erreur. Ne consulte aucun store, aucune horloge.
 */
export function createUserCommunicationProfile(
  input: {
    readonly observations?: readonly CommunicationStyleObservation[];
    readonly traits?: readonly CommunicationTrait[];
  } = {},
): UserCommunicationProfile {
  const observations = (input.observations ?? []).map((o) => {
    assertValidLayer(o);
    return cleanObservation(o);
  });
  const traits = (input.traits ?? []).map((t) => {
    assertValidLayer(t);
    return cleanTrait(t);
  });
  return buildProfile(observations, traits);
}
