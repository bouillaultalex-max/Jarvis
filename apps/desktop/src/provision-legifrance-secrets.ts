import { createInterface } from 'node:readline';

import { OsCredentialSecretStore, type SecretStore } from '@jarvis/connectors';
import {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from '@jarvis/legifrance-client';

/**
 * Outil local de provisionnement des secrets sandbox Légifrance dans le
 * trousseau OS (`OsCredentialSecretStore`) — aucun script de ce type
 * n'existait auparavant dans le dépôt (voir README.md → `legal-search`).
 *
 * Volontairement **hors** de `main.ts`/`dispatch()` : ce n'est pas une
 * sous-commande de recherche, c'est un geste d'administration locale
 * ponctuel, jamais appelé par `legal-search` lui-même. Aucune requête OAuth
 * ni appel Légifrance ici — uniquement `SecretStore.set`/`has` (opérations
 * locales).
 *
 * Lancement (racine du dépôt, terminal interactif) :
 *
 *   node_modules/.bin/tsx apps/desktop/src/provision-legifrance-secrets.ts
 */

export class ProvisionCancelledError extends Error {
  constructor() {
    super('Provisionnement annulé (Ctrl+C) — aucun secret écrit.');
    this.name = 'ProvisionCancelledError';
  }
}

/** Sous-ensemble de `process.stdin` nécessaire ici — permet l'injection d'un double en test (ex. `node:stream` `PassThrough`). */
export type ProvisionStdin = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): void;
};

export interface ProvisionIo {
  readonly stdin: ProvisionStdin;
  readonly output: NodeJS.WritableStream;
}

const ENTER_CHARS = new Set(['\r', '\n']);
const BACKSPACE_CHARS = new Set(['\u007f', '\b']);
const CTRL_C = '\u0003';

/**
 * Lit une ligne au clavier sans jamais l'afficher (astérisques ni écho).
 *
 * Traite **chaque caractère** d'un chunk `data` individuellement — jamais le
 * chunk entier comme une seule touche — ce qui couvre nativement le collé
 * (plusieurs caractères livrés dans un seul évènement `data`). Un seul
 * écouteur `data` actif à la fois ; retiré, et le mode brut restauré, dans
 * **tous** les chemins de sortie (succès, Ctrl+C, erreur inattendue) via
 * `finally`.
 */
export function readMaskedLine(io: ProvisionIo, prompt: string): Promise<string> {
  const { stdin, output } = io;
  output.write(prompt);
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
    };

    function onData(chunk: Buffer | string): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const ch of text) {
        if (ch === CTRL_C) {
          cleanup();
          output.write('\n');
          reject(new ProvisionCancelledError());
          return;
        }
        if (ENTER_CHARS.has(ch)) {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (BACKSPACE_CHARS.has(ch)) {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    }

    stdin.on('data', onData);
  });
}

