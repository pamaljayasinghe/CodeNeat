import { CATALOG, SECTIONS } from '../../../src/shared/catalog';
import { capabilityFor } from '../../../src/shared/resolve';
import type { OptionDefinition, SectionId } from '../../../src/shared/types';
import { Banner, Button, Select, SettingRow } from '../components/controls';
import { OptionRow } from '../components/OptionRow';
import { Preview } from '../components/Preview';
import type { PageContext } from '../context';
import { host } from '../host';
import { profilesOf, setLanguageFormatter, setLanguageProfile, setSlotValue, slotValue } from '../state';

interface OptionListProps {
  context: PageContext;
  options: OptionDefinition[];
  /** When true, options the formatter does not support are left out instead of shown disabled. */
  hideUnsupported?: boolean;
}

/** Renders catalog options for the selected language: available ones first, unavailable ones after. */
export function OptionList({ context, options, hideUnsupported }: OptionListProps) {
  const { view, draft, scope, target, languageId } = context;
  if (!view?.resolved) {
    return null;
  }
  const resolved = view.resolved.options;
  const available = options.filter((option) => resolved[option.id]?.supported);
  const fixed = options.filter((option) => resolved[option.id] && !resolved[option.id].supported && resolved[option.id].source === 'fixed');
  const unavailable = options.filter((option) => resolved[option.id] && !resolved[option.id].supported && resolved[option.id].source !== 'fixed');

  const row = (definition: OptionDefinition) => (
    <OptionRow
      key={definition.id}
      definition={definition}
      view={view}
      resolved={resolved[definition.id]}
      slot={slotValue(draft, scope, target, languageId, definition.id)}
      slotLabel={context.slotLabel}
      onChange={(value) => context.update((current) => setSlotValue(current, scope, target, languageId, definition.id, value))}
      onReset={() => context.update((current) => setSlotValue(current, scope, target, languageId, definition.id, undefined))}
    />
  );

  return (
    <>
      {available.map(row)}
      {fixed.length > 0 && (
        <div className="option-group">
          <h4>Decided by {view.formatter?.displayName}</h4>
          {fixed.map(row)}
        </div>
      )}
      {!hideUnsupported && unavailable.length > 0 && (
        <details className="option-group">
          <summary>
            {unavailable.length} {unavailable.length === 1 ? 'option is' : 'options are'} not available for {view.language.label} with {view.formatter?.displayName}
          </summary>
          {unavailable.map(row)}
        </details>
      )}
    </>
  );
}

function NoFormatter({ context }: { context: PageContext }) {
  return (
    <Banner tone="warn">
      Choose a language at the top of the page to see and change its formatting options.
      {context.state.activeEditor && !context.state.activeEditor.languageId && (
        <p>CodeNeat does not have a formatter for the file that is currently open ({context.state.activeEditor.vscodeLanguageId}).</p>
      )}
    </Banner>
  );
}

/** How many catalog options a formatter supports for a language. */
function supportedCount(context: PageContext, formatterId: string): number {
  const formatter = context.state.formatters.find((candidate) => candidate.id === formatterId);
  if (!formatter) {
    return 0;
  }
  return CATALOG.filter((option) => capabilityFor(formatter, option.id, context.languageId)).length;
}

/**
 * Explains why only some options can be edited, and points to an available formatter for the same
 * language that offers more of them.
 */
