import type { SenderAllowlist } from './channel-ports.js';

/** Allowlist en mémoire — ensemble fixe d'identifiants autorisés. */
export class InMemoryAllowlist implements SenderAllowlist {
  readonly #authorized: ReadonlySet<string>;

  constructor(authorized: ReadonlySet<string>) {
    this.#authorized = authorized;
  }

  isAuthorized(senderId: string): boolean {
    return this.#authorized.has(senderId);
  }
}
