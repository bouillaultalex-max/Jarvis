import { SecretNotFoundError } from './errors.js';

/**
 * Abstraction de stockage de secrets (tokens OAuth, clés API…),
 * indépendante du mécanisme réel (coffre-fort OS, vault chiffré, service
 * cloud…). M5 ne fournit qu'une implémentation de développement/test —
 * voir {@link ../in-memory/in-memory-secret-store.js}.
 *
 * Un secret lu via `get`/`has` ne doit jamais être :
 *   - transmis au LLM ;
 *   - journalisé (log, erreur, exception) ;
 *   - renvoyé par un `Tool` ou inclus dans une réponse utilisateur.
 * Seul le code d'infrastructure qui construit un client déjà authentifié
 * (ex. un `AccessTokenProvider`) doit lire un `SecretStore`.
 */
export interface SecretStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * Variante stricte de `SecretStore.get` : lève {@link SecretNotFoundError}
 * plutôt que de renvoyer `undefined`. Le message d'erreur ne cite que la
 * clé, jamais une valeur.
 */
export async function requireSecret(store: SecretStore, key: string): Promise<string> {
  const value = await store.get(key);
  if (value === undefined) {
    throw new SecretNotFoundError(key);
  }
  return value;
}
