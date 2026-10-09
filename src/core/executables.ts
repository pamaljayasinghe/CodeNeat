import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    await fs.promises.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
}

/** Candidate file names for an executable name on the current platform. */
export function executableNames(name: string, platform = process.platform, env = process.env): string[] {
  if (platform !== 'win32' || path.extname(name)) {
    return [name];
  }
  return windowsExtensions(env).map((extension) => name + extension);
}

/** Expands a leading "~" so that paths typed by users work on every platform. */
export function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Looks an executable up on PATH without starting a shell. Relative PATH entries (including the
 * empty entry, which means "current directory") are skipped so that a file dropped into a project
 * can never shadow a real tool.
 */
export async function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (name.includes('/') || name.includes('\\')) {
    return undefined;
  }
  const rawPath = env.PATH ?? env.Path ?? '';
  const directories = rawPath.split(path.delimiter).filter((directory) => directory && path.isAbsolute(directory));
  const names = executableNames(name, process.platform, env);
  for (const directory of directories) {
    for (const candidate of names) {
      const full = path.join(directory, candidate);
      if (await isExecutableFile(full)) {
        return full;
      }
    }
  }
  return undefined;
}

/**
 * Resolves a path configured by the user. Only absolute paths (after "~" expansion) to existing
 * files are accepted.
 */
export async function resolveConfiguredPath(value: string): Promise<{ path?: string; problem?: string }> {
  const expanded = expandHome(value.trim());
  if (!path.isAbsolute(expanded)) {
    return { problem: `The configured path "${value}" is not an absolute path.` };
  }
  for (const candidate of executableNames(expanded)) {
    if (await isExecutableFile(candidate)) {
      return { path: candidate };
    }
  }
  if (await isExecutableFile(expanded)) {
    return { path: expanded };
  }
  return { problem: `The configured path "${value}" does not exist or is not executable.` };
}

/** Searches upwards from `startDir` for `relative` (e.g. node_modules/.bin/tool), stopping at `stopDir`. */
export async function findUpwards(startDir: string, relative: string[], stopDir?: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;
  for (let depth = 0; depth < 40; depth++) {
    for (const entry of relative) {
      for (const candidate of executableNames(path.join(current, entry))) {
        if (await isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }
    if (stop && current === stop) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

/** Searches upwards for the first existing file among `names`. */
export async function findFileUpwards(startDir: string, names: string[], stopDir?: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;
  for (let depth = 0; depth < 40; depth++) {
    for (const name of names) {
      const candidate = path.join(current, name);
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch {
        // keep looking
      }
    }
    if (stop && current === stop) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

/** Extracts the first thing that looks like a version number from a tool's --version output. */
export function parseVersion(output: string): string | undefined {
  const match = /\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.]+)?/.exec(output);
  return match?.[0];
}

/** Compares dotted version strings numerically. Returns negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  const partsB = b.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
