import { createInterface } from 'node:readline';

import { OsCredentialSecretStore, type SecretStore } from '@jarvis/connectors';

import {
  WHATSAPP_ACCESS_TOKEN_KEY,
  WHATSAPP_APP_SECRET_KEY,
  WHATSAPP_VERIFY_TOKEN_KEY,
} from './real-whatsapp-config.js';

/**
 * Outil local de provisionnement des secrets du mode réel WhatsApp dans le
 * trousseau OS (`OsCredentialSecretStore`) — **l'outil identifié comme
 * manquant** dans le rapport précédent, construit ici sur le même schéma
 * déjà en place et testé pour Légifrance
 * (`apps/desktop/src/provision-legifrance-secrets.ts`) — logique dupliquée
 * volontairement plutôt que partagée entre apps : `apps/whatsapp-channel`
 * ne doit jamais dépendre de `apps/desktop` (frontière déjà actée,
 * `eslint.config.js`).
 *
 * Volontairement **hors** de `main.ts` : un geste d'administration locale
 * ponctuel, jamais appelé par le bootstrap lui-même. Aucun appel réseau,
 * aucune connexion Meta — uniquement `SecretStore.set`/`has` (opérations
 * locales).
 *
 * Lancement (racine du dépôt, terminal interactif — jamais de valeur à
 * coller ici ni dans un chat, uniquement saisie masquée au clavier) :
 *
 *   node_modules/.bin/tsx apps/whatsapp-channel/src/provision-whatsapp-secrets.ts
 *
 * Ne provisionne **que** les trois secrets (`appSecret`/`verifyToken`/
 * `accessToken`) — `phoneNumberId`/version Graph API/expéditeur autorisé
 * restent des variables d'environnement (`real-whatsapp-config.ts`), non
 * secrets, jamais écrites dans le trousseau.
 */

export class ProvisionCancelledError extends Error {
  constructor() {
    super('Provisionnement annulé (Ctrl+C) — aucun secret écrit.');
    this.name = 'ProvisionCancelledError';
  }
}

/**
 * `stdin` s'est terminé (`'end'`) avant Entrée/Ctrl+C — ex. redirection
 * depuis un fichier/pipe épuisé, ou session de terminal interrompue.
 * Défaut corrigé en revue : sans cet écouteur, `readMaskedLine()` ne se
 * résolvait **jamais**, laissant l'écouteur `data` et le mode brut actifs
 * indéfiniment (vérifié par test).
 */
export class ProvisionStdinClosedError extends Error {
  constructor() {
    super('stdin fermé avant la fin de la saisie — aucun secret écrit.');
    this.name = 'ProvisionStdinClosedError';
  }
}

/** Sous-ensemble de `process.stdin` nécessaire ici — permet l'injection d'un double en test. */
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

/** Lit une ligne au clavier sans jamais l'afficher — même mécanisme que `provision-legifrance-secrets.ts`. */
export function readMaskedLine(io: ProvisionIo, prompt: string): Promise<string> {
  const { stdin, output } = io;
  output.write(prompt);
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.setRawMode?.(false);
    };

    function onEnd(): void {
      cleanup();
      reject(new ProvisionStdinClosedError());
    }

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
    stdin.once('end', onEnd);
  });
}

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

interface SecretField {
  readonly key: string;
  readonly label: string;
  readonly prompt: string;
}

const SECRET_FIELDS: readonly SecretField[] = [
  {
    key: WHATSAPP_APP_SECRET_KEY,
    label: 'appSecret',
    prompt: 'App Secret (panneau Meta App → Paramètres de base) : ',
  },
  {
    key: WHATSAPP_VERIFY_TOKEN_KEY,
    label: 'verifyToken',
    prompt: 'Verify Token (choisi par vous, à reporter dans la configuration webhook Meta) : ',
  },
  {
    key: WHATSAPP_ACCESS_TOKEN_KEY,
    label: 'accessToken',
    prompt: 'Access Token (temporaire 24h, ou permanent via un System User) : ',
  },
];

