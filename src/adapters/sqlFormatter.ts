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
import { CATALOG } from '../shared/catalog';
import type { FormatterDescriptor, FormatterStatus } from '../shared/types';

interface SqlDialect {
  tokenizerOptions: Record<string, unknown> & { reservedFunctionNames: string[] };
}

type SqlFormatterModule = {
  format(query: string, options: Record<string, unknown>): string;
  formatDialect(query: string, options: Record<string, unknown>): string;
} & Record<string, unknown>;

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

const dialects = new Map<string, SqlDialect>();

/**
 * sql-formatter writes a space before the bracket of every function it does not know (`now ()`),
 * and some databases reject that for their built-in functions. Names the query itself writes
 * directly against a bracket are therefore handed to the formatter as function names.
 */
function dialectFor(sql: SqlFormatterModule, language: string, query: string, plainStrings = false): SqlDialect | undefined {
  const base = sql[language] as SqlDialect | undefined;
  if (!base?.tokenizerOptions || !Array.isArray(base.tokenizerOptions.reservedFunctionNames)) {
    return undefined;
  }
  const reserved = new Set<string>();
  for (const [key, value] of Object.entries(base.tokenizerOptions)) {
    if (key.startsWith('reserved') && Array.isArray(value)) {
      for (const phrase of value) {
        for (const word of String(phrase).split(' ')) {
          reserved.add(word);
        }
      }
    }
  }
  const called = new Set<string>();
  for (const match of query.matchAll(/([A-Za-z_][\w$]*)\(/g)) {
    const name = match[1].toUpperCase();
    if (!reserved.has(name)) {
      called.add(name);
    }
  }
  if (called.size === 0 && !plainStrings) {
    return base;
  }
  const names = [...called].sort();
  const key = `${language}:${plainStrings}:${names.join(',')}`;
  let dialect = dialects.get(key);
  if (!dialect) {
    const tokenizerOptions: SqlDialect['tokenizerOptions'] = { ...base.tokenizerOptions, reservedFunctionNames: [...base.tokenizerOptions.reservedFunctionNames, ...names] };
    if (plainStrings && Array.isArray(tokenizerOptions.stringTypes)) {
      // "''-qq-bs" is a quoted string with backslash escapes; "''-qq" is one without.
      tokenizerOptions.stringTypes = tokenizerOptions.stringTypes.map((type: unknown) =>
        type && typeof type === 'object' && (type as { quote?: string }).quote === "''-qq-bs" ? { ...type, quote: "''-qq" } : type,
      );
    }
    dialect = { ...base, tokenizerOptions };
    dialects.set(key, dialect);
  }
  return dialect;
}

/** Operators that only some databases have. A dialect that does not know one prints it in pieces (`a <= > b`). */
const DIALECT_OPERATORS = ['<=>', '->>', '#>>', '<<', '>>', '=>', '**', '->', '#>', '::', ':=', '&&', '||', '!=', '<>', '<=', '>=', '!~', '~*', '@>', '+=', '-='];

/** The first operator of the query that the formatter pulled apart, if any. */
function brokenOperator(before: string, after: string): string | undefined {
  const count = (text: string, operator: string): number => text.split(operator).length - 1;
  return DIALECT_OPERATORS.find((operator) => count(after, operator) < count(before, operator));
}

/**
 * A call written as `schema.name(` gets a space before its bracket. It is removed again, but only
 * when the query never writes that name with a space itself, so text inside strings stays as it is.
 */
function attachQualifiedCalls(before: string, after: string): string {
  return after.replace(/\.([A-Za-z_][\w$]*) \(/g, (match, name: string) => {
    const escaped = name.replace(/\$/g, '\\$');
    const attached = new RegExp(`\\.${escaped}\\(`, 'i').test(before);
    const spaced = new RegExp(`\\.${escaped}\\s+\\(`, 'i').test(before);
    return attached && !spaced ? `.${name}(` : match;
  });
}

class UnknownOperator extends Error {
  constructor(readonly operator: string) {
    super(`Unknown operator ${operator}`);
  }
}

function dialectLabel(id: string): string {
  const definition = CATALOG.find((candidate) => candidate.id === 'sqlDialect');
  return (definition?.type === 'enum' ? definition.choices.find((choice) => choice.value === id)?.label : undefined) ?? id;
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
    dialects.clear();
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
    const language = SQL_FORMATTER_DIALECTS[style.str('sqlDialect') ?? 'ansi'] ?? 'sql';
    const options: Record<string, unknown> = {};
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
    const sql = loadSqlFormatter();
    const attempt = (dialectName: string, plainStrings = false): string => {
      const dialect = dialectFor(sql, dialectName, request.text, plainStrings);
      const output = dialect ? sql.formatDialect(request.text, { ...options, dialect }) : sql.format(request.text, { ...options, language: dialectName });
      const broken = brokenOperator(request.text, output);
      if (broken) {
        throw new UnknownOperator(broken);
      }
      return attachQualifiedCalls(request.text, output);
    };
    try {
      let formatted: string;
      try {
        formatted = attempt(language);
      } catch (error) {
        // Standard SQL has no backslash escapes, so `escape '\'` is a complete string there.
        if (language !== 'sql' || error instanceof UnknownOperator || !request.text.includes('\\')) {
          throw error;
        }
        try {
          formatted = attempt(language, true);
        } catch {
          throw error;
        }
      }
      if (token.isCancellationRequested) {
        throw new FormatterError('cancelled', 'Formatting was cancelled.');
      }
      // sql-formatter omits the final newline; files conventionally end with one.
      return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
    } catch (error) {
      if (error instanceof FormatterError) {
        throw error;
      }
      // Other dialects that can read the file tell the user what to choose.
      const readable = Object.entries(SQL_FORMATTER_DIALECTS)
        .filter(([, name]) => name !== language)
        .filter(([, name]) => {
          try {
            attempt(name);
            return true;
          } catch {
            return false;
          }
        })
        .slice(0, 4)
        .map(([id]) => dialectLabel(id));
      const advice = readable.length > 0 ? `It can be read as ${readable.join(', ')}: choose your database under "SQL: Dialect".` : 'Check that the SQL dialect is right.';
      const current = dialectLabel(Object.keys(SQL_FORMATTER_DIALECTS).find((id) => SQL_FORMATTER_DIALECTS[id] === language) ?? 'ansi');
      if (error instanceof UnknownOperator) {
        throw new FormatterError('failed', `The "${current}" dialect does not have the operator ${error.operator}, so nothing was changed. ${advice}`);
      }
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      throw new FormatterError('failed', `SQL Formatter could not read this file as "${current}", so nothing was changed. ${advice}\n${message}`);
    }
  }
}
