import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'src/generated/'] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // () => resolve() and similar callbacks are the usual shorthand
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // The SDK never prints by itself: warnings go to the onWarning option
      'no-console': 'error',
    },
  },
  { files: ['**/*.js', '**/*.mjs', '**/*.cjs'], extends: [tseslint.configs.disableTypeChecked] },
  // The CommonJS smoke consumer checks require() of the package on purpose
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['**/*.test.ts', '**/*.test-d.ts', 'test/**', 'scripts/**', 'examples/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', 'no-console': 'off' },
  },
  {
    // NestJS modules are empty classes with a decorator
    files: ['examples/**'],
    rules: { '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }] },
  },
  {
    // expectTypeOf(psp.invoices.create) looks at a method without calling it
    files: ['**/*.test-d.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
);