export type ProvisionOutcome =
  | { readonly status: 'not_a_tty' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'stdin_closed' }
  | { readonly status: 'declined_overwrite'; readonly keys: readonly string[] }
  | { readonly status: 'empty_value'; readonly label: string }
  | { readonly status: 'written'; readonly keys: readonly string[] }
  | {
      readonly status: 'partial_failure';
      readonly results: ReadonlyArray<{ readonly key: string; readonly ok: boolean }>;
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
  } catch {
    // Motif **fixe et contrôlé** — jamais `err.message`, même partiellement
    // expurgé : retirer la seule valeur soumise (tentative précédente,
    // revue finale) ne protège pas contre une exception qui embarquerait un
    // AUTRE secret, un encodage, une pile, ou tout autre détail interne du
    // trousseau. Seul le nom de la clé — non secret — est inclus ; l'erreur
    // d'origine n'est jamais inspectée au-delà de ce `catch`.
    return {
      ok: false,
      error: `Échec d'écriture pour la clé "${key}" (détail non repris — voir les journaux du trousseau OS si besoin).`,
    };
  }
}

export interface ProvisionWhatsAppSecretsDeps extends ProvisionIo {
  readonly secretStore: SecretStore;
}

/**
 * Provisionne `whatsapp.appSecret`/`verifyToken`/`accessToken`. Refuse
 * avant toute saisie si `stdin` n'est pas un TTY. N'écrase jamais un
 * secret déjà présent sans confirmation explicite (valeurs jamais
 * affichées). Un refus ou une annulation n'écrit rien.
 */
export async function runProvisionWhatsAppSecrets(
  deps: ProvisionWhatsAppSecretsDeps,
): Promise<ProvisionOutcome> {
  if (deps.stdin.isTTY !== true) {
    return { status: 'not_a_tty' };
  }

  const existing: string[] = [];
  for (const field of SECRET_FIELDS) {
    if (await deps.secretStore.has(field.key)) existing.push(field.key);
  }
  if (existing.length > 0) {
    const confirmed = await confirmOverwrite(deps, existing);
    if (!confirmed) {
      return { status: 'declined_overwrite', keys: existing };
    }
  }

  const values: Record<string, string> = {};
  for (const field of SECRET_FIELDS) {
    let value: string;
    try {
      value = await readMaskedLine(deps, field.prompt);
    } catch (err) {
      if (err instanceof ProvisionCancelledError) return { status: 'cancelled' };
      if (err instanceof ProvisionStdinClosedError) return { status: 'stdin_closed' };
      throw err;
    }
    if (value.length === 0) {
      return { status: 'empty_value', label: field.label };
    }
    values[field.key] = value;
  }

  const results = await Promise.all(
    SECRET_FIELDS.map(async (field) => ({
      key: field.key,
      ...(await trySet(deps.secretStore, field.key, values[field.key]!)),
    })),
  );

  if (results.every((r) => r.ok)) {
    return { status: 'written', keys: results.map((r) => r.key) };
  }
  return {
    status: 'partial_failure',
    results: results.map((r) => ({ key: r.key, ok: r.ok })),
    detail: results
      .filter((r): r is { key: string; ok: false; error: string } => !r.ok)
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
    case 'stdin_closed':
      return ['Entrée standard fermée avant la fin de la saisie — aucun secret écrit.'];
    case 'declined_overwrite':
      return [`Écrasement refusé pour : ${outcome.keys.join(', ')} — aucun secret écrit.`];
    case 'empty_value':
      return [`Valeur vide refusée pour ${outcome.label} — aucun secret écrit.`];
    case 'written':
      return [`Secrets écrits : ${outcome.keys.join(', ')}.`];
    case 'partial_failure':
      return [
        `Écriture partielle — ${outcome.results.map((r) => `${r.key}: ${r.ok ? 'écrit' : 'échec'}`).join(', ')}.`,
        `Détail (sans valeur) : ${outcome.detail}`,
      ];
    default: {
      const exhaustive: never = outcome;
      return [`Statut inattendu (${(exhaustive as { readonly status: string }).status}).`];
    }
  }
}

async function main(): Promise<void> {
  const outcome = await runProvisionWhatsAppSecrets({
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
