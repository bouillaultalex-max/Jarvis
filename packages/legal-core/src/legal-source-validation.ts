import {
  LEGAL_SOURCE_AUTHORITIES,
  LEGAL_SOURCE_RELIABILITIES,
  LEGAL_SOURCE_TYPES,
  type LegalSource,
} from './legal-case.js';
import {
  checkNoDuplicateIds,
  invalid,
  isNonEmptyString,
  isValidDateString,
  validateEachOf,
  type LegalCaseValidation,
  OK,
} from './legal-validation-shared.js';

/**
 * Validation runtime d'une {@link LegalSource} non fiable — jalon LEGAL-02A
 * (revue d'architecture LEGAL-01 §5/§7). Extrait de
 * `legal-case-validation.ts` pour éviter qu'un seul fichier ne porte toute
 * la validation du domaine (revue LEGAL-01 §10 : ce fichier approchait déjà
 * 350 lignes avant l'ajout de la temporalité/versionnement).
 *
 * Ne fait **que** de la validation de forme (types, unions fermées,
 * cohérence des dates) — jamais de résolution temporelle (« quelle version
 * s'appliquait à telle date »), explicitement hors périmètre de LEGAL-02A.
 */

/** Empreinte SHA-256 hexadécimale — même format que `createHash('sha256').digest('hex')`, déjà utilisé ailleurs dans le dépôt (`confirmation-service.ts`, `fingerprint.ts`). */
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function validateOptionalString(value: unknown, path: string, label: string): LegalCaseValidation {
  if (value !== undefined && typeof value !== 'string') {
    return invalid(`${path}.${label} : chaîne attendue.`);
  }
  return OK;
}

/**
 * Valide une {@link LegalSource} non fiable. Ne lève jamais — voir
 * {@link LegalCaseValidation}.
 *
 * Règles temporelles (`LEGAL_SPECIFICATION.md` et revue LEGAL-01 §7) :
 *   - `effectiveFrom`, `consultedAt` sont des dates ISO 8601 obligatoires et
 *     effectivement interprétables ;
 *   - `publicationDate`, si présente, doit être une date ISO 8601 valide —
 *     mais elle est **optionnelle** (LEGAL-02B.3) : aucune source réelle
 *     n'est tenue d'en fournir une avec une sémantique confirmée ;
 *   - `effectiveTo`, si présent, doit être une date valide **strictement
 *     postérieure** à `effectiveFrom` — une source ne peut pas cesser
 *     d'être en vigueur avant même d'y être entrée ;
 *   - `consultedAt` n'est jamais comparé à `effectiveFrom`/`effectiveTo` :
 *     ce sont des axes temporels indépendants (voir la note de classe de
 *     `LegalSource`).
 */
export function validateSource(source: unknown, path: string): LegalCaseValidation {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return invalid(`${path} : objet attendu.`);
  }
  const {
    id,
    sourceType,
    authority,
    title,
    identifier,
    reference,
    url,
    publicationDate,
    effectiveFrom,
    effectiveTo,
    consultedAt,
    version,
    contentHash,
    reliability,
  } = source as Partial<LegalSource>;

  if (!isNonEmptyString(id)) return invalid(`${path}.id : chaîne non vide attendue.`);
  if (typeof sourceType !== 'string' || !LEGAL_SOURCE_TYPES.includes(sourceType as never)) {
    return invalid(`${path}.sourceType : l'une de ${LEGAL_SOURCE_TYPES.join(', ')} attendue.`);
  }
  if (typeof authority !== 'string' || !LEGAL_SOURCE_AUTHORITIES.includes(authority as never)) {
    return invalid(`${path}.authority : l'une de ${LEGAL_SOURCE_AUTHORITIES.join(', ')} attendue.`);
  }
  if (!isNonEmptyString(title)) return invalid(`${path}.title : chaîne non vide attendue.`);
  if (!isNonEmptyString(identifier))
    return invalid(`${path}.identifier : chaîne non vide attendue.`);

  const referenceResult = validateOptionalString(reference, path, 'reference');
  if (!referenceResult.ok) return referenceResult;
  const urlResult = validateOptionalString(url, path, 'url');
  if (!urlResult.ok) return urlResult;

  if (publicationDate !== undefined && !isValidDateString(publicationDate)) {
    return invalid(`${path}.publicationDate : date ISO 8601 valide attendue si présente.`);
  }
  if (!isValidDateString(effectiveFrom)) {
    return invalid(`${path}.effectiveFrom : date ISO 8601 valide attendue.`);
  }
  if (effectiveTo !== undefined) {
    if (!isValidDateString(effectiveTo)) {
      return invalid(`${path}.effectiveTo : date ISO 8601 valide attendue.`);
    }
    if (Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) {
      return invalid(`${path}.effectiveTo : doit être postérieur à effectiveFrom.`);
    }
  }
  if (!isValidDateString(consultedAt)) {
    return invalid(`${path}.consultedAt : date ISO 8601 valide attendue.`);
  }
  if (!isNonEmptyString(version)) {
    return invalid(`${path}.version : chaîne non vide attendue.`);
  }
  if (contentHash !== undefined) {
    if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) {
      return invalid(
        `${path}.contentHash : empreinte SHA-256 hexadécimale (64 caractères) attendue.`,
      );
    }
  }
  if (
    typeof reliability !== 'string' ||
    !LEGAL_SOURCE_RELIABILITIES.includes(reliability as never)
  ) {
    return invalid(
      `${path}.reliability : l'une de ${LEGAL_SOURCE_RELIABILITIES.join(', ')} attendue.`,
    );
  }

  return OK;
}

/**
 * Valide la liste `sources` d'une {@link import('./legal-case.js').LegalCase} :
 * chaque élément via {@link validateSource}, puis l'absence de doublon
 * d'`id` (nécessaire pour que `LegalCitation.sourceId` désigne toujours
 * exactement une source, sans ambiguïté).
 */
export function validateSourceList(sources: unknown, path: string): LegalCaseValidation {
  const itemsResult = validateEachOf(sources, path, validateSource);
  if (!itemsResult.ok) return itemsResult;

  return checkNoDuplicateIds(sources as readonly { readonly id: string }[], path);
}
