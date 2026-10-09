import { spawn } from 'node:child_process';
import * as path from 'node:path';

export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export const NEVER_CANCELLED: CancellationSignal = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
};

export interface RunOptions {
  cwd?: string;
  /** Text written to the tool's standard input (UTF-8). */
  stdin?: string;
  timeoutMs: number;
  env?: Record<string, string>;
  token?: CancellationSignal;
  /** Maximum number of bytes accepted on stdout/stderr before the tool is stopped. */
  maxOutputBytes?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ToolErrorKind = 'not-found' | 'timeout' | 'cancelled' | 'too-much-output' | 'spawn-failed';

export class ToolRunError extends Error {
  constructor(
    readonly kind: ToolErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ToolRunError';
  }
}

const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;

/** On Windows, .cmd/.bat launchers cannot be started without a shell, so they are run via cmd.exe /c with quoting. */
function needsCmdWrapper(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function quoteForCmd(arg: string): string {
  // Arguments for cmd.exe: wrap in quotes, escape embedded quotes, and neutralise metacharacters.
  if (/[\r\n]/.test(arg)) {
    throw new ToolRunError('spawn-failed', 'Arguments containing line breaks cannot be passed to a .cmd launcher.');
  }
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`.replace(/[%!^&|<>()]/g, '^$&');
}

/**
 * Runs an executable with an argument array. A shell is never used for normal executables, so
 * arguments can never be interpreted as shell syntax. The process is killed on timeout or
 * cancellation, and all listeners are released when it ends.
 */
export function runTool(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    if (!command || command.includes('\0') || args.some((arg) => arg.includes('\0'))) {
      reject(new ToolRunError('spawn-failed', 'Invalid command or argument.'));
      return;
    }
    if (options.token?.isCancellationRequested) {
      reject(new ToolRunError('cancelled', 'Cancelled.'));
      return;
    }

    let file = command;
    let finalArgs = [...args];
    let windowsVerbatimArguments = false;
    try {
      if (needsCmdWrapper(command)) {
        file = process.env.ComSpec || 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', `"${[command, ...args].map(quoteForCmd).join(' ')}"`];
        windowsVerbatimArguments = true;
      }
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(file, finalArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    let failure: ToolRunError | undefined;

    const kill = (): void => {
      if (!child.killed) {
        child.kill();
        // Some tools ignore SIGTERM; make sure nothing is left running.
        const force = setTimeout(() => child.kill('SIGKILL'), 1500);
        force.unref();
      }
    };

    const timer = setTimeout(() => {
      failure = new ToolRunError('timeout', `Timed out after ${options.timeoutMs} ms.`);
      kill();
    }, options.timeoutMs);

    const subscription = options.token?.onCancellationRequested(() => {
      failure = new ToolRunError('cancelled', 'Cancelled.');
      kill();
    });

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      subscription?.dispose();
      action();
    };

    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxOutput) {
        failure = new ToolRunError('too-much-output', 'The formatter produced too much output.');
        kill();
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdoutChunks));
    child.stderr.on('data', collect(stderrChunks));

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === 'ENOENT'
            ? new ToolRunError('not-found', `Could not find "${path.basename(command)}".`)
            : new ToolRunError('spawn-failed', error.message),
        ),
      );
    });

    child.on('close', (code) => {
      finish(() => {
        if (failure) {
          reject(failure);
          return;
        }
        resolve({
          code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });
    });

    // A tool that exits before reading all of its input must not crash the extension host.
    child.stdin.on('error', () => undefined);
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin, 'utf8');
    } else {
      child.stdin.end();
    }
  });
}
