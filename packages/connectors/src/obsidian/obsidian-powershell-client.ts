import { execFile, type ExecFileException } from 'node:child_process';

import { ObsidianReadError } from './obsidian-errors.js';

/**
 * Client Obsidian via `powershell.exe` et le lanceur Windows `Obsidian.com`,
 * depuis WSL (ADR-0025, Proposed).
 *
 * - `execFile`, **jamais de shell** ; une seule forme d'appel :
 *   `powershell.exe -NoProfile -NonInteractive -NoLogo -EncodedCommand <b64>`.
 * - Aucune valeur (vault, chemin, lanceur, racine) n'est insérée telle quelle
 *   dans le script : chacune y figure encodée en base64 — alphabet sans
 *   guillemet ni caractère actif PowerShell — et n'est décodée qu'en
 *   variable, puis passée au lanceur comme argument distinct.
 * - Chaque script fixe `$ProgressPreference='SilentlyContinue'` ; stderr ne
 *   participe **jamais** à une décision (un diagnostic de progression
 *   PowerShell ne fait pas échouer une lecture réussie).
 * - Les décisions reposent uniquement sur des codes de sortie réservés,
 *   produits par nos scripts (le code du lanceur lui-même n'est jamais
 *   transmis tel quel).
 */

/** Configuration d'un vault unique. Chemins Windows absolus. */
export interface ObsidianVaultConfig {
  /** Nom ou identifiant passé au lanceur avec `vault=`. */
  readonly vaultId: string;
  /** Racine Windows du vault, ex. `C:\…\Mon vault`. */
  readonly vaultRoot: string;
  /** Chemin Windows complet de `Obsidian.com`. */
  readonly launcherPath: string;
  /** Exécutable PowerShell côté WSL. Défaut : `powershell.exe` (résolu via le PATH). */
  readonly powershellPath?: string;
}

/** État d'une note sous la racine, sans lecture de son contenu. */
export type ObsidianNoteInspection = 'file' | 'absent';

/**
 * Port consommé par le connecteur `obsidian`. Lève uniquement des
 * {@link ObsidianReadError}.
 */
export interface ObsidianVaultClient {
  readonly vaultId: string;
  readonly vaultRoot: string;
  /** Sortie brute de `vault=<id> vault info=path` (Obsidian ouvert vérifié avant l'appel). */
  vaultPath(): Promise<string>;
  /** Inspecte `<racine>/<relativePath>` segment par segment ; refuse liens et jonctions. */
  inspectNote(relativePath: string): Promise<ObsidianNoteInspection>;
  /** Sortie brute de `vault=<id> read path=<relativePath>` (Obsidian ouvert vérifié avant l'appel). */
  readNote(relativePath: string): Promise<string>;
  /**
   * Sortie brute de `vault=<id> search query=<query> limit=5 format=json`
   * (Obsidian ouvert vérifié avant l'appel). N'ouvre aucune note.
   */
  searchNotes(query: string): Promise<string>;
}

/** Issue d'un processus, sans jamais lever. */
export type ProcessOutcome =
  | {
      readonly kind: 'exited';
      readonly exitCode: number;
      readonly stdout: Buffer;
      readonly stderr: Buffer;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'output_too_large' }
  | { readonly kind: 'failed' };

export interface ProcessLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type ProcessRunner = (
  file: string,
  args: readonly string[],
  limits: ProcessLimits,
) => Promise<ProcessOutcome>;

/** Sous-ensemble de `execFile` utilisé — injectable pour les tests. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: {
    readonly encoding: 'buffer';
    readonly timeout: number;
    readonly maxBuffer: number;
    readonly windowsHide: true;
    readonly shell: false;
  },
  callback: (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => void,
) => unknown;

const defaultExecFile: ExecFileLike = (file, args, options, callback) =>
  execFile(file, [...args], { ...options }, callback);

export const OBSIDIAN_PROCESS_TIMEOUT_MS = 10_000;
export const OBSIDIAN_MAX_OUTPUT_BYTES = 1024 * 1024;
/** Nombre maximal de chemins demandés à `search` — fixé ici, jamais fourni par l'appelant. */
export const OBSIDIAN_SEARCH_LIMIT = 5;

