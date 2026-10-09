import {
  type AdapterEnvironment,
  descriptorDefaults,
  type FormatRequest,
  type FormatterAdapter,
  FormatterError,
  NO_PROJECT_CONFIG,
  type ProjectConfigInfo,
  StyleReader,
} from '../core/adapter';
import { EOL_BY_CODENEAT } from '../core/eol';
import type { CancellationSignal } from '../core/process';
import type { FormatterDescriptor, FormatterStatus } from '../shared/types';

interface SqlFormatterModule {
  format(query: string, options: Record<string, unknown>): string;
}

/** CodeNeat dialect ids → sql-formatter language names. */
export const SQL_FORMATTER_DIALECTS: Record<string, string> = {
  ansi: 'sql',
  postgres: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  sqlite: 'sqlite',
  tsql: 'transactsql',
  oracle: 'plsql',
  bigquery: 'bigquery',
  snowflake: 'snowflake',
  redshift: 'redshift',
  sparksql: 'spark',
  trino: 'trino',
  hive: 'hive',
  db2: 'db2',
};

export const SQL_FORMATTER_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'sql-formatter',
  displayName: 'SQL Formatter',
  kind: 'bundled',
  engine: 'sql-formatter',
  license: 'MIT',
  homepage: 'https://github.com/sql-formatter-org/sql-formatter',
  languages: ['sql'],
  extensions: ['.sql'],
  requirement: 'Bundled with CodeNeat.',
  install: {
    summary: 'SQL Formatter is bundled with CodeNeat, so there is nothing to install.',
    commands: [],
    url: 'https://github.com/sql-formatter-org/sql-formatter',
  },
  options: {
    lineEndings: { native: EOL_BY_CODENEAT, support: 'full', default: 'auto' },
    indentStyle: { native: 'useTabs', support: 'full', default: 'spaces' },
    indentSize: { native: 'tabWidth', support: 'full', default: 2 },
    maxBlankLines: {
      native: 'linesBetweenQueries',
      support: 'partial',
      default: 1,
      note: 'Sets the number of blank lines placed between statements.',
    },
    sqlDialect: { native: 'language', support: 'full', default: 'ansi' },
    sqlKeywordCase: { native: 'keywordCase', support: 'full', default: 'preserve' },
  },
  lineLength: 'none',
  lineLengthNote: 'SQL Formatter always puts each clause on its own line and has no line-length setting.',
  cancellation: 'discard-result',
  configFiles: [],
  limitations: [
    'There is no line-length setting: every clause goes on its own line.',
    'Stored-procedure bodies in vendor-specific languages are formatted on a best-effort basis; choose the matching dialect.',
  ],
};

function loadSqlFormatter(): SqlFormatterModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('sql-formatter') as SqlFormatterModule;
}

function bundledVersion(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('sql-formatter/package.json') as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export class SqlFormatterAdapter implements FormatterAdapter {
  readonly descriptor = SQL_FORMATTER_DESCRIPTOR;

  reset(): void {
    // nothing is cached
  }

  async detect(): Promise<FormatterStatus> {
    try {
      loadSqlFormatter();
      return { id: this.descriptor.id, available: true, version: bundledVersion(), path: 'bundled with CodeNeat', origin: 'bundled' };
    } catch (error) {
      return { id: this.descriptor.id, available: false, problem: `SQL Formatter could not be loaded: ${String(error)}` };
    }
  }

  async readProjectConfig(): Promise<ProjectConfigInfo> {
    return NO_PROJECT_CONFIG;
  }

  async format(request: FormatRequest, _env: AdapterEnvironment, token: CancellationSignal): Promise<string> {
    if (request.range) {
      throw new FormatterError('unsupported', 'SQL Formatter cannot format only a selection.');
    }
    const style = StyleReader.of(request);
    const options: Record<string, unknown> = {
      language: SQL_FORMATTER_DIALECTS[style.str('sqlDialect') ?? 'ansi'] ?? 'sql',
    };
    if (style.num('indentSize') !== undefined) {
      options.tabWidth = style.num('indentSize');
    }
    if (style.useTabs !== undefined) {
      options.useTabs = style.useTabs;
    }
    if (style.str('sqlKeywordCase')) {
      options.keywordCase = style.str('sqlKeywordCase');
    }
    if (style.num('maxBlankLines') !== undefined) {
      options.linesBetweenQueries = style.num('maxBlankLines');
    }
    try {
      const formatted = loadSqlFormatter().format(request.text, options);
      if (token.isCancellationRequested) {
        throw new FormatterError('cancelled', 'Formatting was cancelled.');
      }
      // sql-formatter omits the final newline; files conventionally end with one.
      return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
    } catch (error) {
      if (error instanceof FormatterError) {
        throw error;
      }
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      throw new FormatterError(
        'failed',
        `SQL Formatter could not read this file, so nothing was changed. Check that the SQL dialect is right.\n${message}`,
      );
    }
  }
}
