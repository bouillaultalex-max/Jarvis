import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  ClassificationEngine,
  InMemoryPreferenceStore,
  LlmProviderEmailClassifier,
} from '@jarvis/classification';
import {
  EmailFetchBlockedError,
  fetchAndClassifyEmails,
  type ClassifiedEmail,
} from '@jarvis/inbox';
import { AnthropicProvider, type LlmProvider } from '@jarvis/llm';

import {
  type Account,
  type AccountStore,
  type ConfirmationRequest,
  type ConnectGmailAccountOutcome,
  type DisconnectGmailAccountOutcome,
  type GmailAppCredentials,
  type GmailReadInput,
  type GmailSendInput,
  type SecretStore,
  type ToolExecutionResult,
  ConfirmationService,
  connectGmailAccount,
  disconnectGmailAccount,
  FileAccountStore,
  gmailConnector,
  GmailOAuthFlow,
  OsCredentialSecretStore,
  PermissionManager,
  resolveAccount,
  resolveGmailApiClient,
  ToolExecutor,
  ToolRegistry,
  UnknownAccountError,
} from '@jarvis/connectors';

import { startGmailOAuthCallbackServer } from './gmail-oauth-callback-server.js';
import { describeInboxResult } from './inbox-view.js';
import { parseGmailSendArgs } from './gmail-send-args.js';
import { runGmailSend, type RunGmailSendResult } from './gmail-send.js';
import { createTerminalConfirm } from './terminal-confirm.js';

/**
 * Orchestration desktop du flux Gmail — M8-B2 (OAuth réel) + M8-B3
 * (persistance réelle + détection « déjà connecté ») + M8-B5 (sous-commande
 * `send` : envoi Gmail confirmé réellement accessible).
 *
 * `FileAccountStore`/`OsCredentialSecretStore` : implémentations réelles
 * réutilisées telles quelles (`@jarvis/connectors`) — aucune nouvelle
 * couche de stockage introduite ici. Le compte et son refresh token
 * survivent désormais à l'arrêt du process, contrairement à M8-B2
 * (`InMemoryAccountStore`/`InMemorySecretStore`, volontairement limité à
 * l'intérieur d'un seul run).
 *
 * M8-B5 ne fait que **câbler** `runGmailSend` (M8-B4, inchangé) à un point
 * d'entrée : `resolveAccount`/`ToolExecutor`/`PermissionManager`/
 * `ConfirmationService` restent les seuls points de contrôle, jamais
 * contournés. Aucun secret n'est journalisé ; le résultat de `runGmailSend`
 * n'est jamais sérialisé tel quel (voir {@link describeSendResult}).
 */

function defaultAccountsFilePath(): string {
  const dataDir =
    process.env.JARVIS_DATA_DIR ??
    (process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')));

  return join(dataDir, 'jarvis', 'accounts.json');
}

function openSystemBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) {
      console.log(
        `Ouvrez cette URL dans votre navigateur pour connecter un compte Gmail :\n${url}`,
      );
    }
  });
}

export interface ResolveExistingGmailConnectionOptions {
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  readonly appCredentials: GmailAppCredentials;
  /** Transmis tel quel à `resolveAccount()` — jamais choisi implicitement ici. */
  readonly accountId?: string;
}

/**
 * Détermine si un compte Gmail déjà connecté et immédiatement utilisable
 * existe, pour éviter de rouvrir inutilement un flux OAuth — M8-B3.
 *
 * Réutilise exclusivement des briques existantes, sans dupliquer leurs
 * règles :
 *   - `resolveAccount()` reste l'unique point de sélection de compte : un
 *     `accountId` absent avec plusieurs comptes Gmail persistés lève
 *     `AmbiguousAccountError`, propagée telle quelle — jamais de sélection
 *     arbitraire (« prendre le premier ») introduite ici.
 *   - Le statut du compte (`'connected'` vs `'disconnected'`/`'error'`) et
 *     la présence du secret ne sont **pas** revérifiés ici : c'est
 *     exactement la responsabilité déjà assumée par `resolveGmailCredentials`
 *     (via `resolveGmailApiClient`), inchangée depuis M8-A14. Un compte non
 *     `'connected'`, ou dont le secret est absent, fait donc simplement
 *     échouer `resolveGmailApiClient()` — traité ici comme « pas encore
 *     exploitable », sans réinterpréter la raison.
 *
 * @returns le compte déjà connecté et exploitable, ou `undefined` si un
 *   nouveau consentement OAuth est nécessaire (aucun compte pour ce
 *   provider, ou compte trouvé mais non exploitable).
 * @throws la même erreur que `resolveAccount()` pour tout cas autre
 *   qu'« aucun compte » (notamment `AmbiguousAccountError`) — jamais
 *   avalée.
 */