/** Runner de production : `execFile` sans shell, délai et sortie bornés. */
export function createExecFileRunner(execFileFn: ExecFileLike = defaultExecFile): ProcessRunner {
  return (file, args, limits) =>
    new Promise<ProcessOutcome>((resolve) => {
      try {
        execFileFn(
          file,
          args,
          {
            encoding: 'buffer',
            timeout: limits.timeoutMs,
            maxBuffer: limits.maxOutputBytes,
            windowsHide: true,
            shell: false,
          },
          (error, stdout, stderr) => {
            resolve(classifyExecResult(error, stdout, stderr));
          },
        );
      } catch {
        resolve({ kind: 'failed' });
      }
    });
}

function classifyExecResult(
  error: ExecFileException | null,
  stdout: Buffer,
  stderr: Buffer,
): ProcessOutcome {
  if (error === null) {
    return { kind: 'exited', exitCode: 0, stdout, stderr };
  }
  if ((error.code as unknown) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { kind: 'output_too_large' };
  }
  if (error.killed === true) {
    return { kind: 'timeout' };
  }
  if (typeof error.code === 'number') {
    return { kind: 'exited', exitCode: error.code, stdout, stderr };
  }
  return { kind: 'failed' };
}

/** Codes de sortie réservés à nos scripts. */
const EXIT = {
  ok: 0,
  obsidianNotRunning: 10,
  launcherNotFound: 11,
  vaultRootUnavailable: 12,
  absent: 13,
  linkInPath: 14,
  notAFile: 15,
  launcherFailed: 20,
} as const;

/** Littéral PowerShell sûr : base64 de l'UTF-8, décodé dans le script. */
function encodedArg(value: string): string {
  return `(Get-JarvisArg '${Buffer.from(value, 'utf8').toString('base64')}')`;
}

const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'function Get-JarvisArg([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }',
];

const OBSIDIAN_RUNNING_CHECK = [
  '$jarvisSession = (Get-Process -Id $PID).SessionId',
  "$jarvisObsidian = @(Get-Process -Name 'Obsidian' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $jarvisSession })",
  `if ($jarvisObsidian.Count -eq 0) { exit ${EXIT.obsidianNotRunning} }`,
];

/** Script qui vérifie Obsidian ouvert et le lanceur, puis appelle `vault=<id> <commandArgs…>`. */
export function buildLauncherScript(
  config: ObsidianVaultConfig,
  commandArgs: readonly string[],
): string {
  const args = commandArgs.map(encodedArg).join(' ');
  return [
    ...PRELUDE,
    ...OBSIDIAN_RUNNING_CHECK,
    `$jarvisLauncher = ${encodedArg(config.launcherPath)}`,
    `if (-not (Test-Path -LiteralPath $jarvisLauncher -PathType Leaf)) { exit ${EXIT.launcherNotFound} }`,
    `& $jarvisLauncher ('vault=' + ${encodedArg(config.vaultId)}) ${args}`,
    `if ($LASTEXITCODE -eq 0) { exit ${EXIT.ok} } else { exit ${EXIT.launcherFailed} }`,
  ].join('\n');
}

/**
 * Script d'inspection, sans lecture de contenu : parcourt la racine segment
 * par segment et refuse tout point d'analyse (lien symbolique, jonction)
 * rencontré sous la racine — aucune résolution de lien n'est donc
 * nécessaire pour garantir que le fichier reste dans la racine.
 */
