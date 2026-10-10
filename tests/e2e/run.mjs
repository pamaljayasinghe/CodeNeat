// Launches a real VS Code with CodeNeat loaded and runs tests/e2e/suite.ts inside it.
//   node tests/e2e/run.mjs          → tests the extension from this folder (after `npm run build:dev`)
//   node tests/e2e/run.mjs --vsix   → installs codeneat.vsix into a throw-away profile and tests that
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

// When this script is started from a VS Code terminal or task, these variables would make the
// test instance behave like a plain Node process or attach to the parent window.
for (const name of Object.keys(process.env)) {
  if (name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('VSCODE_')) {
    delete process.env[name];
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const useVsix = process.argv.includes('--vsix');
const scratch = mkdtempSync(join(tmpdir(), 'codeneat-e2e-'));
const workspace = join(scratch, 'workspace');
cpSync(join(root, 'tests', 'fixtures'), workspace, { recursive: true });

// A fresh profile opens the Chat view, whose input box takes the keyboard focus at an unpredictable
// moment. Keyboard commands such as Undo would then go to that box instead of the editor under test.
const userSettings = join(scratch, 'profile', 'User');
mkdirSync(userSettings, { recursive: true });
writeFileSync(
  join(userSettings, 'settings.json'),
  JSON.stringify({ 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'chat.disableAIFeatures': true, 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off' }, null, 2),
);

// Newer macOS builds name the binary "Code"; older ones (and the test downloader) expect "Electron".
function existing(candidate) {
  if (!candidate) {
    return undefined;
  }
  return [candidate, join(dirname(candidate), 'Code'), join(dirname(candidate), 'Electron')].find((path) => existsSync(path));
}
const vscodeExecutablePath =
  existing(process.env.CODENEAT_VSCODE_PATH) ??
  existing('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ??
  existing(await downloadAndUnzipVSCode('stable'));
if (!vscodeExecutablePath) {
  throw new Error('Could not find a VS Code executable. Set CODENEAT_VSCODE_PATH.');
}
console.log(`VS Code: ${vscodeExecutablePath}`);

let extensionDevelopmentPath = root;
let exitCode = 0;
try {
  if (useVsix) {
    const vsix = join(root, 'codeneat.vsix');
    if (!existsSync(vsix)) {
      throw new Error('codeneat.vsix not found. Run "npm run package" first.');
    }
    const installDir = join(scratch, 'installed-extensions');
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    const args = [...cliArgs.filter((arg) => !arg.startsWith('--extensions-dir') && !arg.startsWith('--user-data-dir')),
      '--extensions-dir', installDir, '--user-data-dir', join(scratch, 'install-profile'), '--install-extension', vsix, '--force'];
    const install = spawnSync(cli, args, { encoding: 'utf8' });
    console.log((install.stdout + install.stderr).trim());
    if (install.status !== 0) {
      throw new Error('VS Code could not install codeneat.vsix');
    }
    const installed = readdirSync(installDir).find((name) => name.startsWith('pamaljayasinghe.codeneat-'));
    if (!installed) {
      throw new Error('The VSIX was not installed into the extensions directory.');
    }
    extensionDevelopmentPath = join(installDir, installed);
    const manifest = JSON.parse(readFileSync(join(extensionDevelopmentPath, 'package.json'), 'utf8'));
    console.log(`Installed from VSIX: ${manifest.publisher}.${manifest.name} ${manifest.version} → ${extensionDevelopmentPath}`);
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: join(root, 'out', 'e2e', 'suite.js'),
    extensionTestsEnv: {
      CODENEAT_E2E_WORKSPACE: workspace,
      CODENEAT_E2E_RESULTS: process.env.CODENEAT_E2E_RESULTS ?? '',
    },
    launchArgs: [
      workspace,
      '--user-data-dir', join(scratch, 'profile'),
      '--extensions-dir', join(scratch, 'extensions'),
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      '--disable-telemetry',
    ],
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(exitCode);