export async function resolveExistingGmailConnection(
  options: ResolveExistingGmailConnectionOptions,
): Promise<Account | undefined> {
  const { accountStore, secretStore, appCredentials, accountId } = options;

  let account: Account;
  try {
    account = await resolveAccount(accountStore, { provider: 'gmail', accountId });
  } catch (err) {
    if (err instanceof UnknownAccountError) {
      return undefined;
    }
    throw err;
  }

  try {
    // Construction seule, sans appel de méthode : `resolveGmailApiClient` ne
    // fait aucun appel réseau elle-même (voir gmail-client-resolver.ts) —
    // ce contrôle reste purement local.
    await resolveGmailApiClient({ account, secretStore, appCredentials });
    return account;
  } catch {
    return undefined;
  }
}

/** Dépendances desktop injectables — permet aux tests d'utiliser des stores en mémoire. */
export interface DesktopDeps {
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  readonly appCredentials: GmailAppCredentials;
  /** Transmis tel quel à `resolveAccount()` (via `resolveExistingGmailConnection`) — jamais de sélection implicite. */
  readonly accountId?: string;
  /**
   * Injecté par les tests uniquement (transmis à `runGmailSend` → l'échange
   * OAuth et l'appel Gmail `send`). Absent en production ⇒ `fetch` global.
   */
  readonly fetchFn?: typeof fetch;
  /**
   * Injecté par les tests uniquement (transmis à `runGmailSend`). Absent en
   * production ⇒ `runGmailSend` applique sa politique par défaut
   * (`gmail.send` ⇒ `require_confirmation`). Ne contourne jamais
   * `PermissionManager` — le fournit.
   */
  readonly permissionManager?: PermissionManager;
  /**
   * Injecté par les tests uniquement (flux `inbox`). Absent en production ⇒
   * moteur construit par {@link buildInboxClassificationEngine} (préférences
   * en mémoire, LLM branché seulement si `ANTHROPIC_API_KEY` est présente).
   */
  readonly classificationEngine?: ClassificationEngine;
  /**
   * Injecté par les tests uniquement (flux `inbox`, transmis à
   * {@link buildInboxClassificationEngine} lorsque `classificationEngine`
   * n'est pas fourni). Absent en production ⇒ `AnthropicProvider` si
   * `ANTHROPIC_API_KEY` est présente, sinon aucun LLM.
   */
  readonly llmProvider?: LlmProvider;
}

/**
 * Effectue le consentement OAuth réel puis `connectGmailAccount`. Seam
 * injectable : les tests fournissent un faux `connect` (aucun navigateur,
 * aucun `GmailOAuthFlow` rejoué) — même compromis que M8-B3.
 */
export type ConnectGmailFn = (
  deps: DesktopDeps,
  write: (line: string) => void,
) => Promise<ConnectGmailAccountOutcome>;

function defaultDesktopDeps(): DesktopDeps {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET sont requis (variables d’environnement) pour le flux Gmail.',
    );
  }
  return {
    accountStore: new FileAccountStore({ filePath: defaultAccountsFilePath() }),
    secretStore: new OsCredentialSecretStore(),
    appCredentials: { clientId, clientSecret },
    ...(process.env.GMAIL_ACCOUNT_ID !== undefined
      ? { accountId: process.env.GMAIL_ACCOUNT_ID }
      : {}),
  };
}

const runOAuthConnect: ConnectGmailFn = async (deps, write) => {
  const { clientId, clientSecret } = deps.appCredentials;
  const callbackServer = await startGmailOAuthCallbackServer();
  const flow = new GmailOAuthFlow({ clientId, redirectUri: callbackServer.redirectUri });

  write('Ouverture du navigateur système pour connecter un compte Gmail…');
  openSystemBrowser(flow.authorizationUrl);

  const callback = await callbackServer.result;
  const result = await flow.completeWithCallback(callback, { clientSecret });

  return connectGmailAccount({
    result,
    accountStore: deps.accountStore,
    secretStore: deps.secretStore,
  });
};

