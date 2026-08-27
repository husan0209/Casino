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
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-alert': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],
    'no-implicit-coercion': 'error',
    'no-return-assign': 'error',
    'no-throw-literal': 'error',
    'no-duplicate-imports': 'off',
    'curly': ['error', 'all'],
    'brace-style': ['error', '1tbs', { allowSingleLine: false }],

    // ─── TypeScript ───────────────────────────────────────────────
    // CRITICAL: was 'warn'. Money-related code MUST NOT use any.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // ─── Imports ──────────────────────────────────────────────────
    'import/no-duplicates': 'error',
    'import/newline-after-import': 'error',
    // CRITICAL: was 'warn'. Cycles in modules hide dependency problems.
    'import/no-cycle': 'error',
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
    // CRITICAL: was 'warn'. Stale closures cause subtle money bugs (balance, etc).
    'react-hooks/exhaustive-deps': 'error',

    // ─── Function discipline ──────────────────────────────────────
    // CRITICAL: was 'warn'. Long/complex methods hide business logic.
    'max-params': ['warn', 4],
    'max-depth': ['error', 3],
    // TODO(security-hardening): promote back to 'error' after extracting
    // guard-clauses in wallet/casino flows + adding unit tests (follow-up PR)
    'complexity': ['warn', 10],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],

    // ─── Money (docs/CONVENTIONS.md §5, AI_DEVELOPMENT_RULES §1) ─
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
      // Relaxed rules for tests (docs/CONVENTIONS.md §11: tests assert behavior, not size)
      files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts'],
      rules: {
        'max-lines-per-function': 'off',
        'max-params': 'off',
        'complexity': 'off',
        'max-depth': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // ── Module layering: domain/application must NOT import prisma directly ──
      // Catches AUDIT_REPORT §A3, A4, H5: use cases reaching into prisma.* without
      // going through a Repository interface or a Facade. Violates
      // .cursorrules §"Cross-module communication" and AI_DEVELOPMENT_RULES §3.2.
      files: [
        'apps/api/src/modules/**/domain/**/*.ts',
        'apps/api/src/modules/**/application/**/*.ts',
      ],
      rules: {
        // TODO(audit A3/A4/H5): promote back to 'error' after extracting
        // XxxRepository per module (phase-2 wallet/payments refactor)
        'no-restricted-imports': [
          'warn',
          {
            patterns: [
              {
                group: ['@casino/database', '**/node_modules/.prisma/**', '**/.prisma/client/**'],
                message:
                  'Direct prisma import in domain/application is FORBIDDEN. Use a repository interface (IXxxRepository) or another module\'s Facade. See docs/AI_DEVELOPMENT_RULES.md §3.2 and .cursorrules §"Cross-module communication".',
              },
            ],
          },
        ],
      },
    },
    {
      // ── Web/Admin (Next.js) — disable Node-only rules ──
      files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
      env: { browser: true, node: true, es2022: true },
    },
  ],
}
