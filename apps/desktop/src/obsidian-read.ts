import {
  createPowerShellObsidianVaultClient,
  OBSIDIAN_READ_ERROR_MESSAGES,
  obsidianConnector,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type ObsidianReadInput,
  type ObsidianVaultClient,
  type ObsidianVaultConfig,
  type ToolExecutionResult,
} from '@jarvis/connectors';

/**
 * Sous-commande `obsidian-read` (ADR-0025, Proposed) :
 *
 *   obsidian-read --vault <identifiant> --path <chemin/relatif.md>
 *
 * Même composition que `read` (`gmail.read`) : `obsidianConnector.createTools()`
 * → `ToolRegistry` → `PermissionManager` → `ToolExecutor`. Aucune dépendance
 * Gmail. La validation de fond (vault configuré, chemin) reste celle de
 * `obsidian.read.validateInput`, jamais refaite ici.
 */

/**
 * Découpe des options nommées obligatoires (`--nom valeur` ou `--nom=valeur`),
 * chacune exactement une fois ; ne valide pas le fond. Partagé par
 * `obsidian-read` et `obsidian-search`. Les messages ne citent que des noms
 * d'options, jamais une valeur fournie.
 */
export function parseObsidianOptions<K extends string>(
  command: string,
  flags: readonly K[],
  argv: readonly string[],
): Record<K, string> {
  const listed = flags.map((flag) => `--${flag}`);
  const isKnownFlag = (name: string): name is K => (flags as readonly string[]).includes(name);
  const values: Partial<Record<K, string>> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new Error(
        `${command} : argument positionnel inattendu (attendu : ${listed.join(', ')}).`,
      );
    }
    const eq = token.indexOf('=');
    const name = eq !== -1 ? token.slice(2, eq) : token.slice(2);
    if (!isKnownFlag(name)) {
      throw new Error(`${command} : option inconnue (connues : ${listed.join(', ')}).`);
    }
    let value: string;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${command} : valeur manquante pour l’option --${name}.`);
      }
      value = next;
      i += 1;
    }
    if (values[name] !== undefined) {
      throw new Error(`${command} : option --${name} fournie plusieurs fois.`);
    }
    values[name] = value;
  }
  if (flags.some((flag) => values[flag] === undefined)) {
    throw new Error(`${command} : ${listed.join(' et ')} sont obligatoires.`);
  }
  return values as Record<K, string>;
}

export function parseObsidianReadArgs(argv: readonly string[]): ObsidianReadInput {
  const { vault, path } = parseObsidianOptions('obsidian-read', ['vault', 'path'], argv);
  return { vault, path };
}

export const OBSIDIAN_ENV = {
  vaultId: 'OBSIDIAN_VAULT_ID',
  vaultRoot: 'OBSIDIAN_VAULT_ROOT',
  launcherPath: 'OBSIDIAN_CLI_PATH',
  powershellPath: 'OBSIDIAN_POWERSHELL_PATH',
} as const;

const ABSOLUTE_WINDOWS_PATH = /^[A-Za-z]:\\/;
// eslint-disable-next-line no-control-regex -- refus explicite des caractères de contrôle
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '' || CONTROL_CHARS.test(value)) {
    throw new Error(`obsidian-read : variable ${name} absente ou invalide.`);
  }
  return value;
}

/** Configuration du vault unique, lue dans l'environnement. Ne lance aucun processus. */
export function loadObsidianVaultConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObsidianVaultConfig {
  const vaultId = requireEnv(env, OBSIDIAN_ENV.vaultId);
  const vaultRoot = requireEnv(env, OBSIDIAN_ENV.vaultRoot);
  const launcherPath = requireEnv(env, OBSIDIAN_ENV.launcherPath);
  if (/["\\]/.test(vaultId)) {
    throw new Error(`obsidian-read : variable ${OBSIDIAN_ENV.vaultId} absente ou invalide.`);
  }
  if (!ABSOLUTE_WINDOWS_PATH.test(vaultRoot)) {
    throw new Error(
      `obsidian-read : ${OBSIDIAN_ENV.vaultRoot} doit être un chemin Windows absolu (ex. C:\\…).`,
    );
  }
  if (!ABSOLUTE_WINDOWS_PATH.test(launcherPath) || !/\.(com|exe)$/i.test(launcherPath)) {
    throw new Error(
      `obsidian-read : ${OBSIDIAN_ENV.launcherPath} doit être le chemin Windows absolu du lanceur.`,
    );
  }
  const powershellPath = env[OBSIDIAN_ENV.powershellPath];
  return {
    vaultId,
    vaultRoot,
    launcherPath,
    ...(powershellPath !== undefined && powershellPath !== '' ? { powershellPath } : {}),
  };
}

export interface ObsidianReadDeps {
  readonly client: ObsidianVaultClient;
  /** Injecté par les tests uniquement. Absent ⇒ `obsidian.read` explicitement autorisé. */
  readonly permissionManager?: PermissionManager;
}

/** Dépendances de production — construites seulement dans la branche `obsidian-read`. */
export function defaultObsidianReadDeps(): ObsidianReadDeps {
  return { client: createPowerShellObsidianVaultClient(loadObsidianVaultConfigFromEnv()) };
}

export async function runObsidianReadFlow(
  input: ObsidianReadInput,
  deps: ObsidianReadDeps,
): Promise<ToolExecutionResult> {
  const registry = new ToolRegistry();
  for (const tool of obsidianConnector.createTools(deps.client)) {
    registry.register(tool);
  }
  const permissionManager =
    deps.permissionManager ?? new PermissionManager({ rules: { 'obsidian.read': 'allow' } });
  const executor = new ToolExecutor(registry, permissionManager);
  return executor.run({ tool: 'obsidian.read', input });
}

const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(OBSIDIAN_READ_ERROR_MESSAGES),
);

/**
 * Texte exact reçu du connecteur pour une note lue — à écrire tel quel sur
 * stdout, sans ajout ni retrait de saut de ligne. `undefined` si aucune note
 * n'a été lue (voir alors {@link describeObsidianReadResult}).
 */
export function obsidianReadContent(result: ToolExecutionResult): string | undefined {
  if (result.status !== 'executed') {
    return undefined;
  }
  const output = result.output as { readonly status?: unknown; readonly content?: unknown };
  return output?.status === 'found' && typeof output.content === 'string'
    ? output.content
    : undefined;
}

/**
 * Lignes de message lorsqu'aucune note n'a été lue (messages maîtrisés).
 * Vide si une note a été lue : son contenu passe par {@link obsidianReadContent}.
 */
export function describeObsidianReadResult(result: ToolExecutionResult): readonly string[] {
  if (obsidianReadContent(result) !== undefined) {
    return [];
  }
  switch (result.status) {
    case 'executed': {
      const output = result.output as { readonly status?: unknown };
      if (output?.status === 'not_found') {
        return ['Note introuvable dans le vault configuré.'];
      }
      return ['Lecture Obsidian échouée (résultat inattendu).'];
    }
    case 'invalid_input':
      return [`Lecture Obsidian refusée : ${result.reason}`];
    case 'denied':
      return ['Lecture Obsidian refusée par la politique de permissions.'];
    case 'error':
      return [
        KNOWN_ERROR_MESSAGES.has(result.reason)
          ? `Lecture Obsidian échouée : ${result.reason}`
          : 'Lecture Obsidian échouée.',
      ];
    default:
      return [`Lecture Obsidian échouée (${result.status}).`];
  }
}

/** `0` seulement si la note a été lue. */
export function obsidianReadExitCode(result: ToolExecutionResult): number {
  if (result.status !== 'executed') {
    return 1;
  }
  const output = result.output as { readonly status?: unknown };
  return output?.status === 'found' ? 0 : 1;
}
