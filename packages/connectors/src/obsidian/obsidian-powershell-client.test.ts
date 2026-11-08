import type { ExecFileException } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { OBSIDIAN_READ_ERROR_MESSAGES } from './obsidian-errors.js';
import {
  createExecFileRunner,
  createPowerShellObsidianVaultClient,
  OBSIDIAN_MAX_OUTPUT_BYTES,
  OBSIDIAN_PROCESS_TIMEOUT_MS,
  type ExecFileLike,
  type ObsidianVaultConfig,
  type ProcessOutcome,
  type ProcessRunner,
} from './obsidian-powershell-client.js';

const CONFIG: ObsidianVaultConfig = {
  vaultId: "Vault — d’O'Brien",
  vaultRoot: "C:\\Users\\test\\Vaults\\Vault — d’O'Brien",
  launcherPath: 'C:\\Programs\\Obsidian\\Obsidian.com',
};
const NOTE = "Dossier/l’O'Neil $(Remove-Item x); `n.md";

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly script: string;
}

function decodeScript(args: readonly string[]): string {
  return Buffer.from(args[4] ?? '', 'base64').toString('utf16le');
}

/** Runner double : enregistre l'appel, renvoie une issue programmée. */
function fakeRunner(outcomes: readonly ProcessOutcome[]): ProcessRunner & { calls: Call[] } {
  const queue = [...outcomes];
  const calls: Call[] = [];
  const runner: ProcessRunner = async (file, args) => {
    calls.push({ file, args, script: decodeScript(args) });
    return queue.shift() ?? { kind: 'failed' };
  };
  return Object.assign(runner, { calls });
}

const exited = (exitCode: number, stdout = '', stderr = ''): ProcessOutcome => ({
  kind: 'exited',
  exitCode,
  stdout: Buffer.from(stdout, 'utf8'),
  stderr: Buffer.from(stderr, 'utf8'),
});

const b64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

describe('createPowerShellObsidianVaultClient — construction des scripts', () => {
  it('appelle powershell.exe sans shell, avec -EncodedCommand, et n’insère aucune valeur brute', async () => {
    const runner = fakeRunner([exited(0, '# x')]);
    await createPowerShellObsidianVaultClient(CONFIG, { runner }).readNote(NOTE);

    const [call] = runner.calls;
    expect(call?.file).toBe('powershell.exe');
    expect(call?.args.slice(0, 4)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-NoLogo',
      '-EncodedCommand',
    ]);
    const script = call?.script ?? '';
    for (const raw of [CONFIG.vaultId, CONFIG.launcherPath, NOTE, '$(Remove-Item', "O'Brien"]) {
      expect(script).not.toContain(raw);
    }
    expect(script).toContain(b64(CONFIG.launcherPath));
    expect(script).toContain(b64(CONFIG.vaultId));
    expect(script).toContain(b64(`path=${NOTE}`));
    expect(script).toContain(b64('read'));
  });

  it('vérifie Obsidian ouvert et le lanceur AVANT d’appeler le lanceur ; progression désactivée', async () => {
    const runner = fakeRunner([exited(0, 'C:\\x\n')]);
    await createPowerShellObsidianVaultClient(CONFIG, { runner }).vaultPath();
    const script = runner.calls[0]?.script ?? '';
    const progress = script.indexOf("$ProgressPreference = 'SilentlyContinue'");
    const running = script.indexOf("Get-Process -Name 'Obsidian'");
    const launcherCheck = script.indexOf('Test-Path -LiteralPath $jarvisLauncher');
    const launch = script.indexOf('& $jarvisLauncher');
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(running).toBeGreaterThan(progress);
    expect(launcherCheck).toBeGreaterThan(running);
    expect(launch).toBeGreaterThan(launcherCheck);
    expect(script).toContain(b64('vault'));
    expect(script).toContain(b64('info=path'));
  });

  it('inspection : parcours segment par segment, refus des points d’analyse, sans lancer Obsidian', async () => {
    const runner = fakeRunner([exited(0)]);
    await createPowerShellObsidianVaultClient(CONFIG, { runner }).inspectNote(NOTE);
    const script = runner.calls[0]?.script ?? '';
    expect(script).toContain('ReparsePoint');
    expect(script).toContain(b64(CONFIG.vaultRoot));
    expect(script).toContain(b64(NOTE));
    expect(script).not.toContain('jarvisLauncher');
    expect(script).not.toContain(NOTE);
  });

  it('transmet le délai et la borne de sortie au runner', async () => {
    let seen: unknown;
    const runner: ProcessRunner = async (_file, _args, limits) => {
      seen = limits;
      return exited(0, 'x');
    };
    await createPowerShellObsidianVaultClient(CONFIG, { runner }).readNote(NOTE);
    expect(seen).toEqual({
      timeoutMs: OBSIDIAN_PROCESS_TIMEOUT_MS,
      maxOutputBytes: OBSIDIAN_MAX_OUTPUT_BYTES,
    });
  });
});

