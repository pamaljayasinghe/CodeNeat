import { useState } from 'react';
import { CATALOG } from '../../../src/shared/catalog';
import { chooseFormatter } from '../../../src/shared/resolve';
import type { FormatterDescriptor } from '../../../src/shared/types';
import { Badge, Banner, Button, Card, CodeLine } from '../components/controls';
import type { PageContext } from '../context';
import { host } from '../host';
import { setLanguageFormatter } from '../state';

type Filter = 'all' | 'available' | 'missing';

function originLabel(origin: string | undefined): string {
  switch (origin) {
    case 'bundled':
      return 'Bundled with CodeNeat';
    case 'project':
      return 'Installed in this project';
    case 'setting':
      return 'Path from your settings';
    case 'path':
      return 'Found on your PATH';
    default:
      return '';
  }
}

function FormatterCard({ context, formatter }: { context: PageContext; formatter: FormatterDescriptor }) {
  const { state, draft, scope } = context;
  const status = state.statuses[formatter.id];
  const available = !!status?.available;
  const languages = state.languages.filter((language) => formatter.languages.includes(language.id));
  const activeFor = languages.filter(
    (language) => chooseFormatter(language, state.formatters, state.statuses, draft.user, draft.workspace).formatter?.id === formatter.id,
  );
  const optionLabels = CATALOG.filter((option) => formatter.options[option.id]).map((option) => option.label);
  const path = draft.toolPaths[formatter.id] ?? '';
  const [pathText, setPathText] = useState(path);
  const pathInvalid = pathText.trim() !== '' && !/^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(pathText.trim());

  const setPath = (value: string): void => {
    setPathText(value);
    const trimmed = value.trim();
    if (trimmed !== '' && !/^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(trimmed)) {
      return;
    }
    context.update((current) => {
      const toolPaths = { ...current.toolPaths };
      if (trimmed) {
        toolPaths[formatter.id] = trimmed;
      } else {
        delete toolPaths[formatter.id];
      }
      return { ...current, toolPaths };
    });
  };

  return (
    <Card
      title={formatter.displayName}
      actions={
        <>
          {formatter.kind === 'bundled' && <Badge tone="info">Bundled</Badge>}
          {formatter.kind === 'custom' && <Badge tone="info">Custom</Badge>}
          {available ? <Badge tone="ok">Installed</Badge> : <Badge tone="warn">Missing</Badge>}
        </>
      }
    >
      <dl className="facts">
        <dt>Languages</dt>
        <dd>{languages.map((language) => language.label).join(', ') || formatter.languages.join(', ')}</dd>
        <dt>Active for</dt>
        <dd>{activeFor.length > 0 ? activeFor.map((language) => language.label).join(', ') : 'No language at the moment'}</dd>
        <dt>Version</dt>
        <dd>{status?.version ?? (available ? 'Unknown' : '—')}</dd>
        <dt>Location</dt>
        <dd>
          {status?.path ? <code>{status.path}</code> : '—'} {status?.origin && <span className="muted">({originLabel(status.origin)})</span>}
        </dd>
        <dt>Needs</dt>
        <dd>{formatter.requirement}</dd>
        <dt>Options</dt>
        <dd>
          {optionLabels.length > 0 ? `${optionLabels.length}: ${optionLabels.join(', ')}` : 'None — this formatter has one fixed style'}
        </dd>
        <dt>Line length</dt>
        <dd>
          {formatter.lineLength === 'preferred'
            ? 'Preferred width (not a hard limit)'
            : formatter.lineLength === 'strict'
              ? 'Strict maximum'
              : (formatter.lineLengthNote ?? 'Not configurable')}
        </dd>
        <dt>Format selection</dt>
        <dd>{formatter.rangeLanguages.length > 0 ? 'Supported' : 'Whole files only'}</dd>
        {formatter.configFiles.length > 0 && (
          <>
            <dt>Reads</dt>
            <dd>{formatter.configFiles.join(', ')}</dd>
          </>
        )}
        <dt>Engine</dt>
        <dd>
          {formatter.engine} · {formatter.license}
        </dd>
      </dl>

      {!available && (
        <div className="install-guide">
          <Banner tone="warn">
            <strong>{formatter.displayName} was not detected.</strong> {status?.problem && status.problem !== undefined ? status.problem : formatter.install.summary}
          </Banner>
          {formatter.install.commands.length > 0 && <p>{formatter.install.summary} Use the Install button, or run one of these yourself in a terminal:</p>}
          {formatter.install.commands.map((command) => (
            <div key={command.label} className="install-command">
              <span className="muted">{command.label}</span>
              <CodeLine text={command.command} onCopy={host.copy} />
            </div>
          ))}
          {formatter.kind === 'external' && (
            <div className="button-row">
              <Button kind="primary" disabled={!state.trusted} onClick={() => host.command('codeneat.installFormatter', { formatterId: formatter.id })}>
                Install {formatter.displayName}…
              </Button>
            </div>
          )}
          <p className="muted">
            “Install” shows you the exact command and runs it in a terminal only after you confirm. CodeNeat never installs anything on its own.
          </p>
        </div>
      )}

      {formatter.limitations.length > 0 && (
        <details className="faq">
          <summary>Limitations</summary>
          <ul>
            {formatter.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </details>
      )}

      {formatter.kind === 'external' && (
        <div className="path-row">
          <label htmlFor={`path-${formatter.id}`}>Custom location (optional)</label>
          <input
            id={`path-${formatter.id}`}
            type="text"
            className={`text-input${pathInvalid ? ' has-error' : ''}`}
            placeholder={`Full path to ${formatter.executables[0] ?? 'the executable'}`}
            value={pathText}
            disabled={!state.trusted}
            aria-invalid={pathInvalid}
            spellCheck={false}
            onChange={(event) => setPath(event.target.value)}
          />
          {pathInvalid && (
            <p className="field-error" role="alert">
              Enter a full path, for example /usr/local/bin/{formatter.executables[0]} or C:\Tools\{formatter.executables[0]}.exe.
            </p>
          )}
        </div>
      )}

      <div className="button-row">
        {languages
          .filter((language) => !activeFor.includes(language) && languages.length <= 4)
          .map((language) => (
            <Button key={language.id} small onClick={() => context.update((current) => setLanguageFormatter(current, scope, language.id, formatter.id))}>
              Use for {language.label}
            </Button>
          ))}
        {formatter.install.url && (
          <Button small kind="ghost" onClick={() => host.command('codeneat.openExternal', { url: formatter.install.url })}>
            {available ? 'Documentation' : 'Installation guide'}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function FormattersPage({ context }: { context: PageContext }) {
  const { state, view } = context;
  const [filter, setFilter] = useState<Filter>('all');
  const [onlyLanguage, setOnlyLanguage] = useState(false);
  const total = state.formatters.length;
  const availableCount = state.formatters.filter((formatter) => state.statuses[formatter.id]?.available).length;
  const shown = state.formatters.filter((formatter) => {
    const available = !!state.statuses[formatter.id]?.available;
    if (filter === 'available' && !available) {
      return false;
    }
    if (filter === 'missing' && available) {
      return false;
    }
    return !onlyLanguage || !view || formatter.languages.includes(view.language.id);
  });

  return (
    <div className="page">
      <header className="page-header">
        <h2>Formatter Management</h2>
        <p>
          CodeNeat uses a real, language-aware formatting engine for every language. {availableCount} of {total} are available on this computer.
        </p>
      </header>
      {!state.trusted && (
        <Banner tone="warn">In Restricted Mode only the bundled formatters can run. Trust this workspace to use the others.</Banner>
      )}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter formatters">
          {(['all', 'available', 'missing'] as const).map((value) => (
            <button key={value} type="button" className={filter === value ? 'is-selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'all' ? `All (${total})` : value === 'available' ? `Installed (${availableCount})` : `Missing (${total - availableCount})`}
            </button>
          ))}
        </div>
        {view && (
          <label className="checkbox">
            <input type="checkbox" checked={onlyLanguage} onChange={(event) => setOnlyLanguage(event.target.checked)} />
            Only for {view.language.label}
          </label>
        )}
        <Button onClick={() => host.post({ type: 'refreshFormatters' })} title="Look for formatters again, for example after installing one">
          Re-detect
        </Button>
        <Button kind="ghost" onClick={() => host.command('codeneat.openDiagnostics')}>
          Diagnostics
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="empty-state">No formatter matches this filter.</p>
      ) : (
        <div className="formatter-list">
          {shown.map((formatter) => (
            <FormatterCard key={formatter.id} context={context} formatter={formatter} />
          ))}
        </div>
      )}
    </div>
  );
}
