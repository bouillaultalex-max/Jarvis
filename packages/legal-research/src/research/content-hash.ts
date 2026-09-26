import { createHash } from 'node:crypto';

/**
 * Contrat normatif du hash de contenu — ADR-0021. Unique définition de calcul
 * et de vérification (fonctions pures : aucune I/O, aucune horloge).
 *
 * **SHA-256 des octets UTF-8 du texte exactement tel que reçu**, en hexadécimal
 * minuscule (64 caractères). Aucune normalisation, à dessein :
 *   - pas de `trim` (les espaces de début et de fin comptent) ;
 *   - pas de normalisation Unicode (`é` composé et `é` décomposé donnent deux hash) ;
 *   - pas de transformation des espaces ni des fins de ligne (`\r\n` ≠ `\n`).
 *
 * Le texte concerné est le champ `texte` de l'article — jamais `texteHtml`, qui
 * n'est pas exposé. Le hash est une empreinte d'intégrité du **contenu d'une
 * version** ; il n'entre dans aucune clé d'identité (ADR-0013) et ne prouve pas
 * la version (l'identité est contrôlée à part).
 *
 * Limite connue : l'algorithme n'est pas inscrit dans la valeur (pas de préfixe).
 */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** `true` si le hash du texte est exactement `expectedHash`. Comparaison stricte, sensible à la casse. */
export function verifyContentHash(text: string, expectedHash: string): boolean {
  return computeContentHash(text) === expectedHash;
}
