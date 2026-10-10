/**
 * Types shared by the extension host and the settings dashboard webview.
 * Nothing in src/shared may import `vscode` or Node built-ins.
 */

export type OptionValue = string | number | boolean;

/** A bag of CodeNeat style preferences, keyed by option id from the catalog. */
export type StyleOptions = Record<string, OptionValue>;

export type SectionId =
  | 'general'
  | 'wrapping'
  | 'indentation'
  | 'spacing'
  | 'braces'
  | 'quotes'
  | 'imports'
  | 'language';

export interface OptionChoice {
  value: string;
  label: string;
  description?: string;
}

interface OptionBase {
  id: string;
  section: SectionId;
  /** Plain-language label shown in the dashboard. */
  label: string;
  /** One-sentence explanation. */
  description: string;
  /** Optional short before/after style example. */
  example?: string;
  /** Extra search keywords (native formatter option names etc.). */
  keywords?: string[];
  /**
   * True when the option can change more than whitespace/layout (for example removing imports).
   * Such options are always off unless the user switches them on.
   */
  semantic?: boolean;
}

export interface BooleanOption extends OptionBase {
  type: 'boolean';
  fallback: boolean;
  codeneatDefault?: boolean;
}

export interface NumberOption extends OptionBase {
  type: 'number';
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Quick-pick values shown next to the numeric input. */
  presets?: number[];
  fallback: number;
  codeneatDefault?: number;
  control?: 'slider' | 'input';
}

export interface EnumOption extends OptionBase {
  type: 'enum';
  choices: OptionChoice[];
  fallback: string;
  codeneatDefault?: string;
  control?: 'radio' | 'select';
}

export type OptionDefinition = BooleanOption | NumberOption | EnumOption;

/** How one CodeNeat option maps onto a formatter's native option. */
export interface OptionCapability {
  /** Native option / flag name, shown to advanced users. */
  native: string;
  /** `partial` means the formatter honours the preference only in some situations (see `note`). */
  support: 'full' | 'partial';
  note?: string;
  /** Subset of enum values the formatter accepts. Omit when all catalog values are accepted. */
  values?: string[];
  min?: number;
  max?: number;
  /** The formatter's own default, used when the user has not chosen a value. */
  default?: OptionValue;
  /** Per-language formatter defaults that differ from `default`. */
  languageDefaults?: Record<string, OptionValue>;
  /** Restrict the option to some of the formatter's languages. */
  languages?: string[];
}

/** A value the formatter enforces and that cannot be configured. */
export interface FixedOption {
  value: OptionValue;
  reason: string;
  languages?: string[];
}

export type LineLengthSemantics = 'preferred' | 'strict' | 'none';

export interface InstallGuide {
  /** One-sentence guidance, e.g. "Install rustfmt using the Rust toolchain." */
  summary: string;
  /** Commands the user may run themselves. CodeNeat never runs these. */
  commands: { label: string; command: string }[];
  url: string;
}

export interface FormatterDescriptor {
  id: string;
  displayName: string;
  kind: 'bundled' | 'external' | 'custom';
  /** Underlying engine and its licence, for transparency. */
  engine: string;
  license: string;
  homepage: string;
  /** CodeNeat language ids. */
  languages: string[];
  /** File extensions (with leading dot) handled even when no VS Code language id is known. */
  extensions: string[];
  /** Human-readable requirement, e.g. "rustfmt executable" or "bundled with CodeNeat". */
  requirement: string;
  /** Executable names searched on PATH (external formatters). */
  executables: string[];
  install: InstallGuide;
  options: Record<string, OptionCapability>;
  fixed: Record<string, FixedOption>;
  lineLength: LineLengthSemantics;
  lineLengthNote?: string;
  supportsDocument: boolean;
  /** Languages for which range ("Format Selection") formatting is supported. */
  rangeLanguages: string[];
  supportsCheck: boolean;
  cancellation: 'kill-process' | 'discard-result';
  /** Project configuration files this formatter reads. */
  configFiles: string[];
  limitations: string[];
}

