import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**', 'tests/fixtures/**', 'src/shared/samples.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      curly: ['error', 'all'],
    },
  },
  {
    // Extension-host code must never start a shell: all tools go through src/core/process.ts.
    files: ['src/**/*.ts'],
    ignores: ['src/core/process.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'node:child_process', message: 'Use runTool from src/core/process.ts.' }, { name: 'child_process', message: 'Use runTool from src/core/process.ts.' }] },
      ],
    },
  },
  {
    files: ['scripts/**', 'tests/e2e/run.mjs', 'tests/helpers/*.cjs', 'webview/sidebar/*.js', '*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', require: 'readonly', module: 'readonly', __dirname: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', document: 'readonly', acquireVsCodeApi: 'readonly', Element: 'readonly', URL: 'readonly', fetch: 'readonly', Buffer: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
