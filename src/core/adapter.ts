import type { FormatterDescriptor, FormatterStatus, InstallGuide, StyleOptions } from '../shared/types';
import type { CancellationSignal } from './process';

/** Everything an adapter may know about its surroundings. Contains no VS Code types. */
export interface AdapterEnvironment {
  /** False in Restricted Mode: project files and external executables must not be used. */
  trusted: boolean;
  /** User-configured executable paths keyed by formatter id. */
  toolPaths: Record<string, string>;
  /** Workspace folder paths, used to find project-local formatter installations. */
  workspaceRoots: string[];
  /** Fingerprints of custom formatter commands the user has approved. */
  approvedCommands: ReadonlySet<string>;
  log(message: string): void;
}

export interface FormatRequest {
  text: string;
  languageId: string;
  /** Absolute path of the document when it is a file on disk. */
  filePath?: string;
  /** File name (with extension) used to tell tools what kind of file they are formatting. */
  fileName: string;
  /** Workspace folder that contains the file, if any. */
  workspaceRoot?: string;
  /** Resolved values for all options the formatter supports (including formatter defaults). */
  style: StyleOptions;
  /**
   * Ids of options whose value was actually chosen (by the user, a profile, CodeNeat's defaults or
   * a project file). Adapters only pass these to the tool so that everything else keeps the
   * tool's own default.
   */
  explicit: string[];
  /** The formatter configuration file found for this document, if any. */
  projectConfigFile?: string;
  /**
   * True when the formatter's own project configuration file should decide the style. Adapters
   * must then pass no style flags.
   */
  projectConfigTakesOver: boolean;
  /** True when project configuration may be consulted at all. */
  useProjectConfig: boolean;
  /** Optional range as UTF-16 offsets into `text`. */
  range?: { start: number; end: number };
  timeoutMs: number;
}

export type FormatterErrorKind =
  | 'missing'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'untrusted'
  | 'unsupported'
  | 'ignored'
  | 'needs-approval'
  | 'too-large';

export class FormatterError extends Error {
  install?: InstallGuide;
  /** The formatter the error is about, when known. */
  formatterId?: string;
  constructor(
    readonly kind: FormatterErrorKind,
    message: string,
    /** Raw tool output for the diagnostics log. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'FormatterError';
  }
}

export interface ProjectConfigInfo {
  /** Values CodeNeat could read from the configuration file (may be empty). */
  style: StyleOptions;
  file?: string;
  /** True when the tool reads the file itself and CodeNeat cannot merge individual keys. */
  takesOver: boolean;
}

export interface FormatterAdapter {
  readonly descriptor: FormatterDescriptor;
  /** Finds the formatter and reports its version. `nearDir` enables project-local lookup. */
  detect(env: AdapterEnvironment, nearDir?: string): Promise<FormatterStatus>;
  /** Formats `request.text` and returns the complete formatted text. */
  format(request: FormatRequest, env: AdapterEnvironment, token: CancellationSignal): Promise<string>;
  /** Reads the formatter's project configuration that applies to a file, if any. */
  readProjectConfig(filePath: string, workspaceRoot: string | undefined, env: AdapterEnvironment): Promise<ProjectConfigInfo>;
  /** Clears cached detection results. */
  reset(): void;
}

export const NO_PROJECT_CONFIG: ProjectConfigInfo = { style: {}, takesOver: false };

/**
 * Typed accessors for resolved style values. `num`/`str`/`bool` return a value only when it was
 * explicitly chosen; the `effective*` variants also return formatter defaults.
 */
export class StyleReader {
  private readonly explicit: ReadonlySet<string> | undefined;

  constructor(
    private readonly style: StyleOptions,
    explicit?: Iterable<string>,
  ) {
    this.explicit = explicit ? new Set(explicit) : undefined;
  }

  static of(request: FormatRequest): StyleReader {
    return request.projectConfigTakesOver ? new StyleReader({}, []) : new StyleReader(request.style, request.explicit);
  }

  has(id: string): boolean {
    return this.style[id] !== undefined && (!this.explicit || this.explicit.has(id));
  }

  num(id: string): number | undefined {
    return this.has(id) ? this.effectiveNum(id) : undefined;
  }

  str(id: string): string | undefined {
    return this.has(id) ? this.effectiveStr(id) : undefined;
  }

  bool(id: string): boolean | undefined {
    return this.has(id) ? this.effectiveBool(id) : undefined;
  }

  effectiveNum(id: string): number | undefined {
    const value = this.style[id];
    return typeof value === 'number' ? value : undefined;
  }

  effectiveStr(id: string): string | undefined {
    const value = this.style[id];
    return typeof value === 'string' ? value : undefined;
  }

  effectiveBool(id: string): boolean | undefined {
    const value = this.style[id];
    return typeof value === 'boolean' ? value : undefined;
  }

  /** True/false when the indent style was explicitly chosen, otherwise undefined. */
  get useTabs(): boolean | undefined {
    const value = this.str('indentStyle');
    return value === undefined ? undefined : value === 'tabs';
  }

  /** True when either indentation option was explicitly chosen. */
  get indentChosen(): boolean {
    return this.has('indentStyle') || this.has('indentSize');
  }

  get effectiveUseTabs(): boolean {
    return this.effectiveStr('indentStyle') === 'tabs';
  }

  /** Explicitly chosen values only. */
  explicitValues(): StyleOptions {
    const result: StyleOptions = {};
    for (const [id, value] of Object.entries(this.style)) {
      if (this.has(id)) {
        result[id] = value;
      }
    }
    return result;
  }
}

export function descriptorDefaults(): Pick<
  FormatterDescriptor,
  'options' | 'fixed' | 'rangeLanguages' | 'supportsDocument' | 'supportsCheck' | 'configFiles' | 'limitations' | 'executables' | 'extensions'
> {
  return {
    options: {},
    fixed: {},
    rangeLanguages: [],
    supportsDocument: true,
    supportsCheck: true,
    configFiles: [],
    limitations: [],
    executables: [],
    extensions: [],
  };
}
