import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardState, PreviewResult, SettingsDraft } from '../../../src/shared/types';
import { diffMarks, highlightLines } from '../highlight';
import { host } from '../host';
import type { LanguageView } from '../state';
import { Badge, Banner, Button, CodeLine } from './controls';

interface PreviewProps {
  state: DashboardState;
  draft: SettingsDraft;
  view: LanguageView;
}

const DEBOUNCE_MS = 350;
let nextRequestId = 1;

function CodePane({ title, lines, marks, tone }: { title: string; lines: string[]; marks: Set<number>; tone: 'removed' | 'added' }) {
  return (
    <div className="code-pane">
      <div className="code-pane-title">{title}</div>
      <div className="code-scroll" tabIndex={0} role="region" aria-label={title}>
        <table className="code-table">
          <tbody>
            {lines.map((html, index) => (
              <tr key={index} className={marks.has(index) ? `line-${tone}` : undefined}>
                <td className="line-number" aria-hidden="true">
                  {index + 1}
                </td>
                {/* highlight.js escapes the source text; the webview CSP forbids inline scripts regardless. */}
                <td className="line-code" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Live before/after preview that runs the real formatter with the unsaved (draft) settings. */
export function Preview({ state, draft, view }: PreviewProps) {
  const languageId = view.language.id;
  const formatterId = view.formatter?.id;
  const editorMatches = state.activeEditor?.languageId === languageId;
  const [source, setSource] = useState<'sample' | 'editor'>('sample');
  const [result, setResult] = useState<PreviewResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const pending = useRef(0);
  const effectiveSource = source === 'editor' && editorMatches ? 'editor' : 'sample';
  const draftKey = useMemo(() => JSON.stringify(draft), [draft]);
  const sample = state.samples[languageId] ?? '';

  useEffect(() => {
    return host.subscribe((message) => {
      // Answers to superseded requests are stale and must be ignored.
      if (message.type === 'previewResult' && message.result.requestId === pending.current) {
        setResult(message.result);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!formatterId) {
      setResult(undefined);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const requestId = nextRequestId++;
      pending.current = requestId;
      host.post({
        type: 'preview',
        request: {
          requestId,
          languageId,
          formatterId,
          source: effectiveSource,
          code: effectiveSource === 'sample' ? sample : undefined,
          draft: JSON.parse(draftKey) as SettingsDraft,
        },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `nonce` lets the Reset button force a fresh run.
  }, [languageId, formatterId, effectiveSource, draftKey, sample, state.activeEditor?.uri, effectiveSource === 'editor' ? state.activeEditor?.revision : 0, state.statuses, nonce]);

  useEffect(
    () => () => {
      host.post({ type: 'cancelPreview' });
    },
    [],
  );

  const grammar = view.language.highlight;
  const original = result?.original ?? (effectiveSource === 'sample' ? sample : '');
  const formatted = result?.ok ? (result.formatted ?? '') : '';
  const originalLines = useMemo(() => highlightLines(original, grammar), [original, grammar]);
  const formattedLines = useMemo(() => highlightLines(formatted, grammar), [formatted, grammar]);
  const marks = useMemo(() => diffMarks(original, formatted), [original, formatted]);
  const changedCount = marks.right.size || marks.left.size;

  if (!view.formatter) {
    return (
      <aside className="preview" aria-label="Live preview">
        <Banner tone="warn">CodeNeat has no formatter for {view.language.label}.</Banner>
      </aside>
    );
  }

  const lineLengthNote =
    view.formatter.lineLength === 'none'
      ? (view.formatter.lineLengthNote ?? `${view.formatter.displayName} does not wrap lines.`)
      : undefined;

  return (
    <aside className="preview" aria-label="Live preview">
      <div className="preview-toolbar">
        <div className="preview-title">
          <h3>Live preview</h3>
          <Badge tone="info" title="The formatter that produced this preview">
            {result?.formatterName ?? view.formatter.displayName}
          </Badge>
          {loading && (
            <span className="spinner" role="status" aria-live="polite">
              Formatting…
            </span>
          )}
          {!loading && result?.ok && (
            <span className="muted" role="status" aria-live="polite">
              {result.changed ? `${changedCount} ${changedCount === 1 ? 'line' : 'lines'} changed` : 'Already formatted'}
              {typeof result.durationMs === 'number' ? ` · ${result.durationMs} ms` : ''}
            </span>
          )}
        </div>
        <div className="preview-actions">
          <div className="segmented" role="group" aria-label="Code to preview">
            <button type="button" className={effectiveSource === 'sample' ? 'is-selected' : ''} aria-pressed={effectiveSource === 'sample'} onClick={() => setSource('sample')}>
              Sample
            </button>
            <button
              type="button"
              className={effectiveSource === 'editor' ? 'is-selected' : ''}
              aria-pressed={effectiveSource === 'editor'}
              disabled={!editorMatches}
              title={editorMatches ? `Preview ${state.activeEditor?.fileName}` : `Open a ${view.language.label} file to preview your own code`}
              onClick={() => setSource('editor')}
            >
              Current file
            </button>
          </div>
          <Button
            small
            kind="ghost"
            title="Go back to the sample code and run the preview again"
            onClick={() => {
              setSource('sample');
              setResult(undefined);
              setNonce((value) => value + 1);
            }}
          >
            Reset
          </Button>
          <Button small kind="ghost" disabled={!result?.ok} onClick={() => host.copy(formatted)} title="Copy the formatted code">
            Copy
          </Button>
          <Button
            small
            kind="primary"
            disabled={!editorMatches || !result?.ok}
            title={editorMatches ? `Format ${state.activeEditor?.fileName} with these settings` : `Open a ${view.language.label} file first`}
            onClick={() => host.post({ type: 'applyToDocument', draft })}
          >
            Apply to file
          </Button>
        </div>
      </div>

      {lineLengthNote && <p className="preview-note">{lineLengthNote}</p>}

      {result && !result.ok ? (
        <div className="preview-problem">
          <Banner tone={result.errorKind === 'missing' || result.errorKind === 'untrusted' ? 'warn' : 'error'}>
            <strong>
              {result.errorKind === 'missing'
                ? `${view.formatter.displayName} is not installed`
                : result.errorKind === 'untrusted'
                  ? 'Not available yet'
                  : 'The preview could not be created'}
            </strong>
            <p className="pre-wrap">{result.error}</p>
          </Banner>
          {result.errorKind === 'missing' && result.install && (
            <div className="install-guide">
              <p>{result.install.summary}</p>
              {result.install.commands.map((command) => (
                <div key={command.label} className="install-command">
                  <span className="muted">{command.label}</span>
                  <CodeLine text={command.command} onCopy={host.copy} />
                </div>
              ))}
              <div className="button-row">
                {view.formatter.kind === 'external' && (
                  <Button small kind="primary" onClick={() => host.command('codeneat.installFormatter', { formatterId: view.formatter?.id ?? '' })}>
                    Install {view.formatter.displayName}…
                  </Button>
                )}
                {result.install.url && (
                  <Button small onClick={() => host.command('codeneat.openExternal', { url: result.install?.url ?? '' })}>
                    Installation guide
                  </Button>
                )}
                <Button small onClick={() => host.post({ type: 'refreshFormatters' })}>
                  I installed it — check again
                </Button>
              </div>
              <p className="muted">Install shows you the exact command first and runs it only after you confirm. Nothing is shown as formatted until the real formatter has run.</p>
            </div>
          )}
          {result.errorKind === 'untrusted' && (
            <Button small onClick={() => host.command('codeneat.manageWorkspaceTrust')}>
              Manage Workspace Trust
            </Button>
          )}
          {result.original && <CodePane title="Original code" lines={originalLines} marks={new Set()} tone="removed" />}
        </div>
      ) : (
        <div className="preview-panes">
          <CodePane title={effectiveSource === 'editor' ? `Original · ${result?.fileName ?? state.activeEditor?.fileName ?? ''}` : 'Original code'} lines={originalLines} marks={marks.left} tone="removed" />
          <CodePane title="Formatted code" lines={result?.ok ? formattedLines : ['']} marks={marks.right} tone="added" />
        </div>
      )}
    </aside>
  );
}
