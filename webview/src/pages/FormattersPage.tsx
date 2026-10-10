import { useState } from 'react';
import { CATALOG } from '../../../src/shared/catalog';
import { chooseFormatter } from '../../../src/shared/resolve';
import type { DashboardState, FormatterDescriptor } from '../../../src/shared/types';
import { Badge, Banner, Button, Card, CodeLine } from '../components/controls';
import type { PageContext } from '../context';
import { host } from '../host';
import { setLanguageFormatter } from '../state';

type Category = 'builtin' | 'installed' | 'required' | 'optional';
type Filter = 'all' | Category;

const CATEGORY_TITLES: Record<Category, { title: string; summary: string }> = {
  builtin: { title: 'Built in', summary: 'Included with CodeNeat. Nothing to install.' },
  installed: { title: 'Installed on this computer', summary: 'Found on your computer and used in place of the built-in engine where there is one.' },
  required: { title: 'Needs to be installed', summary: 'These languages have no built-in formatter. Install the tool once to format them.' },
  optional: {
    title: 'Optional alternatives',
    summary: 'You do not need these. Their languages already work with a built-in formatter; install one only if you prefer that tool.',
  },
};

/** True when at least one formatter for the language can run right now. */
function isCovered(state: DashboardState, languageId: string): boolean {
  return state.formatters.some((formatter) => formatter.languages.includes(languageId) && state.statuses[formatter.id]?.available);
}

/**
 * Sorts a formatter into what it means for the user: built in, installed, really needed, or just
 * an optional alternative for languages that already work.
 */
function categoryOf(state: DashboardState, formatter: FormatterDescriptor): Category {
  if (state.statuses[formatter.id]?.available) {
    return formatter.kind === 'bundled' ? 'builtin' : 'installed';
  }
  return formatter.languages.some((languageId) => !isCovered(state, languageId)) ? 'required' : 'optional';
}

/** The available formatters that already handle the languages of an optional one. */
function coveredBy(state: DashboardState, formatter: FormatterDescriptor): string {
  const names = new Set<string>();
  for (const languageId of formatter.languages) {
    const active = state.formatters.find((candidate) => candidate.languages.includes(languageId) && state.statuses[candidate.id]?.available);
    if (active) {
      names.add(active.displayName);
    }
  }
  return [...names].join(', ');
}

function originLabel(origin: string | undefined): string {
  switch (origin) {
    case 'bundled':
      return 'Built into CodeNeat';
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
  const category = categoryOf(state, formatter);
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
          {formatter.kind === 'custom' && <Badge tone="info">Custom</Badge>}
          {category === 'builtin' && <Badge tone="ok">Built in</Badge>}
          {category === 'installed' && <Badge tone="ok">Installed</Badge>}
          {category === 'required' && <Badge tone="warn">Needs install</Badge>}
          {category === 'optional' && <Badge>Optional · not needed</Badge>}
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

      {category === 'optional' && (
        <Banner>
          <strong>You do not need to install this.</strong> {languages.map((language) => language.label).join(', ')} already{' '}
          {languages.length === 1 ? 'formats' : 'format'} with {coveredBy(state, formatter)}. {formatter.displayName} is an alternative you can add if you
          prefer it.
        </Banner>
      )}
      {category === 'required' && (
        <Banner tone="warn">
          <strong>{formatter.displayName} is not installed.</strong>{' '}
          {status?.problem && !status.problem.includes('was not found') ? status.problem : formatter.install.summary}
        </Banner>
      )}
      {!available &&
        (() => {
          const guide = (
            <div className="install-guide">
              {formatter.install.commands.length > 0 && <p>{formatter.install.summary} Use the Install button, or run one of these yourself in a terminal:</p>}
              {formatter.install.commands.map((command) => (
                <div key={command.label} className="install-command">
                  <span className="muted">{command.label}</span>
                  <CodeLine text={command.command} onCopy={host.copy} />
                </div>
              ))}
              {formatter.kind === 'external' && (
                <div className="button-row">
                  <Button kind={category === 'required' ? 'primary' : 'secondary'} disabled={!state.trusted} onClick={() => host.command('codeneat.installFormatter', { formatterId: formatter.id })}>
                    Install {formatter.displayName}…
                  </Button>
                </div>
              )}
              <p className="muted">
                “Install” shows you the exact command and runs it in a terminal only after you confirm. CodeNeat never installs anything on its own.
              </p>
            </div>
          );
          return category === 'optional' ? (
            <details className="faq">
              <summary>How to install it anyway</summary>
              {guide}
            </details>
          ) : (
            guide
          );
        })()}

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
  const order: Category[] = ['builtin', 'installed', 'required', 'optional'];
  const byCategory = (category: Category): FormatterDescriptor[] =>
    state.formatters.filter(
      (formatter) => categoryOf(state, formatter) === category && (!onlyLanguage || !view || formatter.languages.includes(view.language.id)),
    );
  const counts = Object.fromEntries(order.map((category) => [category, state.formatters.filter((formatter) => categoryOf(state, formatter) === category).length])) as Record<Category, number>;
  const ready = state.languages.filter((language) => isCovered(state, language.id));
  const waiting = state.languages.filter((language) => !isCovered(state, language.id));
  const shownCategories = order.filter((category) => filter === 'all' || filter === category);
  const anyShown = shownCategories.some((category) => byCategory(category).length > 0);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Formatter Management</h2>
        <p>CodeNeat uses a real, language-aware formatting engine for every language.</p>
      </header>
      <Card title={`${ready.length} of ${state.languages.length} languages are ready to format`}>
        <p>
          Everything listed under <strong>Built in</strong> comes with CodeNeat, including Java, Python, JavaScript, C, C++, Go and the other popular languages.
          You do not have to install anything for them.
        </p>
        {waiting.length > 0 ? (
          <p>
            <strong>Need their own formatter:</strong> {waiting.map((language) => language.label).join(', ')}. These are listed under “Needs to be
            installed”, each with an Install button.
          </p>
        ) : (
          <p>Every language has a formatter available on this computer.</p>
        )}
        <p className="muted">
          Formatters marked “Optional” are alternatives for languages that already work. They are shown so you can choose them if you prefer; it is fine to
          ignore them.
        </p>
      </Card>
      {!state.trusted && (
        <Banner tone="warn">In Restricted Mode only the built-in formatters can run. Trust this workspace to use the others.</Banner>
      )}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter formatters">
          <button type="button" className={filter === 'all' ? 'is-selected' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({state.formatters.length})
          </button>
          {order.map((category) => (
            <button key={category} type="button" className={filter === category ? 'is-selected' : ''} aria-pressed={filter === category} onClick={() => setFilter(category)}>
              {category === 'builtin' ? 'Built in' : category === 'installed' ? 'Installed' : category === 'required' ? 'Needs install' : 'Optional'} ({counts[category]})
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
      {!anyShown ? (
        <p className="empty-state">No formatter matches this filter.</p>
      ) : (
        shownCategories.map((category) => {
          const list = byCategory(category);
          return list.length === 0 ? null : (
            <section key={category} className="formatter-section" aria-label={CATEGORY_TITLES[category].title}>
              <h3>
                {CATEGORY_TITLES[category].title} ({list.length})
              </h3>
              <p className="muted">{CATEGORY_TITLES[category].summary}</p>
              <div className="formatter-list">
                {list.map((formatter) => (
                  <FormatterCard key={formatter.id} context={context} formatter={formatter} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