function OptionSummary({ context, options }: { context: PageContext; options: OptionDefinition[] }) {
  const { view, state, scope, languageId } = context;
  if (!view?.formatter || !view.resolved) {
    return null;
  }
  const formatter = view.formatter;
  const here = options.filter((option) => view.resolved?.options[option.id]?.supported).length;
  const total = supportedCount(context, formatter.id);
  const better = view.choice.candidates
    .filter((candidate) => candidate.id !== formatter.id && state.statuses[candidate.id]?.available)
    .map((candidate) => ({ candidate, count: supportedCount(context, candidate.id) }))
    .filter((entry) => entry.count > total)
    .sort((a, b) => b.count - a.count)[0];
  return (
    <div className="option-summary">
      <p>
        <strong>
          {here} of {options.length}
        </strong>{' '}
        {options.length === 1 ? 'option' : 'options'} on this page can be changed for {view.language.label}.{' '}
        <span className="muted">
          CodeNeat only offers what the formatter really implements: {formatter.displayName} supports {total} of {CATALOG.length} options and decides the
          rest of the layout itself.
        </span>
      </p>
      {here === 0 && options.length > 0 && (
        <p className="empty-state">
          {formatter.displayName} has a fixed style for everything on this page, so there is nothing to choose here for {view.language.label}.
        </p>
      )}
      {better && (
        <p className="option-switch">
          Want more control? <strong>{better.candidate.displayName}</strong> is available and supports {better.count} options for {view.language.label}.{' '}
          <Button small kind="primary" onClick={() => context.update((current) => setLanguageFormatter(current, scope, languageId, better.candidate.id))}>
            Use {better.candidate.displayName} for {view.language.label}
          </Button>
        </p>
      )}
    </div>
  );
}

function FormatterNotice({ context }: { context: PageContext }) {
  const view = context.view;
  if (!view?.formatter) {
    return null;
  }
  const status = context.state.statuses[view.formatter.id];
  return (
    <>
      {!status?.available && (
        <Banner tone="warn">
          <strong>{view.formatter.displayName} is not installed.</strong> You can still choose your preferences; they apply as soon as the formatter is available.{' '}
          {view.formatter.install.summary}{' '}
          {view.formatter.kind === 'external' && (
            <Button small kind="primary" onClick={() => host.command('codeneat.installFormatter', { formatterId: view.formatter?.id ?? '' })}>
              Install {view.formatter.displayName}…
            </Button>
          )}{' '}
          <Button small kind="ghost" onClick={() => context.navigate('formatters')}>
            Show setup guide
          </Button>
        </Banner>
      )}
      {view.resolved?.projectConfigTakesOver && (
        <Banner>
          This file is formatted according to <code>{view.resolved.projectConfigFile?.split(/[\\/]/).pop()}</code> in your project. CodeNeat
          does not change that file.{' '}
          <Button small kind="primary" onClick={() => context.update((current) => ({ ...current, respectProjectConfig: false }))}>
            Use my CodeNeat preferences instead
          </Button>
        </Banner>
      )}
      {!view.resolved?.projectConfigTakesOver && Object.values(view.resolved?.options ?? {}).some((option) => option.locked) && (
        <Banner>
          Some options are set by a project file (<code>.editorconfig</code> or the formatter’s own configuration) and are locked so the whole team gets
          the same result.{' '}
          <Button small kind="primary" onClick={() => context.update((current) => ({ ...current, respectProjectConfig: false }))}>
            Unlock and use my CodeNeat preferences
          </Button>
        </Banner>
      )}
    </>
  );
}