export function buildInspectScript(config: ObsidianVaultConfig, relativePath: string): string {
  return [
    ...PRELUDE,
    `$jarvisRoot = ${encodedArg(config.vaultRoot)}`,
    `$jarvisRel = ${encodedArg(relativePath)}`,
    `if (-not (Test-Path -LiteralPath $jarvisRoot -PathType Container)) { exit ${EXIT.vaultRootUnavailable} }`,
    '$jarvisCurrent = $jarvisRoot',
    "$jarvisSegments = $jarvisRel.Split('/')",
    'for ($i = 0; $i -lt $jarvisSegments.Length; $i++) {',
    '  $jarvisCurrent = [IO.Path]::Combine($jarvisCurrent, $jarvisSegments[$i])',
    `  if (-not (Test-Path -LiteralPath $jarvisCurrent)) { exit ${EXIT.absent} }`,
    '  $jarvisItem = Get-Item -LiteralPath $jarvisCurrent -Force',
    `  if (($jarvisItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit ${EXIT.linkInPath} }`,
    '  $jarvisIsLast = ($i -eq $jarvisSegments.Length - 1)',
    `  if ($jarvisIsLast -and $jarvisItem.PSIsContainer) { exit ${EXIT.notAFile} }`,
    `  if ((-not $jarvisIsLast) -and (-not $jarvisItem.PSIsContainer)) { exit ${EXIT.absent} }`,
    '}',
    `exit ${EXIT.ok}`,
  ].join('\n');
}

/** Arguments `powershell.exe` pour un script donné. */
export function powershellArgs(script: string): readonly string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-NoLogo',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export interface PowerShellObsidianClientOptions {
  readonly runner?: ProcessRunner;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

const UTF8 = new TextDecoder('utf-8');

/** Client de production, lié à un seul vault configuré. */
export function createPowerShellObsidianVaultClient(
  config: ObsidianVaultConfig,
  options: PowerShellObsidianClientOptions = {},
): ObsidianVaultClient {
  const runner = options.runner ?? createExecFileRunner();
  const limits: ProcessLimits = {
    timeoutMs: options.timeoutMs ?? OBSIDIAN_PROCESS_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? OBSIDIAN_MAX_OUTPUT_BYTES,
  };
  const powershell = config.powershellPath ?? 'powershell.exe';

  async function run(
    script: string,
  ): Promise<{ readonly exitCode: number; readonly stdout: Buffer }> {
    const outcome = await runner(powershell, powershellArgs(script), limits);
    switch (outcome.kind) {
      case 'exited':
        return { exitCode: outcome.exitCode, stdout: outcome.stdout };
      case 'timeout':
        throw new ObsidianReadError('timeout');
      case 'output_too_large':
        throw new ObsidianReadError('output_too_large');
      case 'failed':
        throw new ObsidianReadError('process_failed');
    }
  }

  async function runLauncher(
    commandArgs: readonly string[],
    launcherFailure: 'vault_check_failed' | 'process_failed',
  ): Promise<string> {
    const { exitCode, stdout } = await run(buildLauncherScript(config, commandArgs));
    switch (exitCode) {
      case EXIT.ok:
        return UTF8.decode(stdout);
      case EXIT.obsidianNotRunning:
        throw new ObsidianReadError('obsidian_not_running');
      case EXIT.launcherNotFound:
        throw new ObsidianReadError('launcher_not_found');
      case EXIT.launcherFailed:
        throw new ObsidianReadError(launcherFailure);
      default:
        throw new ObsidianReadError('process_failed');
    }
  }

  return {
    vaultId: config.vaultId,
    vaultRoot: config.vaultRoot,
    vaultPath: () => runLauncher(['vault', 'info=path'], 'vault_check_failed'),
    readNote: (relativePath) => runLauncher(['read', `path=${relativePath}`], 'process_failed'),
    searchNotes: (query) =>
      runLauncher(
        ['search', `query=${query}`, `limit=${OBSIDIAN_SEARCH_LIMIT}`, 'format=json'],
        'process_failed',
      ),
    async inspectNote(relativePath) {
      const { exitCode } = await run(buildInspectScript(config, relativePath));
      switch (exitCode) {
        case EXIT.ok:
          return 'file';
        case EXIT.absent:
          return 'absent';
        case EXIT.vaultRootUnavailable:
          throw new ObsidianReadError('vault_root_unavailable');
        case EXIT.linkInPath:
          throw new ObsidianReadError('link_in_path');
        case EXIT.notAFile:
          throw new ObsidianReadError('not_a_file');
        default:
          throw new ObsidianReadError('process_failed');
      }
    },
  };
}
