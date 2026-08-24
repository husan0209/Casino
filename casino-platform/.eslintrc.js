module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'import', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  settings: {
    'import/resolver': { typescript: { alwaysTryTypes: true } },
  },
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'build', '.next', 'node_modules', 'prisma/generated', 'coverage'],
  rules: {
    // ─── General quality ──────────────────────────────────────────
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-alert': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],
    'no-implicit-coercion': 'error',
    'no-return-assign': 'error',
    'no-throw-literal': 'error',
    'no-duplicate-imports': 'off',

    // ─── TypeScript ───────────────────────────────────────────────
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // ─── Imports ──────────────────────────────────────────────────
    'import/no-duplicates': 'error',
    'import/newline-after-import': 'error',
    'import/no-cycle': 'warn',
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
        pathGroups: [
          { pattern: '@/**', group: 'internal', position: 'after' },
          { pattern: '@casino/**', group: 'internal', position: 'after' },
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],

    // ─── React ────────────────────────────────────────────────────
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // ─── Function discipline ──────────────────────────────────────
    'max-params': ['warn', 3],
    'max-depth': ['warn', 3],
    'complexity': ['warn', 10],
    'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],

    // ─── Money (docs/CONVENTIONS.md 5.3) ──────────────────────────
    // Money is MoneyAmount (string) + decimal.js. Never number/float.
    'no-restricted-globals': [
      'error',
      {
        name: 'parseFloat',
        message: 'parseFloat is forbidden for money. Use money.* helpers from @casino/shared-utils.',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "Property[key.name=/^(amount|balance|price|fee|sum|total|profit|reward|locked)$/][value.type='Literal'][value.raw=/^\\d+(\\.\\d+)?(?!n)/]",
        message:
          'Monetary values must be MoneyAmount (string). Use money.* helpers from @casino/shared-utils.',
      },
      {
        selector:
          "VariableDeclarator[id.name=/^(amount|balance|price|fee|sum|total|profit|reward|locked)$/][init.type='Literal'][init.raw=/^\\d+(\\.\\d+)?(?!n)/]",
        message:
          'Monetary values must be MoneyAmount (string). Use money.* helpers from @casino/shared-utils.',
      },
    ],
  },
  overrides: [
    {
      // Relaxed rules for tests (docs/CONVENTIONS.md: tests assert behavior, not size)
      files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts'],
      rules: {
        'max-lines-per-function': 'off',
        'max-params': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
}
