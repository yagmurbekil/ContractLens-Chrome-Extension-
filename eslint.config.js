import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-harness', 'dist-e2e', 'node_modules', 'cypress/videos', 'cypress/screenshots', 'eval/results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'cypress.config.ts', 'cypress/**/*.ts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly', window: 'readonly', document: 'readonly', chrome: 'readonly' } },
  },
);
