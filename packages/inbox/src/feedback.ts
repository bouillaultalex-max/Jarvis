import type {
  ClassificationEngine,
  Preference,
  PreferenceAttribute,
  PreferenceDecision,
} from '@jarvis/classification';

import type { ClassifiedEmail } from './classified-email.js';

/**
 * Contrats/fonctions préparant une future interface conversationnelle
 * (« Cet email est important. », « Les mails de cette adresse sont toujours
 * importants. »…), **sans** construire cette interface ici. Chaque fonction
 * n'est qu'un point d'ancrage fin autour de `ClassificationEngine`, dont le
 * comportement (portée `sender` par défaut pour une correction, jamais
 * `domain`) reste inchangé.
 */

/**
 * Retrouve, par son id, un email d'un lot déjà classifié et enregistre une
 * correction utilisateur dessus — « cet email est important » / « celui-ci
 * n'est pas important ». Ne crée qu'une préférence de portée `sender`
 * (comportement de `ClassificationEngine.learnFromFeedback`, inchangé) :
 * une correction sur un expéditeur ne se généralise jamais à son domaine.
 *
 * @throws {Error} si aucun email de ce lot n'a cet id.
 */
export function recordFeedbackForEmail(
  engine: ClassificationEngine,
  batch: readonly ClassifiedEmail[],
  emailId: string,
  decision: PreferenceDecision,
): Preference {
  const target = batch.find((classified) => classified.email.id === emailId);
  if (target === undefined) {
    throw new Error(`recordFeedbackForEmail : aucun email d'id « ${emailId} » dans ce lot.`);
  }
  return engine.learnFromFeedback(target.email, decision);
}

/**
 * Une règle générale que l'utilisateur énonce explicitement, indépendamment
 * de tout email précis — « les emails de cette adresse sont toujours
 * importants », « les newsletters de ce domaine ne sont pas importantes ».
 * Forme neutre qu'une future couche NLU pourra produire directement.
 */
export interface UserRuleRequest {
  readonly attribute: PreferenceAttribute;
  readonly value: string;
  readonly decision: PreferenceDecision;
  /** Explication optionnelle ; une explication par défaut est générée sinon. */
  readonly reason?: string;
}

function defaultReasonFor(request: UserRuleRequest): string {
  const subject: string =
    request.attribute === 'sender'
      ? `les emails de « ${request.value} »`
      : request.attribute === 'domain'
        ? `les emails du domaine « ${request.value} »`
        : request.attribute === 'subject_contains'
          ? `les emails dont l'objet contient « ${request.value} »`
          : `les emails contenant le mot-clé « ${request.value} »`;
  return `Règle explicite de l'utilisateur : ${subject} sont désormais classés « ${request.decision} ».`;
}

/** Applique une règle générale déclarée explicitement (`ClassificationEngine.addExplicitRule`). */
export function applyUserRule(engine: ClassificationEngine, request: UserRuleRequest): Preference {
  return engine.addExplicitRule({
    attribute: request.attribute,
    value: request.value,
    decision: request.decision,
    reason: request.reason ?? defaultReasonFor(request),
  });
}
