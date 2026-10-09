import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type AdapterEnvironment,
  type FormatRequest,
  type FormatterAdapter,
  FormatterError,
  NO_PROJECT_CONFIG,
  type ProjectConfigInfo,
  StyleReader,
} from '../core/adapter';
import { expandHome, findFileUpwards, findOnPath, findUpwards, parseVersion, resolveConfiguredPath } from '../core/executables';
import { type CancellationSignal, type RunResult, runTool, ToolRunError } from '../core/process';
import type { FormatterDescriptor, FormatterStatus } from '../shared/types';

/** One process invocation of a formatting pipeline. */
export interface Invocation {
  /** Arguments placed before `args` (used when the executable is a launcher such as `dotnet`). */
  args: string[];
  /**
   * `stdin`: the source is piped in and the result read from stdout.
   * `file`: the source is written to a private temporary file which the tool rewrites in place.
   * `file-stdout`: the source is written to a temporary file and the result read from stdout.
   */
  mode: 'stdin' | 'file' | 'file-stdout';
  /** Exit codes that mean success. Defaults to [0]. */
  okCodes?: number[];
  env?: Record<string, string>;
  /** Run in the private temporary directory instead of the file's own directory. */
  cwdIsTemp?: boolean;
  /** Post-processes stdout (e.g. to strip a banner). */
  extract?(stdout: string): string;
}

export interface BuildContext {
  request: FormatRequest;
  style: StyleReader;
  /** Detected tool version, when known. */
  version?: string;
  /** True when CodeNeat should pass its style preferences as flags. */
  applyStyle: boolean;
  /** Path of the temporary copy of the source (created on first use). */
  inputFile(): Promise<string>;
  /** Writes an auxiliary file (e.g. a generated config) into the private temporary directory. */
  writeTemp(name: string, content: string): Promise<string>;
  /** Byte offsets (UTF-8) for the requested range, when there is one. */
  byteRange?: { start: number; end: number };
  /** 1-based inclusive line range for the requested range, when there is one. */
  lineRange?: { start: number; end: number };
}

export interface ExternalSpec {
  descriptor: FormatterDescriptor;
  versionArgs: string[];
  /** Pattern that the version output must match for the tool to count as present. */
  versionCheck?: RegExp;
  /** Project-local locations (relative to a project directory) tried in trusted workspaces. */
  localBin?: string[];
  /** Arguments placed before every formatting invocation's own args (e.g. `["format"]` for `dart format`). */
  prefixArgs?: string[];
  /** When true the tool counts as present even if its version command fails (older releases without --version). */
  versionOptional?: boolean;
  /** Last-resort lookup when the tool is not on PATH (e.g. asking xcrun on macOS). */
  locateFallback?(): Promise<string | undefined>;
  /** Custom presence probe for tools that are modules of another runtime (PowerShell, R). */
  probe?(exe: string, env: AdapterEnvironment): Promise<{ version?: string; problem?: string }>;
  build(context: BuildContext): Invocation[] | Promise<Invocation[]>;
  /** Decides whether a candidate project configuration file really configures this tool. */
  configMatches?(fileName: string, content: string): boolean;
  /** Turns a failed run into a short readable message. */
  explainFailure?(result: RunResult): string | undefined;
}

interface Detection {
  status: FormatterStatus;
  exe?: string;
}

const DETECT_TIMEOUT_MS = 8000;

function firstLines(text: string, count = 6): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, count)
    .join('\n');
}

function toByteOffset(text: string, utf16Offset: number): number {
  return Buffer.byteLength(text.slice(0, utf16Offset), 'utf8');
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
    }
  }
  return line;
}

/** Generic adapter for formatters that are separate executables. */
export class ExternalAdapter implements FormatterAdapter {
  readonly descriptor: FormatterDescriptor;
  private readonly cache = new Map<string, Promise<Detection>>();

  constructor(private readonly spec: ExternalSpec) {
    this.descriptor = spec.descriptor;
  }

  reset(): void {
    this.cache.clear();
  }

  async detect(env: AdapterEnvironment, nearDir?: string): Promise<FormatterStatus> {
    return (await this.locate(env, nearDir)).status;
  }

