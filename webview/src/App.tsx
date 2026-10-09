import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardState, SettingsDraft } from '../../src/shared/types';
import { Badge, Button, Select } from './components/controls';
import type { PageContext } from './context';
import { host } from './host';
import { AdvancedPage, AutoPage, HelpPage, OverviewPage, WorkspacePage } from './pages/BasicPages';
import { FormattersPage } from './pages/FormattersPage';
import { addImportedProfile, ProfilesPage } from './pages/ProfilesPage';
import { SearchResults, StylePage } from './pages/StylePage';
import { draftFromState, isPageId, PAGES, type PageId, sameDraft, type Scope, STYLE_PAGES, type Target, viewLanguage } from './state';

interface UiState {
  page: PageId;
  manualLanguage?: string;
  scope: Scope;
  target: Target;
}

interface Notice {
  id: number;
  level: 'info' | 'error';
  message: string;
}

const FALLBACK_LANGUAGE = 'javascript';
let noticeCounter = 0;

export function App() {
  const saved = host.getUiState<Partial<UiState>>();
  const [state, setState] = useState<DashboardState | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [baseline, setBaseline] = useState<SettingsDraft | null>(null);
  const [page, setPage] = useState<PageId>(saved?.page && isPageId(saved.page) ? saved.page : 'overview');
  const [manualLanguage, setManualLanguage] = useState<string | undefined>(saved?.manualLanguage);
  const [scope, setScope] = useState<Scope>(saved?.scope === 'workspace' ? 'workspace' : 'user');
  const [target, setTarget] = useState<Target>(saved?.target === 'language' ? 'language' : 'all');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const draftRef = useRef<SettingsDraft | null>(null);
  const baselineRef = useRef<SettingsDraft | null>(null);
  draftRef.current = draft;
  baselineRef.current = baseline;

  const notify = useCallback((level: Notice['level'], message: string) => {
    const id = ++noticeCounter;
    setNotices((current) => [...current.slice(-2), { id, level, message }]);
    setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), level === 'error' ? 9000 : 4500);
  }, []);

  useEffect(() => {
    const unsubscribe = host.subscribe((message) => {
      switch (message.type) {
        case 'state': {
          const fresh = draftFromState(message.state);
          const dirty = !!draftRef.current && !!baselineRef.current && !sameDraft(draftRef.current, baselineRef.current);
          setState(message.state);
          setBaseline(fresh);
          if (message.reason !== 'refresh' || !dirty) {
            setDraft(fresh);
          }
          if (message.reason !== 'refresh') {
            setSaving(false);
          }
          if (message.reason === 'applied') {
            notify('info', 'Your settings were saved.');
          }
          break;
        }
        case 'activeEditor':
          setState((current) => (current ? { ...current, activeEditor: message.activeEditor, project: message.project } : current));
          break;
        case 'navigate':
          if (isPageId(message.page)) {
            setPage(message.page);
            setQuery('');
          }
          if (message.languageId) {
            setManualLanguage(message.languageId);
          }
          break;
        case 'profileImported':
          setDraft((current) => (current ? addImportedProfile(current, message.profile) : current));
          setPage('profiles');
          notify('info', `Imported the profile “${message.profile.name}”. Press Apply to keep it.`);
          break;
        case 'notice':
          setSaving(false);
          notify(message.level, message.message);
          break;
      }
    });
    host.post({ type: 'ready' });
    return unsubscribe;
  }, [notify]);

  const dirty = !!draft && !!baseline && !sameDraft(draft, baseline);

  useEffect(() => {
    if (state) {
      host.post({ type: 'dirty', dirty });
    }
  }, [dirty, state === null]);

  useEffect(() => {
    host.setUiState({ page, manualLanguage, scope, target } satisfies UiState);
  }, [page, manualLanguage, scope, target]);

  const apply = useCallback(() => {
    if (draftRef.current && baselineRef.current && !sameDraft(draftRef.current, baselineRef.current)) {
      setSaving(true);
      host.post({ type: 'apply', draft: draftRef.current });
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement | null;
      const typing = !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        apply();
      } else if (event.key === 'Escape' && element === searchRef.current) {
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply]);

  const languageId = useMemo(() => {
    if (!state) {
      return FALLBACK_LANGUAGE;
    }
    const known = (id: string | undefined): id is string => !!id && state.languages.some((language) => language.id === id);
    if (known(manualLanguage)) {
      return manualLanguage;
    }
    return known(state.activeEditor?.languageId) ? state.activeEditor.languageId : FALLBACK_LANGUAGE;
  }, [state, manualLanguage]);

  const view = useMemo(() => (state && draft ? viewLanguage(state, draft, languageId) : undefined), [state, draft, languageId]);

  if (!state || !draft) {
    return (
      <div className="loading" role="status">
        Loading CodeNeat settings…
      </div>
    );
  }

  const effectiveScope: Scope = scope === 'workspace' && state.hasWorkspace ? 'workspace' : 'user';
  // Language-specific options only make sense for the language they belong to.
  const effectiveTarget: Target = page === 'language' ? 'language' : target;
  const languageLabel = view?.language.label ?? languageId;
  const slotLabel = `${effectiveScope === 'user' ? 'your settings' : 'the workspace settings'}${effectiveTarget === 'language' ? ` for ${languageLabel}` : ''}`;
  const searching = query.trim().length > 0;
  const showStyleBar = searching || STYLE_PAGES.includes(page);

  const context: PageContext = {
    state,
    draft,
    update: (change) => setDraft((current) => (current ? change(current) : current)),
    scope: effectiveScope,
    target: effectiveTarget,
    languageId,
    view,
    navigate: (next) => {
      setPage(next);
      setQuery('');
      mainRef.current?.scrollTo({ top: 0 });
      mainRef.current?.focus();
    },
    selectLanguage: setManualLanguage,
    slotLabel,
  };

  const followLabel = state.activeEditor?.languageId
    ? `Follow current file (${state.languages.find((language) => language.id === state.activeEditor?.languageId)?.label ?? ''})`
    : 'Follow current file';
  const groups = ['Web', 'Backend', 'Scripting and data'].map((group) => ({
    label: group,
    choices: state.languages.filter((language) => language.group === group).map((language) => ({ value: language.id, label: language.label })),
  }));

  let content: JSX.Element;
  if (searching) {
    content = <SearchResults context={context} query={query} />;
  } else {
    switch (page) {
      case 'overview':
        content = <OverviewPage context={context} />;
        break;
      case 'auto':
        content = <AutoPage context={context} />;
        break;
      case 'profiles':
        content = <ProfilesPage context={context} />;
        break;
      case 'formatters':
        content = <FormattersPage context={context} />;
        break;
      case 'workspace':
        content = <WorkspacePage context={context} />;
        break;
      case 'advanced':
        content = <AdvancedPage context={context} />;
        break;
      case 'help':
        content = <HelpPage context={context} />;
        break;
      default:
        content = <StylePage context={context} section={page} />;
    }
  }

  const navGroups = [...new Set(PAGES.map((entry) => entry.group))];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {'{ }'}
          </span>
          <div>
            <h1>CodeNeat</h1>
            <span className="brand-tagline">One Extension. Every Language. Your Style.</span>
          </div>
        </div>

        <div className="topbar-field">
          <span className="field-label" id="language-label">
            Language
          </span>
          <Select
            label="Language to configure"
            value={manualLanguage && state.languages.some((language) => language.id === manualLanguage) ? manualLanguage : ''}
            choices={[{ value: '', label: followLabel }]}
            groups={groups}
            onChange={(value) => setManualLanguage(value || undefined)}
          />
          {view?.formatter && (
            <Badge tone={view.available ? 'ok' : 'warn'} title={view.available ? `${view.formatter.displayName} is ready` : `${view.formatter.displayName} is not installed`}>
              {view.formatter.displayName}
              {view.available ? '' : ' · not installed'}
            </Badge>
          )}
        </div>

        <div className="topbar-search">
          <input
            ref={searchRef}
            type="search"
            className="text-input search-input"
            placeholder="Search settings ( / )"
            aria-label="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="topbar-actions">
          {dirty ? (
            <span className="unsaved" role="status">
              <span className="unsaved-dot" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : (
            <span className="saved" role="status">
              All changes saved
            </span>
          )}
          <Button onClick={() => setDraft(baseline)} disabled={!dirty || saving} title="Discard the changes you have not applied">
            Cancel
          </Button>
          <Button kind="primary" onClick={apply} disabled={!dirty || saving} title="Save your changes (Ctrl/Cmd + S)">
            {saving ? 'Saving…' : 'Apply'}
          </Button>
        </div>
      </header>

      <div className="body">
        <nav className="sidenav" aria-label="Settings sections">
          {navGroups.map((group) => (
            <div key={group} className="nav-group">
              <div className="nav-group-title">{group}</div>
              <ul>
                {PAGES.filter((entry) => entry.group === group).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`nav-item${!searching && page === entry.id ? ' is-active' : ''}`}
                      aria-current={!searching && page === entry.id ? 'page' : undefined}
                      onClick={() => context.navigate(entry.id)}
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className="main" ref={mainRef} tabIndex={-1}>
          {showStyleBar && (
            <div className="scopebar" role="group" aria-label="Where changes are saved">
              <div className="scopebar-item">
                <span className="field-label">Save to</span>
                <div className="segmented" role="group" aria-label="Save to">
                  <button type="button" className={effectiveScope === 'user' ? 'is-selected' : ''} aria-pressed={effectiveScope === 'user'} onClick={() => setScope('user')}>
                    My settings
                  </button>
                  <button
                    type="button"
                    className={effectiveScope === 'workspace' ? 'is-selected' : ''}
                    aria-pressed={effectiveScope === 'workspace'}
                    disabled={!state.hasWorkspace}
                    title={state.hasWorkspace ? 'Saved in this workspace and shared with your team' : 'Open a folder to use workspace settings'}
                    onClick={() => setScope('workspace')}
                  >
                    Workspace
                  </button>
                </div>
              </div>
              <div className="scopebar-item">
                <span className="field-label">Applies to</span>
                <div className="segmented" role="group" aria-label="Applies to">
                  <button
                    type="button"
                    className={effectiveTarget === 'all' ? 'is-selected' : ''}
                    aria-pressed={effectiveTarget === 'all'}
                    disabled={page === 'language' && !searching}
                    onClick={() => setTarget('all')}
                  >
                    All languages
                  </button>
                  <button type="button" className={effectiveTarget === 'language' ? 'is-selected' : ''} aria-pressed={effectiveTarget === 'language'} onClick={() => setTarget('language')}>
                    Only {languageLabel}
                  </button>
                </div>
              </div>
              <span className="muted scopebar-hint">
                Showing what is in effect for <strong>{languageLabel}</strong>. Changes are stored in {slotLabel}.
              </span>
            </div>
          )}
          {content}
        </main>
      </div>

      <div className="toasts" aria-live="polite">
        {notices.map((notice) => (
          <div key={notice.id} className={`toast toast-${notice.level}`} role={notice.level === 'error' ? 'alert' : 'status'}>
            {notice.message}
          </div>
        ))}
      </div>
    </div>
  );
}
