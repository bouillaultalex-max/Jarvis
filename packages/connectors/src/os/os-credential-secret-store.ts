import { AsyncEntry } from '@napi-rs/keyring';

import type { SecretStore } from '../secret-store.js';

/**
 * Implémentation de production de {@link SecretStore} — M8-B3. Délègue
 * intégralement au gestionnaire d'identification natif du système
 * d'exploitation (Windows Credential Manager / macOS Keychain / Linux
 * Secret Service) via `@napi-rs/keyring` (`AsyncEntry`, API vérifiée contre
 * la version installée). Aucun fichier, aucune clé de chiffrement gérée par
 * JARVIS, aucune cryptographie maison : le chiffrement au repos est
 * entièrement délégué à l'OS.
 *
 * Ne garde aucun état en mémoire au-delà du nom de service (non sensible) :
 * chaque appel crée un `AsyncEntry` éphémère pour la clé demandée. Rien à
 * exposer via `JSON.stringify`/`Object.keys`/`String()` sur cette instance —
 * plus strict à cet égard que `InMemorySecretStore`, qui doit au moins
 * protéger un `#secrets` privé.
 */
export interface OsCredentialSecretStoreOptions {
  /**
   * Nom de service sous lequel toutes les entrées de ce store sont
   * regroupées dans le magasin OS. Configurable pour séparer un
   * environnement de développement d'un environnement réel sans toucher à
   * la convention de clé métier (`gmail.{accountId}.refreshToken`, définie
   * dans `gmail-auth.ts`, inchangée). Défaut : `'jarvis'`.
   */
  readonly service?: string;
}

const DEFAULT_SERVICE = 'jarvis';

export class OsCredentialSecretStore implements SecretStore {
  private readonly service: string;

  constructor(options: OsCredentialSecretStoreOptions = {}) {
    this.service = options.service ?? DEFAULT_SERVICE;
  }

  /**
   * `AsyncEntry.setPassword` peut lever une erreur `Ambiguous` si plusieurs
   * credentials de plateforme correspondent déjà à cette entrée (uniquement
   * possible si une application tierce en a écrit un) — propagée telle
   * quelle, jamais interceptée ni enrichie : son message ne décrit qu'un
   * conflit de credential, jamais une valeur.
   */
  async set(key: string, value: string): Promise<void> {
    await new AsyncEntry(this.service, key).setPassword(value);
  }

  /**
   * Le typage fourni par `@napi-rs/keyring@2.0.0` déclare
   * `getPassword(): Promise<string | undefined>`, mais le comportement réel
   * observé (vérifié par test contre le backend OS réel, pas supposé depuis
   * le `.d.ts`) résout `null` pour une entrée absente — jamais `undefined`.
   * `?? undefined` normalise les deux pour respecter exactement le contrat
   * `SecretStore.get()`.
   */
  async get(key: string): Promise<string | undefined> {
    const value = await new AsyncEntry(this.service, key).getPassword();
    return value ?? undefined;
  }

  /**
   * `AsyncEntry.deletePassword` ne lève jamais pour une entrée absente (elle
   * résout `false` dans ce cas) — le contrat `SecretStore.delete()`
   * (idempotent, jamais d'exception si rien à supprimer) est donc respecté
   * nativement, sans logique supplémentaire ici.
   */
  async delete(key: string): Promise<void> {
    await new AsyncEntry(this.service, key).deletePassword();
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }
}
