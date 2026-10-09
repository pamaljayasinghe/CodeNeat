import { useState } from 'react';
import { PRECEDENCE } from '../../../src/shared/resolve';
import type { EditorSettings, SettingsDraft } from '../../../src/shared/types';
import { Badge, Banner, Button, Card, NumberField, Select, SettingRow, Toggle } from '../components/controls';
import type { PageContext } from '../context';
import { host } from '../host';
import { profilesOf, setDefaultProfile } from '../state';

const EXTENSION_ID = 'pamaljayasinghe.codeneat';

function PageHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <header className="page-header">
      <h2>{title}</h2>
      <p>{summary}</p>
    </header>
  );
}

// ───────────────────────────────────────────────────────────── Overview

const STEPS: { title: string; text: string }[] = [
  { title: 'Open a supported file', text: 'CodeNeat detects the language of the file you are working on.' },
  { title: 'Open CodeNeat settings', text: 'You are here. Click the CodeNeat icon in the Activity Bar any time to come back.' },
  { title: 'Customize your preferences', text: 'Pick a line length, indentation, quotes and more from the pages on the left.' },
  { title: 'Preview the changes', text: 'Every style page shows a live before/after preview made by the real formatter.' },
  { title: 'Apply formatting', text: 'Press Apply to save your settings, then format the file.' },
  { title: 'Optionally format on save', text: 'Switch on Format on Save under Auto Formatting.' },
];

