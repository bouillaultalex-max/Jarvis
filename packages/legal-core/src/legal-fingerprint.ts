import { createHash } from 'node:crypto';

import {
  canonicalizeLegal,
  isSupportedCanonicalization,
  LEGAL_CANONICALIZATION_VERSION,
} from './legal-canonical.js';
import { invalid, OK, type LegalCaseValidation } from './legal-validation-shared.js';
import { validateClosedObject } from './legal-primitives.js';

/**
 * Empreinte d'un objet **immuable** du dossier — LegalCase v3.
 *
 *   objet → canonicalisation versionnée → SHA-256 (UTF-8) → hexadécimal minuscule
 *
 * Stockée **dans l'objet qui référence** (validation, conflit, résolution, référence
 * d'entrée `fact`/`evidence`), jamais sur l'objet référencé lui-même.
 *
 * ## Portée — ce que l'empreinte ne prouve PAS
 * Elle prouve seulement que l'objet **référencé** n'a pas changé depuis la
 * référence. Elle ne détecte ni la modification d'un objet que personne ne
 * référence, ni la troncature de la fin d'une liste, ni une réécriture complète et
 * cohérente du fichier ; elle n'authentifie aucun auteur. Ce n'est pas une preuve
 * d'intégrité d'un fichier externe.
 */
export interface LegalFingerprint {
  readonly algorithm: 'sha256';
  /** Version de canonicalisation utilisée (voir `legal-canonical.ts`). */
  readonly canonicalization: number;
  /** SHA-256 hexadécimal minuscule (64 caractères). */
  readonly value: string;
}

const FINGERPRINT_KEYS: ReadonlySet<string> = new Set(['algorithm', 'canonicalization', 'value']);
const HEX_64 = /^[0-9a-f]{64}$/;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Empreinte de `value` avec la canonicalisation courante.
 *
 * @throws {TypeError} si `value` n'est pas une donnée JSON canonicalisable.
 */
export function computeLegalFingerprint(value: unknown): LegalFingerprint {
  return {
    algorithm: 'sha256',
    canonicalization: LEGAL_CANONICALIZATION_VERSION,
    value: sha256Hex(canonicalizeLegal(value, LEGAL_CANONICALIZATION_VERSION)),
  };
}

/**
 * `true` si `fingerprint` est l'empreinte de `value` **selon la version inscrite**.
 * Une version de canonicalisation inconnue, une forme invalide ou une valeur non
 * canonicalisable donnent `false` : jamais « vérifié » par défaut.
 */
export function verifyLegalFingerprint(value: unknown, fingerprint: unknown): boolean {
  if (!validateLegalFingerprint(fingerprint, 'fingerprint').ok) return false;
  const { canonicalization, value: expected } = fingerprint as LegalFingerprint;
  try {
    return sha256Hex(canonicalizeLegal(value, canonicalization)) === expected;
  } catch {
    return false;
  }
}

/** Deux empreintes désignent-elles la même valeur (mêmes algorithme, version, hexadécimal) ? */
export function legalFingerprintsEqual(a: LegalFingerprint, b: LegalFingerprint): boolean {
  return (
    a.algorithm === b.algorithm && a.canonicalization === b.canonicalization && a.value === b.value
  );
}

/** Forme d'une empreinte : clés fermées, `sha256`, version supportée, hexadécimal valide. */
export function validateLegalFingerprint(value: unknown, path: string): LegalCaseValidation {
  const closed = validateClosedObject(value, FINGERPRINT_KEYS, path);
  if (!closed.ok) return closed;
  const { algorithm, canonicalization, value: digest } = value as Record<string, unknown>;
  if (algorithm !== 'sha256') return invalid(`${path}.algorithm : « sha256 » attendu.`);
  if (!isSupportedCanonicalization(canonicalization)) {
    return invalid(`${path}.canonicalization : version de canonicalisation non supportée.`);
  }
  if (typeof digest !== 'string' || !HEX_64.test(digest)) {
    return invalid(
      `${path}.value : empreinte SHA-256 hexadécimale minuscule (64 caractères) attendue.`,
    );
  }
  return OK;
}
