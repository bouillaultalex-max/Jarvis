import type { EmailMessage } from '@jarvis/types';
import type { ClassificationResult } from '@jarvis/classification';

/**
 * Un email couplé à sa classification — l'unité de restitution destinée à
 * une future interface JARVIS. Contient tout ce qu'il faut pour afficher
 * l'email, la décision (`important` / `not_important` / `uncertain`), sa
 * source, la préférence appliquée le cas échéant (`preferenceId`), et une
 * explication (`reason`) — sans jamais porter de credential : `EmailMessage`
 * et `ClassificationResult` n'en contiennent structurellement aucun.
 */
export interface ClassifiedEmail {
  readonly email: EmailMessage;
  readonly classification: ClassificationResult;
}
