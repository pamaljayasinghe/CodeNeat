import { compareVersions } from '../../core/executables';
import type { ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** CSharpier — https://csharpier.com/docs/CLI */
export const csharpier: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'csharpier',
    displayName: 'CSharpier',
    engine: 'CSharpier',
    license: 'MIT',
    homepage: 'https://csharpier.com',
    languages: ['csharp'],
    extensions: ['.cs'],
    requirement: 'The "csharpier" .NET tool (needs the .NET SDK).',
    executables: ['csharpier', 'dotnet-csharpier'],
    install: {
      summary: 'Install CSharpier as a .NET global tool.',
      commands: [{ label: '.NET', command: 'dotnet tool install -g csharpier' }],
      url: 'https://csharpier.com/docs/Installation',
    },
    options: {
      lineLength: { native: 'printWidth', support: 'full', default: 100, note: 'CSharpier aims for this width; it is not a hard limit.' },
      indentStyle: { native: 'useTabs', support: 'full', default: 'spaces' },
      indentSize: { native: 'indentSize', support: 'full', default: 4 },
    },
    fixed: {
      braceStyle: fixed('allman', 'CSharpier always puts opening braces on their own line.'),
    },
    lineLength: 'preferred',
    configFiles: ['.csharpierrc', '.csharpierrc.json', '.csharpierrc.yaml', '.csharpierrc.yml'],
    limitations: ['CSharpier is opinionated: only line length and indentation can be configured.'],
  }),
  versionArgs: ['--version'],
  localBin: [],
  async build({ request, style, applyStyle, version, writeTemp }) {
    // CSharpier 1.0 moved formatting under the "format" sub-command.
    const args = version && compareVersions(version, '1.0.0') < 0 ? [] : ['format'];
    if (applyStyle) {
      const config: Record<string, unknown> = {};
      if (style.num('lineLength') !== undefined) {
        config.printWidth = style.num('lineLength');
      }
      if (style.useTabs !== undefined) {
        config.useTabs = style.useTabs;
      }
      if (style.num('indentSize') !== undefined) {
        config.indentSize = style.num('indentSize');
        config.tabWidth = style.num('indentSize');
      }
      if (Object.keys(config).length > 0) {
        args.push('--config-path', await writeTemp('.csharpierrc.json', JSON.stringify(config)));
      }
    } else if (request.projectConfigFile) {
      args.push('--config-path', request.projectConfigFile);
    }
    return [{ mode: 'stdin', args }];
  },
};

/** Fantomas — https://fsprojects.github.io/fantomas/docs/end-users/Configuration.html */
export const fantomas: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'fantomas',
    displayName: 'Fantomas',
    engine: 'Fantomas',
    license: 'Apache-2.0',
    homepage: 'https://fsprojects.github.io/fantomas/',
    languages: ['fsharp'],
    extensions: ['.fs', '.fsi', '.fsx'],
    requirement: 'The "fantomas" .NET tool (needs the .NET SDK).',
    executables: ['fantomas'],
    install: {
      summary: 'Install Fantomas as a .NET global tool.',
      commands: [{ label: '.NET', command: 'dotnet tool install -g fantomas' }],
      url: 'https://fsprojects.github.io/fantomas/docs/end-users/GettingStarted.html',
    },
    options: {
      lineLength: { native: 'max_line_length (.editorconfig)', support: 'full', default: 120, note: 'Fantomas aims for this width; it is not a hard limit.' },
      indentSize: { native: 'indent_size (.editorconfig)', support: 'full', default: 4 },
    },
    fixed: {
      indentStyle: fixed('spaces', 'F# does not allow tabs for indentation.'),
    },
    lineLength: 'preferred',
    limitations: [
      'Fantomas is run on a private temporary copy of the file, so Fantomas-specific "fsharp_*" keys in your project\'s .editorconfig are not applied. Standard .editorconfig keys are.',
    ],
  }),
  versionArgs: ['--version'],
  versionCheck: /fantomas/i,
  async build({ style, applyStyle, inputFile, writeTemp }) {
    const lines = ['root = true', '', '[*.{fs,fsx,fsi}]'];
    if (applyStyle) {
      if (style.num('lineLength') !== undefined) {
        lines.push(`max_line_length = ${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        lines.push(`indent_size = ${style.num('indentSize')}`);
      }
    }
    await writeTemp('.editorconfig', `${lines.join('\n')}\n`);
    return [{ mode: 'file', args: [await inputFile()], cwdIsTemp: true }];
  },
};