/** One of the eight style pages: settings on the left, live preview on the right. */
export function StylePage({ context, section }: { context: PageContext; section: SectionId }) {
  const meta = SECTIONS.find((entry) => entry.id === section);
  const options = CATALOG.filter((option) => option.section === section);
  const { view } = context;

  return (
    <div className="style-layout">
      <div className="style-settings">
        <header className="page-header">
          <h2>{meta?.title}</h2>
          <p>{meta?.summary}</p>
        </header>
        {!view?.formatter ? (
          <NoFormatter context={context} />
        ) : (
          <>
            <FormatterNotice context={context} />
            {section === 'language' && <LanguageChoices context={context} />}
            {section === 'wrapping' && view.formatter.lineLength !== 'strict' && (
              <Banner>
                {view.formatter.lineLength === 'none'
                  ? (view.formatter.lineLengthNote ?? `${view.formatter.displayName} does not wrap lines, so there is no line length to set for ${view.language.label}.`)
                  : `Line length is a preferred width, not a strict maximum. ${view.formatter.displayName} wraps code when it can do so safely, and never splits strings or other text that cannot be broken. No integrated formatter offers a strict limit, because enforcing one would mean breaking code blindly.`}
              </Banner>
            )}
            {section !== 'language' && <OptionSummary context={context} options={options} />}
            <OptionList context={context} options={options} hideUnsupported={section === 'language'} />
            {section === 'language' && options.every((option) => !view.resolved?.options[option.id]?.supported) && (
              <p className="empty-state">{view.formatter.displayName} has no extra options for {view.language.label}.</p>
            )}
            {view.formatter.limitations.length > 0 && section === 'language' && (
              <div className="limitations">
                <h4>Good to know about {view.formatter.displayName}</h4>
                <ul>
                  {view.formatter.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      {view?.formatter && <Preview state={context.state} draft={context.draft} view={view} />}
    </div>
  );
}

/** Formatter and profile choice for the selected language. */
function LanguageChoices({ context }: { context: PageContext }) {
  const { view, state, draft, scope, languageId } = context;
  if (!view) {
    return null;
  }
  const chosenFormatter = draft[scope].languages[languageId]?.formatter ?? '';
  const chosenProfile = draft[scope].languages[languageId]?.profile ?? '';
  const scopeName = scope === 'user' ? 'your settings' : 'this workspace';
  return (
    <>
      <SettingRow
        label={`Formatter for ${view.language.label}`}
        description={
          <>
            Which formatting engine CodeNeat uses for this language ({scopeName}). “Automatic” picks the first one that is installed.
            {view.formatter && (
              <>
                {' '}
                Currently in use: <strong>{view.formatter.displayName}</strong>.
              </>
            )}
          </>
        }
      >
        <Select
          label={`Formatter for ${view.language.label}`}
          value={chosenFormatter}
          choices={[
            { value: '', label: 'Automatic' },
            ...view.choice.candidates.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.displayName}${state.statuses[candidate.id]?.available ? '' : ' (not installed)'}`,
            })),
          ]}
          onChange={(value) => context.update((current) => setLanguageFormatter(current, scope, languageId, value || undefined))}
        />
      </SettingRow>
      <SettingRow
        label={`Profile for ${view.language.label}`}
        description={`Use a different formatting profile just for this language (${scopeName}). In effect now: ${view.resolved?.profile.name ?? 'Standard'}.`}
      >
        <Select
          label={`Profile for ${view.language.label}`}
          value={chosenProfile}
          choices={[{ value: '', label: 'Same as default profile' }, ...profilesOf(state, draft).map((profile) => ({ value: profile.id, label: profile.name }))]}
          onChange={(value) => context.update((current) => setLanguageProfile(current, scope, languageId, value || undefined))}
        />
      </SettingRow>
      {view.formatter?.homepage && (
        <p className="muted">
          Engine: {view.formatter.engine} · Licence: {view.formatter.license} ·{' '}
          <Button small kind="ghost" onClick={() => host.command('codeneat.openExternal', { url: view.formatter?.homepage ?? '' })}>
            Formatter website
          </Button>
        </p>
      )}
    </>
  );
}

/** Search results across every style section. */
export function SearchResults({ context, query }: { context: PageContext; query: string }) {
  const needle = query.trim().toLowerCase();
  const matches = CATALOG.filter((option) =>
    [option.label, option.description, option.id, ...(option.keywords ?? [])].some((text) => text.toLowerCase().includes(needle)),
  );
  return (
    <div className="style-layout">
      <div className="style-settings">
        <header className="page-header">
          <h2>Search results</h2>
          <p role="status">
            {matches.length} {matches.length === 1 ? 'setting matches' : 'settings match'} “{query.trim()}”.
          </p>
        </header>
        {!context.view?.formatter ? (
          <NoFormatter context={context} />
        ) : matches.length === 0 ? (
          <p className="empty-state">
            No formatting setting matches your search. Try a different word, for example “indent”, “quote” or “line”.
          </p>
        ) : (
          SECTIONS.map((section) => {
            const options = matches.filter((option) => option.section === section.id);
            return options.length === 0 ? null : (
              <div key={section.id} className="search-section">
                <h3>
                  <button type="button" className="link" onClick={() => context.navigate(section.id)}>
                    {section.title}
                  </button>
                </h3>
                <OptionList context={context} options={options} />
              </div>
            );
          })
        )}
      </div>
      {context.view?.formatter && <Preview state={context.state} draft={context.draft} view={context.view} />}
    </div>
  );
}
