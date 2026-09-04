import type { SecretStore } from '../secret-store.js';

/**
 * Implémentation de développement/test de {@link SecretStore}, entièrement
 * en mémoire.
 *
 * AVERTISSEMENT : rien n'est chiffré ni persisté — **jamais** utiliser en
 * production. Sert uniquement à valider l'architecture `SecretStore` (M5)
 * sans dépendre d'un coffre-fort réel.
 *
 * Le stockage utilise un champ privé JS réel (`#secrets`, pas seulement
 * `private` TypeScript) : les valeurs n'apparaissent donc jamais dans
 * `JSON.stringify(store)`, `console.log(store)` ou `Object.keys(store)` —
 * seule l'API `SecretStore` peut les lire.
 */
export class InMemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, string>();

  async set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
  }

  async get(key: string): Promise<string | undefined> {
    return this.#secrets.get(key);
  }

  async delete(key: string): Promise<void> {
    this.#secrets.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.#secrets.has(key);
  }
}
