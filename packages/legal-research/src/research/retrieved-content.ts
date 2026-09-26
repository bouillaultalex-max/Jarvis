import { computeContentHash, verifyContentHash } from './content-hash.js';

/**
 * Contenu juridique récupéré, **transitoire et vérifié** — ADR-0021.
 *
 * Porte le texte d'une version de source (`texte`) pendant l'exécution du
 * pipeline, pour qu'un futur ANALYZE puisse le lire. Trois propriétés :
 *
 *   1. **Vérifié par construction.** Le constructeur est privé ; la seule voie est
 *      {@link RetrievedContent.verified}, qui exige que le hash du texte soit
 *      exactement le hash attendu (celui de `LegalSource.contentHash`). Une
 *      instance existante est donc toujours cohérente avec ce hash ; sinon
 *      {@link ContentIntegrityError}, jamais un contenu exposé comme vérifié.
 *   2. **Explicite.** Le texte n'est lisible que par {@link revealText} : aucune
 *      propriété énumérable, donc absent de `JSON.stringify`, du spread, de
 *      `Object.keys` et de `structuredClone` ; `toJSON`, `toString` et
 *      l'affichage console renvoient un marqueur qui ne contient jamais le texte.
 *   3. **Hors persistance.** Ce n'est ni un champ de `LegalSource`, ni de
 *      `LegalCitation`, ni de `LegalCase` : il vit dans les résultats de récupération
 *      et disparaît avec eux.
 */
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

export type ContentIntegrityReason = 'hash_mismatch' | 'missing_expected_hash';

/**
 * Le contenu ne peut pas être exposé comme vérifié. Ne contient **jamais** le
 * texte : uniquement des hash (ou leur absence).
 */
export class ContentIntegrityError extends Error {
  constructor(
    readonly reason: ContentIntegrityReason,
    readonly expectedHash: string | undefined,
    readonly actualHash: string,
  ) {
    super(
      reason === 'missing_expected_hash'
        ? 'contenu : aucun hash attendu — intégrité invérifiable, contenu refusé.'
        : `contenu : hash SHA-256 attendu ${expectedHash ?? '?'}, obtenu ${actualHash} — contenu refusé.`,
    );
    this.name = 'ContentIntegrityError';
  }
}

export class RetrievedContent {
  /** Hash SHA-256 du texte — égal, par construction, au hash attendu fourni à `verified`. */
  readonly contentHash: string;
  readonly #text: string;

  private constructor(text: string, contentHash: string) {
    this.#text = text;
    this.contentHash = contentHash;
  }

  /**
   * Seule voie de construction.
   * @param expectedHash hash attendu — en pratique `source.contentHash`.
   * @throws {ContentIntegrityError} si `expectedHash` est absent ou si le hash du texte diffère.
   */
  static verified(text: string, expectedHash: string | undefined): RetrievedContent {
    const actualHash = computeContentHash(text);
    if (expectedHash === undefined) {
      throw new ContentIntegrityError('missing_expected_hash', undefined, actualHash);
    }
    if (actualHash !== expectedHash) {
      throw new ContentIntegrityError('hash_mismatch', expectedHash, actualHash);
    }
    return new RetrievedContent(text, actualHash);
  }

  /** Le texte exact, tel que reçu. L'unique accès : à n'appeler que là où le contenu est réellement utilisé. */
  revealText(): string {
    return this.#text;
  }

  /**
   * Re-contrôle indépendant : le texte détenu correspond-il à `expectedHash` ?
   * Recalcule le hash (ne se fie pas au champ `contentHash`).
   * @throws {ContentIntegrityError}
   */
  assertMatches(expectedHash: string | undefined): void {
    if (expectedHash === undefined) {
      throw new ContentIntegrityError(
        'missing_expected_hash',
        undefined,
        computeContentHash(this.#text),
      );
    }
    if (!verifyContentHash(this.#text, expectedHash)) {
      throw new ContentIntegrityError(
        'hash_mismatch',
        expectedHash,
        computeContentHash(this.#text),
      );
    }
  }

  /** Sérialisation JSON : un marqueur, jamais le texte. */
  toJSON(): { readonly redacted: true; readonly contentHash: string } {
    return { redacted: true, contentHash: this.contentHash };
  }

  toString(): string {
    return `[contenu juridique non sérialisé sha256:${this.contentHash}]`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}
