const js = require('@eslint/js');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const i18nhelper = require('eslint-plugin-i18nhelper');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      i18nhelper: i18nhelper,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    rules: {
      ...typescriptPlugin.configs['eslint-recommended'].rules,
      ...typescriptPlugin.configs.recommended.rules,
      '@typescript-eslint/no-namespace': 'off',
      'i18nhelper/no-jp-string': 'warn',
      'i18nhelper/no-jp-comment': 'warn',
    },
  },
  {
    ignores: ['cdk.out/**', '*.config.cjs', 'eslint.config.cjs'],
  },
];