  private locate(env: AdapterEnvironment, nearDir?: string): Promise<Detection> {
    const localKey = env.trusted && this.spec.localBin?.length ? (nearDir ?? '') : '';
    const key = `${env.trusted}|${env.toolPaths[this.descriptor.id] ?? ''}|${localKey}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.locateUncached(env, nearDir);
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async locateUncached(env: AdapterEnvironment, nearDir?: string): Promise<Detection> {
    const id = this.descriptor.id;
    if (!env.trusted) {
      return {
        status: {
          id,
          available: false,
          problem: 'External formatters are switched off in Restricted Mode. Trust this workspace to use them.',
        },
      };
    }

    let exe: string | undefined;
    let origin: FormatterStatus['origin'];
    const configured = env.toolPaths[id];
    if (configured) {
      const resolved = await resolveConfiguredPath(configured);
      if (!resolved.path) {
        return { status: { id, available: false, problem: resolved.problem } };
      }
      exe = resolved.path;
      origin = 'setting';
    }

    if (!exe && this.spec.localBin?.length) {
      const starts = nearDir ? [nearDir] : env.workspaceRoots;
      for (const start of starts) {
        const stop = env.workspaceRoots.find((root) => isInside(root, start));
        // Without a containing workspace folder only the directory itself is inspected.
        const found = await findUpwards(start, this.spec.localBin, stop ?? start);
        if (found) {
          exe = found;
          origin = 'project';
          break;
        }
      }
    }

    if (!exe) {
      for (const name of this.descriptor.executables) {
        // A custom formatter may name its executable by absolute path instead of relying on PATH.
        const expanded = expandHome(name);
        exe = path.isAbsolute(expanded) ? (await resolveConfiguredPath(expanded)).path : await findOnPath(name);
        if (exe) {
          origin = path.isAbsolute(expanded) ? 'setting' : 'path';
          break;
        }
      }
    }

    if (!exe && this.spec.locateFallback) {
      exe = await this.spec.locateFallback().catch(() => undefined);
      origin = exe ? 'path' : undefined;
    }

    if (!exe) {
      return {
        status: { id, available: false, problem: `${this.descriptor.displayName} was not found. ${this.descriptor.install.summary}` },
      };
    }

    try {
      if (this.spec.probe) {
        const probed = await this.spec.probe(exe, env);
        if (probed.problem) {
          return { status: { id, available: false, path: exe, origin, problem: probed.problem } };
        }
        return { status: { id, available: true, path: exe, origin, version: probed.version }, exe };
      }
      const result = await runTool(exe, this.spec.versionArgs, {
        timeoutMs: DETECT_TIMEOUT_MS,
        cwd: os.tmpdir(),
      });
      const output = `${result.stdout}\n${result.stderr}`;
      if (this.spec.versionCheck && !this.spec.versionCheck.test(output)) {
        return {
          status: {
            id,
            available: false,
            path: exe,
            origin,
            problem: `Found "${exe}" but it did not identify itself as ${this.descriptor.displayName}. ${firstLines(output, 2)}`,
          },
        };
      }
      if (result.code !== 0 && !parseVersion(output) && !this.spec.versionOptional) {
        return {
          status: {
            id,
            available: false,
            path: exe,
            origin,
            problem: `"${exe}" could not be started: ${firstLines(output, 2) || `exit code ${result.code}`}`,
          },
        };
      }
      return { status: { id, available: true, path: exe, origin, version: parseVersion(output) }, exe };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: { id, available: false, path: exe, origin, problem: `"${exe}" could not be started: ${message}` } };
    }
  }

  async readProjectConfig(
    filePath: string,
    workspaceRoot: string | undefined,
    env: AdapterEnvironment,
  ): Promise<ProjectConfigInfo> {
    if (!env.trusted || this.descriptor.configFiles.length === 0) {
      return NO_PROJECT_CONFIG;
    }
    let directory = path.dirname(filePath);
    const stop = workspaceRoot && isInside(workspaceRoot, directory) ? workspaceRoot : undefined;
    for (let attempts = 0; attempts < 40; attempts++) {
      const found = await findFileUpwards(directory, this.descriptor.configFiles, stop);
      if (!found) {
        return NO_PROJECT_CONFIG;
      }
      if (!this.spec.configMatches) {
        return { style: {}, file: found, takesOver: true };
      }
      try {
        const content = await fs.promises.readFile(found, 'utf8');
        if (this.spec.configMatches(path.basename(found), content)) {
          return { style: {}, file: found, takesOver: true };
        }
      } catch {
        // unreadable file: ignore it and keep looking further up
      }
      const parent = path.dirname(path.dirname(found));
      if (parent === path.dirname(found) || (stop && path.dirname(found) === path.resolve(stop))) {
        return NO_PROJECT_CONFIG;
      }
      directory = parent;
    }
    return NO_PROJECT_CONFIG;
  }

  async format(request: FormatRequest, env: AdapterEnvironment, token: CancellationSignal): Promise<string> {
    const nearDir = request.filePath ? path.dirname(request.filePath) : request.workspaceRoot;
    const located = await this.locate(env, nearDir);
    if (!located.exe) {
      const error = new FormatterError(
        env.trusted ? 'missing' : 'untrusted',
        located.status.problem ?? `${this.descriptor.displayName} is not installed.`,
      );
      error.install = this.descriptor.install;
      throw error;
    }
    if (request.range && !this.descriptor.rangeLanguages.includes(request.languageId)) {
      throw new FormatterError('unsupported', `${this.descriptor.displayName} cannot format only a selection.`);
    }

    let tempDir: string | undefined;
    let inputPath: string | undefined;
    const ensureTemp = async (): Promise<string> => {
      if (!tempDir) {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codeneat-'));
        if (process.platform !== 'win32') {
          await fs.promises.chmod(tempDir, 0o700);
        }
      }
      return tempDir;
    };
    const safeName = path.basename(request.fileName).replace(/[^A-Za-z0-9._-]/g, '_') || 'source.txt';

    let current = request.text;
    const context: BuildContext = {
      request,
      style: StyleReader.of(request),
      version: located.status.version,
      applyStyle: !request.projectConfigTakesOver,
      inputFile: async () => {
        if (!inputPath) {
          // The copy lives in its own sub-directory so generated config files cannot collide with it.
          const sourceDir = path.join(await ensureTemp(), 'src');
          await fs.promises.mkdir(sourceDir, { recursive: true });
          inputPath = path.join(sourceDir, safeName);
        }
        return inputPath;
      },
      writeTemp: async (name, content) => {
        const target = path.join(await ensureTemp(), path.basename(name));
        await fs.promises.writeFile(target, content, 'utf8');
        return target;
      },
    };
    if (request.range) {
      context.byteRange = {
        start: toByteOffset(request.text, request.range.start),
        end: toByteOffset(request.text, request.range.end),
      };
      const endOffset = Math.max(request.range.start, request.range.end - 1);
      context.lineRange = {
        start: lineOfOffset(request.text, request.range.start),
        end: lineOfOffset(request.text, endOffset),
      };
    }

    try {
      const invocations = await this.spec.build(context);
      const fileDir = request.filePath ? path.dirname(request.filePath) : undefined;
      const defaultCwd = (fileDir && (await directoryExists(fileDir)) ? fileDir : undefined) ?? request.workspaceRoot ?? (await ensureTemp());

      for (const invocation of invocations) {
        if (token.isCancellationRequested) {
          throw new FormatterError('cancelled', 'Formatting was cancelled.');
        }
        const usesFile = invocation.mode !== 'stdin';
        if (usesFile) {
          await fs.promises.writeFile(await context.inputFile(), current, 'utf8');
        }
        const args = [...(this.spec.prefixArgs ?? []), ...invocation.args];
        env.log(`${this.descriptor.id}: ${path.basename(located.exe)} ${args.join(' ')}`);
        let result: RunResult;
        try {
          result = await runTool(located.exe, args, {
            cwd: invocation.cwdIsTemp ? await ensureTemp() : defaultCwd,
            stdin: invocation.mode === 'stdin' ? current : undefined,
            timeoutMs: request.timeoutMs,
            env: invocation.env,
            token,
          });
        } catch (error) {
          throw this.translateRunError(error, request.timeoutMs);
        }
        const okCodes = invocation.okCodes ?? [0];
        if (result.code === null || !okCodes.includes(result.code)) {
          const explained = this.spec.explainFailure?.(result);
          const summary = explained ?? firstLines(result.stderr || result.stdout) ?? '';
          throw new FormatterError(
            'failed',
            `${this.descriptor.displayName} could not format this file${summary ? `:\n${summary}` : ` (exit code ${result.code}).`}`,
            `${result.stderr}\n${result.stdout}`.trim(),
          );
        }
        let output: string;
        if (invocation.mode === 'file') {
          output = await fs.promises.readFile(await context.inputFile(), 'utf8');
        } else {
          output = invocation.extract ? invocation.extract(result.stdout) : result.stdout;
        }
        if (output.length === 0 && current.trim().length > 0) {
          throw new FormatterError(
            'failed',
            `${this.descriptor.displayName} returned no output, so the file was left unchanged.`,
            result.stderr,
          );
        }
        current = output;
      }
      return current;
    } finally {
      if (tempDir) {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private translateRunError(error: unknown, timeoutMs: number): FormatterError {
    if (error instanceof FormatterError) {
      return error;
    }
    if (error instanceof ToolRunError) {
      switch (error.kind) {
        case 'cancelled':
          return new FormatterError('cancelled', 'Formatting was cancelled.');
        case 'timeout':
          return new FormatterError(
            'timeout',
            `${this.descriptor.displayName} did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped. You can raise the limit under Advanced.`,
          );
        case 'not-found': {
          this.reset();
          const missing = new FormatterError('missing', `${this.descriptor.displayName} is no longer available. ${this.descriptor.install.summary}`);
          missing.install = this.descriptor.install;
          return missing;
        }
        default:
          return new FormatterError('failed', `${this.descriptor.displayName} could not be run: ${error.message}`);
      }
    }
    return new FormatterError('failed', error instanceof Error ? error.message : String(error));
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