export function OverviewPage({ context }: { context: PageContext }) {
  const { state, view } = context;
  const editor = state.activeEditor;
  const formatters = state.formatters;
  const available = formatters.filter((formatter) => state.statuses[formatter.id]?.available).length;
  const ready = state.languages.filter((language) =>
    formatters.some((formatter) => formatter.languages.includes(language.id) && state.statuses[formatter.id]?.available),
  ).length;

  return (
    <div className="page">
      <PageHeader title="Welcome to CodeNeat" summary="One Extension. Every Language. Your Style." />
      {!state.trusted && (
        <Banner tone="warn">
          <strong>Restricted Mode.</strong> This workspace is not trusted, so CodeNeat only runs its bundled formatters with your own
          settings. Project configuration files and external formatter programs are switched off.{' '}
          <Button small kind="ghost" onClick={() => host.command('codeneat.manageWorkspaceTrust')}>
            Manage Workspace Trust
          </Button>
        </Banner>
      )}

      <div className="card-grid">
        <Card title="Current file">
          {editor ? (
            <dl className="facts">
              <dt>File</dt>
              <dd>{editor.fileName}</dd>
              <dt>Language</dt>
              <dd>{view && editor.languageId ? view.language.label : `${editor.vscodeLanguageId} (not supported yet)`}</dd>
              {view && editor.languageId === view.language.id && (
                <>
                  <dt>Formatter</dt>
                  <dd>
                    {view.formatter?.displayName ?? 'None'}{' '}
                    {view.formatter && (view.available ? <Badge tone="ok">Ready</Badge> : <Badge tone="warn">Not installed</Badge>)}
                  </dd>
                  <dt>Profile</dt>
                  <dd>{view.resolved?.profile.name}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="empty-state">No file is open. Open a file and CodeNeat will show how it is going to be formatted.</p>
          )}
          <div className="button-row">
            <Button kind="primary" disabled={!editor?.languageId} onClick={() => host.command('codeneat.formatDocument')}>
              Format Document
            </Button>
            <Button disabled={!editor?.languageId} onClick={() => host.command('codeneat.previewFormatting')}>
              Preview in Diff Editor
            </Button>
            <Button disabled={!editor?.languageId} onClick={() => host.command('codeneat.checkFormatting')}>
              Check Formatting
            </Button>
          </div>
        </Card>

        <Card title="At a glance">
          <dl className="facts">
            <dt>Languages ready</dt>
            <dd>
              {ready} of {state.languages.length}
            </dd>
            <dt>Formatters available</dt>
            <dd>
              {available} of {formatters.length}
            </dd>
            <dt>Default profile</dt>
            <dd>{profilesOf(state, context.draft).find((profile) => profile.id === (context.draft.workspace.defaultProfile ?? context.draft.user.defaultProfile ?? 'standard'))?.name ?? 'Standard'}</dd>
            <dt>Format on Save</dt>
            <dd>{context.draft.editor.formatOnSave ? 'On' : 'Off'}</dd>
          </dl>
          <div className="button-row">
            <Button onClick={() => context.navigate('formatters')}>Manage Formatters</Button>
            <Button onClick={() => host.command('codeneat.formatWorkspace')}>Format Workspace…</Button>
          </div>
        </Card>
      </div>

      <Card title="Getting started">
        <ol className="steps">
          {STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
        <div className="button-row">
          <Button kind="primary" onClick={() => context.navigate('wrapping')}>
            Start Customizing
          </Button>
          <Button onClick={() => context.navigate('auto')}>Set Up Format on Save</Button>
          <Button onClick={() => host.command('codeneat.openWalkthrough')}>Open the Walkthrough</Button>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Auto formatting

export function AutoPage({ context }: { context: PageContext }) {
  const { state, draft, view } = context;
  const editor = draft.editor;
  const set = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void =>
    context.update((current) => ({ ...current, editor: { ...current.editor, [key]: value } }));
  const languageDefault = view ? state.defaultFormatter.byLanguage[view.language.id] : state.defaultFormatter.global;
  const isDefault = languageDefault === EXTENSION_ID;
  const rangeSupported = !!view?.formatter?.rangeLanguages.includes(view.language.id);
  const typeSupported = view?.formatter?.kind === 'bundled';

  return (
    <div className="page">
      <PageHeader title="Auto Formatting" summary="Let VS Code format your code for you while you work." />
      <Card title="Default formatter">
        <p>
          Format on Save, Paste and Type use VS Code’s <em>default formatter</em>.{' '}
          {view ? (
            isDefault ? (
              <>
                <Badge tone="ok">CodeNeat is the default for {view.language.label}</Badge>
              </>
            ) : languageDefault ? (
              <>
                For {view.language.label} it is currently <code>{languageDefault}</code>. CodeNeat never replaces another extension’s setting without
                asking.
              </>
            ) : (
              <>No default formatter is set for {view.language.label}; VS Code will ask you to choose one, or use the only formatter installed.</>
            )
          ) : (
            'Choose a language at the top of the page to see its default formatter.'
          )}
        </p>
        <div className="button-row">
          <Button kind={isDefault ? 'secondary' : 'primary'} onClick={() => host.command('codeneat.setAsDefaultFormatter')}>
            Use CodeNeat as Default Formatter…
          </Button>
        </div>
      </Card>

      <Card title="When to format">
        <SettingRow label="Format on Save" description="Format a file every time you save it.">
          <Toggle label="Format on Save" checked={editor.formatOnSave} onChange={(value) => set('formatOnSave', value)} />
        </SettingRow>
        <SettingRow
          label="What to Format on Save"
          description="Format the whole file, or only the lines you changed (needs Git and a formatter that can format selections)."
        >
          <Select
            label="What to Format on Save"
            value={editor.formatOnSaveMode}
            disabled={!editor.formatOnSave}
            choices={[
              { value: 'file', label: 'The whole file' },
              { value: 'modifications', label: 'Only modified lines' },
              { value: 'modificationsIfAvailable', label: 'Modified lines when possible, otherwise the whole file' },
            ]}
            onChange={(value) => set('formatOnSaveMode', value as EditorSettings['formatOnSaveMode'])}
          />
        </SettingRow>
        <SettingRow
          label="Format on Paste"
          description={
            view
              ? rangeSupported
                ? `Format code right after you paste it. Supported for ${view.language.label} with ${view.formatter?.displayName}.`
                : `Format code right after you paste it. Not supported for ${view.language.label}: ${view.formatter?.displayName ?? 'its formatter'} can only format whole files.`
              : 'Format code right after you paste it. Works for languages whose formatter can format a selection.'
          }
        >
          <Toggle label="Format on Paste" checked={editor.formatOnPaste} onChange={(value) => set('formatOnPaste', value)} />
        </SettingRow>
        <SettingRow
          label="Format on Type"
          description={
            view
              ? typeSupported
                ? `Tidy the file when you type “}” or “;”. Supported for ${view.language.label}.`
                : `Tidy the file when you type “}” or “;”. Not supported for ${view.language.label}: this needs a bundled formatter, because starting an external program on every keystroke would be too slow.`
              : 'Tidy the file when you type “}” or “;”. Available for languages with a bundled formatter.'
          }
        >
          <Toggle label="Format on Type" checked={editor.formatOnType} onChange={(value) => set('formatOnType', value)} />
        </SettingRow>
        <SettingRow
          label="Let CodeNeat Format on Type"
          description="Switch this off to keep VS Code’s Format on Type for other extensions while CodeNeat stays out of it."
        >
          <Toggle
            label="Let CodeNeat Format on Type"
            checked={draft.codeneatFormatOnType}
            disabled={!editor.formatOnType}
            onChange={(value) => context.update((current) => ({ ...current, codeneatFormatOnType: value }))}
          />
        </SettingRow>
      </Card>

      <Card title="Whitespace clean-up on save">
        <p className="muted">These are VS Code editor features that apply to every file, whichever formatter is used.</p>
        <SettingRow label="End Files with a Newline" description="Make sure the last line of a file ends with a line break when you save.">
          <Toggle label="End Files with a Newline" checked={editor.insertFinalNewline} onChange={(value) => set('insertFinalNewline', value)} />
        </SettingRow>
        <SettingRow label="Remove Trailing Spaces" description="Delete spaces and tabs at the end of lines when you save.">
          <Toggle label="Remove Trailing Spaces" checked={editor.trimTrailingWhitespace} onChange={(value) => set('trimTrailingWhitespace', value)} />
        </SettingRow>
        <SettingRow label="Remove Extra Blank Lines at the End" description="Keep at most one line break at the very end of a file when you save.">
          <Toggle label="Remove Extra Blank Lines at the End" checked={editor.trimFinalNewlines} onChange={(value) => set('trimFinalNewlines', value)} />
        </SettingRow>
      </Card>
      <p className="muted">
        These switches change VS Code’s own settings (<code>editor.formatOnSave</code> and friends) when you press Apply. If a language has its
        own override in your settings.json, that override still wins.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Workspace

function ListEditor({ items, onChange, placeholder, label }: { items: string[]; onChange(items: string[]): void; placeholder: string; label: string }) {
  const [text, setText] = useState('');
  const add = (): void => {
    const value = text.trim();
    if (value && !items.includes(value)) {
      onChange([...items, value]);
    }
    setText('');
  };
  return (
    <div className="list-editor">
      {items.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
              <Button small kind="ghost" ariaLabel={`Remove ${item}`} onClick={() => onChange(items.filter((candidate) => candidate !== item))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="list-add">
        <input
          type="text"
          className="text-input"
          aria-label={label}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button small onClick={add} disabled={!text.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function WorkspacePage({ context }: { context: PageContext }) {
  const { state, draft, view } = context;
  const project = view?.formatter && state.activeEditor?.languageId === view.language.id ? state.project[view.formatter.id] : undefined;
  const workspaceStyleCount =
    Object.keys(draft.workspace.style).length + Object.values(draft.workspace.languages).reduce((sum, entry) => sum + Object.keys(entry.style ?? {}).length, 0);
  const profiles = profilesOf(state, draft);

  return (
    <div className="page">
      <PageHeader title="Workspace Settings" summary="Settings that belong to this project and can be shared with your team." />
      {!state.hasWorkspace ? (
        <Banner>Open a folder or workspace to use workspace-specific settings. Until then, all your choices are stored in your personal settings.</Banner>
      ) : (
        <Card title={`Workspace: ${state.workspaceName ?? 'current folder'}`}>
          <p>
            Workspace settings are saved in <code>.vscode/settings.json</code>, so they travel with the project. To edit them, switch “Save to” at the
            top of the page to <strong>Workspace</strong>, then use any style page.
          </p>
          <dl className="facts">
            <dt>Trusted</dt>
            <dd>{state.trusted ? 'Yes' : 'No (Restricted Mode)'}</dd>
            <dt>Workspace preferences</dt>
            <dd>{workspaceStyleCount === 0 ? 'None set' : `${workspaceStyleCount} set`}</dd>
          </dl>
          <SettingRow label="Workspace Profile" description="The profile used for every language in this workspace, instead of your personal default.">
            <Select
              label="Workspace Profile"
              value={draft.workspace.defaultProfile ?? ''}
              choices={[{ value: '', label: 'Use my personal default' }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
              onChange={(value) => context.update((current) => setDefaultProfile(current, 'workspace', value || undefined))}
            />
          </SettingRow>
          <div className="button-row">
            <Button
              kind="danger"
              disabled={workspaceStyleCount === 0 && !draft.workspace.defaultProfile && Object.keys(draft.workspace.languages).length === 0}
              onClick={() => context.update((current) => ({ ...current, workspace: { style: {}, languages: {} } }))}
            >
              Clear All Workspace Preferences
            </Button>
          </div>
        </Card>
      )}

      <Card title="Project configuration files">
        <SettingRow
          label="Respect Project Configuration"
          description="Let files such as .editorconfig, .prettierrc, .clang-format or rustfmt.toml take priority over CodeNeat preferences. CodeNeat reads these files but never changes them."
        >
          <Toggle
            label="Respect Project Configuration"
            checked={draft.respectProjectConfig}
            disabled={!state.trusted}
            onChange={(value) => context.update((current) => ({ ...current, respectProjectConfig: value }))}
          />
        </SettingRow>
        {!state.trusted && <p className="option-reason">Project files are never read in Restricted Mode.</p>}
        {state.activeEditor && view?.formatter && project ? (
          <dl className="facts">
            <dt>File</dt>
            <dd>{state.activeEditor.fileName}</dd>
            <dt>.editorconfig</dt>
            <dd>
              {Object.keys(project.editorconfig).length === 0
                ? 'Nothing that applies to this file'
                : Object.entries(project.editorconfig)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(', ')}
            </dd>
            <dt>{view.formatter.displayName} config</dt>
            <dd>
              {project.formatterConfigFile ? (
                <>
                  <code>{project.formatterConfigFile}</code>
                  {project.formatterConfigTakesOver ? ' — controls all options for this file' : ''}
                </>
              ) : (
                'None found'
              )}
            </dd>
          </dl>
        ) : (
          <p className="muted">Open a file to see which project configuration files apply to it.</p>
        )}
        {view?.formatter && view.formatter.configFiles.length > 0 && (
          <p className="muted">
            {view.formatter.displayName} reads: {view.formatter.configFiles.join(', ')}
          </p>
        )}
      </Card>

      <Card title="Which setting wins">
        <p>When the same option is set in several places, the one lower in this list wins:</p>
        <ol className="precedence">
          {PRECEDENCE.map((entry) => (
            <li key={entry.source}>{entry.label}</li>
          ))}
        </ol>
        <p className="muted">Every option on the style pages shows “From: …” so you can see which of these is in effect.</p>
      </Card>

      <Card
        title="Format Workspace"
        actions={
          <Button kind="primary" onClick={() => host.command('codeneat.formatWorkspace')}>
            Format Workspace…
          </Button>
        }
      >
        <p>
          Formats many files at once. CodeNeat first shows you the list of files that would change and asks for confirmation; nothing is rewritten
          before that.
        </p>
        <SettingRow label="Skip Files Ignored by Git" description="Leave out everything matched by .gitignore.">
          <Toggle label="Skip Files Ignored by Git" checked={draft.useGitignore} onChange={(value) => context.update((current) => ({ ...current, useGitignore: value }))} />
        </SettingRow>
        <SettingRow
          label="Extra Folders and Files to Skip"
          description="Patterns in .gitignore style, for example “legacy/” or “*.gen.ts”. node_modules, build output, lock files, minified and generated files are always skipped."
        >
          <ListEditor
            label="Pattern to skip"
            placeholder="e.g. legacy/ or *.gen.ts"
            items={draft.workspaceExclude}
            onChange={(items) => context.update((current) => ({ ...current, workspaceExclude: items }))}
          />
        </SettingRow>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Advanced

export function AdvancedPage({ context }: { context: PageContext }) {
  const { state, draft } = context;
  const custom = state.formatters.filter((formatter) => formatter.kind === 'custom');
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void => context.update((current) => ({ ...current, [key]: value }));
  const userCount =
    Object.keys(draft.user.style).length + Object.values(draft.user.languages).reduce((sum, entry) => sum + Object.keys(entry.style ?? {}).length, 0);

  return (
    <div className="page">
      <PageHeader title="Advanced" summary="Limits, backups and tools for experienced users." />
      <Card title="Safety limits">
        <SettingRow label="Time Limit per File" description="A formatter that takes longer than this is stopped and the file is left unchanged.">
          <NumberField
            label="Time Limit per File"
            value={Math.round(draft.timeoutMs / 1000)}
            min={1}
            max={120}
            unit="seconds"
            presets={[5, 10, 30, 60]}
            onChange={(value) => set('timeoutMs', value * 1000)}
          />
        </SettingRow>
        <SettingRow label="Largest File to Format" description="Bigger files are skipped so the editor stays responsive.">
          <NumberField
            label="Largest File to Format"
            value={draft.maxFileSizeKB}
            min={16}
            max={102400}
            unit="KB"
            presets={[512, 2048, 8192]}
            onChange={(value) => set('maxFileSizeKB', value)}
          />
        </SettingRow>
        <SettingRow label="Show Formatter in the Status Bar" description="Show which formatter handles the current file at the bottom of the window.">
          <Toggle label="Show Formatter in the Status Bar" checked={draft.showStatusBar} onChange={(value) => set('showStatusBar', value)} />
        </SettingRow>
      </Card>

      <Card title="Back up and share your settings">
        <p>Export your personal CodeNeat preferences and custom profiles to a file, or load them on another computer.</p>
        <div className="button-row">
          <Button onClick={() => host.command('codeneat.exportSettings')}>Export Settings…</Button>
          <Button onClick={() => host.command('codeneat.importSettings')}>Import Settings…</Button>
        </div>
        <p className="muted">Export saves the settings that are already applied. Press Apply first if you have unsaved changes.</p>
      </Card>

      <Card title="Custom formatters">
        <p>
          Use any other command-line formatter for a language CodeNeat does not cover. CodeNeat sends the file to the program’s standard input and
          uses what it prints. Each command must be approved by you before it runs, and custom formatters never run in Restricted Mode.
        </p>
        {custom.length === 0 ? (
          <p className="empty-state">No custom formatters are set up.</p>
        ) : (
          <ul className="plain-list">
            {custom.map((formatter) => (
              <li key={formatter.id}>
                <strong>{formatter.displayName}</strong> <span className="muted">({formatter.languages.join(', ')})</span>
                <br />
                <code>{formatter.engine.replace(/^Custom command: /, '')}</code>{' '}
                {state.statuses[formatter.id]?.available ? <Badge tone="ok">Approved</Badge> : <Badge tone="warn">{state.statuses[formatter.id]?.problem ?? 'Not available'}</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div className="button-row">
          <Button onClick={() => host.command('codeneat.openSettingsJson')}>Edit “codeneat.customFormatters” in settings.json</Button>
        </div>
        <pre className="option-example">{`"codeneat.customFormatters": [
  { "id": "zig-fmt", "name": "zig fmt", "languages": ["zig"],
    "extensions": [".zig"], "command": "zig", "args": ["fmt", "--stdin"] }
]`}</pre>
      </Card>

      <Card title="Start over">
        <p>
          You have {userCount} personal style {userCount === 1 ? 'preference' : 'preferences'} set. Clearing them returns every option to its profile or
          formatter default. Nothing is saved until you press Apply.
        </p>
        <div className="button-row">
          <Button
            kind="danger"
            disabled={userCount === 0 && Object.keys(draft.user.languages).length === 0 && !draft.user.defaultProfile}
            onClick={() => context.update((current) => ({ ...current, user: { style: {}, languages: {} } }))}
          >
            Clear All My Preferences
          </Button>
          <Button onClick={() => host.command('codeneat.openSettingsJson')}>Open settings.json</Button>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Help

const FAQ: { question: string; answer: string }[] = [
  {
    question: 'Why is a line still longer than my line length?',
    answer:
      'Line length is the width the formatter aims for, not a hard limit. Formatters never split a string, a URL or another piece of code that cannot be broken safely, because that could change what your program does.',
  },
  {
    question: 'Why is a setting greyed out?',
    answer:
      'Each language is formatted by a real formatting engine, and each engine only offers certain options. CodeNeat disables anything the engine cannot do and tells you why, instead of pretending. Some engines (such as gofmt) have a single fixed style by design.',
  },
  {
    question: 'It says a formatter is not installed. What now?',
    answer:
      'Web languages, Java, XML, SQL and TOML work out of the box. Other languages use the official formatter for that language, which you install once. Open Formatter Management for the exact command, then press “Re-detect”.',
  },
  {
    question: 'My project has a .prettierrc or .editorconfig. Who wins?',
    answer:
      'By default the project file wins, so everyone on the project gets the same result. CodeNeat never edits those files. You can change this under Workspace Settings.',
  },
  {
    question: 'Nothing happens when I save.',
    answer:
      'Format on Save uses VS Code’s default formatter. Open Auto Formatting, make CodeNeat the default formatter for the language, and switch Format on Save on.',
  },
  {
    question: 'Does CodeNeat send my code anywhere?',
    answer:
      'No. Formatting happens entirely on your computer. CodeNeat has no account, no telemetry and makes no network requests.',
  },
];

export function HelpPage({ context }: { context: PageContext }) {
  const { state } = context;
  return (
    <div className="page">
      <PageHeader title="Help and Diagnostics" summary="Answers to common questions and tools for when something does not work." />
      <Card title="Troubleshooting tools">
        <div className="button-row">
          <Button kind="primary" onClick={() => host.command('codeneat.openDiagnostics')}>
            Open Diagnostics Report
          </Button>
          <Button onClick={() => host.command('codeneat.showLog')}>Show Log</Button>
          <Button onClick={() => host.post({ type: 'refreshFormatters' })}>Re-detect Formatters</Button>
          <Button onClick={() => host.command('codeneat.openWalkthrough')}>Open the Walkthrough</Button>
        </div>
        <p className="muted">
          The diagnostics report lists your formatters, settings and where each option for the current file comes from. It never contains your code.
        </p>
      </Card>
      <Card title="Common questions">
        {FAQ.map((entry) => (
          <details key={entry.question} className="faq">
            <summary>{entry.question}</summary>
            <p>{entry.answer}</p>
          </details>
        ))}
      </Card>
      <Card title="Keyboard">
        <p>
          Every control can be reached with <kbd>Tab</kbd> and changed with <kbd>Space</kbd>, <kbd>Enter</kbd> or the arrow keys. Press{' '}
          <kbd>/</kbd> to jump to the search box, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> to apply your changes.
        </p>
      </Card>
      <Card title="About">
        <dl className="facts">
          <dt>Version</dt>
          <dd>CodeNeat {state.version}</dd>
          <dt>Privacy</dt>
          <dd>No account, no telemetry, no network requests. Your code never leaves your computer.</dd>
          <dt>Licence</dt>
          <dd>Apache-2.0</dd>
        </dl>
        <div className="button-row">
          <Button onClick={() => host.command('codeneat.openExternal', { url: 'https://github.com/pamaljayasinghe/CodeNeat' })}>Project on GitHub</Button>
          <Button onClick={() => host.command('codeneat.openExternal', { url: 'https://github.com/pamaljayasinghe/CodeNeat/issues' })}>Report a Problem</Button>
        </div>
      </Card>
    </div>
  );
}