describe('createPowerShellObsidianVaultClient — issues', () => {
  it('lecture réussie : stdout UTF-8 rendu tel quel, malgré un diagnostic de progression sur stderr', async () => {
    const progress = '#< CLIXML\n<Objs Version="1.1.0.1"><Obj S="progress"></Obj></Objs>';
    const runner = fakeRunner([exited(0, '# Note — é\n', progress)]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).readNote(NOTE),
    ).resolves.toBe('# Note — é\n');
  });

  it.each([
    [10, 'obsidian_not_running'],
    [11, 'launcher_not_found'],
    [20, 'process_failed'],
    [1, 'process_failed'],
  ] as const)('lecture, code %i → %s', async (code, error) => {
    const runner = fakeRunner([exited(code, 'sortie brute')]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).readNote(NOTE),
    ).rejects.toThrow(OBSIDIAN_READ_ERROR_MESSAGES[error]);
  });

  it('vault info=path : échec du lanceur → vault_check_failed', async () => {
    const runner = fakeRunner([exited(20)]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).vaultPath(),
    ).rejects.toThrow(OBSIDIAN_READ_ERROR_MESSAGES.vault_check_failed);
  });

  it.each([
    [0, 'file'],
    [13, 'absent'],
  ] as const)('inspection, code %i → %s', async (code, state) => {
    const runner = fakeRunner([exited(code)]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).inspectNote(NOTE),
    ).resolves.toBe(state);
  });

  it.each([
    [12, 'vault_root_unavailable'],
    [14, 'link_in_path'],
    [15, 'not_a_file'],
    [10, 'process_failed'],
  ] as const)('inspection, code %i → %s', async (code, error) => {
    const runner = fakeRunner([exited(code)]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).inspectNote(NOTE),
    ).rejects.toThrow(OBSIDIAN_READ_ERROR_MESSAGES[error]);
  });

  it.each([
    [{ kind: 'timeout' }, 'timeout'],
    [{ kind: 'output_too_large' }, 'output_too_large'],
    [{ kind: 'failed' }, 'process_failed'],
  ] as const)('runner %j → erreur %s', async (outcome, error) => {
    const runner = fakeRunner([outcome]);
    await expect(
      createPowerShellObsidianVaultClient(CONFIG, { runner }).readNote(NOTE),
    ).rejects.toThrow(OBSIDIAN_READ_ERROR_MESSAGES[error]);
  });
});

describe('createExecFileRunner', () => {
  const LIMITS = { timeoutMs: 1234, maxOutputBytes: 5678 };

  function execFileReturning(
    error: Partial<ExecFileException> | null,
    seen: { options?: unknown } = {},
  ): ExecFileLike {
    return (_file, _args, options, callback) => {
      seen.options = options;
      callback(
        error === null ? null : Object.assign(new Error('x'), error),
        Buffer.from('out'),
        Buffer.from('err'),
      );
    };
  }

  it('sans shell, sortie binaire, délai et borne transmis', async () => {
    const seen: { options?: unknown } = {};
    await createExecFileRunner(execFileReturning(null, seen))('powershell.exe', [], LIMITS);
    expect(seen.options).toEqual({
      encoding: 'buffer',
      timeout: 1234,
      maxBuffer: 5678,
      windowsHide: true,
      shell: false,
    });
  });

  it.each([
    ['succès', null, { kind: 'exited', exitCode: 0 }],
    ['code non nul', { code: 13 as unknown as string }, { kind: 'exited', exitCode: 13 }],
    ['délai dépassé', { killed: true, signal: 'SIGTERM' as NodeJS.Signals }, { kind: 'timeout' }],
    [
      'sortie trop grande',
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true },
      { kind: 'output_too_large' },
    ],
    ['exécutable absent', { code: 'ENOENT' }, { kind: 'failed' }],
  ])('%s', async (_label, error, expected) => {
    const outcome = await createExecFileRunner(execFileReturning(error))(
      'powershell.exe',
      [],
      LIMITS,
    );
    expect(outcome).toMatchObject(expected);
  });

  it('exception synchrone de execFile → failed', async () => {
    const throwing: ExecFileLike = () => {
      throw new Error('spawn impossible');
    };
    await expect(createExecFileRunner(throwing)('powershell.exe', [], LIMITS)).resolves.toEqual({
      kind: 'failed',
    });
  });
});