/** Confirmation visible (jamais masquée : ne porte aucun secret) — même mécanisme que `createTerminalConfirm` (`terminal-confirm.ts`). */
async function confirmOverwrite(
  io: ProvisionIo,
  existingKeys: readonly string[],
): Promise<boolean> {
  io.output.write(
    `Clé(s) déjà présente(s) dans le trousseau : ${existingKeys.join(', ')}\n` +
      '(les valeurs ne sont jamais affichées)\n',
  );
  const rl = createInterface({ input: io.stdin, output: io.output });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question('Écraser ? [y/N] ', (value) => resolve(value));
      rl.once('close', () => resolve(''));
    });
    return ['y', 'yes', 'oui'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

export type ProvisionOutcome =
  | { readonly status: 'not_a_tty' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'declined_overwrite'; readonly keys: readonly string[] }
  | { readonly status: 'empty_value'; readonly label: 'clientId' | 'clientSecret' }
  | { readonly status: 'written'; readonly clientIdKey: string; readonly clientSecretKey: string }
  | {
      readonly status: 'partial_failure';
      readonly clientId: 'written' | 'failed';
      readonly clientSecret: 'written' | 'failed';
      readonly detail: string;
    };

async function trySet(
  store: SecretStore,
  key: string,
  value: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  try {
    await store.set(key, value);
    return { ok: true };
  } catch (err) {
    // Jamais `value` dans le message — voir OsCredentialSecretStore.set().
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ProvisionLegifranceSecretsDeps extends ProvisionIo {
  readonly secretStore: SecretStore;
}

/**
 * Provisionne `legifrance.sandbox.clientId`/`clientSecret` dans le
 * `SecretStore` fourni. Refuse avant toute saisie si `stdin` n'est pas un
 * TTY ; ne saisit jamais depuis un pipe/fichier. N'écrase jamais un secret
 * déjà présent sans confirmation explicite en terminal (valeurs jamais
 * affichées) ; un refus n'écrit rien et ne supprime rien. Un échec partiel
 * d'écriture (une clé posée, l'autre en échec) est rapporté sans jamais la
 * valeur, sans tenter de supprimer la clé déjà écrite.
 */
export async function runProvisionLegifranceSecrets(
  deps: ProvisionLegifranceSecretsDeps,
): Promise<ProvisionOutcome> {
  if (deps.stdin.isTTY !== true) {
    return { status: 'not_a_tty' };
  }

  const idKey = legifranceClientIdSecretKey('sandbox');
  const secretKey = legifranceClientSecretSecretKey('sandbox');

  const existing: string[] = [];
  if (await deps.secretStore.has(idKey)) existing.push(idKey);
  if (await deps.secretStore.has(secretKey)) existing.push(secretKey);

  if (existing.length > 0) {
    const confirmed = await confirmOverwrite(deps, existing);
    if (!confirmed) {
      return { status: 'declined_overwrite', keys: existing };
    }
  }

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = await readMaskedLine(deps, 'client_id (sandbox) : ');
  } catch (err) {
    if (err instanceof ProvisionCancelledError) return { status: 'cancelled' };
    throw err;
  }
  if (clientId.length === 0) {
    return { status: 'empty_value', label: 'clientId' };
  }

  try {
    clientSecret = await readMaskedLine(deps, 'client_secret (sandbox) : ');
  } catch (err) {
    if (err instanceof ProvisionCancelledError) return { status: 'cancelled' };
    throw err;
  }
  if (clientSecret.length === 0) {
    return { status: 'empty_value', label: 'clientSecret' };
  }

  const idResult = await trySet(deps.secretStore, idKey, clientId);
  const secretResult = await trySet(deps.secretStore, secretKey, clientSecret);

  if (idResult.ok && secretResult.ok) {
    return { status: 'written', clientIdKey: idKey, clientSecretKey: secretKey };
  }
  return {
    status: 'partial_failure',
    clientId: idResult.ok ? 'written' : 'failed',
    clientSecret: secretResult.ok ? 'written' : 'failed',
    detail: [idResult, secretResult]
      .filter((r): r is { readonly ok: false; readonly error: string } => !r.ok)
      .map((r) => r.error)
      .join(' ; '),
  };
}

/** Lignes d'affichage d'un `ProvisionOutcome` — jamais une valeur de secret. */
export function describeProvisionOutcome(outcome: ProvisionOutcome): readonly string[] {
  switch (outcome.status) {
    case 'not_a_tty':
      return [
        'Provisionnement refusé : entrée standard non interactive (pas un TTY).',
        'Lancez ce script directement dans un terminal, sans redirection ni pipe.',
      ];
    case 'cancelled':
      return ['Provisionnement annulé — aucun secret écrit.'];
    case 'declined_overwrite':
      return [`Écrasement refusé pour : ${outcome.keys.join(', ')} — aucun secret écrit.`];
    case 'empty_value':
      return [`Valeur vide refusée pour ${outcome.label} — aucun secret écrit.`];
    case 'written':
      return [`Secrets écrits : ${outcome.clientIdKey}, ${outcome.clientSecretKey}.`];
    case 'partial_failure':
      return [
        `Écriture partielle — clientId : ${outcome.clientId}, clientSecret : ${outcome.clientSecret}.`,
        `Détail (sans valeur) : ${outcome.detail}`,
      ];
    default: {
      const exhaustive: never = outcome;
      return [`Statut inattendu (${(exhaustive as { readonly status: string }).status}).`];
    }
  }
}

async function main(): Promise<void> {
  const outcome = await runProvisionLegifranceSecrets({
    stdin: process.stdin,
    output: process.stdout,
    secretStore: new OsCredentialSecretStore(),
  });
  for (const line of describeProvisionOutcome(outcome)) {
    process.stdout.write(`${line}\n`);
  }
  process.exitCode = outcome.status === 'written' ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Échec du provisionnement :', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
