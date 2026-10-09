import { compareVersions } from '../../core/executables';
import { runTool } from '../../core/process';
import type { ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** swift-format — https://github.com/swiftlang/swift-format/blob/main/Documentation/Configuration.md */
export const swiftFormat: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'swift-format',
    displayName: 'swift-format',
    engine: 'swift-format (Apple)',
    license: 'Apache-2.0',
    homepage: 'https://github.com/swiftlang/swift-format',
    languages: ['swift'],
    extensions: ['.swift'],
    requirement: 'The "swift-format" executable. It ships with Xcode 16 and with Swift 6 toolchains.',
    executables: ['swift-format'],
    install: {
      summary: 'swift-format ships with Xcode 16 and Swift 6. On older setups install it with Homebrew.',
      commands: [{ label: 'Homebrew', command: 'brew install swift-format' }],
      url: 'https://github.com/swiftlang/swift-format#getting-swift-format',
    },
    options: {
      lineLength: { native: 'lineLength', support: 'full', default: 100, note: 'swift-format wraps code at this width where it can; long strings are not split.' },
      indentStyle: { native: 'indentation', support: 'full', default: 'spaces' },
      indentSize: { native: 'indentation.spaces / tabWidth', support: 'full', default: 2 },
      maxBlankLines: { native: 'maximumBlankLines', support: 'full', default: 1 },
    },
    fixed: {
      braceStyle: fixed('attach', 'swift-format always keeps the opening brace on the same line.'),
    },
    lineLength: 'preferred',
    rangeLanguages: ['swift'],
    configFiles: ['.swift-format'],
    limitations: ['Only line length, indentation and blank lines are exposed; other rules can be set in a .swift-format file.'],
  }),
  versionArgs: ['--version'],
  versionOptional: true,
  // Xcode keeps swift-format inside the toolchain rather than on PATH.
  async locateFallback() {
    if (process.platform !== 'darwin') {
      return undefined;
    }
    const result = await runTool('/usr/bin/xcrun', ['--find', 'swift-format'], { timeoutMs: 8000 });
    const found = result.stdout.trim();
    return result.code === 0 && found.startsWith('/') ? found : undefined;
  },
  async build({ request, style, applyStyle, writeTemp, byteRange }) {
    const args = ['format', '--assume-filename', request.filePath ?? request.fileName];
    if (applyStyle) {
      const config: Record<string, unknown> = { version: 1 };
      if (style.num('lineLength') !== undefined) {
        config.lineLength = style.num('lineLength');
      }
      if (style.indentChosen) {
        const size = style.effectiveNum('indentSize') ?? 2;
        config.indentation = style.effectiveUseTabs ? { tabs: 1 } : { spaces: size };
        config.tabWidth = size;
      }
      if (style.num('maxBlankLines') !== undefined) {
        config.maximumBlankLines = style.num('maxBlankLines');
      }
      args.push('--configuration', await writeTemp('swift-format.json', JSON.stringify(config)));
    } else if (request.projectConfigFile) {
      args.push('--configuration', request.projectConfigFile);
    }
    if (byteRange) {
      args.push('--offsets', `${byteRange.start}:${byteRange.end}`);
    }
    return [{ mode: 'stdin', args }];
  },
  explainFailure: (result) =>
    result.stderr
      .split('\n')
      .map((line) => line.replace(/^.*<stdin>:/, 'line '))
      .filter((line) => line.trim())
      .slice(0, 5)
      .join('\n') || undefined,
};

/** dart format — https://dart.dev/tools/dart-format */
export const dartFormat: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'dart-format',
    displayName: 'dart format',
    engine: 'dart format (dart_style)',
    license: 'BSD-3-Clause',
    homepage: 'https://dart.dev/tools/dart-format',
    languages: ['dart'],
    extensions: ['.dart'],
    requirement: 'The "dart" executable from the Dart or Flutter SDK.',
    executables: ['dart'],
    install: {
      summary: 'dart format is part of the Dart SDK, which is also included in Flutter.',
      commands: [
        { label: 'Homebrew', command: 'brew install dart-sdk' },
        { label: 'Chocolatey', command: 'choco install dart-sdk' },
      ],
      url: 'https://dart.dev/get-dart',
    },
    options: {
      lineLength: { native: '--page-width (--line-length before Dart 3.7)', support: 'full', default: 80, note: 'dart format aims for this width; long strings are not split.' },
    },
    fixed: {
      indentStyle: fixed('spaces', 'dart format always indents with 2 spaces.'),
      indentSize: fixed(2, 'dart format always indents with 2 spaces.'),
      braceStyle: fixed('attach', 'dart format always keeps the opening brace on the same line.'),
    },
    lineLength: 'preferred',
    configFiles: ['analysis_options.yaml'],
    limitations: ['Only the page width can be configured.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /dart/i,
  prefixArgs: ['format'],
  configMatches: (_fileName, content) => /^formatter:/m.test(content),
  build({ request, style, applyStyle, version }) {
    const args: string[] = [];
    if (applyStyle && style.num('lineLength') !== undefined) {
      const modern = !version || compareVersions(version, '3.7.0') >= 0;
      args.push(modern ? '--page-width' : '--line-length', String(style.num('lineLength')));
    }
    if (request.filePath) {
      args.push('--stdin-name', request.filePath);
    }
    return [{ mode: 'stdin', args }];
  },
};