/** Ligne d'affichage d'un `ConnectGmailAccountOutcome` — jamais l'objet brut, jamais de secret. */
function describeConnectOutcome(outcome: ConnectGmailAccountOutcome): string {
  switch (outcome.status) {
    case 'connected':
      return `connecté — ${outcome.accountIdentifier} (accountId=${outcome.accountId})`;
    case 'cancelled':
      return 'annulé par l’utilisateur';
    case 'error':
      return `erreur — ${outcome.reason}`;
    case 'rejected':
      return `refusé — ${outcome.reason}`;
  }
}

/**
 * Ligne d'affichage d'un `RunGmailSendResult` — **jamais** `console.log(result)`
 * (défense en profondeur : le résultat ne doit être ni sérialisé tel quel, ni
 * exposer un `reason` non maîtrisé). Seul l'`id` Gmail public est affiché en
 * cas de succès.
 */
function describeSendResult(result: RunGmailSendResult): string {
  switch (result.status) {
    case 'executed': {
      const output = result.output as { readonly id?: unknown };
      const id = typeof output?.id === 'string' ? output.id : '?';
      return `Email envoyé (id Gmail : ${id}).`;
    }
    case 'confirmation_declined':
      return 'Envoi annulé : confirmation refusée.';
    case 'confirmation_required':
      return 'Envoi refusé : gmail.send exige une confirmation explicite (politique « allow » non acceptée).';
    case 'denied':
      return 'Envoi refusé par la politique de permissions.';
    case 'confirmation_failed':
      return 'Envoi échoué : confirmation invalide ou expirée.';
    case 'awaiting_confirmation':
      return 'Envoi interrompu : confirmation non traitée.';
    case 'error':
    case 'invalid_input':
    case 'unknown_tool':
      return `Envoi échoué (${result.status}).`;
    default: {
      const exhaustive: never = result;
      return `Envoi échoué (${(exhaustive as { readonly status: string }).status}).`;
    }
  }
}

/**
 * Flux `connect` — comportement M8-B2/B3 inchangé : détecte un compte déjà
 * exploitable, sinon lance le consentement OAuth.
 */