export interface FormatterStatus {
  id: string;
  available: boolean;
  version?: string;
  /** Resolved executable path or package location. */
  path?: string;
  /** Where the tool was found. */
  origin?: 'bundled' | 'project' | 'setting' | 'path';
  /** Why the formatter cannot be used right now. */
  problem?: string;
}

export interface LanguageDefinition {
  id: string;
  label: string;
  group: 'Web' | 'Backend' | 'Scripting and data';
  /** VS Code language identifiers that map to this language. */
  vscodeIds: string[];
  extensions: string[];
  /** Exact file names (e.g. "Dockerfile"). */
  filenames?: string[];
  /** highlight.js grammar used by the preview. */
  highlight: string;
  /** Formatter ids in order of preference. */
  formatters: string[];
}

export interface ProfileDefinition {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
  style: StyleOptions;
  /** Per-language additions on top of `style`. */
  languages?: Record<string, StyleOptions>;
}

export interface LanguageSettings {
  formatter?: string;
  profile?: string;
  style?: StyleOptions;
}

/** One configuration scope (user or workspace) of CodeNeat's own settings. */
export interface SettingsLayer {
  style: StyleOptions;
  languages: Record<string, LanguageSettings>;
  defaultProfile?: string;
}

export interface EditorSettings {
  formatOnSave: boolean;
  formatOnSaveMode: 'file' | 'modifications' | 'modificationsIfAvailable';
  formatOnPaste: boolean;
  formatOnType: boolean;
  insertFinalNewline: boolean;
  trimTrailingWhitespace: boolean;
  trimFinalNewlines: boolean;
}

export interface CustomFormatterConfig {
  id: string;
  name: string;
  languages: string[];
  extensions?: string[];
  command: string;
  args?: string[];
}

export interface CodeNeatSettings {
  user: SettingsLayer;
  workspace: SettingsLayer;
  /** Custom profiles (built-ins are not stored). */
  profiles: Record<string, ProfileDefinition>;
  respectProjectConfig: boolean;
  codeneatFormatOnType: boolean;
  /** Ask to review CodeNeat's changes after a manual save instead of formatting silently. */
  previewOnSave: boolean;
  /** Show the result of CodeNeat: Format Document in the editor and wait for Keep or Undo. */
  inlineReview: boolean;
  timeoutMs: number;
  maxFileSizeKB: number;
  workspaceExclude: string[];
  useGitignore: boolean;
  toolPaths: Record<string, string>;
  showStatusBar: boolean;
  /** Master switch: when false CodeNeat formats nothing. */
  enabled: boolean;
  /** Show the Format button in the editor title bar. */
  showEditorButton: boolean;
  /** Show CodeNeat entries in the editor's right-click menu. */
  showContextMenu: boolean;
}

export type ValueSource =
  | 'formatter-default'
  | 'codeneat-default'
  | 'profile'
  | 'user'
  | 'workspace'
  | 'user-language'
  | 'workspace-language'
  | 'editorconfig'
  | 'project-config'
  | 'fixed';

export interface ResolvedOption {
  id: string;
  value: OptionValue;
  source: ValueSource;
  /** Extra detail for the source (profile name, config file name). */
  sourceDetail?: string;
  supported: boolean;
  support?: 'full' | 'partial';
  native?: string;
  note?: string;
  /** Why the control is disabled (unsupported or fixed). */
  unavailableReason?: string;
  /** True when a project file overrides the user's preference. */
  locked?: boolean;
}

/** Values coming from files in the project (computed by the extension host). */
export interface ProjectOverrides {
  /** Values from .editorconfig. */
  editorconfig: StyleOptions;
  /** Values read from the formatter's own configuration file. */
  formatterConfig: StyleOptions;
  /** Path of the formatter configuration file that was found, if any. */
  formatterConfigFile?: string;
  /**
   * True when the formatter config file is opaque to CodeNeat: the tool reads it itself and
   * CodeNeat passes no style flags at all.
   */
  formatterConfigTakesOver: boolean;
}

