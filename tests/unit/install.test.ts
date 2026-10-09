import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { EXTERNAL_SPECS } from '../../src/core/registry';
import { planInstall } from '../../src/vscode/install';

const descriptor = (id: string) => {
  const found = EXTERNAL_SPECS.find((spec) => spec.descriptor.id === id)?.descriptor;
  if (!found) {
    throw new Error(id);
  }
  return found;
};
const having = (...programs: string[]) => async (program: string) => programs.includes(program);

describe('choosing an install command', () => {
  it('uses the first installer that exists on this computer', async () => {
    expect(await planInstall(descriptor('rustfmt'), 'darwin', having('rustup'))).toEqual({ label: 'rustup', commandLine: 'rustup component add rustfmt' });
    expect(await planInstall(descriptor('rubocop'), 'darwin', having('gem'))).toEqual({ label: 'gem', commandLine: 'gem install rubocop' });
    expect(await planInstall(descriptor('ktfmt'), 'darwin', having('brew'))).toEqual({ label: 'Homebrew', commandLine: 'brew install ktfmt' });
    expect((await planInstall(descriptor('scalafmt'), 'linux', having('brew')))?.commandLine).toBe('brew install scalafmt');
    expect((await planInstall(descriptor('scalafmt'), 'linux', having('cs', 'brew')))?.commandLine).toBe('cs install scalafmt');
    expect((await planInstall(descriptor('fantomas'), 'win32', having('dotnet')))?.commandLine).toBe('dotnet tool install -g fantomas');
  });

  it('offers a working installer on Windows, macOS and Linux for the languages that need one', async () => {
    const typical: Record<string, string[]> = {
      win32: ['rustup', 'gem', 'dotnet', 'cs', 'powershell', 'winget', 'pip'],
      darwin: ['rustup', 'gem', 'dotnet', 'cs', 'pwsh', 'brew', 'pip3'],
      linux: ['rustup', 'gem', 'dotnet', 'cs', 'pwsh', 'curl', 'pip3'],
    };
    // rustfmt, RuboCop, scalafmt, Fantomas, PSScriptAnalyzer and Air install the same way everywhere.
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const id of ['rustfmt', 'rubocop', 'scalafmt', 'fantomas', 'psscriptanalyzer', 'air']) {
        expect(await planInstall(descriptor(id), platform, having(...typical[platform])), `${id} on ${platform}`).toBeDefined();
      }
    }
    expect((await planInstall(descriptor('terraform-fmt'), 'win32', having('winget')))?.commandLine).toBe('winget install Hashicorp.Terraform');
    expect((await planInstall(descriptor('air'), 'win32', having('powershell')))?.commandLine).toContain('air-installer.ps1');
    expect((await planInstall(descriptor('air'), 'linux', having('curl')))?.commandLine).toContain('air-installer.sh');
    // No dependable one-line installer exists for these, so the guide is opened instead.
    expect(await planInstall(descriptor('ktfmt'), 'win32', having(...typical.win32))).toBeUndefined();
    expect(await planInstall(descriptor('terraform-fmt'), 'linux', having(...typical.linux))).toBeUndefined();
  });

  it('returns nothing when no installer is available, instead of guessing', async () => {
    expect(await planInstall(descriptor('rustfmt'), 'darwin', having())).toBeUndefined();
    expect(await planInstall(descriptor('ktfmt'), 'win32', having('brew'))).toBeUndefined();
    expect(await planInstall(descriptor('clang-format'), 'darwin', having('apt', 'winget'))).toBeUndefined();
  });

  it('adapts pip, PowerShell and R commands so they run from a terminal', async () => {
    expect((await planInstall(descriptor('ruff'), 'darwin', having('pip3')))?.commandLine).toBe('pip3 install ruff');
    expect((await planInstall(descriptor('psscriptanalyzer'), 'darwin', having('pwsh')))?.commandLine).toBe(
      'pwsh -NoProfile -Command "Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force"',
    );
    expect((await planInstall(descriptor('psscriptanalyzer'), 'win32', having('powershell')))?.commandLine).toMatch(/^powershell -NoProfile/);
    expect(await planInstall(descriptor('psscriptanalyzer'), 'darwin', having('brew'))).toBeUndefined();
    expect((await planInstall(descriptor('styler'), 'darwin', having('Rscript')))?.commandLine).toContain("install.packages('styler'");
    expect((await planInstall(descriptor('air'), 'darwin', having('brew', 'curl')))?.commandLine).toBe('brew install air');
  });
});