export async function runConnectFlow(
  deps: DesktopDeps,
  write: (line: string) => void = console.log,
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<void> {
  const existing = await resolveExistingGmailConnection({
    accountStore: deps.accountStore,
    secretStore: deps.secretStore,
    appCredentials: deps.appCredentials,
    ...(deps.accountId !== undefined ? { accountId: deps.accountId } : {}),
  });
  if (existing !== undefined) {
    write(
      `Compte Gmail déjà connecté : ${existing.accountIdentifier} (accountId=${existing.id}) — aucun nouveau consentement OAuth nécessaire.`,
    );
    return;
  }
  const outcome = await connect(deps, write);
  write(`Résultat de la connexion Gmail : ${describeConnectOutcome(outcome)}`);
}

/** Ligne d'affichage d'un `DisconnectGmailAccountOutcome` — jamais l'objet brut, jamais de secret. */
function describeDisconnectOutcome(outcome: DisconnectGmailAccountOutcome): string {
  return `déconnecté — ${outcome.accountIdentifier} (accountId=${outcome.accountId})`;
}

/**
 * Flux `disconnect` — déconnecte un compte Gmail existant.
 *
 * `resolveAccount()` reste l'unique point de sélection de compte (jamais de
 * sélection implicite) ; `disconnectGmailAccount()` reste seule responsable
 * du `SecretStore` (le CLI ne le manipule jamais directement). Contrairement
 * à `resolveOrConnectGmailAccount`, on n'exige pas que le compte soit
 * actuellement exploitable : un compte déjà `disconnected` ou en `error`
 * reste un compte connu qui doit pouvoir être déconnecté proprement
 * (`disconnectGmailAccount` est idempotente).
 *
 * `disconnectGmailAccount` n'est pas un `Tool` classé `execute` — elle
 * n'appelle jamais `PermissionManager`/`ToolExecutor` — aucune confirmation
 * interactive n'est donc nécessaire ici, contrairement à `send`.
 */
export async function runDisconnectFlow(
  deps: DesktopDeps,
  write: (line: string) => void = console.log,
): Promise<void> {
  const account = await resolveAccount(deps.accountStore, {
    provider: 'gmail',
    accountId: deps.accountId,
  });
  const outcome = await disconnectGmailAccount({
    accountId: account.id,
    accountStore: deps.accountStore,
    secretStore: deps.secretStore,
    confirmationService: new ConfirmationService(),
  });
  write(`Résultat de la déconnexion Gmail : ${describeDisconnectOutcome(outcome)}`);
}

/**
 * Renvoie un compte Gmail exploitable : celui déjà connecté (aucun nouvel
 * OAuth), ou celui obtenu via le consentement OAuth. `resolveAccount()` reste
 * l'unique point de sélection — `AmbiguousAccountError` (plusieurs comptes
 * sans `GMAIL_ACCOUNT_ID`) se propage telle quelle, jamais de « prendre le
 * premier ».
 */
export async function resolveOrConnectGmailAccount(
  deps: DesktopDeps,
  write: (line: string) => void,
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<Account> {
  const existing = await resolveExistingGmailConnection({
    accountStore: deps.accountStore,
    secretStore: deps.secretStore,
    appCredentials: deps.appCredentials,
    ...(deps.accountId !== undefined ? { accountId: deps.accountId } : {}),
  });
  if (existing !== undefined) {
    return existing;
  }
  const outcome = await connect(deps, write);
  if (outcome.status !== 'connected') {
    throw new Error(`Connexion Gmail non aboutie (${describeConnectOutcome(outcome)}).`);
  }
  return deps.accountStore.get(outcome.accountId);
}

/**
 * Lignes d'affichage d'un résultat `gmail.read` — jamais l'objet brut.
 *
 * Succès : une ligne par email (expéditeur + objet uniquement — jamais le
 * corps, ni `id`/`threadId`/métadonnées internes), aucune ligne fictive si
 * la boîte est vide. Échec : message générique groupant tous les statuts
 * non exécutés, jamais un `reason` non maîtrisé (même discipline que
 * {@link describeSendResult}).
 */
function describeReadResult(result: ToolExecutionResult): readonly string[] {
  if (result.status !== 'executed') {
    return [`Lecture échouée (${result.status}).`];
  }
  const output = result.output as { readonly messages?: readonly unknown[] };
  const messages = Array.isArray(output?.messages) ? output.messages : [];
  if (messages.length === 0) {
    return ['Aucun email trouvé.'];
  }
  return messages.map((message) => {
    const { sender, subject } = message as {
      readonly sender?: unknown;
      readonly subject?: unknown;
    };
    return `${typeof sender === 'string' ? sender : '?'} — ${typeof subject === 'string' ? subject : '?'}`;
  });
}

/**
 * Flux `read` — lit les emails Gmail récents via le Tool `gmail.read`
 * existant (`packages/connectors`, inchangé), en composant exactement les
 * mêmes briques que `send`/`disconnect` : `resolveOrConnectGmailAccount()`
 * → `resolveGmailApiClient()` → `gmailConnector.createTools()` →
 * `ToolRegistry`/`ToolExecutor`. `gmail.read` est classé `'read'` (jamais
 * `'execute'`) : aucune confirmation interactive n'est nécessaire, et la
 * politique par défaut l'autorise directement (contrairement à `send`, où
 * `require_confirmation` reste la politique par défaut).
 */
export async function runReadFlow(
  deps: DesktopDeps,
  input: GmailReadInput,
  write: (line: string) => void = console.log,
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<ToolExecutionResult> {
  const account = await resolveOrConnectGmailAccount(deps, write, connect);
  const client = await resolveGmailApiClient({
    account,
    secretStore: deps.secretStore,
    appCredentials: deps.appCredentials,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
  });

  const registry = new ToolRegistry();
  for (const tool of gmailConnector.createTools(client)) {
    registry.register(tool);
  }
  const permissionManager =
    deps.permissionManager ?? new PermissionManager({ rules: { 'gmail.read': 'allow' } });
  const executor = new ToolExecutor(registry, permissionManager);

  const result = await executor.run({ tool: 'gmail.read', input });
  for (const line of describeReadResult(result)) {
    write(line);
  }
  return result;
}

/**
 * Construit le moteur de classification de la sous-commande `inbox`.
 *
 * - Préférences : magasin **en mémoire**, toujours vide — cette commande
 *   n'introduit aucune persistance de préférences (une préférence ne peut
 *   exister ici que si un `classificationEngine` est injecté par un test).
 * - LLM : branché uniquement si `ANTHROPIC_API_KEY` est présente (ou si un
 *   provider est injecté). Sans clé, le moteur n'a pas de `llmClassifier` et
 *   retombe explicitement sur `uncertain` (`source: 'default'`). Si le LLM
 *   échoue à l'exécution, `LlmProviderEmailClassifier` renvoie `undefined` et
 *   `ClassificationEngine` applique le même repli contrôlé — jamais une
 *   erreur, jamais un message d'erreur LLM brut.
 */
export function buildInboxClassificationEngine(
  options: { readonly llmProvider?: LlmProvider } = {},
): ClassificationEngine {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const provider = options.llmProvider ?? (apiKey ? new AnthropicProvider() : undefined);
  return new ClassificationEngine({
    preferenceStore: new InMemoryPreferenceStore(),
    ...(provider !== undefined ? { llmClassifier: new LlmProviderEmailClassifier(provider) } : {}),
  });
}

/**
 * Flux `inbox` — lit puis classe les emails Gmail récents en composant
 * exactement les mêmes briques de confiance que `read` :
 * `resolveOrConnectGmailAccount()` → `resolveGmailApiClient()` →
 * `gmailConnector.createTools()` → `ToolRegistry`/`PermissionManager`/
 * `ToolExecutor`. La lecture passe par `fetchAndClassifyEmails`
 * (`@jarvis/inbox`, inchangé), qui invoque `gmail.read` **strictement** via
 * `ToolExecutor` puis applique `ClassificationEngine.classify` email par
 * email.
 *
 * `--maxResults` est transmis tel quel à `gmail.read` (jamais réécrit ici).
 * Une lecture non exécutée (erreur Gmail, refus…) est signalée par un statut
 * générique — jamais le `reason` d'origine (même discipline que
 * {@link describeReadResult}). Seuls expéditeur, objet, libellé, raison et
 * provenance sont affichés (voir {@link describeInboxResult}).
 */
export async function runInboxFlow(
  deps: DesktopDeps,
  input: GmailReadInput,
  write: (line: string) => void = console.log,
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<readonly ClassifiedEmail[]> {
  const account = await resolveOrConnectGmailAccount(deps, write, connect);
  const client = await resolveGmailApiClient({
    account,
    secretStore: deps.secretStore,
    appCredentials: deps.appCredentials,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
  });

  const registry = new ToolRegistry();
  for (const tool of gmailConnector.createTools(client)) {
    registry.register(tool);
  }
  const permissionManager =
    deps.permissionManager ?? new PermissionManager({ rules: { 'gmail.read': 'allow' } });
  const executor = new ToolExecutor(registry, permissionManager);

  const engine =
    deps.classificationEngine ??
    buildInboxClassificationEngine(
      deps.llmProvider !== undefined ? { llmProvider: deps.llmProvider } : {},
    );

  let classified: readonly ClassifiedEmail[];
  try {
    classified = await fetchAndClassifyEmails(executor, engine, {
      toolName: 'gmail.read',
      input,
    });
  } catch (err) {
    if (err instanceof EmailFetchBlockedError) {
      write(`Lecture échouée (${err.outcome.status}).`);
      return [];
    }
    throw err;
  }

  for (const line of describeInboxResult(classified)) {
    write(line);
  }
  return classified;
}

/**
 * Flux `send` — M8-B5. Câble `runGmailSend` (M8-B4, inchangé) : le compte est
 * résolu (ou connecté), puis l'envoi passe **obligatoirement** par
 * `proposeConfirmation → confirm() → confirmAndExecute`. Le `confirm` réel est
 * `createTerminalConfirm`. Renvoie le `RunGmailSendResult` pour les tests ;
 * n'affiche qu'une ligne humaine, jamais l'objet.
 */
export async function runSendFlow(
  deps: DesktopDeps,
  input: GmailSendInput,
  confirm: (request: ConfirmationRequest) => boolean | Promise<boolean>,
  write: (line: string) => void = console.log,
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<RunGmailSendResult> {
  const account = await resolveOrConnectGmailAccount(deps, write, connect);
  const result = await runGmailSend({
    accountStore: deps.accountStore,
    secretStore: deps.secretStore,
    appCredentials: deps.appCredentials,
    accountId: account.id,
    input,
    confirm,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.permissionManager !== undefined ? { permissionManager: deps.permissionManager } : {}),
  });
  write(describeSendResult(result));
  return result;
}

export interface DesktopIo {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/**
 * Parse les arguments de la sous-commande `read` :
 *
 *   read [--maxResults <n>]
 *
 * Fonction pure, même discipline que {@link parseGmailSendArgs}
 * (`gmail-send-args.ts`) : structure uniquement l'entrée, ne valide jamais
 * la plage de `maxResults` elle-même — cette validation de fond reste
 * entièrement faite par `gmail.read.validateInput` via `ToolExecutor`
 * (`packages/connectors`, inchangé). Absence de `--maxResults` ⇒ objet vide,
 * pour que le Tool applique son propre défaut, jamais réécrit ici.
 *
 * Partagée par `read` et `inbox` (contrat d'options identique) : `command`
 * ne sert qu'à préfixer les messages d'erreur.
 */
function parseGmailReadArgs(argv: readonly string[], command = 'read'): GmailReadInput {
  let raw: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith('--')) {
      throw new Error(
        `${command} : argument positionnel inattendu (seule l’option --maxResults est acceptée).`,
      );
    }

    const eq = token.indexOf('=');
    const name = eq !== -1 ? token.slice(2, eq) : token.slice(2);

    if (name !== 'maxResults') {
      throw new Error(`${command} : option inconnue « --${name} » (connue : --maxResults).`);
    }

    let value: string;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${command} : valeur manquante pour l’option --maxResults.`);
      }
      value = next;
      i += 1;
    }

    if (raw !== undefined) {
      throw new Error(`${command} : option --maxResults fournie plusieurs fois.`);
    }
    raw = value;
  }

  return raw === undefined ? {} : { maxResults: Number(raw) };
}

/** Dispatch de la ligne de commande : `connect` (défaut) | `send` | `disconnect` | `read`. */
export async function dispatch(
  argv: readonly string[],
  deps: DesktopDeps,
  io: DesktopIo = {},
  connect: ConnectGmailFn = runOAuthConnect,
): Promise<void> {
  const output = io.output ?? process.stdout;
  const write = (line: string): void => {
    output.write(`${line}\n`);
  };
  const command = argv[0];

  if (command === 'send') {
    const input = parseGmailSendArgs(argv.slice(1));
    const confirm = createTerminalConfirm({
      ...(io.input !== undefined ? { input: io.input } : {}),
      output,
    });
    await runSendFlow(deps, input, confirm, write, connect);
    return;
  }

  if (command === 'disconnect') {
    await runDisconnectFlow(deps, write);
    return;
  }

  if (command === 'read') {
    const input = parseGmailReadArgs(argv.slice(1));
    await runReadFlow(deps, input, write, connect);
    return;
  }

  if (command === 'inbox') {
    const input = parseGmailReadArgs(argv.slice(1), 'inbox');
    await runInboxFlow(deps, input, write, connect);
    return;
  }

  if (command === undefined || command === 'connect') {
    await runConnectFlow(deps, write, connect);
    return;
  }

  throw new Error('Commande inconnue (attendu : connect | send | disconnect | read | inbox).');
}

async function main(): Promise<void> {
  await dispatch(process.argv.slice(2), defaultDesktopDeps());
}

// Garde d'entrée : ce module est importé directement par ses tests (pour
// exercer `resolveExistingGmailConnection` sans navigateur ni OAuth réel) —
// `main()` ne doit donc s'exécuter que lorsque ce fichier est le point
// d'entrée réel du process (exécuté en CommonJS, comme le reste du
// monorepo — aucun package.json ne déclare `"type": "module"`), jamais au
// simple import.
if (require.main === module) {
  main().catch((err) => {
    console.error('Échec de la connexion Gmail :', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
