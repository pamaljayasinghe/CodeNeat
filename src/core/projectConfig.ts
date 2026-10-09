import * as path from 'node:path';
import { isInside } from '../adapters/external';
import type { ProjectOverrides, StyleOptions } from '../shared/types';
import type { AdapterEnvironment, FormatterAdapter } from './adapter';
import { findFileUpwards } from './executables';

interface EditorConfigModule {
  parse(filePath: string, options?: { root?: string }): Promise<Record<string, unknown>>;
}

function loadEditorConfig(): EditorConfigModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('editorconfig') as EditorConfigModule;
}

/** Converts resolved .editorconfig properties into CodeNeat style values. */
export function editorConfigToStyle(props: Record<string, unknown>): StyleOptions {
  const style: StyleOptions = {};
  if (props.indent_style === 'tab') {
    style.indentStyle = 'tabs';
  } else if (props.indent_style === 'space') {
    style.indentStyle = 'spaces';
  }
  const size = props.indent_size === 'tab' ? props.tab_width : props.indent_size;
  if (typeof size === 'number' && size > 0) {
    style.indentSize = size;
  } else if (typeof props.tab_width === 'number' && props.tab_width > 0 && props.indent_style === 'tab') {
    style.indentSize = props.tab_width;
  }
  const width = typeof props.max_line_length === 'string' ? Number(props.max_line_length) : props.max_line_length;
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    style.lineLength = width;
  }
  if (props.end_of_line === 'lf' || props.end_of_line === 'crlf') {
    style.lineEndings = props.end_of_line;
  }
  return style;
}

/** Reads the .editorconfig settings that apply to a file. Never throws. */
export async function readEditorConfig(filePath: string, workspaceRoot: string | undefined, log: (message: string) => void): Promise<StyleOptions> {
  try {
    const stop = workspaceRoot && isInside(workspaceRoot, filePath) ? workspaceRoot : undefined;
    // Skip the (WASM-backed) parser entirely when there is no .editorconfig to read.
    if (!(await findFileUpwards(path.dirname(filePath), ['.editorconfig'], stop))) {
      return {};
    }
    const props = await loadEditorConfig().parse(filePath, stop ? { root: stop } : undefined);
    return editorConfigToStyle(props);
  } catch (error) {
    log(`editorconfig: could not read settings for ${filePath}: ${String(error)}`);
    return {};
  }
}

export const NO_OVERRIDES: ProjectOverrides = { editorconfig: {}, formatterConfig: {}, formatterConfigTakesOver: false };

/** Collects everything project files say about how `filePath` should be formatted by `adapter`. */
export async function readProjectOverrides(
  adapter: FormatterAdapter,
  filePath: string | undefined,
  workspaceRoot: string | undefined,
  env: AdapterEnvironment,
): Promise<ProjectOverrides> {
  if (!filePath || !env.trusted || !path.isAbsolute(filePath)) {
    return NO_OVERRIDES;
  }
  const [editorconfig, config] = await Promise.all([
    readEditorConfig(filePath, workspaceRoot, env.log),
    adapter.readProjectConfig(filePath, workspaceRoot, env).catch(() => ({ style: {}, takesOver: false, file: undefined })),
  ]);
  return {
    editorconfig,
    formatterConfig: config.style,
    formatterConfigFile: config.file,
    formatterConfigTakesOver: config.takesOver,
  };
}
