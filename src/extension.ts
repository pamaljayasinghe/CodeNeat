import * as vscode from 'vscode';
import { chooseFormatter } from './shared/resolve';
import { CodeNeatApp } from './vscode/app';
import { PREVIEW_SCHEME, registerCommands } from './vscode/commands';
import { DashboardPanel } from './vscode/dashboard';
import { InlineReview } from './vscode/inlineReview';
import { LivePreview, type SaveReview } from './vscode/livePreview';
import { registerProviders } from './vscode/providers';
import { SidebarProvider } from './vscode/sidebar';

/** What the extension exposes to other extensions and to the end-to-end tests. */
export interface CodeNeatApi {
  readonly version: string;
  /** Resolves when the first formatter detection has finished. */
  readonly ready: Promise<void>;
  /** True while the settings dashboard panel is open. */
  isDashboardOpen(): boolean;
  /** True once the dashboard UI has loaded its state from the extension host. */
  isDashboardRendered(): boolean;
  /** True while the active editor shows formatting changes that wait for Keep or Undo. */
  isInlineReviewActive(): boolean;
  /** The last "review changes on save" prompt that was offered, if any. */
  lastSaveReview(): SaveReview | undefined;
  /** Formatter ids that are currently available. */
  availableFormatters(): string[];
}

function isRealEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  if (!editor) {
    return false;
  }
  const scheme = editor.document.uri.scheme;
  return scheme !== 'output' && scheme !== PREVIEW_SCHEME;
}

export function activate(context: vscode.ExtensionContext): CodeNeatApi {
  const app = new CodeNeatApp(context);
  const dashboard = new DashboardPanel(app);
  const openDashboard = (page?: string, languageId?: string): void => dashboard.show(page, languageId);
  const sidebar = new SidebarProvider(app, openDashboard);
  const live = new LivePreview(app);
  const review = new InlineReview(app);

  let providers = registerProviders(app);
  const reRegisterProviders = (): void => {
    providers.dispose();
    providers = registerProviders(app);
  };

  const statusBar = vscode.window.createStatusBarItem('codeneat.status', vscode.StatusBarAlignment.Right, 90);
  statusBar.name = 'CodeNeat';
  statusBar.command = 'codeneat.showMenu';
  const updateStatusBar = (): void => {
    const editor = vscode.window.activeTextEditor;
    const settings = app.config.read(editor?.document.uri);
    const language = editor ? app.languageOf(editor.document) : undefined;
    // Drives the Format button in the editor title bar: only shown for files CodeNeat can format.
    void vscode.commands.executeCommand('setContext', 'codeneat.activeFileSupported', !!language && settings.enabled && editor?.document.uri.scheme !== PREVIEW_SCHEME);
    if (!settings.showStatusBar || !editor || !language) {
      statusBar.hide();
      return;
    }
    const choice = chooseFormatter(language, app.registry.descriptors, app.registry.statuses, settings.user, settings.workspace);
    const formatter = choice.formatter;
    const available = formatter ? app.registry.statuses[formatter.id]?.available : false;
    statusBar.text = `${available ? '$(sparkle)' : '$(warning)'} CodeNeat: ${formatter?.displayName ?? 'no formatter'}`;
    statusBar.tooltip = formatter
      ? available
        ? `CodeNeat formats ${language.label} with ${formatter.displayName}. Click for CodeNeat actions.`
        : `${formatter.displayName} is not installed. ${formatter.install.summary} Click for CodeNeat actions.`
      : `CodeNeat has no formatter for ${language.label}.`;
    statusBar.show();
  };

  const ready = app
    .refreshFormatters()
    .then(updateStatusBar)
    .catch((error) => app.log.error(`Formatter detection failed: ${String(error)}`));

  context.subscriptions.push(
    dashboard,
    sidebar,
    statusBar,
    { dispose: () => providers.dispose() },
    live,
    review,
    registerCommands(app, openDashboard, live, review),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isRealEditor(editor)) {
        app.lastEditor = editor;
      }
      updateStatusBar();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (app.lastEditor?.document === document) {
        app.lastEditor = isRealEditor(vscode.window.activeTextEditor) ? vscode.window.activeTextEditor : undefined;
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeneat.customFormatters')) {
        app.reloadCustomFormatters();
        reRegisterProviders();
        void app.refreshFormatters();
      } else if (event.affectsConfiguration('codeneat.toolPaths')) {
        void app.refreshFormatters();
      }
      if (event.affectsConfiguration('codeneat')) {
        updateStatusBar();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      app.reloadCustomFormatters();
      reRegisterProviders();
      void app.refreshFormatters();
    }),
    app.onDidChangeFormatters(updateStatusBar),
  );

  app.log.info(`CodeNeat ${app.version} activated.`);
  return {
    version: app.version,
    ready,
    isDashboardOpen: () => dashboard.isOpen,
    isDashboardRendered: () => dashboard.isRendered,
    isInlineReviewActive: () => review.isActive(),
    lastSaveReview: () => live.lastSaveReview,
    availableFormatters: () =>
      Object.values(app.registry.statuses)
        .filter((status) => status.available)
        .map((status) => status.id),
  };
}

export function deactivate(): void {
  // All resources are released through context.subscriptions.
}