export interface ActiveEditorInfo {
  uri: string;
  fileName: string;
  languageId: string | undefined;
  vscodeLanguageId: string;
  hasSelection: boolean;
  lineCount: number;
  tooLarge: boolean;
  /** Changes with every edit, so the dashboard preview can follow the file while it is edited. */
  revision: number;
}

/** Complete snapshot sent to the dashboard. */
export interface DashboardState {
  version: string;
  catalog: OptionDefinition[];
  languages: LanguageDefinition[];
  formatters: FormatterDescriptor[];
  statuses: Record<string, FormatterStatus>;
  builtinProfiles: ProfileDefinition[];
  settings: CodeNeatSettings;
  editor: EditorSettings;
  /** Per CodeNeat-language: is CodeNeat the default formatter for it ("yes"/"no"/another extension id). */
  defaultFormatter: { global: string | null; byLanguage: Record<string, string | null> };
  activeEditor: ActiveEditorInfo | null;
  project: Record<string, ProjectOverrides>;
  trusted: boolean;
  hasWorkspace: boolean;
  workspaceName?: string;
  platform: string;
  samples: Record<string, string>;
}

/** What the dashboard sends back when the user presses Apply. */
export interface SettingsDraft {
  user: SettingsLayer;
  workspace: SettingsLayer;
  profiles: Record<string, ProfileDefinition>;
  editor: EditorSettings;
  respectProjectConfig: boolean;
  codeneatFormatOnType: boolean;
  /** Ask to review CodeNeat's changes after a manual save instead of formatting silently. */
  previewOnSave: boolean;
  /** Show the result of CodeNeat: Format Document in the editor and wait for Keep or Undo. */
  inlineReview: boolean;
  timeoutMs: number;
  maxFileSizeKB: number;
  workspaceExclude: string[];
  useGitignore: boolean;
  toolPaths: Record<string, string>;
  showStatusBar: boolean;
  /** Master switch: when false CodeNeat formats nothing. */
  enabled: boolean;
  /** Show the Format button in the editor title bar. */
  showEditorButton: boolean;
  /** Show CodeNeat entries in the editor's right-click menu. */
  showContextMenu: boolean;
}

export interface PreviewRequest {
  requestId: number;
  languageId: string;
  formatterId?: string;
  source: 'sample' | 'editor' | 'custom';
  /** Present when `source` is `sample`/`custom`: the code to format. */
  code?: string;
  draft: SettingsDraft;
}

export interface PreviewResult {
  requestId: number;
  ok: boolean;
  original: string;
  formatted?: string;
  changed?: boolean;
  formatterId?: string;
  formatterName?: string;
  durationMs?: number;
  error?: string;
  /** `missing` = formatter not installed, `error` = formatter failed (e.g. syntax error). */
  errorKind?: 'missing' | 'error' | 'unsupported' | 'untrusted' | 'too-large';
  install?: InstallGuide;
  fileName?: string;
}

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'preview'; request: PreviewRequest }
  | { type: 'cancelPreview' }
  | { type: 'apply'; draft: SettingsDraft }
  | { type: 'applyToDocument'; draft: SettingsDraft }
  | { type: 'command'; command: string; args?: Record<string, string> }
  | { type: 'copy'; text: string }
  | { type: 'refreshFormatters' }
  | { type: 'exportProfile'; profile: ProfileDefinition }
  | { type: 'importProfile' }
  | { type: 'dirty'; dirty: boolean };

export type HostToWebviewMessage =
  | { type: 'state'; state: DashboardState; reason: 'init' | 'refresh' | 'applied' }
  | { type: 'previewResult'; result: PreviewResult }
  | { type: 'activeEditor'; activeEditor: ActiveEditorInfo | null; project: Record<string, ProjectOverrides> }
  | { type: 'navigate'; page: string; languageId?: string }
  | { type: 'profileImported'; profile: ProfileDefinition }
  | { type: 'notice'; level: 'info' | 'error'; message: string };
