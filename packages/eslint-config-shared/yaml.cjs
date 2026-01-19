const ymlPlugin = require('eslint-plugin-yml');
const yamlParser = require('yaml-eslint-parser');

const yamlConfig = {
  files: ['**/*.{yaml,yml}'],
  plugins: {
    yml: ymlPlugin,
  },
  languageOptions: {
    parser: yamlParser,
  },
  rules: {
    ...ymlPlugin.configs.standard.rules,
    'yml/sort-keys': 'off', // Disabled: expensive regex-based sorting significantly slows CI
    'yml/quotes': ['error', { prefer: 'single', avoidEscape: true }],
  },
};

module.exports = {
  yamlConfig,
};
