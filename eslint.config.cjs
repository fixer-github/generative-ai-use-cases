const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const reactRefreshPlugin = require('eslint-plugin-react-refresh');
const tailwindcssPlugin = require('eslint-plugin-tailwindcss');
const ymlPlugin = require('eslint-plugin-yml');
const yamlParser = require('yaml-eslint-parser');
const i18nhelperPlugin = require('eslint-plugin-i18nhelper');
const shopifyPlugin = require('@shopify/eslint-plugin');

module.exports = defineConfig([
  js.configs.recommended,
  // For cdk, common
  {
    files: ['packages/{cdk,common}/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      i18nhelper: i18nhelperPlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      ...typescriptPlugin.configs['eslint-recommended'].rules,
      ...typescriptPlugin.configs.recommended.rules,
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-redeclare': 'off',
      'i18nhelper/no-jp-string': 'off',
      'i18nhelper/no-jp-comment': 'off',
    },
  },
  // For cdk Lambda files (AWS Lambda streaming)
  {
    files: ['packages/cdk/lambda/**/*.ts'],
    languageOptions: {
      globals: {
        NodeJS: 'readonly',
        awslambda: 'readonly',
      },
    },
  },
  // For cdk test files
  {
    files: ['packages/cdk/**/*.test.ts', 'packages/cdk/test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // For cdk JavaScript files (Lambda, CloudFront Functions, custom-resources)
  {
    files: ['packages/cdk/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2020,
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // For CloudFront Functions (special runtime)
  {
    files: ['packages/cdk/cloudfront-functions/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        handler: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
  // For web
  {
    files: ['packages/web/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      tailwindcss: tailwindcssPlugin,
      i18nhelper: i18nhelperPlugin,
      '@shopify': shopifyPlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    settings: {
      tailwindcss: {
        whitelist: [
          'w-',
          'h-',
          'aws-.*',
          'border-aws-.*',
          'bg-aws-.*',
          'text-aws-.*',
          'data-\\[.*\\]:.*',
          'animate-.*',
          'fade-.*',
          'zoom-.*',
          'font-mono',
          'bg-opacity-.*',
        ],
      },
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescriptPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...tailwindcssPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'i18nhelper/no-jp-string': 'off',
      'i18nhelper/no-jp-comment': 'off',
      '@shopify/jsx-no-hardcoded-content': 'off',
    },
  },
  // For yaml files
  {
    files: ['**/*.{yaml,yml}'],
    plugins: {
      yml: ymlPlugin,
    },
    languageOptions: {
      parser: yamlParser,
    },
    rules: {
      ...ymlPlugin.configs.standard.rules,
      'yml/sort-keys': 'error',
      'yml/quotes': ['error', { prefer: 'single', avoidEscape: true }],
    },
  },
  // General rules
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: [
      'packages/cdk/cdk.out/**',
      'packages/{cdk,common}/*.config.cjs',
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/*.config.ts',
    ],
  },
]);
