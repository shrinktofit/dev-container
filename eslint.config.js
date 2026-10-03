import { defineConfig, globalIgnores } from 'eslint/config';
import stf from '@shrinktofit/eslint-config';
import node from '@shrinktofit/eslint-config/node';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/lib/',
    '**/lib-types/',
    '**/dist/',
    '**/.deploy/',
    '**/.turbo/',
    '**/.dev-container/',
    '.test-runs/',
  ]),
  { settings: { node: { version: '>=26.0.0' } } },
  ...vue.configs['flat/recommended'],
  ...stf.configs.recommended,
  ...stf.configs.conventions,
  ...node.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
        projectService: {
          defaultProject: 'tsconfig.eslint.json',
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 32,
          allowDefaultProject: [
            'eslint.config.js',
            'packages/*/vite.config.ts',
            'packages/*/tsdown.config.ts',
            'packages/*/electron.vite.config.ts',
            'scripts/*.ts',
          ],
        },
      },
    },
    rules: {
      // Workspace exports, build tooling and shared test runtimes are resolved by TypeScript.
      'n/no-extraneous-import': 'off',
      'n/no-unpublished-import': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    // Electron 42.6.0 embeds Node 24.18.0; tools run with the repository's Node 26 baseline.
    files: ['packages/*/src/main/**/*.ts', 'packages/dev-container/src/preload/**/*.ts'],
    settings: { node: { version: '>=24.18.0' } },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      globals: globals.browser,
      parserOptions: { parser: '@typescript-eslint/parser' },
    },
    rules: {
      // Vue's script rule handles indentation inside single-file components.
      '@stylistic/indent': 'off',
      'vue/html-indent': ['error', 2],
      'vue/script-indent': [
        'error',
        2,
        { switchCase: 0 },
      ],
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
  {
    files: ['packages/*/src/renderer/**/*.ts', 'packages/dev-container-sdk/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: { 'n/no-unsupported-features/node-builtins': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      // Extension hooks and IPC handlers expose intentional Promise-returning contracts.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': [
        'error',
        {
          allow: [
            'arrowFunctions',
            'asyncMethods',
            'constructors',
            'methods',
            'overrideMethods',
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      // Browser callbacks execute inside the fixture page, outside the test process.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
]);
