import {
  LEGAL_HISTORY_COMPLETENESSES,
  type LegalCitation,
  type LegalSource,
} from './legal-case.js';
import {
  checkNoDuplicateIds,
  invalid,
  isNonEmptyString,
  isPlainObject,
  isValidDateString,
  validateEachOf,
  type LegalCaseValidation,
  OK,
} from './legal-validation-shared.js';

/**
 * Validation runtime d'une {@link LegalCitation} non fiable — jalon
 * LEGAL-02A (revue d'architecture LEGAL-01 §5/§6).
 *
 * Fait respecter, en plus de la forme, deux règles d'intégrité qu'un
 * typage statique ne peut pas garantir sur une valeur `unknown` :
 *   - `sourceId` doit désigner une {@link LegalSource} réellement présente
 *     dans `sources` ;
 *   - `sourceVersion` doit correspondre exactement au `version` de cette
 *     source précise — une incohérence indique qu'une citation a été
 *     créée pour une version qui n'est plus (ou n'a jamais été) celle
 *     enregistrée sous cet `id` (voir la note de classe de `LegalCitation`).
 *
 * `contentHash` (optionnel) doit avoir la forme d'une empreinte SHA-256 et, si la
 * source en porte une, lui être identique. `eligibility` (optionnel) est validé
 * par {@link validateEligibility} ; `knownQuestionIds` (les `LegalQuestion` du
 * dossier) est alors requis pour vérifier que `questionId` désigne une question
 * réelle — sans lui, cette référence ne peut pas être vérifiée et est refusée.
 */
export function validateCitation(
  citation: unknown,
  path: string,
  knownSourcesById: ReadonlyMap<string, LegalSource>,
  knownQuestionIds?: ReadonlySet<string>,
): LegalCaseValidation {
  if (typeof citation !== 'object' || citation === null || Array.isArray(citation)) {
    return invalid(`${path} : objet attendu.`);
  }
  const {
    id,
    sourceId,
    sourceVersion,
    pinpoint,
    quotedText,
    consultedAt,
    contentHash,
    eligibility,
  } = citation as Partial<LegalCitation>;

  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (!isNonEmptyString(sourceId)) return invalid(`${path}.sourceId : chaîne non vide attendue.`);
  if (!isNonEmptyString(sourceVersion))
    return invalid(`${path}.sourceVersion : chaîne non vide attendue.`);

  const source = knownSourcesById.get(sourceId);
  if (source === undefined) {
    return invalid(`${path}.sourceId : source inconnue « ${sourceId} » (absente de « sources »).`);
  }
  if (source.version !== sourceVersion) {
    return invalid(
      `${path}.sourceVersion : incohérente — la source « ${sourceId} » est en version « ${source.version} », pas « ${sourceVersion} ».`,
    );
  }

  if (pinpoint !== undefined && typeof pinpoint !== 'string') {
    return invalid(`${path}.pinpoint : chaîne attendue.`);
  }
  if (quotedText !== undefined && typeof quotedText !== 'string') {
    return invalid(`${path}.quotedText : chaîne attendue.`);
  }
  if (!isValidDateString(consultedAt)) {
    return invalid(`${path}.consultedAt : date ISO 8601 valide attendue.`);
  }

  const hashResult = validateCitationHash(contentHash, source, path);
  if (!hashResult.ok) return hashResult;

  if (eligibility !== undefined) {
    return validateEligibility(eligibility, `${path}.eligibility`, knownQuestionIds);
  }

  return OK;
}

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function validateCitationHash(
  contentHash: unknown,
  source: LegalSource,
  path: string,
): LegalCaseValidation {
  if (contentHash === undefined) return OK;
  if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) {
    return invalid(
      `${path}.contentHash : empreinte SHA-256 hexadécimale (64 caractères) attendue.`,
    );
  }
  if (source.contentHash !== undefined && source.contentHash !== contentHash) {
    return invalid(
      `${path}.contentHash : incohérent avec l'empreinte de la source « ${source.id} » — la citation ne désigne pas le contenu enregistré.`,
    );
  }
  return OK;
}

/**
 * Valide le fondement d'éligibilité d'une citation de niveau source (ADR-0020).
 * Ne juge que la **forme** et la **référence de question** : aucune vérification
 * temporelle (l'applicabilité de la version à `asOf` relève du resolver et de
 * VERIFY), aucune pertinence.
 */
function validateEligibility(
  eligibility: unknown,
  path: string,
  knownQuestionIds: ReadonlySet<string> | undefined,
): LegalCaseValidation {
  if (!isPlainObject(eligibility)) return invalid(`${path} : objet attendu.`);
  const { questionId, asOf, resolution, historyCompleteness } = eligibility;

  if (!isNonEmptyString(questionId))
    return invalid(`${path}.questionId : chaîne non vide attendue.`);
  if (knownQuestionIds === undefined || !knownQuestionIds.has(questionId)) {
    return invalid(
      `${path}.questionId : question inconnue « ${questionId} » (absente de « questions »).`,
    );
  }
  if (!isValidDateString(asOf)) {
    return invalid(`${path}.asOf : date ISO 8601 valide attendue (jamais implicite).`);
  }
  if (resolution !== 'resolved') return invalid(`${path}.resolution : « resolved » attendu.`);
  if (
    typeof historyCompleteness !== 'string' ||
    !LEGAL_HISTORY_COMPLETENESSES.includes(historyCompleteness as never)
  ) {
    return invalid(
      `${path}.historyCompleteness : l'une de ${LEGAL_HISTORY_COMPLETENESSES.join(', ')} attendue.`,
    );
  }
  return OK;
}

/**
 * Valide la liste `citations` d'une {@link import('./legal-case.js').LegalCase} :
 * chaque élément via {@link validateCitation}, puis l'absence de doublon
 * d'`id` (nécessaire pour que `citationIds` — recherche, arguments,
 * analyses, conclusions — désigne toujours une citation sans ambiguïté).
 */
export function validateCitationList(
  citations: unknown,
  path: string,
  knownSourcesById: ReadonlyMap<string, LegalSource>,
  knownQuestionIds?: ReadonlySet<string>,
): LegalCaseValidation {
  const itemsResult = validateEachOf(citations, path, (item, itemPath) =>
    validateCitation(item, itemPath, knownSourcesById, knownQuestionIds),
  );
  if (!itemsResult.ok) return itemsResult;

  return checkNoDuplicateIds(citations as readonly { readonly id: string }[], path);
}
