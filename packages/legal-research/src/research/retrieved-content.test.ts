import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { computeContentHash } from './content-hash.js';
import { ContentIntegrityError, RetrievedContent } from './retrieved-content.js';

const TEXT = 'Texte juridique confidentiel-de-test L1237-1 : préavis.';
const HASH = computeContentHash(TEXT);

function content(): RetrievedContent {
  return RetrievedContent.verified(TEXT, HASH);
}

describe('RetrievedContent — vérifié par construction (D5)', () => {
  it('1. texte + hash correct → contenu disponible, hash exposé, texte lisible explicitement', () => {
    const c = content();
    expect(c.contentHash).toBe(HASH);
    expect(c.revealText()).toBe(TEXT);
    expect(() => c.assertMatches(HASH)).not.toThrow();
  });

  it('2. hash incorrect → échec dur (ContentIntegrityError structurée), aucun contenu construit', () => {
    const wrong = computeContentHash('autre texte');
    let caught: unknown;
    try {
      RetrievedContent.verified(TEXT, wrong);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentIntegrityError);
    const error = caught as ContentIntegrityError;
    expect(error.reason).toBe('hash_mismatch');
    expect(error.expectedHash).toBe(wrong);
    expect(error.actualHash).toBe(HASH);
  });

  it('un hash attendu absent est refusé : jamais un contenu « vérifié » sans référence', () => {
    let caught: unknown;
    try {
      RetrievedContent.verified(TEXT, undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentIntegrityError);
    expect((caught as ContentIntegrityError).reason).toBe('missing_expected_hash');
  });

  it('un hash à la mauvaise casse ou tronqué est un échec (comparaison stricte)', () => {
    expect(() => RetrievedContent.verified(TEXT, HASH.toUpperCase())).toThrow(
      ContentIntegrityError,
    );
    expect(() => RetrievedContent.verified(TEXT, HASH.slice(0, 63))).toThrow(ContentIntegrityError);
  });

  it('assertMatches recalcule : détecte un hash différent, ou absent', () => {
    const c = content();
    expect(() => c.assertMatches(computeContentHash('autre'))).toThrow(ContentIntegrityError);
    expect(() => c.assertMatches(undefined)).toThrow(ContentIntegrityError);
  });

  it('le texte est conservé exactement tel que reçu (aucun trim, aucune normalisation)', () => {
    const raw = '  ligne 1\r\n\tligne 2 é  ';
    const c = RetrievedContent.verified(raw, computeContentHash(raw));
    expect(c.revealText()).toBe(raw);
  });

  it('ne se construit pas directement : seule `verified` produit une instance', () => {
    // Le constructeur est privé : `new` est refusé au typage ; à l'exécution, la seule
    // instance possible reste cohérente avec un hash vérifié.
    const c = content();
    expect(c).toBeInstanceOf(RetrievedContent);
    expect(computeContentHash(c.revealText())).toBe(c.contentHash);
  });
});

describe('RetrievedContent — le texte n’apparaît dans aucune sérialisation par défaut (D9)', () => {
  it('9. JSON.stringify : un marqueur rédigé, jamais le texte', () => {
    const c = content();
    expect(JSON.stringify(c)).not.toContain('confidentiel-de-test');
    expect(JSON.parse(JSON.stringify(c))).toEqual({ redacted: true, contentHash: HASH });
    expect(JSON.stringify({ result: { content: c }, list: [c] })).not.toContain(
      'confidentiel-de-test',
    );
  });

  it('String(), gabarits et concaténations ne contiennent pas le texte', () => {
    const c = content();
    for (const rendered of [String(c), `${c}`, `x${c}`, c.toString()]) {
      expect(rendered).not.toContain('confidentiel-de-test');
      expect(rendered).toContain(HASH);
    }
  });

  it('affichage console / util.inspect (même imbriqué) : jamais le texte', () => {
    const c = content();
    expect(inspect(c)).not.toContain('confidentiel-de-test');
    expect(inspect({ a: { b: { c } } }, { depth: 10, showHidden: true })).not.toContain(
      'confidentiel-de-test',
    );
  });

  it('aucune propriété énumérable ne porte le texte : Object.keys, spread, entrées, clone structuré', () => {
    const c = content();
    expect(Object.keys(c)).toEqual(['contentHash']);
    expect(Object.getOwnPropertyNames(c)).toEqual(['contentHash']);
    expect(JSON.stringify({ ...c })).not.toContain('confidentiel-de-test');
    expect(JSON.stringify(Object.entries(c))).not.toContain('confidentiel-de-test');
    expect(JSON.stringify(structuredClone(c))).not.toContain('confidentiel-de-test');
  });

  it('11. l’erreur d’intégrité ne contient jamais le texte : uniquement des hash', () => {
    const wrong = computeContentHash('autre texte');
    for (const attempt of [
      () => RetrievedContent.verified(TEXT, wrong),
      () => RetrievedContent.verified(TEXT, undefined),
      () => content().assertMatches(wrong),
    ]) {
      let caught: unknown;
      try {
        attempt();
      } catch (error) {
        caught = error;
      }
      const error = caught as ContentIntegrityError;
      expect(error.message).not.toContain('confidentiel-de-test');
      expect(JSON.stringify(error)).not.toContain('confidentiel-de-test');
      expect(String(error.stack)).not.toContain('confidentiel-de-test');
    }
  });

  it('un objet gelé en profondeur reste utilisable (aucune mutation nécessaire)', () => {
    const c = Object.freeze(content());
    expect(c.revealText()).toBe(TEXT);
    expect(Object.isFrozen(c)).toBe(true);
  });
});
