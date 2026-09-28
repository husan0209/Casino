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
          { pattern: '@modules/**', group: 'internal', position: 'after' },
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
    // GAP-25 закрыт: обещанные в QUALITY_GATES §2.1 error-пороги (3/10).
    // Nest-специфика исключена (см. overrides ниже): controller-хендлеры
    // (параметры навязаны декораторами роутинга) и DI-конструкторы
    // (граф зависимостей) — inline-disable с обоснованием.
    'max-params': ['error', 3],
    'max-depth': ['error', 3],
    'complexity': ['error', 10],
    // Лимит перекалиброван 60→90 под prettier-нормализацию (printWidth 100 растягивает строки).
    // Вернуть к 60 после разбора 14 методов — GAP-30 (вместе с тестами GAP-21/24).
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
      // Nest-хендлеры: сигнатуру задаёт фреймворк (декораторы @Param/@Body/@Req/@Res,
      // express verify(req,res,buf,encoding)) — это не наш API-дизайн (GAP-25).
      // Return-типы хендлеров — HTTP-контракт (см. QUALITY_GATES §2.1.1): interceptor
      // оборачивает в {success,data}, форма проверяется Zod-схемами фронта и E2E.
      files: ['**/*.controller.ts', '**/src/main.ts'],
      rules: {
        'max-params': 'off',
        'explicit-function-return-type': 'off',
      },
    },
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
      // ── DOMAIN layer: no RUNTIME coupling to Nest/Prisma ──
      // Domain не знает ни о Nest, ни о БД в рантайме. Type-only импорты из
      // '@prisma/client' разрешены конвенцией репо (casino.repository.ts):
      // они стираются при компиляции и не создают рантайм-зависимости —
      // рантайм-импорты ловит guard G1 (в т.ч. import()).
      // Rule: docs/AI_DEVELOPMENT_RULES.md §3.2, docs/ARCHITECTURE.md §2.
      files: ['apps/api/src/modules/**/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@nestjs/*'],
                message:
                  'Domain layer MUST be framework-agnostic — no NestJS in domain. See docs/AI_DEVELOPMENT_RULES.md §3.2.',
              },
              {
                group: ['@casino/database', '**/node_modules/.prisma/**', '**/.prisma/client/**'],
                message:
                  'Domain layer MUST NOT depend on the database client at runtime. Use repository interfaces (type-only @prisma/client imports are allowed). See docs/AI_DEVELOPMENT_RULES.md §3.2.',
              },
              {
                group: ['**/infrastructure/**', '**/application/**', '**/presentation/**'],
                message:
                  'Domain cannot import from other layers. See docs/AI_DEVELOPMENT_RULES.md §3.2.',
              },
            ],
          },
        ],
      },
    },
    {
      // ── APPLICATION layer: use-cases go through repository interfaces ──
      // Рантайм-запрет на клиент БД. Последнее нарушение (динамический
      // import('@casino/database') в maintenance/update-rates.job.ts) устранено
      // через порт IExchangeRateWriter — warn поднят до error,
      // TODO(audit A3/A4/H5) закрыт минуя phase-2. Type-only импорты из
      // '@prisma/client' разрешены конвенцией (casino.repository.ts).
      files: ['apps/api/src/modules/**/application/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@casino/database', '**/node_modules/.prisma/**', '**/.prisma/client/**'],
                message:
                  'Application layer MUST NOT import the database client at runtime. Use a repository interface (IXxxRepository) or another module\'s Facade (type-only @prisma/client imports are allowed). See docs/AI_DEVELOPMENT_RULES.md §3.2.',
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
