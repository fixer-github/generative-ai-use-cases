module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['cdk.out', '.eslintrc.cjs', 'custom-resources/**', 'dist'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'i18nhelper', '@shopify'],
  rules: {
    '@typescript-eslint/no-namespace': 'off',
    // Detect Japanese strings
    'i18nhelper/no-jp-string': 'warn',
    'i18nhelper/no-jp-comment': 'warn',
    // Apply JSX rules
    '@shopify/jsx-no-hardcoded-content': 'warn',
  },
  overrides: [
    {
      // Chat Web 検索ツールの実装。ツール説明文・エラーメッセージ・trace 文言は
      // LLM へ Japanese で渡すことを意図しているため i18n 警告の対象外とする。
      files: [
        'lambda/utils/bedrockApiWithTools.ts',
        'lambda/utils/safeFetch.ts',
        'lambda/utils/webSearchTool.ts',
        'scripts/test-web-search.ts',
      ],
      rules: {
        'i18nhelper/no-jp-string': 'off',
        'i18nhelper/no-jp-comment': 'off',
      },
    },
  ],
};
