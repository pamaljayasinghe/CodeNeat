import * as vscode from 'vscode';
import { findOnPath } from '../core/executables';
import type { FormatterDescriptor } from '../shared/types';
import type { CodeNeatApp } from './app';

export interface InstallPlan {
  label: string;
  /** Exactly what will be typed into the terminal. */
  commandLine: string;
}

const UNIX_ONLY = new Set(['brew', 'apt', 'apt-get', 'curl']);
const WINDOWS_ONLY = new Set(['winget', 'choco', 'scoop']);

/** The program an install command needs, e.g. "brew" for "brew install shfmt". */
function requiredProgram(command: string): string {
  const words = command.trim().split(/\s+/);
  return words[0] === 'sudo' ? (words[1] ?? '') : words[0];
}

/**
 * Chooses the first install command from the formatter's guide that can run on this computer
 * (its package manager is installed). Returns undefined when none can.
 */
export async function planInstall(
  descriptor: FormatterDescriptor,
  platform: NodeJS.Platform = process.platform,
  has: (program: string) => Promise<boolean> = async (program) => !!(await findOnPath(program)),
): Promise<InstallPlan | undefined> {
  for (const entry of descriptor.install.commands) {
    const command = entry.command;
    // Commands that are typed inside another program are wrapped so they can run from a terminal.
    if (command.startsWith('Install-Module')) {
      const shell = (await has('pwsh')) ? 'pwsh' : (await has('powershell')) ? 'powershell' : undefined;
      if (shell) {
        return { label: entry.label, commandLine: `${shell} -NoProfile -Command "${command} -Force"` };
      }
      continue;
    }
    if (command.startsWith('install.packages(')) {
      if (await has('Rscript')) {
        return { label: entry.label, commandLine: `Rscript -e "install.packages('styler', repos = 'https://cloud.r-project.org')"` };
      }
      continue;
    }
    const program = requiredProgram(command);
    // Windows PowerShell one-liners only make sense on Windows.
    if (program === 'powershell' && platform !== 'win32') {
      continue;
    }
    if (!program || (platform === 'win32' && UNIX_ONLY.has(program)) || (platform !== 'win32' && WINDOWS_ONLY.has(program))) {
      continue;
    }
    if (program === 'apt' && platform !== 'linux') {
      continue;
    }
    if (program === 'pip') {
      const pip = (await has('pip3')) ? 'pip3' : (await has('pip')) ? 'pip' : undefined;
      if (pip) {
        return { label: entry.label, commandLine: command.replace(/^pip\b/, pip) };
      }
      continue;
    }
    if (await has(program)) {
      return { label: entry.label, commandLine: command };
    }
  }
  return undefined;
}

function runInTerminal(name: string, commandLine: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const task = new vscode.Task({ type: 'codeneat-install' }, vscode.TaskScope.Global, name, 'CodeNeat', new vscode.ShellExecution(commandLine));
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: true, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    let execution: vscode.TaskExecution | undefined;
    const listener = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution === execution) {
        listener.dispose();
        resolve(event.exitCode);
      }
    });
    vscode.tasks.executeTask(task).then(
      (started) => {
        execution = started;
      },
      () => {
        listener.dispose();
        resolve(undefined);
      },
    );
  });
}

/**
 * Installs an external formatter after the user has seen and approved the exact command. The
 * command runs in a visible VS Code terminal, never in the background. Returns true when the
 * formatter is available afterwards.
 */
export async function installFormatter(app: CodeNeatApp, formatterId: string): Promise<boolean> {
  const descriptor = app.registry.get(formatterId)?.descriptor;
  if (!descriptor) {
    return false;
  }
  const name = descriptor.displayName;
  if (descriptor.kind !== 'external') {
    vscode.window.showInformationMessage(`CodeNeat: ${name} is already included; there is nothing to install.`);
    return true;
  }
  if (!vscode.workspace.isTrusted) {
    const trust = 'Manage Workspace Trust';
    const choice = await vscode.window.showWarningMessage(`CodeNeat: External formatters such as ${name} cannot be installed or used in Restricted Mode.`, trust);
    if (choice === trust) {
      await vscode.commands.executeCommand('workbench.trust.manage');
    }
    return false;
  }

  const guide = 'Open Installation Guide';
  const plan = await planInstall(descriptor);
  if (!plan) {
    const tools = descriptor.install.commands.map((entry) => entry.label).join(', ');
    const choice = await vscode.window.showWarningMessage(
      `CodeNeat cannot install ${name} automatically on this computer.`,
      { modal: true, detail: `${descriptor.install.summary}\n\nNone of the usual installers was found${tools ? ` (${tools})` : ''}. The installation guide explains how to install ${name} by hand. Afterwards, run "CodeNeat: Re-detect Installed Formatters".` },
      guide,
    );
    if (choice === guide && descriptor.install.url) {
      await vscode.env.openExternal(vscode.Uri.parse(descriptor.install.url));
    }
    return false;
  }

  const run = 'Install in Terminal';
  const choice = await vscode.window.showInformationMessage(
    `Install ${name}?`,
    {
      modal: true,
      detail: `CodeNeat will run this command in a terminal so you can watch it:\n\n${plan.commandLine}\n\nIt downloads and installs ${name} (${descriptor.engine}, licence ${descriptor.license}) on your computer using ${plan.label}. Nothing is installed unless you continue.`,
    },
    run,
    guide,
  );
  if (choice === guide && descriptor.install.url) {
    await vscode.env.openExternal(vscode.Uri.parse(descriptor.install.url));
    return false;
  }
  if (choice !== run) {
    return false;
  }

  app.log.info(`Installing ${name} at the user's request: ${plan.commandLine}`);
  const exitCode = await runInTerminal(`Install ${name}`, plan.commandLine);
  await app.refreshFormatters();
  const status = app.registry.statuses[formatterId];
  if (status?.available) {
    vscode.window.showInformationMessage(`CodeNeat: ${name}${status.version ? ` ${status.version}` : ''} is installed and ready.`);
    return true;
  }
  const again = 'Check Again';
  const answer = await vscode.window.showWarningMessage(
    exitCode === 0
      ? `CodeNeat: The installer finished, but ${name} was not found yet. VS Code may need to be restarted so it can see newly installed programs.`
      : `CodeNeat: ${name} was not installed. See the terminal for what went wrong.`,
    again,
    guide,
  );
  if (answer === again) {
    await app.refreshFormatters();
    return !!app.registry.statuses[formatterId]?.available;
  }
  if (answer === guide && descriptor.install.url) {
    await vscode.env.openExternal(vscode.Uri.parse(descriptor.install.url));
  }
  return false;
}
